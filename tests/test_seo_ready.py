from copy import deepcopy
from itertools import islice, permutations
import json
import unittest
from unittest.mock import patch

from automatic_seo import SeoError, numeric_values, normalized_characteristic
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
        self.result.update(sources=self.sources, competitorProfile={'structure': ['Назначение'],
            'phrases': [{'phrase': 'кран для умывальника', 'quote': 'кран для умывальника'}]})

    def group(self, ids, **kwargs):
        value = {'ids': list(ids), 'relevance': 'релевантен', 'kind': 'quote', 'textId': 'T2',
            'phrase': 'NONE', 'reason': 'Назначение крана для умывальника подтверждено исходной карточкой смесителя.',
            'factIds': ['F1']}
        return dict(value, **kwargs)

    def test_full_workflow_checks_facts_keywords_and_all_queries_before_ready(self):
        calls = []
        def answer(messages):
            data = json.loads(messages[1]['content']); calls.append(data)
            if 'keywordIds' in data:
                return response({'keywords': [{'id': 0, 'outputPhrase': 'кран для умывальника',
                    'decision': 'использовать', 'reason': 'Назначение соответствует собственному описанию смесителя для раковины.',
                    'factIds': ['F1']}]})
            if data.get('writeReadyDescription'):
                return response({'value': fixtures.generated()['description']['value']})
            if 'queries' in data:
                return response({'groups': [self.group(map(int, data['queries']))]})
            return response({'ready': True, 'problems': [], 'sourceQuestions': []})
        with patch.object(self.host, 'audit_llm_chat_completion', side_effect=answer):
            result = self.service.generate_ready(self.card, self.sources, [], self.result, {})
        self.assertEqual(len(calls), 4)
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['quality']['state'], 'ready')
        self.assertEqual(result['quality']['checkedQueries'], 1)
        self.assertEqual(result['semanticDecisions'][0]['witness'], 'Латунный кран для умывальника.')

    def test_thousand_variants_have_complete_coverage_in_five_requests(self):
        phrases = [' '.join(words) for words in islice(permutations(
            ['латунный', 'кран', 'для', 'раковины', 'с', 'одним', 'рычагом', 'смеситель']), 1001)]
        self.result['sources']['semantic'] = [{'query': query} for query in phrases]
        calls = []
        def answer(instruction, data, **kwargs):
            calls.append(data)
            return {'groups': [self.group(map(int, data['queries']))]}
        with patch.object(self.service, 'chat', side_effect=answer):
            added = self.service.resolve_query_groups(self.card, self.result, {})
        self.assertEqual(added, [])
        self.assertEqual(len(calls), 5)
        self.assertEqual([r['query'] for r in self.result['semanticDecisions']], phrases)
        self.assertTrue(all(r['placementReviewed'] for r in self.result['semanticDecisions']))
        self.assertTrue(all(r['outputPhrase'] == 'Латунный кран для умывальника.' for r in self.result['semanticDecisions']))

    def test_wrong_ids_nonexistent_quote_and_legacy_exclusion_shape_never_become_questions(self):
        for broken in [self.group([999]), self.group([0, 0]), self.group([0], textId='T999'),
                       self.group([0], kind='skip', textId='T2', phrase='сам запрос')]:
            with self.subTest(broken=broken):
                with patch.object(self.service, 'chat', return_value={'groups': [broken]}):
                    with self.assertRaisesRegex(SeoError, 'seo_semantic_review_incomplete'):
                        self.service.resolve_query_groups(self.card, deepcopy(self.result), {})

    def test_different_numbers_cannot_be_declared_one_meaning(self):
        result = deepcopy(self.result)
        result['sources']['semantic'] = [{'query': 'набор на 4 персоны'}, {'query': 'набор на 6 персон'}]
        def answer(instruction, data, **kwargs):
            # Even after split this deliberately returns the wrong scope.
            return {'groups': [self.group([0, 1])]}
        with patch.object(self.service, 'chat', side_effect=answer):
            with self.assertRaisesRegex(SeoError, 'seo_semantic_review_incomplete'):
                self.service.resolve_query_groups(self.card, result, {})

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
