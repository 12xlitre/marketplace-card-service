from copy import deepcopy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import load_workbook
from automatic_seo import (AutomaticSeoService, CleanError, CleanRebuilder, GroundedReview,
                           GROUNDED_REVISION, GROUNDED_METHOD, SeoError, fingerprint, contains_components)
from automatic_seo_xlsx import build_workbook
import test_automatic_seo as fixtures
from test_seo_ready import response


class GroundedRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.AutomaticSeoTest(); self.case.setUp(); self.addCleanup(self.case.tearDown)
        self.service, self.host = self.case.service, self.case.host
        self.host.automatic_seo_grounded_workflow = lambda: True
        self.card = fixtures.card('1001')
        self.sources = fixtures.sources(self.card, self.case.mapping['1001'])
        self.calls = []

    def answer(self, messages):
        data = json.loads(messages[1]['content']); self.calls.append(data)
        if data.get('groundedRelevance'):
            return response({'decisions': {key: {'status': 'exclude' if any(q.startswith('Конкурент') for q in queries) else 'use',
                'reason': 'Кран для умывальника соответствует назначению собственного смесителя.' if not any(q.startswith('Конкурент') for q in queries) else 'Фраза содержит только служебное название чужого товара без собственного поискового назначения.',
                'factIds': [next(iter(data['ownFacts']))]} for key, queries in data['semanticGroups'].items()}})
        if data.get('groundedWrite'):
            return response({'title': 'Смеситель для раковины ТЕСТ, латунь',
                'titleReason': 'Название расширено подтверждённым материалом собственного изделия.',
                'descriptionAddition': 'Латунный кран для умывальника ТЕСТ подходит для раковины.',
                'queryParagraphs': {key: 'Латунный кран для умывальника ТЕСТ подходит для раковины.'
                                    for key in data['uncoveredQueries']}})
        if data.get('groundedAudit'):
            return response({'ready': True, 'problems': [], 'claims': {key: {'supported': True,
                'factIds': [next(iter(data['ownFactCatalog']))],
                'reason': 'Назначение и материал предложения подтверждены собственной карточкой смесителя.'}
                for key in data['newClaims']}})
        if 'candidatePairs' in data:
            return response({'conflicts': []})
        raise AssertionError('Unexpected stage: ' + str(data.keys()))

    def generate(self, **kwargs):
        with patch.object(self.host, 'audit_llm_chat_completion', side_effect=self.answer):
            return self.service.generate_grounded(self.card, self.sources, kwargs.pop('remarks', []),
                kwargs.pop('previous', None), kwargs.pop('cache', {}), **kwargs)

    def test_common_contract_and_open_workbook_for_both_marketplaces_and_distinct_stores(self):
        for marketplace, store in [('Wildberries', 'магазин А'), ('Ozon', 'магазин Б'), ('Wildberries', 'магазин В'), ('Ozon', 'магазин Г')]:
            with self.subTest(marketplace=marketplace, store=store):
                self.card['marketplace'] = marketplace
                self.card['offerId'] = store
                self.sources['marketplace'] = marketplace
                result = self.generate()
                self.assertEqual(result['quality']['revision'], GROUNDED_REVISION)
                self.assertTrue(result['quality']['requiresSpecialistReview'])
                self.assertIn(self.card['description'], result['description']['value'])
                self.assertLessEqual(len(result['title']['value']), 59)
                self.service.verify_grounded_result(self.card, result)
                version = {'cards': [self.card], 'results': {'1001': result}, 'workflowRevision': GROUNDED_REVISION,
                    'quality': {'state': 'ready'}, 'number': 1, 'method': GROUNDED_METHOD,
                    'sourceCapturedAt': '2026-11-03', 'period': {'d1': '2026-10-04', 'd2': '2026-11-02'}}
                path = self.service.root / 'review.xlsx'; build_workbook(path, version)
                book = load_workbook(path, rich_text=True)
                self.assertEqual(len(book.sheetnames), 8)
                self.assertEqual(book['Итог'].cell(5, 2).value, store)
                self.assertIn('Релевантность', [c.value for c in book['Семантика'][4]])
                self.assertFalse(any(r.hidden for sheet in book for r in sheet.row_dimensions.values()))
                self.assertFalse(any(c.hidden for sheet in book for c in sheet.column_dimensions.values()))
                self.assertNotIn('JEWEL', str(book['Итог'].cell(2, 1).value))
                self.assertEqual(str(book['Описания'].cell(5, 4).value), result['description']['value'])
                book.close()

    def test_every_query_variant_and_count_is_retained_including_preexisting_keys(self):
        self.sources['semantic'] = [{'query': q, 'count': index, 'countSourceSku': '9001', 'observations': []}
            for index, q in enumerate(['кран для умывальника', 'умывальника для кран', 'смеситель для раковины'] * 80)]
        result = self.generate()
        rows = result['semanticDecisions']
        self.assertEqual([r['query'] for r in rows[:240]], [r['query'] for r in self.sources['semantic']])
        self.assertTrue(all(r['status'] == 'use' and r['witness'] for r in rows[:240]))
        self.assertEqual([r['count'] for r in result['sources']['semantic'][:240]], list(range(240)))
        self.assertEqual(result['_groundedReview']['quality']['unplacedRelevantRows'], 0)

    def test_own_text_is_not_a_short_list_and_missing_placement_stops_readiness(self):
        self.sources['semantic'].append({'query': 'антивандальный смеситель', 'count': 100})
        with self.assertRaisesRegex(SeoError, 'seo_grounded_review_incomplete'):
            self.generate()
        self.assertEqual(sum(bool(r.get('groundedWrite')) for r in self.calls), 3)

    def test_existing_description_keywords_cannot_be_removed_by_writer(self):
        self.card['description'] += ' Стойкое покрытие. Установка на раковину.'
        result = self.generate()
        self.assertIn(self.card['description'], result['description']['value'])

    def test_cotton_derivation_keeps_all_other_query_modifiers(self):
        self.assertTrue(contains_components('футболка мужская хлопковая с коротким рукавом',
            'Мужская футболка из хлопка с короткими рукавами.'))
        self.assertFalse(contains_components('футболка хлопковая с длинным рукавом',
            'Футболка из хлопка с короткими рукавами.'))
        self.assertFalse(contains_components('футболка хлопковая', 'Футболка из полиэстера.'))
        self.assertTrue(contains_components('Хлопковая футболка для мужчин.', 'Мужская футболка из хлопка.'))
        self.assertTrue(contains_components('базовая модель на каждый день', 'Повседневная базовая модель.'))
        self.assertFalse(contains_components('подарок папе от дочки', 'Подарок дочке от папы.'))

    def test_ozon_description_over_five_thousand_characters_is_preserved(self):
        self.card['marketplace'] = self.sources['marketplace'] = 'Ozon'
        self.card['description'] = 'Смеситель для раковины из латуни. ' * 165
        self.assertGreater(len(self.card['description']), 5000)
        result = self.generate()
        self.assertIn(self.card['description'].strip(), result['description']['value'])
        self.assertLessEqual(len(result['description']['value']), 6000)
        self.assertTrue(all(r['descriptionLimit'] == 6000 for r in self.calls if r.get('groundedWrite')))
        self.card['marketplace'] = self.sources['marketplace'] = 'Wildberries'
        with self.assertRaisesRegex(SeoError, 'seo_grounded_review_incomplete'):
            self.generate()

    def test_foreign_brand_country_and_wrong_quantity_cannot_be_approved_by_model(self):
        self.sources['competitor']['characteristics'] = {'Бренд': 'ALIEN'}
        self.sources['semantic'] += [{'query': 'ALIEN кран'}, {'query': 'французский смеситель'}]
        result = self.generate()
        by_query = {r['query']: r for r in result['semanticDecisions']}
        self.assertEqual(by_query['ALIEN кран']['status'], 'exclude')
        self.assertEqual(by_query['французский смеситель']['status'], 'confirm')
        self.assertNotIn('француз', result['description']['value'])
        self.assertNotIn('ALIEN', result['description']['value'])

    def test_characteristics_fill_from_own_facts_keep_competitor_candidates_and_details(self):
        card = {'sku': 'new-card', 'title': 'Набор столовой посуды Бланш на 6 персон 19 предметов',
                'description': 'Белая стеклокерамика.', 'characteristics': [
                    {'id': 1, 'name': 'Комплектация', 'values': ['тарелки - 12 шт.', 'салатники - 7 шт.']}]}
        source = {'competitor': {'characteristics': {'Количество персон': '6', 'Страна производства': 'Франция',
                 'Особенности посуды': 'ударопрочная', 'Комплектация': 'Набор для 6 персон из 19 предметов'}},
                 'definitions': [{'id': 1, 'name': 'Комплектация', 'maxCount': 4}, {'id': 2, 'name': 'Количество персон'},
                     {'id': 3, 'name': 'Страна производства'}, {'id': 4, 'name': 'Особенности посуды'}]}
        plan = GroundedReview.attributes(card, source, [])
        self.assertEqual(plan['fields']['2']['action'], 'add')
        self.assertEqual(plan['fields']['2']['values'], ['6'])
        self.assertEqual(plan['fields']['3']['action'], 'confirm')
        self.assertEqual(plan['fields']['4']['action'], 'confirm')
        self.assertEqual(plan['fields']['1']['values'][:2], ['тарелки - 12 шт.', 'салатники - 7 шт.'])
        self.assertNotIn('Франция', GroundedReview.confirmed_values(card, plan))

    def test_rejected_official_value_stays_visible_as_candidate_without_changing_own_field(self):
        self.sources['competitor']['characteristics'] = {'Материал': 'латунь'}
        self.card['characteristics'] = [r for r in self.card['characteristics'] if r['id'] != 100]
        def reject(candidate):
            candidate['characteristics'] = []
        result = self.generate(verify_characteristics=reject)
        self.assertEqual(result['characteristics'], [])
        row = result['_groundedReview']['attributes']['fields']['100']
        self.assertEqual(row['action'], 'confirm')
        self.assertIn('латунь', row['values'])

    def test_unverified_auditor_quote_is_not_an_issue_given_to_user(self):
        original = self.answer
        def answer(messages):
            data = json.loads(messages[1]['content'])
            if data.get('groundedAudit'):
                return response({'ready': False, 'problems': [{'quote': 'чужая выдуманная цитата', 'reason': 'Такой текст не подтверждён нашими фактами.'}]})
            return original(messages)
        with patch.object(self.host, 'audit_llm_chat_completion', side_effect=answer):
            with self.assertRaisesRegex(SeoError, 'seo_invalid_content_audit'):
                self.service.generate_grounded(self.card, self.sources, [], None, {})

    def test_new_claims_need_complete_audit_and_real_own_fact_ids(self):
        original = self.answer
        for broken in ('missing_claim', 'unknown_fact'):
            def answer(messages):
                envelope = original(messages)
                data = json.loads(messages[1]['content'])
                if data.get('groundedAudit'):
                    content = json.loads(envelope[0]['choices'][0]['message']['content'])
                    if broken == 'missing_claim': content['claims'].pop(next(iter(content['claims'])))
                    else: next(iter(content['claims'].values()))['factIds'] = ['invented-fact']
                    return response(content)
                return envelope
            with self.subTest(broken=broken), patch.object(self.host, 'audit_llm_chat_completion', side_effect=answer):
                with self.assertRaisesRegex(SeoError, 'seo_invalid_content_audit'):
                    self.service.generate_grounded(self.card, self.sources, [], None, {})

    def test_unsupported_promises_and_arbitrary_foreign_brand_never_become_ready(self):
        self.sources['competitor']['brand'] = 'ALIEN'
        original = self.answer
        for addition in ('Обладает стойкостью к коррозии.', 'Это модель ALIEN.'):
            def answer(messages):
                envelope = original(messages)
                if json.loads(messages[1]['content']).get('groundedWrite'):
                    content = json.loads(envelope[0]['choices'][0]['message']['content'])
                    content['descriptionAddition'] += ' ' + addition
                    return response(content)
                return envelope
            with self.subTest(addition=addition), patch.object(self.host, 'audit_llm_chat_completion', side_effect=answer):
                with self.assertRaisesRegex(SeoError, 'seo_grounded_review_incomplete'):
                    self.service.generate_grounded(self.card, self.sources, [], None, {})

    def test_title_remark_preserves_description_and_source_change_cannot_replay(self):
        before = self.generate()
        after = self.generate(previous=before, remarks=[{'section': 'title', 'text': 'Указать материал', 'sku': '1001'}])
        self.assertEqual(after['description'], before['description'])
        self.sources['semantic'][0]['count'] = 999
        with self.assertRaisesRegex(SeoError, 'seo_recheck_response_missing'):
            self.generate(previous=before, cache={'_readOnlyReplay': True})

    def test_scoped_remarks_preserve_every_untargeted_section(self):
        before = self.generate()
        for section in ('description', 'semantic', 'characteristics'):
            with self.subTest(section=section):
                after = self.generate(previous=before, remarks=[{'section': section, 'text': 'Уточнить по собственным данным', 'sku': '1001'}])
                self.assertEqual(after['title'], before['title'])
                if section == 'characteristics':
                    self.assertEqual(after['description'], before['description'])
                else:
                    self.assertEqual(after['characteristics'], before['characteristics'])

    def test_retry_generates_only_failed_sku_and_preserves_ready_version_and_sources(self):
        original = self.answer
        def fail_second(messages):
            data = json.loads(messages[1]['content'])
            if data.get('groundedWrite') and data['ownSku'] == '1002':
                raise SeoError('seo_llm_timeout')
            return original(messages)
        with patch.object(self.host, 'audit_llm_chat_completion', side_effect=fail_second):
            self.case.action(); first = self.case.finish()
        self.assertEqual(first['status'], 'partial', first)
        self.assertEqual(first['completedCount'], 1)
        old = deepcopy(self.service.load(self.service.directory(1, 'batch'))['versions'][0])
        self.assertEqual(set(old['results']), {'1001'})
        self.calls.clear()
        with patch.object(self.host, 'audit_llm_chat_completion', side_effect=original):
            self.case.action(version=1); latest = self.case.finish()
        self.assertEqual(latest['status'], 'review', latest)
        versions = self.service.load(self.service.directory(1, 'batch'))['versions']
        self.assertEqual(versions[0], old)
        self.assertEqual(versions[1]['results']['1001'], old['results']['1001'])
        self.assertEqual(latest['sourceCapturedAt'], first['sourceCapturedAt'])
        self.assertEqual([r['ownSku'] for r in self.calls if r.get('groundedWrite')], ['1002'])
        self.assertEqual(self.host.own_fetches, 1)

    def test_title_and_fact_bindings_are_rechecked_independently_of_saved_hash(self):
        result = self.generate()
        for title in ('ТЕСТ', 'Белый смеситель для раковины ТЕСТ, латунь'):
            changed = deepcopy(result)
            changed['title']['value'] = changed['_groundedReview']['title'] = title
            review = changed['_groundedReview']
            review['outputHash'] = fingerprint({k: v for k, v in review.items() if k != 'outputHash'})
            with self.subTest(title=title), self.assertRaisesRegex(SeoError, 'seo_grounded_review_incomplete'):
                self.service.verify_grounded_result(self.card, changed)
        changed = deepcopy(result)
        changed['_groundedReview']['semanticDecisions'][0]['factIds'] = ['invented-fact']
        changed['semanticDecisions'] = deepcopy(changed['_groundedReview']['semanticDecisions'])
        review = changed['_groundedReview']
        review['outputHash'] = fingerprint({k: v for k, v in review.items() if k != 'outputHash'})
        with self.assertRaisesRegex(SeoError, 'seo_grounded_review_incomplete'):
            self.service.verify_grounded_result(self.card, changed)

    def test_excel_readback_checks_title_and_decisions(self):
        result = self.generate()
        version = {'cards': [self.card], 'results': {'1001': result}, 'workflowRevision': GROUNDED_REVISION,
            'quality': {'state': 'ready'}, 'number': 1, 'method': GROUNDED_METHOD,
            'sourceCapturedAt': '2026-11-05', 'period': {'d1': '2026-10-06', 'd2': '2026-11-04'}}
        for sheet, column, value in [('Заголовки', 6, 'Подменённый заголовок'), ('Семантика', 9, 'Нерелевантен')]:
            def corrupted(*args, **kwargs):
                book = load_workbook(*args, **kwargs)
                self.addCleanup(book.close)
                book[sheet].cell(5, column).value = value
                return book
            with self.subTest(sheet=sheet), patch('automatic_seo_xlsx.load_workbook', side_effect=corrupted):
                with self.assertRaisesRegex(CleanError, 'clean_excel_(title|decision)_changed'):
                    build_workbook(self.service.root / 'corrupt.xlsx', version)

    def test_incomplete_version_cannot_export_even_with_all_individual_results_ready(self):
        result = self.generate()
        path = self.service.root / 'unfinished.xlsx'
        with self.assertRaisesRegex(SeoError, 'seo_content_repair_incomplete'):
            build_workbook(path, {'workflowRevision': GROUNDED_REVISION, 'cards': [self.card],
                'results': {'1001': result}, 'quality': {'state': 'incomplete'}})
        self.assertFalse(path.exists())

    def test_tampered_result_or_source_is_rejected_before_export(self):
        result = self.generate()
        for field in ('description', 'sources', 'characteristics', 'semanticDecisions'):
            changed = deepcopy(result)
            if field == 'description': changed[field]['value'] += ' Прочее.'
            elif field == 'sources': changed[field]['semantic'][0]['count'] = 10000
            elif field == 'characteristics': changed[field].append({'id': '999', 'values': ['чужое']})
            else: changed[field][0]['status'] = 'confirm'
            with self.subTest(field=field), self.assertRaisesRegex(SeoError, 'seo_grounded_review_incomplete'):
                self.service.verify_grounded_result(self.card, changed)

    def test_normal_button_creates_revision_five_and_downloads_verified_file(self):
        with patch.object(self.host, 'audit_llm_chat_completion', side_effect=self.answer):
            self.case.action(); latest = self.case.finish()
        self.assertEqual(latest['status'], 'review', latest)
        self.assertEqual(latest['workflowRevision'], GROUNDED_REVISION)
        self.assertEqual(latest['quality']['state'], 'ready')
        blob = self.service.download(1, 'batch', self.case.tech, 1)
        self.assertEqual(hashlib.sha256(blob).hexdigest(), latest['sha256'])
        self.assertEqual(self.host.statuses, [])
        self.assertEqual(self.service.load(self.service.directory(1, 'batch'))['versions'][0]['method'], GROUNDED_METHOD)

    def test_bad_title_is_bounded_and_never_creates_downloadable_report(self):
        original = self.answer
        def answer(messages):
            result = original(messages)
            data = json.loads(messages[1]['content'])
            if data.get('groundedWrite'):
                content = json.loads(result[0]['choices'][0]['message']['content'])
                content['title'] = 'Очень длинный заголовок ' * 5
                return response(content)
            return result
        with patch.object(self.host, 'audit_llm_chat_completion', side_effect=answer):
            self.case.action(); latest = self.case.finish()
        self.assertEqual(latest['status'], 'partial')
        self.assertFalse(latest.get('sha256'))
        self.assertTrue(all(row['code'] == 'seo_grounded_review_incomplete' for row in latest['errors']))
        self.assertEqual(sum(bool(row.get('groundedWrite')) for row in self.calls), 6)
        with self.assertRaises(SeoError): self.service.download(1, 'batch', self.case.tech, 1)


if __name__ == '__main__': unittest.main()
