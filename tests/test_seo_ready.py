from copy import deepcopy
from itertools import islice, permutations
import json
import unittest
from unittest.mock import patch

from automatic_seo import SeoError, numeric_values, normalized_characteristic, grammatical_phrase, unconfirmed_origin_mentions, unsupported_text_properties, confirmed_composition
import test_automatic_seo as fixtures


def response(value):
    return {'choices': [{'message': {'content': json.dumps(value, ensure_ascii=False)}, 'finish_reason': 'stop'}]}, 'fake', 'fake'


class ReadyWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.AutomaticSeoTest(); self.case.setUp()
        self.addCleanup(self.case.tearDown)
        self.service, self.host = self.case.service, self.case.host
        self.card = fixtures.card('1001')
        self.sources = fixtures.sources(self.card, self.case.mapping['1001'])
        self.result = fixtures.generated()
        self.result.update(sources=self.sources, competitorProfile={'structure': ['Назначение'], 'readyRevision': 3,
            'phrases': [{'phrase': 'кран для умывальника', 'quote': 'кран для умывальника'}]})

    def group(self, ids, **kwargs):
        value = {'ids': list(ids), 'relevance': 'релевантен', 'kind': 'quote', 'textId': 'T2',
            'phrase': 'NONE', 'reason': 'Назначение крана для умывальника подтверждено исходной карточкой смесителя.',
            'factIds': ['F1']}
        return dict(value, **kwargs)

    def test_full_workflow_checks_facts_keywords_and_all_queries_before_ready(self):
        self.result['competitorProfile'].pop('readyRevision')
        calls = []
        def answer(messages):
            data = json.loads(messages[1]['content']); calls.append(data)
            if data.get('sku') == self.sources['competitor']['sku']:
                return response({'structure': ['Назначение'], 'phrases': [{'phrase': 'кран для умывальника', 'quote': 'кран для умывальника'}]})
            if 'keywordIds' in data:
                return response({'keywords': {'K0': {'outputPhrase': 'кран для умывальника',
                    'decision': 'использовать', 'reason': 'Назначение соответствует собственному описанию смесителя для раковины.',
                    'factIds': ['F1']}}})
            if data.get('editReadyDescription'):
                return response({'edits': [{'id': 'P0', 'text': fixtures.generated()['description']['value']}], 'appendParagraphs': []})
            if 'sampleQueries' in data:
                return response({'groups': []})
            if 'newCodes' in data:
                return response({'groups': [], 'corrections': []})
            if 'queries' in data:
                return response({'assignments': {key: 'T1' for key in data['queries']}})
            return response({'ready': True, 'problems': [], 'sourceQuestions': []})
        with patch.object(self.host, 'audit_llm_chat_completion', side_effect=answer):
            result = self.service.generate_ready(self.card, self.sources, [], self.result, {})
        self.assertEqual(len(calls), 4)
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['quality']['state'], 'ready')
        self.assertEqual(result['quality']['checkedQueries'], 1)
        self.assertEqual(result['quality']['modelRequests'], 4)
        self.assertEqual(result['competitorProfile']['readyRevision'], 3)
        self.assertEqual(result['semanticDecisions'][0]['witness'], 'кран для умывальника')

    def ready_result(self):
        value = deepcopy(self.result)
        value['semanticDecisions'][0].update(outputPhrase='кран для умывальника', placementReviewed=True,
            reason='Назначение крана для умывальника подтверждено собственным описанием смесителя.',
            groupProof={'source': 'description', 'quote': 'Смеситель для раковины.'})
        value['_queryGroups'] = [dict(self.group([0]), field='описание', quote='кран для умывальника')]
        value['quality'] = {'state': 'ready', 'checkedQueries': 1, 'unresolvedAutomaticCount': 0}
        return value

    def test_ready_label_cannot_bypass_missing_query_proof_or_new_number(self):
        for change in ['proof', 'coverage', 'number', 'unresolved']:
            value = self.ready_result()
            if change == 'proof':
                value['semanticDecisions'][0]['groupProof']['quote'] = 'Нет такой цитаты'
            elif change == 'coverage':
                value['semanticDecisions'] = []
            elif change == 'number':
                value['description']['value'] += ' Объем 999 литров.'
            else:
                value['semanticDecisions'][0]['destination'] = 'требует решения'
            with self.subTest(change=change), self.assertRaises(SeoError):
                self.service.verify_ready_result(self.card, value)

    def test_appending_verified_fact_preserves_existing_query_witness_without_reclassifying_all_queries(self):
        self.sources['semantic'].append({'query': 'материал смесителя'})
        body = fixtures.generated()['description']['value']
        def answer(messages):
            data = json.loads(messages[1]['content'])
            if 'keywordIds' in data:
                return response({'keywords': {'K0': {'outputPhrase': 'кран для умывальника', 'decision': 'использовать',
                    'reason': 'Назначение подтверждено собственным описанием смесителя.', 'factIds': ['F1']}}})
            if data.get('editReadyDescription'):
                return response({'edits': [{'id': 'P0', 'text': body}], 'appendParagraphs': []})
            return response({'ready': True, 'problems': [], 'sourceQuestions': []})
        def resolve(card, result, cache, progress=None, **kwargs):
            result['semanticDecisions'] = [
                {'query': 'кран для умывальника', 'relevance': 'релевантен', 'destination': 'описание',
                 'outputPhrase': body, 'reason': 'Назначение передано полным проверенным абзацем описания смесителя.',
                 'placementReviewed': True, 'groupProof': {'source': 'final:описание', 'quote': body}},
                {'query': 'материал смесителя', 'relevance': 'релевантен', 'destination': 'не добавлять',
                 'outputPhrase': '', 'reason': 'Материал подтверждён собственным описанием и добавляется отдельным фактом.',
                 'placementReviewed': True, 'groupProof': {'source': 'description', 'quote': 'Материал: латунь.'}}]
            result['_queryGroups'] = [
                {'kind': 'quote', 'field': 'описание', 'quote': body, 'ids': [0]},
                {'kind': 'add', 'field': 'описание', 'quote': 'Материал: латунь.', 'ids': [1],
                 'reason': 'Материал подтверждён собственным описанием смесителя.'}]
            return ['Материал: латунь.']
        with (patch.object(self.host, 'audit_llm_chat_completion', side_effect=answer),
              patch.object(self.service, 'resolve_query_groups', side_effect=resolve) as classify):
            result = self.service.generate_ready(self.card, self.sources, [], self.result, {})
        self.assertEqual(classify.call_count, 1)
        self.assertEqual(result['description']['value'], body + '\n\nМатериал: латунь.')
        self.assertEqual(result['semanticDecisions'][0]['witness'], body)
        self.assertEqual(result['semanticDecisions'][1]['witness'], 'Материал: латунь.')
        self.assertEqual(result['quality']['state'], 'ready')

    def test_recheck_of_ready_result_needs_no_model_and_cannot_reuse_legacy(self):
        value = self.ready_result()
        with patch.object(self.service, 'chat', side_effect=AssertionError('unexpected paid call')):
            replay = self.service.generate(self.card, self.sources, [], value,
                {'_readyWorkflowV2': True, '_readOnlyReplay': True}, reuse_responses=True)
            self.assertEqual(replay['description'], value['description'])
            with self.assertRaisesRegex(SeoError, 'seo_recheck_response_missing'):
                self.service.generate(self.card, self.sources, [], self.result,
                    {'_readyWorkflowV2': True, '_readOnlyReplay': True}, reuse_responses=True)

    def test_title_revision_preserves_description_and_all_existing_keyword_decisions(self):
        value = self.ready_result()
        calls = []
        def answer(instruction, data, **kwargs):
            calls.append(data)
            if 'requestedFields' in data:
                self.assertEqual(set(data['requestedFields']), {'compatibility', 'title'})
                return {'compatibility': value['compatibility'],
                    'title': {'value': value['title']['value'] + ' для умывальника', 'reason': 'Добавлено подтвержденное назначение.'}}
            if 'finalTexts' in data and 'queries' not in data:
                return {'ready': True, 'problems': [], 'sourceQuestions': []}
            raise AssertionError('unexpected full regeneration')
        with patch.object(self.service, 'chat', side_effect=answer):
            result = self.service.generate_ready(self.card, self.sources,
                [{'sku': '1001', 'section': 'title', 'text': 'Уточнить назначение в заголовке'}], value, {})
        self.assertEqual(result['description'], value['description'])
        self.assertEqual(result['keywords'], value['keywords'])
        self.assertEqual(result['characteristics'], value['characteristics'])
        self.assertEqual(len(calls), 2)

    def test_exhausted_budget_stops_before_external_request(self):
        cache = {'_readyWorkflowV2': True, '_readyRequestBudget': 'budget', 'budget': {'used': 2, 'limit': 2}}
        with patch.object(self.host, 'audit_llm_chat_completion', side_effect=AssertionError('unexpected paid call')):
            with self.assertRaisesRegex(SeoError, 'seo_request_budget_reached'):
                self.service.chat('test', {}, journal=cache, journal_key='new')

    def test_source_review_distinguishes_existing_set_members_from_conflicting_dimension(self):
        card = deepcopy(self.card)
        card['description'] = 'Десертная тарелка 19 см. Салатник 630 мл. Большой салатник 1000 мл.'
        card['characteristics'] = [{'id': 100, 'name': 'Комплектация',
            'values': ['Десертная тарелка 19,3см; салатник 630мл; большой салатник 1000мл']}]
        def answer(instruction, data, **kwargs):
            candidates = data['candidatePairs']
            self.assertFalse(any(set([row['leftValue'].replace(' ', ''), row['rightValue'].replace(' ', '')]) == {'630мл', '1000мл'}
                                 for row in candidates.values()))
            selected = next(key for key, row in candidates.items() if row['leftValue']=='19 см' and row['rightValue']=='19,3см')
            return {'conflicts': [{'pairId': selected, 'question': 'Какой диаметр десертной тарелки: 19 или 19,3 см?'}]}
        with patch.object(self.service, 'chat', side_effect=answer):
            conflicts = self.service.ready_source_conflicts(card, {})
        self.assertEqual(len(conflicts), 1)
        neutral = self.service.neutral_ready_facts('Тарелка 19.3 см, 19 предметов; объём 630 мл.', conflicts)
        self.assertNotIn('19.3 см', neutral)
        self.assertIn('19 предметов', neutral)
        self.assertIn('630 мл', neutral)

    def test_paragraph_edits_preserve_untouched_text_and_repair_missing_phrase_once(self):
        value = deepcopy(self.result)
        value['description'] = {'value': 'Смеситель для раковины.\nМатериал: латунь.'}
        calls = []
        def answer(instruction, data, **kwargs):
            calls.append(data)
            if 'missingPhrases' in data and not data.get('editReadyDescription'):
                self.assertEqual(data['missingPhrases'], ['кран для умывальника'])
                return {'paragraph': 'Латунный кран для умывальника.'}
            return {'edits': [], 'appendParagraphs': []}
        with patch.object(self.service, 'chat', side_effect=answer):
            self.service.write_ready_text(self.card, value, {})
        self.assertEqual(value['description']['value'], 'Смеситель для раковины.\nМатериал: латунь.\n\nЛатунный кран для умывальника.')
        self.assertEqual(len(calls), 2)

    def test_complete_keywords_do_not_bypass_removal_of_internal_editorial_comment(self):
        value = deepcopy(self.result)
        value['description']['value'] += '\nХотя в ключевых словах указаны разные варианты комплектации, материал: латунь.'
        calls = []
        def answer(instruction, data, **kwargs):
            calls.append(data)
            self.assertTrue(data['problems'])
            return {'edits': [{'id': 'P1', 'text': 'Материал: латунь.'}], 'appendParagraphs': []}
        with patch.object(self.service, 'chat', side_effect=answer):
            self.service.write_ready_text(self.card, value, {})
        self.assertEqual(len(calls), 1)
        self.assertNotIn('ключевых словах', value['description']['value'])
        self.assertIn('Материал: латунь.', value['description']['value'])

    def test_pack_count_and_component_counts_do_not_create_false_numeric_conflict(self):
        card = deepcopy(self.card)
        card['characteristics'] += [
            {'id': 101, 'name': 'Количество предметов', 'values': ['7 шт']},
            {'id': 102, 'name': 'Комплектация', 'values': ['Нож 1 шт; ножницы 1 шт; подставка 1 шт']}]
        with patch.object(self.service, 'chat', side_effect=AssertionError('different counted entities')):
            self.assertEqual(self.service.ready_source_conflicts(card, {}), [])

    def test_inflected_keyword_is_bound_to_actual_grammatical_text_without_forcing_nominative(self):
        value = deepcopy(self.result)
        value['keywords'][0]['outputPhrase'] = 'белый цвет'
        self.service.bind_ready_keyword_forms(value, 'Посуда белого цвета подходит для дома.')
        self.assertEqual(value['keywords'][0]['outputPhrase'], 'белого цвета')
        self.assertEqual(value['keywords'][0]['decision'], 'адаптировать')

    def test_missing_keyword_proof_is_resolved_once_without_replanning_valid_phrases(self):
        value = deepcopy(self.result)
        value['competitorProfile']['phrases'] += [{'phrase': 'латунный корпус'}, {'phrase': 'устойчивый к царапинам'}]
        _, facts, _ = self.service.ready_fact_catalog(self.card)
        material = next(key for key, row in facts.items() if row['source'] == 'attribute:100')
        calls = []
        def answer(instruction, data, **kwargs):
            calls.append(data)
            if 'phrasesWithoutProof' in data:
                self.assertEqual(set(data['phrasesWithoutProof']), {'K1', 'K2'})
                return {'facts': {'K1': material, 'K2': 'EXCLUDE'}}
            return {'keywords': {
                'K0': {'decision': 'использовать', 'outputPhrase': 'кран для умывальника',
                    'reason': 'Назначение подтверждено собственным описанием смесителя.', 'factIds': ['F1']},
                'K1': {'decision': 'адаптировать', 'outputPhrase': 'латунный корпус',
                    'reason': 'Латунный материал указан в собственных характеристиках.', 'factIds': ['F999']},
                'K2': {'decision': 'использовать', 'outputPhrase': 'устойчивый к царапинам',
                    'reason': 'Предлагается дополнительное свойство поверхности смесителя.', 'factIds': []}}}
        with patch.object(self.service, 'chat', side_effect=answer):
            self.service.ready_keywords(self.card, value, {})
        self.assertEqual(len(calls), 2)
        self.assertEqual(value['keywords'][0]['outputPhrase'], 'кран для умывальника')
        self.assertEqual(value['keywords'][1]['outputPhrase'], 'латунь')
        self.assertEqual(value['keywords'][1]['evidence']['source'], 'attribute:100')
        self.assertEqual(value['keywords'][2]['decision'], 'исключить')
        self.assertEqual(value['keywords'][2]['outputPhrase'], '')

    def test_handles_and_blade_material_cannot_be_transferred_to_the_stand(self):
        card = {'title': 'Набор ножей на подставке',
            'description': 'Ручки ножей пластиковые.\nСтильная подставка в комплекте.', 'characteristics': []}
        _, facts, _ = self.service.ready_fact_catalog(card)
        stand = next(key for key, row in facts.items() if row['quote'] == 'Стильная подставка в комплекте.')
        value = deepcopy(self.result)
        value['competitorProfile']['phrases'] = [{'phrase': 'Подставка с серебристой отделкой и ручками ножей в тон'}]
        bad = 'Молочная подставка с металлическими элементами и удобными ручками'
        def answer(*args, **kwargs):
            return {'keywords': {'K0': {'decision': 'адаптировать', 'outputPhrase': bad,
                'reason': 'Предложена адаптация внешнего вида подставки и ручек ножей.', 'factIds': [stand]}}}
        with patch.object(self.service, 'chat', side_effect=answer):
            self.service.ready_keywords(card, value, {})
        self.assertEqual(value['keywords'][0]['outputPhrase'], 'Стильная подставка в комплекте.')
        self.assertTrue(unsupported_text_properties(bad, card['description']))
        self.assertEqual(unsupported_text_properties('Подставка для ножей с пластиковыми ручками.', card['description']), [])
        self.assertEqual(unsupported_text_properties(bad, bad), [])

    def test_complete_composition_proves_five_knives_and_does_not_count_scissors_as_a_knife(self):
        card = {'title': 'Набор ножей 7 предметов', 'description': 'Ручки пластиковые, лезвия стальные.',
            'characteristics': [{'id': 1, 'name': 'Количество предметов в упаковке', 'values': ['7 шт.']},
                {'id': 2, 'name': 'Комплектация', 'values': ['нож кухонный - 1 шт', 'нож хлебный - 1 шт',
                    'нож универсальный - 1 шт', 'нож для нарезки - 1 шт', 'нож для овощей - 1 шт',
                    'ножницы - 1 шт', 'подставка - 1 шт']}]}
        self.assertEqual(confirmed_composition(card), {'нож': 5, 'ножницы': 1, 'подставка': 1})
        self.assertTrue(unsupported_text_properties('В набор входят шесть ножей.', card['description'], card))
        self.assertEqual(unsupported_text_properties('В набор входят пять ножей.', card['description'], card), [])
        self.assertTrue(unsupported_text_properties('Все инструменты изготовлены из нержавеющей стали.', card['description'], card))
        self.assertEqual(unsupported_text_properties('В наборе семь предметов. Лезвия изготовлены из стали.', card['description'], card), [])
        card['characteristics'][0]['values'] = ['8 шт.']
        self.assertEqual(confirmed_composition(card), {})

    def test_only_query_with_changed_proof_is_reclassified_and_original_order_is_preserved(self):
        previous = deepcopy(self.result)
        previous['sources']['semantic'] = [{'query': 'смеситель для умывальника'}, {'query': 'латунный водопроводный кран'}]
        previous['sources']['ownCharacteristics'] = [{'id': '100', 'values': ['латунь']}]
        old_body = previous['description']['value']
        previous['semanticDecisions'] = [
            {'query': 'смеситель для умывальника', 'relevance': 'релевантен', 'destination': 'описание', 'outputPhrase': old_body,
             'reason': 'Назначение передано проверенным описанием смесителя для раковины.', 'placementReviewed': True,
             'groupProof': {'source': 'final:описание', 'quote': old_body}},
            {'query': 'латунный водопроводный кран', 'relevance': 'релевантен', 'destination': 'характеристика', 'outputPhrase': 'латунь',
             'reason': 'Материал подтверждён собственной характеристикой смесителя.', 'placementReviewed': True,
             'groupProof': {'source': 'attribute:100', 'quote': 'латунь'}}]
        previous['quality'] = {'state': 'ready', 'checkedQueries': 2, 'unresolvedAutomaticCount': 0}
        current = deepcopy(previous)
        current['description']['value'] = 'Латунный смеситель для раковины.'
        current['keywords'] = []; current['competitorProfile']['phrases'] = []
        def resolve(card, subset, *args):
            self.assertEqual([row['query'] for row in subset['sources']['semantic']], ['смеситель для умывальника'])
            quote = subset['description']['value']
            subset['semanticDecisions'] = [dict(previous['semanticDecisions'][0], outputPhrase=quote,
                groupProof={'source': 'final:описание', 'quote': quote})]
            subset['_queryGroups'] = [{'kind': 'quote', 'field': 'описание', 'quote': quote, 'ids': [0]}]
            return []
        with patch.object(self.service, 'resolve_query_groups', side_effect=resolve) as classify:
            additions, reused_all = self.service.ready_query_groups(self.card, current, previous, {})
        self.assertEqual(classify.call_count, 1)
        self.assertEqual(additions, []); self.assertFalse(reused_all)
        self.assertEqual([row['query'] for row in current['semanticDecisions']], [row['query'] for row in previous['semanticDecisions']])
        self.assertEqual(current['semanticDecisions'][1]['groupProof'], previous['semanticDecisions'][1]['groupProof'])
        self.assertEqual(sorted(index for group in current['_queryGroups'] for index in group['ids']), [0,1])
        self.service.verify_ready_result(self.card, current)

    def test_candidate_replay_never_marks_response_validated_and_requires_exact_request(self):
        cache = {}
        with patch.object(self.host, 'audit_llm_chat_completion', return_value=response({'groups': []})) as paid:
            self.service.chat('instruction', {'input': 1}, journal=cache, journal_key='candidate')
            self.service.chat('instruction', {'input': 1}, journal=cache, journal_key='candidate', read_candidate=True)
            self.assertEqual(paid.call_count, 1)
            self.assertFalse(cache['candidate'].get('validated'))
            self.service.chat('instruction', {'input': 2}, journal=cache, journal_key='candidate', read_candidate=True)
            self.assertEqual(paid.call_count, 2)
            self.service.chat('instruction', {'input': 2}, journal=cache, journal_key='candidate')
            self.assertEqual(paid.call_count, 3)

    def test_extra_closing_delimiter_does_not_discard_complete_values_or_accept_other_content(self):
        self.assertEqual(self.service.parse_response_json('{"assignments":{"Q0":"D1"}}}'), {'assignments': {'Q0': 'D1'}})
        for content in ['{"assignments":{"Q0":"D1"}', '{"a":1}{"a":2}', '{"a":1} ignored', '{"a":"unfinished']:
            with self.subTest(content=content), self.assertRaises(ValueError):
                self.service.parse_response_json(content)

    def test_local_phrase_proof_preserves_relations_negation_and_decimal_units(self):
        self.assertEqual(grammatical_phrase('набор ножей', 'Набор кухонных ножей на подставке.', True), 'Набор кухонных ножей')
        self.assertEqual(grammatical_phrase('2.7 л', 'Объём 2,70 л.'), '2,70 л')
        self.assertEqual(grammatical_phrase('стеклянные бокалы', 'Два стеклянных бокала. С гравировкой: нет.'), 'стеклянных бокала')
        for query, text in [('ножи из пластика', 'Ножи на подставке из пластика.'),
                            ('пластиковые ножи', 'Пластиковая подставка для ножей.'),
                            ('ножи пластиковые', 'Ножи, пластиковые подставки.'),
                            ('пластиковая подставка', 'Ножи без пластиковой подставки.'),
                            ('ножи на подставке', 'Ножи без подставки.')]:
            with self.subTest(query=query):
                self.assertEqual(grammatical_phrase(query, text, True), '')

    def test_thousand_variants_have_explicit_codes_and_independent_review(self):
        phrases = [' '.join(words) for words in islice(permutations(
            ['латунный', 'кран', 'для', 'раковины', 'с', 'одним', 'рычагом', 'смеситель']), 1001)]
        self.result['sources']['semantic'] = [{'query': query} for query in phrases]
        calls = []
        def answer(instruction, data, **kwargs):
            calls.append(data)
            if 'sampleQueries' in data: return {'groups': []}
            if 'newCodes' in data: return {'groups': [], 'corrections': []}
            return {'assignments': {key: 'T1' for key in data['queries']}}
        with patch.object(self.service, 'chat', side_effect=answer):
            added = self.service.resolve_query_groups(self.card, self.result, {})
        self.assertEqual(added, [])
        self.assertEqual(len(calls), 33)
        self.assertEqual([r['query'] for r in self.result['semanticDecisions']], phrases)
        self.assertTrue(all(r['placementReviewed'] for r in self.result['semanticDecisions']))
        self.assertTrue(all(r['outputPhrase'] == fixtures.generated()['description']['value'] for r in self.result['semanticDecisions']))

    def test_bad_optional_seed_is_unused_and_duplicate_of_real_text_stays_applied(self):
        result = deepcopy(self.result)
        result['sources']['semantic'] = [{'query': 'смеситель для умывальника'}]
        calls = []
        def answer(instruction, data, **kwargs):
            calls.append(data)
            if 'sampleQueries' in data:
                return {'groups': [{'code': 'S99', 'kind': 'add', 'relevance': 'релевантен', 'phrase': 'титановый корпус',
                    'reason': 'Непроверенное дополнительное свойство не имеет собственного факта.', 'factIds': []}]}
            if 'newCodes' in data:
                return {'groups': [
                    {'code': 'T1', 'kind': 'quote', 'relevance': 'релевантен', 'phrase': 'Смеситель для раковины.',
                     'reason': 'Дословный фрагмент существующего описания.', 'factIds': []},
                    {'code': 'S0', 'kind': 'skip', 'relevance': 'нерелевантен', 'phrase': 'NONE',
                     'reason': 'Полностью повторяет заголовок товара (T0), нет новой информации.', 'factIds': []}],
                    'corrections': {'Q0': 'S0'}}
            self.assertNotIn('S99', data['decisionCodes'])
            return {'assignments': {'Q0': 'NEW'}}
        cache = {}
        with patch.object(self.service, 'chat', side_effect=answer):
            self.service.resolve_query_groups(self.card, result, cache)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result['semanticDecisions'][0]['destination'], 'заголовок')
        self.assertEqual(result['semanticDecisions'][0]['outputPhrase'], result['title']['value'])
        self.assertNotIn('T0', result['semanticDecisions'][0]['reason'])

    def test_wrong_ids_nonexistent_quote_and_legacy_exclusion_shape_never_become_questions(self):
        self.result['sources']['semantic'] = [{'query': 'смеситель для умывальника'}]
        for broken in [self.group([999]), self.group([0, 0]), self.group([0], textId='T999'),
                       self.group([0], kind='skip', textId='T2', phrase='сам запрос')]:
            with self.subTest(broken=broken):
                with patch.object(self.service, 'chat', return_value={'groups': [broken]}):
                    with self.assertRaisesRegex(SeoError, 'seo_semantic_review_incomplete'):
                        self.service.resolve_query_groups(self.card, deepcopy(self.result), {})

    def test_unconfirmed_numbers_are_excluded_with_actual_source_context_without_model_calls(self):
        result = deepcopy(self.result)
        result['sources']['semantic'] = [{'query': 'набор на 4 персоны'}, {'query': 'набор на 6 персон'}, {'query': 'японский смеситель'}]
        with patch.object(self.service, 'chat', side_effect=AssertionError('no model needed for absent numbers')):
            self.service.resolve_query_groups(self.card, result, {})
        self.assertEqual(len(result['semanticDecisions']), 3)
        self.assertTrue(all(row['destination'] == 'не добавлять' and row['groupProof'].get('evidencePacketHash')
                            for row in result['semanticDecisions']))
        self.assertIn('4', result['semanticDecisions'][0]['reason'])
        self.assertEqual(result['issues'], [])
        self.assertIn('японский', result['semanticDecisions'][2]['reason'])
        self.assertEqual(unconfirmed_origin_mentions('американка для смесителя, корень', ''), [])
        self.assertEqual(unconfirmed_origin_mentions('китайский нож', 'Страна: Китай'), [])

    def test_incomplete_definition_is_repaired_without_losing_valid_queries_or_inventing_evidence(self):
        result = deepcopy(self.result)
        result['sources']['semantic'] = [{'query': 'смеситель для умывальника'}]
        calls = []
        def answer(instruction, data, **kwargs):
            calls.append(data)
            if 'sampleQueries' in data:
                return {'groups': []}
            if 'invalidDefinitions' in data:
                self.assertEqual(list(data['undefinedCodes']), ['S9'])
                return {'groups': [{'code': 'S9', 'kind': 'quote', 'relevance': 'релевантен',
                    'phrase': 'T0', 'reason': 'Назначение смесителя подтверждено собственным заголовком товара.', 'factIds': []}]}
            if 'undefinedCodes' in data:
                return {'groups': [{'code': 'S9', 'kind': 'add', 'relevance': 'релевантен',
                    'phrase': 'красивый смеситель', 'reason': 'Добавить красивую формулировку для поиска покупателями.', 'factIds': []}]}
            if 'newCodes' in data:
                return {'groups': [], 'corrections': [{'queryId': 'Q0', 'code': 'S9'}]}
            return {'assignments': {'Q0': 'NEW'}}
        with patch.object(self.service, 'chat', side_effect=answer):
            self.service.resolve_query_groups(self.card, result, {})
        self.assertEqual(len(calls), 5)
        decision = result['semanticDecisions'][0]
        self.assertEqual(decision['outputPhrase'], result['title']['value'])
        self.assertEqual(decision['groupProof']['quote'], result['title']['value'])
        self.assertNotIn('красивый', result['description']['value'])

    def test_redefined_text_code_does_not_overwrite_other_query_and_requires_explicit_recheck(self):
        result = deepcopy(self.result)
        result['sources']['semantic'] = [{'query': 'латунный водопроводный кран'}, {'query': 'смеситель для умывальника'}]
        _, facts, _ = self.service.ready_fact_catalog(self.card)
        material = next(key for key, row in facts.items() if row['source'] == 'attribute:100')
        reviews = []
        def answer(instruction, data, **kwargs):
            if 'sampleQueries' in data: return {'groups': []}
            if 'newCodes' not in data: return {'assignments': {'Q0': 'T0', 'Q1': 'T0'}}
            reviews.append(data)
            self.assertEqual(data['decisionCodes']['T0']['phrase'], result['title']['value'])
            if len(reviews) == 1:
                return {'groups': [{'code': 'T0', 'kind': 'add', 'relevance': 'релевантен', 'phrase': 'NONE',
                    'reason': 'Материал смесителя подтверждён собственной характеристикой латунь.', 'factIds': [material]}],
                    'corrections': {'Q0': 'T0'}}
            self.assertEqual(data['requiredDecisions'], ['Q1'])
            self.assertEqual(kwargs['response_schema']['properties']['corrections']['required'], ['Q1'])
            return {'groups': [], 'corrections': {'Q1': 'T0'}}
        with patch.object(self.service, 'chat', side_effect=answer):
            self.service.resolve_query_groups(self.card, result, {})
        self.assertEqual(len(reviews), 2)
        self.assertEqual(result['semanticDecisions'][0]['outputPhrase'], 'латунь')
        self.assertEqual(result['semanticDecisions'][1]['outputPhrase'], result['title']['value'])
        self.assertEqual(result['semanticDecisions'][1]['destination'], 'заголовок')

    def test_unknown_model_label_requires_real_definition_in_application_namespace(self):
        for with_definition in (False, True):
            with self.subTest(with_definition=with_definition):
                value = deepcopy(self.result)
                value['sources']['semantic'] = [{'query': 'смеситель для умывальника'}]
                def definition(code):
                    return {'code': code, 'kind': 'quote', 'relevance': 'релевантен', 'phrase': 'T0',
                        'reason': 'Назначение смесителя подтверждено исходным заголовком товара.', 'factIds': []}
                def answer(instruction, data, **kwargs):
                    if 'sampleQueries' in data: return {'groups': []}
                    if 'undefinedCodes' in data:
                        self.assertEqual(list(data['undefinedCodes']), ['S0'])
                        return {'groups': [definition('S0')]}
                    if 'newCodes' in data:
                        return {'groups': [definition('T999')] if with_definition else [], 'corrections': {'Q0': 'T999'}}
                    return {'assignments': {'Q0': 'NEW'}}
                with patch.object(self.service, 'chat', side_effect=answer):
                    self.service.resolve_query_groups(self.card, value, {})
                self.assertEqual(value['semanticDecisions'][0]['outputPhrase'], value['title']['value'])
                self.assertEqual(value['semanticDecisions'][0]['groupProof']['quote'], value['title']['value'])

    def test_multivalue_characteristic_witness_uses_actual_export_separators_and_spelling(self):
        result = deepcopy(self.result)
        result['sources']['ownCharacteristics'] = [{'id': '99', 'values': ['новоселье', 'просто так', 'свадьба']}]
        result['semanticDecisions'] = [{'query': 'подарок на новоселье', 'relevance': 'релевантен',
            'destination': 'характеристика', 'outputPhrase': 'новоселье; просто так; свадьба', 'reason': 'Подтверждены поводы подарка.'}]
        result['sources']['semantic'] = [{'query': 'подарок на новоселье'}, {'query': 'кран для умывальника'}]
        result['semanticDecisions'].append({'query': 'кран для умывальника', 'destination': 'описание',
            'outputPhrase': 'кран для умывальника'})
        self.service.verify_keywords(result, result['sources'])
        self.assertEqual(result['semanticDecisions'][0]['witness'], 'новоселье; просто так; свадьба')

    def test_bad_redundant_text_id_can_use_actual_fact_but_negative_brand_stays_excluded(self):
        result = deepcopy(self.result)
        result['sources']['semantic'] = [{'query': 'латунный водопроводный кран'}, {'query': 'смеситель люминарк'}, {'query': 'люминарк кран'}]
        _, facts, _ = self.service.ready_fact_catalog(self.card)
        material = next(key for key, row in facts.items() if row['source'] == 'attribute:100')
        calls = []
        def answer(instruction, data, **kwargs):
            calls.append(data)
            if 'sampleQueries' in data:
                return {'groups': [
                    {'code': 'S0', 'kind': 'quote', 'relevance': 'релевантен', 'phrase': 'T999',
                     'reason': 'Латунный материал подтверждён собственной характеристикой смесителя.', 'factIds': [material]},
                    {'code': 'S1', 'kind': 'skip',
                     'reason': 'Описание товара не содержит упоминания бренда Люминарк.', 'factIds': []}]}
            if 'newCodes' in data:
                return {'groups': [], 'corrections': []}
            return {'assignments': {'Q0': 'S0', 'Q1': 'S1', 'Q2': 'T0'}}
        with patch.object(self.service, 'chat', side_effect=answer):
            self.service.resolve_query_groups(self.card, result, {})
        self.assertEqual(len(calls), 3)
        self.assertEqual(result['semanticDecisions'][0]['outputPhrase'], 'латунь')
        refusal = result['semanticDecisions'][1]
        self.assertEqual(refusal['destination'], 'не добавлять')
        self.assertTrue(refusal['groupProof']['evidencePacketHash'])
        self.assertIn('не содержит', refusal['reason'])
        self.assertEqual(result['semanticDecisions'][2]['destination'], 'не добавлять')

    def test_equivalent_decimal_and_quantity_punctuation_do_not_create_false_changes(self):
        self.assertEqual(numeric_values('2.7 л; 2,70 л'), {'2.7'})
        self.assertEqual(normalized_characteristic('2 шт.'), normalized_characteristic('2 шт'))
        self.assertEqual(normalized_characteristic('2.7 л'), normalized_characteristic('2,70 л'))
        self.assertNotEqual(normalized_characteristic('2 шт'), normalized_characteristic('6 шт'))
        result = deepcopy(self.result)
        result['description']['value'] = 'Объём 2,7 л.'
        self.card['description'] = 'Объём 2.7 л.'
        self.service.verify_final_facts(result, self.card)
        self.assertFalse(any(i.get('code') == 'numeric_claim' for i in result['issues']))

    def test_fake_source_question_and_unanchored_audit_cannot_be_presented_to_reviewer(self):
        for value in [
            {'ready': False, 'problems': [{'kind': 'unsupported', 'quote': 'выдуманный фрагмент', 'source': '', 'reason': 'Ошибка'}], 'sourceQuestions': []},
            {'ready': True, 'problems': [], 'sourceQuestions': [{'sourceA': 'description', 'quoteA': 'нет такой цитаты',
                'sourceB': 'title', 'quoteB': 'тоже нет', 'question': 'Уточните?'}]},
        ]:
            with patch.object(self.service, 'chat', return_value=value):
                with self.assertRaisesRegex(SeoError, 'seo_invalid_content_audit'):
                    self.service.audit_ready_text(self.card, self.result, {})
