import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import server


class PortalCreationPermissionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db = server.DB_PATH
        server.DB_PATH = Path(self.tmp.name) / 'test.sqlite3'
        self.env = patch.dict(os.environ, {server.SECRET_KEY_ENV: server.generate_secret_key()})
        self.env.start()
        server.init_db()
        with server.connect_db() as db:
            db.executemany('INSERT INTO users (login,password_hash,full_name,role,user_role,access_level,is_active) VALUES (?,?,?,?,?,?,?)', [
                ('anastasia.tech', 'x', 'Анастасия Руднева', 'Tech', 'tech', 'readonly_wb', 1),
                ('reader', 'x', 'Reader', 'Tech', 'tech', 'readonly_wb', 1),
                ('owner', 'x', 'Owner', 'Manager', 'manager', 'overview', 1),
                ('unrelated', 'x', 'Unrelated', 'Manager', 'manager', 'overview', 1),
                ('kristina.manager', 'x', 'Кристина Январева', 'Руководитель отдела', 'manager', 'overview', 1),
                ('inactive', 'x', 'Inactive', 'Manager', 'manager', 'overview', 0),
            ])
            self.users = {r['login']: dict(r) for r in db.execute('SELECT * FROM users')}
            self.cookies = {login: f'{server.SESSION_COOKIE}={server.create_session(db, row["id"])}'
                            for login, row in self.users.items() if row['is_active']}
        self.foreign = server.create_portal('Other client', 'Wildberries', 'full', 'unrelated', {'lead': 'unrelated'})
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.OpticardsHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        server.OZON_CONNECTION_NEXT_CHECK.clear()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        server.OZON_CONNECTION_NEXT_CHECK.clear()
        self.env.stop()
        server.DB_PATH = self.old_db
        self.tmp.cleanup()

    def request(self, login, method, path, payload=None):
        client = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        client.request(method, path, json.dumps(payload) if payload is not None else None,
                       {'Cookie': self.cookies[login], 'Content-Type': 'application/json'})
        response = client.getresponse()
        status, body = response.status, json.loads(response.read())
        client.close()
        return status, body

    def test_anastasia_can_create_both_marketplaces_manually_and_keeps_scoped_access(self):
        user = self.users['anastasia.tech']
        self.assertTrue(server.public_user(user)['canCreatePortals'])
        self.assertFalse(server.user_can_manage_portals(user))
        self.assertFalse(server.user_can_manage_users(user))
        self.assertFalse(server.user_has_global_portal_access(user))
        for marketplace in ['Wildberries', 'Ozon']:
            with self.subTest(marketplace=marketplace):
                status, body = self.request('anastasia.tech', 'POST', '/api/portals', {
                    'mode': 'manual', 'marketplace': marketplace, 'name': 'New cabinet',
                    'clientName': 'Selected client', 'teamRoles': {'lead': 'owner', 'tech': 'anastasia.tech'},
                })
                self.assertEqual(status, 201, body)
                portal = body['portal']
                self.assertEqual(portal['clientName'], 'Selected client')
                self.assertTrue(server.user_can_access_portal(user, portal['id']))
                self.assertFalse(server.user_can_access_portal(self.users['reader'], portal['id']))
        self.assertFalse(server.user_can_access_portal(user, self.foreign))

    def test_anastasia_can_connect_api_cabinets_with_encrypted_keys(self):
        token = 'test-key-for-connection-only-123456789'
        wb_snapshot = {'cards': [{'nmID': 12345, 'title': 'Test'}], 'stats': {'portalName': 'Test WB', 'cardCount': 1}}
        ozon_snapshot = {'cards': [{'id': '67890', 'sku': '67890', 'offerId': 'test', 'marketplace': 'ozon'}],
                         'productCount': 1, 'loadedAt': '2026-10-29T10:00:00+00:00'}
        with patch.object(server, 'fetch_wb_cards', return_value=wb_snapshot), patch.object(server, 'fetch_ozon_seller_cards', return_value=ozon_snapshot):
            for marketplace in ['Wildberries', 'Ozon']:
                with self.subTest(marketplace=marketplace):
                    status, body = self.request('anastasia.tech', 'POST', '/api/portals', {
                        'mode': 'api', 'marketplace': marketplace, 'scope': 'full', 'apiKey': token,
                        'clientId': '99999', 'teamRoles': {'tech': 'anastasia.tech', 'lead': 'owner'},
                    })
                    self.assertEqual(status, 201, body)
                    self.assertNotIn(token, json.dumps(body))
                    with server.connect_db() as db:
                        row = db.execute('SELECT token_ciphertext FROM portal_integrations WHERE portal_id=?', (body['portal']['id'],)).fetchone()
                    self.assertTrue(row['token_ciphertext'])
                    self.assertNotIn(token, str(row['token_ciphertext']))

    def test_creation_right_does_not_depend_on_display_name_and_is_checked_before_api(self):
        self.assertFalse(server.user_can_create_portals({**self.users['reader'], 'full_name': 'Анастасия Руднева'}))
        self.assertFalse(server.user_can_create_portals({**self.users['anastasia.tech'], 'is_active': 0}))
        with patch.object(server, 'fetch_wb_cards') as wb, patch.object(server, 'fetch_ozon_seller_cards') as ozon:
            for marketplace in ['Wildberries', 'Ozon']:
                for mode in ['manual', 'api']:
                    status, _ = self.request('reader', 'POST', '/api/portals', {'marketplace': marketplace, 'mode': mode, 'apiKey': 'x' * 32})
                    self.assertEqual(status, 403)
            wb.assert_not_called()
            ozon.assert_not_called()

    def test_creator_can_select_active_team_without_access_to_their_portals(self):
        visible = {u['login'] for u in server.list_visible_users(self.users['anastasia.tech'])}
        self.assertIn('owner', visible)
        self.assertIn('unrelated', visible)
        self.assertNotIn('inactive', visible)
        self.assertNotIn('unrelated', {u['login'] for u in server.list_visible_users(self.users['reader'])})
        self.assertFalse(server.user_can_access_portal(self.users['anastasia.tech'], self.foreign))

    def test_department_head_sees_all_marketplaces_and_archived_cabinets_without_assignment(self):
        user = self.users['kristina.manager']
        self.assertTrue(server.user_has_global_portal_access(user))
        self.assertTrue(server.user_is_ozon_beta_tester(user))
        expected = {str(self.foreign)}
        for marketplace in ['Wildberries', 'Ozon']:
            for active in [True, False]:
                portal_id = server.create_portal(f'{marketplace} {active}', marketplace, 'full',
                                                 'unrelated', {'lead': 'unrelated'})
                expected.add(str(portal_id))
                if not active:
                    with server.connect_db() as db:
                        db.execute('UPDATE portals SET is_active=0 WHERE id=?', (portal_id,))
                self.assertIsNotNone(server.get_portal_row(portal_id, user))
                self.assertTrue(server.user_can_access_portal(user, portal_id))
                self.assertFalse(server.user_can_access_portal(self.users['anastasia.tech'], portal_id))
                self.assertFalse(server.user_can_access_portal(self.users['owner'], portal_id))
        status, body = self.request('kristina.manager', 'GET', '/api/portals')
        self.assertEqual(status, 200)
        self.assertEqual({str(p['id']) for p in body['portals']}, expected)
        self.assertFalse(server.user_is_ozon_beta_tester({**self.users['owner'], 'full_name': 'Кристина Январева'}))


if __name__ == '__main__':
    unittest.main()
