from copy import deepcopy
import unittest
from unittest.mock import patch
import server

from automatic_seo import SeoError, fingerprint
import test_automatic_seo as fixtures


def ready_result(card, sources):
    value = fixtures.generated()
    value.update(sources=deepcopy(sources), competitorProfile={'structure': ['Назначение'],
        'phrases': [{'phrase': 'кран для умывальника', 'quote': 'кран для умывальника'}]})
    value['semanticDecisions'][0].update(outputPhrase='кран для умывальника', placementReviewed=True,
        reason='Назначение крана для умывальника подтверждено собственным описанием смесителя.',
        groupProof={'source': 'description', 'quote': 'Смеситель для раковины.'})
    value['quality'] = {'state': 'ready', 'checkedQueries': 1, 'unresolvedAutomaticCount': 0}
    return value


class ReadyActionTest(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.AutomaticSeoTest(); self.case.setUp()
        self.addCleanup(self.case.tearDown)
        self.service, self.host = self.case.service, self.case.host
        self.case.action(); self.first = self.case.finish()
        self.directory = self.service.directory(1, 'batch')
        state = self.service.load(self.directory)
        state['versions'][-1]['results']['1001'] = ready_result(fixtures.card('1001'),
            state['versions'][-1]['results']['1001']['sources'])
        state['versions'][-1]['results']['1002']['issues'] = [{'code': 'semantic_placement_unresolved', 'blocking': True}]
        state['versions'][-1]['issues'] = [{'sku': '1002', 'blocking': True}]
        self.source_date = state['versions'][-1]['sourceCapturedAt']
        self.hashes = {sku: fingerprint(row) for sku, row in state['versions'][-1]['results'].items()}
        self.service.save(self.directory, state)
        self.host.automatic_seo_ready_workflow = lambda: True

    def test_generate_repairs_legacy_issues_with_frozen_sources_and_preserves_ready_sku(self):
        calls = []
        def generate(card, sources, *args, **kwargs):
            calls.append(card['sku']); return ready_result(card, sources)
        with (patch.object(self.host, 'automatic_seo_own_cards', side_effect=AssertionError('source refresh')),
             patch.object(self.host, 'automatic_seo_sources', side_effect=AssertionError('source refresh')),
             patch.object(self.service, 'generate_ready', side_effect=generate)):
            self.case.action('generate', 1)
            result = self.case.finish()
        self.assertEqual(result['status'], 'review', result)
        self.assertEqual(calls, ['1002'])
        self.assertEqual(result['quality']['checkedCards'], 2)
        self.assertEqual(result['quality']['checkedQueries'], 2)
        self.assertEqual(result['continuation']['preservedCount'], 1)
        self.assertEqual(result['sourceCapturedAt'], self.source_date)
        state = self.service.load(self.directory)
        self.assertEqual(fingerprint(state['versions'][-1]['results']['1001']), self.hashes['1001'])
        self.assertEqual({sku: fingerprint(row) for sku, row in state['versions'][0]['results'].items()}, self.hashes)
        self.assertEqual(self.service.download(1, 'batch', self.case.tech, 1),
                         (self.directory/'seo-v1.xlsx').read_bytes())
        with patch.object(server, 'automatic_seo_service', return_value=self.service), patch.object(server, 'user_is_admin', return_value=True):
            report = server.automatic_seo_handoff_report(1, 'batch', self.case.tech)
        self.assertTrue(report['sourcePreserved'])
        self.assertEqual(report['repair'], {'fromVersion': 1, 'baselineResults': 2,
            'unchangedBaselineResults': 2, 'baselineVersionUnchanged': True})

    def test_unchecked_result_cannot_produce_downloadable_file_or_be_accepted(self):
        with patch.object(self.service, 'generate_ready', return_value=fixtures.generated()):
            self.case.action('repair', 1)
            result = self.case.finish()
        self.assertEqual(result['status'], 'partial', result)
        self.assertEqual([row['sku'] for row in result['errors']], ['1002'])
        self.assertEqual(result['completedCount'], 1)
        self.assertFalse(result.get('sha256'))
        self.assertFalse((self.directory/'seo-v2.xlsx').exists())
        with self.assertRaisesRegex(SeoError, 'seo_not_ready'):
            self.service.action(1, 'batch', self.case.tech, {'action': 'accept', 'version': 2})

    def test_repair_cannot_silently_change_competitor_or_refresh_sources(self):
        for payload in [{'refreshSources': True}, {'competitors': {sku: {'sku': '9002', 'reason': 'Другой конкурент'} for sku in ['1001','1002']}}]:
            with self.subTest(payload=payload), self.assertRaisesRegex(SeoError, 'seo_invalid_repair_scope'):
                self.service.action(1, 'batch', self.case.tech, {'action': 'repair', 'version': 1, **payload})
