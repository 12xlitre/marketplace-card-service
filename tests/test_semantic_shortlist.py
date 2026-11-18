import copy
import json
import unittest
from unittest.mock import patch

import server


CARD = {'title': 'Монтажная пена KOLT для окон и дверей', 'brand': 'KOLT',
        'description': 'Всесезонная монтажная пена для пистолета. Материал: ПВХ.'}


def core(queries, marketplace='Ozon'):
    return {'marketplace': marketplace, 'seedQuery': 'монтажная пена',
            'relevanceVersion': server.SEMANTIC_RELEVANCE_VERSION,
            'allKeywords': [{'query': query, 'relevance': 'relevant', 'ozonCount': 100+i, 'wbCount': 50+i}
                            for i, query in enumerate(queries)]}


class SemanticShortlistTest(unittest.TestCase):
    def prepare(self, queries):
        return server.semantic_prepare_shortlist(core(queries), CARD)

    def test_inflections_and_permutations_keep_one_real_query_and_its_own_demand(self):
        before = core(['монтажная пена', 'пена монтажная', 'монтажные пены', 'монтажной пены'])
        original = copy.deepcopy(before)
        prepared = server.semantic_prepare_shortlist(before, CARD)
        representatives = [r for r in prepared['allKeywords'] if r['selectionStatus'] == 'candidate']
        self.assertEqual(len(representatives), 1)
        self.assertNotEqual(representatives[0]['query'], 'монтажной пены')
        source = next(r for r in original['allKeywords'] if r['query'] == representatives[0]['query'])
        self.assertEqual(representatives[0]['ozonCount'], source['ozonCount'])
        self.assertEqual(before, original)
        self.assertEqual(prepared['shortlist']['duplicateCount'], 3)

    def test_distinct_properties_numbers_recipient_roles_and_negations_do_not_merge(self):
        queries = ['пена для окон', 'пена для дверей', 'пена без пистолета', 'пена для пистолета',
                   'набор на 6 персон 24 предмета', 'набор на 24 персоны 6 предметов',
                   'подарок маме от дочки', 'подарок дочке от мамы', 'пена 750 мл', 'пена 500 мл']
        prepared = self.prepare(queries)
        self.assertEqual(len({r['selectionGroup'] for r in prepared['allKeywords']}), len(queries))
        prepared = self.prepare(['пена для окон монтажная', 'монтажная пена для окон'])
        self.assertEqual(prepared['shortlist']['uniqueCount'], 1)
        prepared = self.prepare(['пена монтажная для окон 500 мл', 'монтажная пена 500 мл для окон'])
        self.assertEqual(prepared['shortlist']['uniqueCount'], 1)

    def test_typos_lemma_grammar_and_fragments_are_not_selected_but_source_is_retained(self):
        queries = ['балон пены', 'пена мон', 'пена монтажный', 'монтажная пены',
                   'пена для пистлета', 'пена монтажная под пистолет под пистолет', 'пена монтажная']
        prepared = self.prepare(queries)
        self.assertEqual(prepared['shortlist']['reviewCount'], 6)
        _, selected, _ = server.semantic_reconcile_result(prepared, {}, 'Ozon')
        self.assertEqual([r['query'] for r in selected], ['пена монтажная'])
        self.assertEqual([r['query'] for r in prepared['allKeywords']], queries)
        self.assertTrue(all(r['relevance'] == 'relevant' for r in prepared['allKeywords']))

    def test_own_brands_and_confirmed_technical_terms_are_not_treated_as_typos(self):
        prepared = self.prepare(['пена KOLT', 'пена для ПВХ', 'низкорасширяющаяся пена'])
        self.assertEqual([r['selectionStatus'] for r in prepared['allKeywords']], ['candidate','candidate','review'])

    def test_default_30_expansion_exclusion_and_current_group_do_not_reintroduce_all(self):
        prepared = self.prepare([f'пена для окон {i} мл' for i in range(65)])
        first, selected, _ = server.semantic_reconcile_result(prepared, {}, 'Ozon')
        self.assertEqual(len(selected), 30)
        prepared['shortlist']['limit'] = 40
        expanded, selected, _ = server.semantic_reconcile_result(prepared, {}, 'Ozon')
        self.assertEqual(len(selected), 40)
        excluded = selected[0]['query']
        old = {'semanticCore': {**expanded, 'decisions': [{'query': excluded, 'manualDecision': 'excluded'}]}, 'selected': selected}
        reloaded, selected, _ = server.semantic_reconcile_result(first, old, 'Ozon')
        self.assertEqual(reloaded['shortlist']['limit'], 40)
        self.assertEqual(len(selected), 39)
        self.assertNotIn(excluded, [r['query'] for r in selected])
        self.assertEqual(prepared['allKeywords'], expanded['allKeywords'])

    def test_manual_includes_and_final_are_retained_and_wrong_market_demand_is_not_used(self):
        prepared = self.prepare(['пена монтажная', 'монтажная пена', 'пена для окон', 'балон пены'])
        prepared['current'] = [{'query': 'монтажная пена'}]
        prepared['allKeywords'][2]['ozonCount'] = 0
        payload = {'selected': [], 'final': [{'query':'итог'}], 'finalSelection': {'selected':[{'query':'итог'}]},
                   'semanticCore': {'allKeywords': [{'query':'балон пены', 'manualDecision':'included'}]}}
        original = copy.deepcopy(payload)
        _, selected, _ = server.semantic_reconcile_result(prepared, payload, 'Ozon')
        self.assertEqual([r['query'] for r in selected], ['балон пены'])
        self.assertEqual(payload, original)

    def test_ozon_normalization_retains_policy_annotations_and_explicit_manual_decisions(self):
        prepared = self.prepare(['монтажная пена', 'пена монтажная', 'балон пены'])
        prepared['shortlist']['limit'] = 40
        prepared['allKeywords'][2]['manualDecision'] = 'excluded'
        payload = server.normalize_ozon_semantic_payload({'cardKey':'1','semanticCore':prepared})
        self.assertEqual(payload['semanticCore']['shortlist'], prepared['shortlist'])
        for saved, original in zip(payload['semanticCore']['allKeywords'], prepared['allKeywords']):
            self.assertEqual(saved, {k:v for k,v in original.items() if v != ''})
        compact = server.semantic_compact_state({'shortlist':prepared['shortlist'],'seedQuery':prepared['seedQuery']})
        self.assertEqual(compact['shortlist']['limit'], 40)
        self.assertNotIn('allKeywords', compact)

    def test_preview_scopes_portal_card_report_and_does_not_write_or_call_providers(self):
        from test_semantic_jobs import SemanticJobsTest, USER
        fixture = SemanticJobsTest()
        fixture.setUp()
        try:
            prepared = core(['средство от моли'])
            server.save_card_draft(fixture.wb, '1001', '1001', '', {'meta': {'semanticCoreReports': [
                {'id':'source-report', 'semanticCore':prepared}]}}, USER)
            with server.connect_db() as db:
                before = db.execute('SELECT payload_json FROM card_drafts').fetchone()[0]
            with patch.object(server, 'fetch_mpstats_semantic_expansion', side_effect=AssertionError('network')), \
                 patch.object(server, 'semantic_classify_query_batch', side_effect=AssertionError('model')):
                result = server.semantic_shortlist_preview(fixture.wb, '1001', 'source-report', USER)
                self.assertEqual(result['shortlist']['uniqueCount'], 1)
                with self.assertRaises(PermissionError):
                    server.semantic_shortlist_preview(fixture.wb, '1001', 'source-report', {**USER, 'login':'other'})
                for card_key, report in [('9999','source-report'), ('1001','other-report')]:
                    with self.assertRaises(ValueError):
                        server.semantic_shortlist_preview(fixture.wb, card_key, report, USER)
            with server.connect_db() as db:
                self.assertEqual(db.execute('SELECT payload_json FROM card_drafts').fetchone()[0], before)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM semantic_jobs').fetchone()[0], 0)
        finally:
            fixture.tearDown()

    def test_content_uses_working_shortlist_without_old_final_or_archived_selection(self):
        prepared = self.prepare(['пена для окон'])
        prepared['current'] = [{'query':'действующий ключ'}]
        payload = {'meta':{'semanticCoreSelected':[{'query':'пена для окон'}], 'semanticCoreRemoval':[],
                          'semanticCoreReports':[{'semanticCore':prepared, 'selected':[{'query':'старый длинный выбор'}]},
                                                 {'semanticCore':core(['архивный ключ']), 'selected':[{'query':'архивный ключ'}]}],
                          'semanticCoreFinal':{'selected':[{'query':'прежний итог'}]}}}
        original = copy.deepcopy(payload)
        with patch.object(server, 'stored_card_draft_payload', return_value=payload):
            selected, current, _ = server.stored_semantic_reoptimization_keywords(1, '1001')
            self.assertEqual([r['query'] for r in selected], ['пена для окон'])
            self.assertEqual([r['query'] for r in current], ['действующий ключ'])
            self.assertEqual(server.stored_semantic_reoptimization_keywords(1, '1001', selected_override=[])[0], [])
            title = server.stored_semantic_title_keyword_rows(1, '1001')
            self.assertEqual({r['query'] for r in title}, {'пена для окон','действующий ключ'})
        self.assertEqual(payload, original)


if __name__ == '__main__':
    unittest.main()
