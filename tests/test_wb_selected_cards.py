import json
import unittest
from unittest.mock import patch

import server
import test_portal_creation_permissions as fixtures


class WbSelectionTest(unittest.TestCase):
    setUp = fixtures.PortalCreationPermissionsTest.setUp
    tearDown = fixtures.PortalCreationPermissionsTest.tearDown
    request = fixtures.PortalCreationPermissionsTest.request
    def create_selected(self, ids):
        return self.request('anastasia.tech', 'POST', '/api/portals', {
            'mode': 'api', 'marketplace': 'Wildberries', 'scope': 'selected',
            'apiKey': 'test-only-selected-connection-123456789',
            'selectedNmIds': ids, 'teamRoles': {'lead': 'owner', 'tech': 'anastasia.tech'},
        })

    def test_missing_invalid_selection_never_calls_api_or_creates_portal(self):
        with patch.object(server, 'fetch_wb_cards') as fetch:
            for value, code in [(None, 'required'), ('', 'required'), ('123\nnot-id', 'invalid'),
                                ('https://wildberries.ru.evil/catalog/123/detail.aspx', 'invalid')]:
                status, body = self.create_selected(value)
                self.assertEqual(status, 400, body)
                self.assertEqual(body['error'], 'wb_selected_cards_' + code)
            fetch.assert_not_called()
        self.assertEqual(len(server.list_portals()), 1)

    def test_complete_selection_saved_and_refresh_stays_bounded(self):
        snapshot = {'cards': [{'nmID': 123, 'title': 'one'}, {'nmID': 456, 'title': 'two'}, {'nmID': 789, 'title': 'extra'}],
                    'stats': {'cardCount': 3, 'portalName': 'Selected'}}
        with patch.object(server, 'fetch_wb_cards', return_value=snapshot) as fetch:
            status, body = self.create_selected('456\nhttps://www.wildberries.ru/catalog/123/detail.aspx?targetUrl=EX\n456')
            self.assertEqual(status, 201, body)
            portal = body['portal']; pid = portal['id']
            self.assertEqual(portal['selectedNmIds'], ['456', '123'])
            self.assertEqual([c['nmID'] for c in portal['realCards']], [456, 123])
            self.assertEqual(portal['cardCount'], 2)
            refreshed = server.fetch_wb_cards_for_portal('test-only', pid)
            self.assertEqual([c['nmID'] for c in refreshed['cards']], [456, 123])
            self.assertEqual(fetch.call_args.kwargs['selected_nm_ids'], ['456', '123'])
            server.update_portal_sync_stats(pid, snapshot)
            self.assertEqual([c['nmID'] for c in server.wb_snapshot_cards_from_row(server.get_portal_row(pid))], [456, 123])
            server.replace_wb_token_for_portal(pid, 'replacement-only-123456789', snapshot)
            self.assertEqual([c['nmID'] for c in server.wb_snapshot_cards_from_row(server.get_portal_row(pid))], [456, 123])
        with server.connect_db() as db:
            db.execute("UPDATE portals SET selected_ids_json='[]' WHERE id=?", (pid,))
        with patch.object(server, 'fetch_wb_cards', return_value=snapshot) as fetch:
            server.fetch_wb_cards_for_portal('test-only', pid)
            self.assertEqual(fetch.call_args.kwargs['selected_nm_ids'], ['456', '123'])

    def test_missing_one_card_does_not_save_partial_cabinet(self):
        with patch.object(server, 'fetch_wb_cards', return_value={'cards': [{'nmID': 123}], 'stats': {}}):
            status, body = self.create_selected('123,456')
        self.assertEqual(status, 400, body)
        self.assertEqual(body['missingNmIds'], ['456'])
        self.assertEqual(len(server.list_portals()), 1)

    def test_summary_and_cached_cards_keep_scope_and_permissions_without_external_api(self):
        with server.connect_db() as db:
            db.execute('UPDATE portals SET card_count=1,cards_snapshot_json=? WHERE id=?',
                       (json.dumps([{'nmID': 123, 'description': 'long body', 'apiKey': 'never-public'}]), self.foreign))
        with patch.object(server, 'wb_request_json', side_effect=AssertionError('no external reads')):
            status, body = self.request('unrelated', 'GET', '/api/portals?view=summary')
            self.assertEqual(status, 200, body)
            portal = body['portals'][0]
            self.assertEqual(portal['cardCount'], 1)
            self.assertFalse(portal['cardsLoaded'])
            self.assertEqual(portal['realCards'], [])
            self.assertNotIn('long body', json.dumps(body))
            status, body = self.request('unrelated', 'GET', f'/api/portals/{self.foreign}/cards')
            self.assertEqual(status, 200, body)
            self.assertEqual(body['cards'][0]['description'], 'long body')
            self.assertNotIn('never-public', json.dumps(body))
            self.assertEqual(self.request('reader', 'GET', f'/api/portals/{self.foreign}/cards')[0], 403)
            self.assertEqual(self.request('kristina.manager', 'GET', f'/api/portals/{self.foreign}/cards')[0], 200)
            self.assertEqual(self.request('kristina.manager', 'GET', '/api/portals/99999/cards')[0], 404)

    def test_raw_fetch_finds_exact_requested_ids_without_unrelated_commercial_enrichment(self):
        def read(token, path, payload=None, **kwargs):
            if path == '/content/v2/get/cards/list':
                search = payload['settings']['filter'].get('textSearch')
                return {'cards': [{'nmID': 456, 'title': 'target'}, {'nmID': 999, 'title': 'unrelated'}] if search else [{'nmID': 123, 'title': 'first'}]}
            return {}
        with patch.object(server, 'fetch_wb_seller_info', return_value={}), \
             patch.object(server, 'wb_request_json', side_effect=read), \
             patch.object(server, 'fetch_wb_prices', return_value={}) as prices, \
             patch.object(server, 'fetch_wb_marketplace_stocks', return_value=[]) as stocks, \
             patch.object(server, 'fetch_wb_analytics_wb_stocks', return_value=[]):
            snapshot = server.fetch_wb_cards('test-only', selected_nm_ids=['456', '123'])
        self.assertEqual([c['nmID'] for c in snapshot['cards']], [456, 123])
        self.assertEqual(prices.call_args.args[1], [456, 123])

    def test_compact_task_summary_keeps_mixed_section_and_semantic_completion_rules(self):
        metas = [
            {'batch': {'workTypes': ['semantic', 'content']}, 'approval': {'status': 'draft'}},
            {'batch': {'workTypes': ['semantic']}, 'semanticCoreFinal': {'semanticCore': {'selected': []}}},
            {'batch': {'workTypes': ['semantic']}, 'semanticCoreFinal': {'semanticCore': {}}},
            {'batch': {'workTypes': ['semantic']}, 'semanticCoreFinal': {'semanticCore': ['wrong type']}},
            {'batch': {'workTypes': ['content', 'prices']}, 'approval': {'status': 'submitted'},
             'approvalSections': {'content': {'status': 'changes_requested'}, 'prices': {'status': 'draft'}}},
            {'batch': {'workTypes': ['content']}, 'approval': {'status': 'approved'}},
            {'batch': {'workTypes': ['content']}, 'manualTaskCompletions': {'content': {'completedAt': '2026-10-29'}}},
            {'batch': {'workTypes': ['semantic', 'stocks']}, 'manualTaskCompletions': {'semantic': {'completedAt': '2026-10-29'}}},
            {'batch': {'workTypes': ['content']}, 'approval': {'status': 'draft'},
             'approvalSections': {'content': {}}},
            {'batch': {'workTypes': []}},
        ]
        expected = server.empty_portal_work_task_summary()
        with server.connect_db() as db:
            for i, meta in enumerate(metas):
                db.execute('INSERT INTO card_drafts(portal_id,card_key,payload_json) VALUES(?,?,?)',
                           (self.foreign, str(i), json.dumps({'meta': meta, 'unusedHistory': 'x' * 100000})))
                work = server.active_task_work_types(meta)
                status = server.task_status_for_work_types(meta, work)
                if not work or status not in {'draft', 'submitted', 'changes_requested', 'approved'}:
                    continue
                expected['taskTotalCount'] += 1
                expected[{'draft': 'taskDraftCount', 'submitted': 'taskPendingCount',
                          'changes_requested': 'taskReturnedCount', 'approved': 'taskApprovedCount'}[status]] += 1
                if status in {'draft', 'submitted', 'changes_requested'}:
                    expected['taskActiveCount'] += 1
            db.execute('INSERT INTO card_drafts(portal_id,card_key,payload_json) VALUES(?,?,?)',
                       (self.foreign, 'invalid', 'invalid json'))
        actual = server.portal_work_task_summary(self.foreign)
        expected['lastTaskAt'] = actual['lastTaskAt']
        self.assertEqual(actual, expected)
