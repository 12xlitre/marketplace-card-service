from copy import deepcopy
import http.client
import io
import json
import re
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import server
from automatic_seo import SeoError
from automatic_seo_host import OzonSeoHost


class AutomaticSeoRoutesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(server, 'DB_PATH', Path(self.tmp.name)/'test.sqlite3')
        self.db_patch.start()
        server.init_db()
        with server.connect_db() as db:
            db.execute("""INSERT INTO users (login, password_hash, full_name, role, user_role, access_level) VALUES
                ('owner', 'x', 'Owner', 'Manager', 'manager', 'overview'),
                ('other', 'x', 'Other', 'Manager', 'manager', 'overview')""")
            uid = db.execute("SELECT id FROM users WHERE login='owner'").fetchone()['id']
            self.session = server.create_session(db, uid)
        self.user = {'login': 'owner', 'role': 'Manager', 'user_role': 'manager', 'access_level': 'overview'}
        self.portal = server.create_portal('TEST Ozon', 'Ozon', 'selected', 'owner', {'tech': 'owner', 'manager': 'owner'})
        self.other = server.create_portal('Other Ozon', 'Ozon', 'selected', 'other', {'tech': 'other'})
        self.task = {'id': 'auto-1', 'cardKey': '1001', 'sku': '1001', 'title': 'TEST',
                     'batchId': 'batch', 'optimizationMode': 'automatic', 'workTypes': ['content'], 'status': 'draft'}
        self.manual = {'id': 'manual-1', 'cardKey': '1001', 'sku': '1001', 'title': 'TEST', 'batchId': 'manual', 'workTypes': ['content']}
        server.save_ozon_tasks(self.portal, {'tasks': [self.manual, self.task]}, self.user)
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.OpticardsHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.thread.join()
        self.db_patch.stop(); self.tmp.cleanup()

    def request(self, method, path, data=None, authenticated=True):
        client = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        headers = {'Content-Type': 'application/json'}
        if authenticated:
            headers['Cookie'] = f'{server.SESSION_COOKIE}={self.session}'
        client.request(method, path, json.dumps(data) if data is not None else None, headers)
        response = client.getresponse(); body = response.read()
        code = response.status; client.close()
        return code, body

    def test_auth_portal_isolation_and_file_route(self):
        path = f'/api/portals/{self.portal}/automatic-seo/batch'
        for method in ['GET', 'POST']:
            self.assertEqual(self.request(method, path, {}, authenticated=False)[0], 401)
        status, raw = self.request('GET', path)
        self.assertEqual(status, 200, raw)
        self.assertTrue(json.loads(raw)['capabilities']['prepare'])
        self.assertEqual(self.request('GET', path+'/file?version=1')[0], 404)
        self.assertEqual(self.request('GET', path.replace(str(self.portal), str(self.other), 1))[0], 403)
        self.assertEqual(self.request('POST', path, {'action': 'generate', 'version': 0, 'competitors': {}})[0], 400)

    def test_gigachat_seo_enforces_json_schema_without_changing_other_calls(self):
        from automatic_seo import PROFILE_SCHEMA
        requests = []
        def response(request, timeout):
            requests.append((json.loads(request.data), timeout))
            return io.BytesIO(b'{"choices":[{"message":{"content":"{}"}}]}')
        with patch.object(server, 'OPTICARDS_LLM_PROVIDER', 'gigachat'), \
             patch.object(server, 'gigachat_access_token', return_value='test-token'), \
             patch.object(server, 'gigachat_urlopen', side_effect=response):
            server.audit_llm_chat_completion([], response_schema=PROFILE_SCHEMA)
            server.audit_llm_chat_completion([])
        self.assertEqual(requests[0][0]['response_format'], {'type': 'json_schema', 'schema': PROFILE_SCHEMA, 'strict': True})
        self.assertEqual(requests[0][1], 60)
        self.assertNotIn('response_format', requests[1][0])

    def test_http_generation_download_accept_and_approval_keep_manual_task(self):
        from test_automatic_seo import card, sources, FakeHost
        service = server.automatic_seo_service()
        provider = FakeHost()
        path = f'/api/portals/{self.portal}/automatic-seo/batch'
        with patch.object(service.host, 'automatic_seo_preflight'), \
             patch.object(service.host, 'automatic_seo_own_cards', return_value=[card('1001')]), \
             patch.object(service.host, 'automatic_seo_sources', side_effect=lambda portal, own, mapping, period, cache, user: sources(own, mapping)), \
             patch.object(service.host, 'automatic_seo_chat_completion', side_effect=lambda messages, schema: provider.audit_llm_chat_completion(messages)):
            status, raw = self.request('POST', path, {'action': 'generate', 'version': 0, 'competitors': {'1001': {'sku': 'https://www.ozon.ru/product/smesitel-9001/?from=share'}}})
            self.assertEqual(status, 200, raw)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                status, raw = self.request('GET', path)
                if json.loads(raw)['versions'][-1]['status'] != 'running':
                    break
                time.sleep(.01)
            self.assertEqual(json.loads(raw)['versions'][-1]['status'], 'review', raw)
            status, file = self.request('GET', path+'/file?version=1')
            self.assertEqual(status, 200)
            self.assertTrue(file.startswith(b'PK'))
            status, raw = self.request('POST', path, {'action': 'accept', 'version': 1, 'acknowledgeIssues': True})
            self.assertEqual(status, 200, raw)
            self.assertEqual(json.loads(raw)['tasks'][0]['status'], 'submitted')
            status, raw = self.request('POST', path, {'action': 'approve', 'version': 1})
            self.assertEqual(status, 200, raw)
            tasks = server.list_ozon_tasks(self.portal, self.user)['tasks']
            self.assertEqual(next(t for t in tasks if t['id']=='auto-1')['status'], 'approved')
            self.assertEqual(next(t for t in tasks if t['id']=='manual-1')['status'], 'draft')

    def test_generic_task_save_cannot_approve_or_downgrade_automatic_mode(self):
        updated = deepcopy(self.task)
        updated.pop('optimizationMode')
        updated.update(status='approved', batchId='stolen-batch')
        data = server.save_ozon_tasks(self.portal, {'tasks': [self.manual, updated]}, self.user)
        auto = next(t for t in data['tasks'] if t['id'] == self.task['id'])
        self.assertEqual((auto['status'], auto['optimizationMode'], auto['batchId'], auto['cardKey']), ('draft', 'automatic', 'batch', '1001'))
        self.assertEqual(len(data['tasks']), 2)  # manual task with same SKU retained

    def test_legacy_schema_migration_preserves_rows_ids_and_is_idempotent(self):
        with server.connect_db() as db:
            db.execute("DELETE FROM ozon_tasks WHERE task_id='auto-1'")
            before = dict(db.execute('SELECT * FROM ozon_tasks').fetchone())
            sql = db.execute("SELECT sql FROM sqlite_master WHERE name='ozon_tasks'").fetchone()['sql']
            legacy_sql = re.sub(r'UNIQUE\s*\(portal_id,\s*task_id\)', 'UNIQUE (portal_id, task_id), UNIQUE (portal_id, card_key)', sql)
            db.execute('DROP TABLE ozon_tasks')
            db.execute(legacy_sql)
            columns = ','.join(before)
            db.execute(f"INSERT INTO ozon_tasks ({columns}) VALUES ({','.join('?' for _ in before)})", list(before.values()))
        server.init_db()
        server.init_db()
        with server.connect_db() as db:
            after = dict(db.execute('SELECT * FROM ozon_tasks').fetchone())
            self.assertEqual(before, after)
            self.assertIsNotNone(db.execute("SELECT name FROM sqlite_master WHERE name='idx_ozon_tasks_portal'").fetchone())
        result = server.save_ozon_tasks(self.portal, {'tasks': [self.manual, self.task]}, self.user)
        self.assertEqual(len(result['tasks']), 2)

    def test_deleted_automatic_task_cannot_be_resurrected_by_stale_browser(self):
        server.save_ozon_tasks(self.portal, {'tasks': [self.manual]}, self.user)
        with self.assertRaisesRegex(ValueError, 'seo_deleted_task_restore_blocked'):
            server.save_ozon_tasks(self.portal, {'tasks': [self.manual, self.task]}, self.user)

    def test_portal_deletion_removes_reports_and_worker_cannot_recreate_them(self):
        from test_automatic_seo import card
        service = server.automatic_seo_service()
        entered, release, completed = threading.Event(), threading.Event(), threading.Event()
        original_worker = service.worker
        def own_cards(*args):
            entered.set(); release.wait(5)
            return [card('1001')]
        def worker(*args):
            try:
                original_worker(*args)
            finally:
                completed.set()
        other_dir = service.directory(self.other, 'other-batch')
        other_dir.mkdir(parents=True)
        (other_dir/'keep.txt').write_text('Other cabinet data')
        with patch.object(service.host, 'automatic_seo_preflight'), \
             patch.object(service.host, 'automatic_seo_own_cards', side_effect=own_cards), \
             patch.object(service, 'worker', side_effect=worker):
            try:
                service.action(self.portal, 'batch', self.user, {'action': 'generate', 'version': 0,
                    'competitors': {'1001': {'sku': '9001', 'reason': 'Подтверждена сопоставимость товара.'}}})
                self.assertTrue(entered.wait(3))
                with server.connect_db() as db:
                    db.execute('UPDATE portals SET is_active=0 WHERE id=?', (self.portal,))
                server.delete_portal(self.portal, self.user)
            finally:
                release.set()
                self.assertTrue(completed.wait(5))
        self.assertFalse((service.root/str(self.portal)).exists())
        self.assertTrue((other_dir/'keep.txt').exists())

    def test_dictionary_validation_and_unknown_attribute_fail_closed(self):
        adapter = OzonSeoHost(server)
        card = {'descriptionCategoryId': 20, 'typeId': 30, 'characteristics': []}
        definition = {'id': 100, 'name': 'Материал', 'dictionary_id': 10, 'max_value_count': 1}
        result = {'sources': {'definitions': [definition]}, 'characteristics': [{'id': '100', 'values': ['латунь']}]}
        with patch.object(adapter, 'dictionary', return_value=[{'value': 'латунь'}]):
            adapter.automatic_seo_verify_characteristics(self.portal, card, result, {}, self.user)
            result['characteristics'][0]['values'] = ['пластик']
            with self.assertRaisesRegex(SeoError, 'seo_dictionary_value_not_allowed'):
                adapter.automatic_seo_verify_characteristics(self.portal, card, result, {}, self.user)
        result['characteristics'][0]['id'] = '999'
        with self.assertRaisesRegex(SeoError, 'seo_invalid_characteristic_id'):
            adapter.automatic_seo_verify_characteristics(self.portal, card, result, {}, self.user)

    def test_source_dates_and_positions_are_own_daily_observations(self):
        adapter = OzonSeoHost(server)
        card = {'sku': '1001', 'rawFields': {'attributeDefinitions': [{'id': 100}]}}
        def fake_mp(path, cache):
            if path.endswith('/versions'):
                return [{'version': 'abc', 'date': '2026-10-10'}]
            if '/versions/abc' in path:
                return {'name': 'Конкурент', 'description': 'Описание конкурента', 'param_names': [], 'param_values': []}
            if '/full?' in path:
                return {'name': 'Конкурент', 'seller': {'id': 2}}
            if '/by_period?' in path:
                return []
            if 'd1=2026-09-20&d2=2026-09-20' in path:
                return [{'query': 'кран', 'positions': [15], 'count': 7}]
            if 'd1=2026-10-19&d2=2026-10-19' in path:
                return [{'query': 'кран', 'positions': [None], 'count': 7}]
            return [{'query': 'кран', 'avg_position': 3, 'count': 7}]
        with patch.object(adapter, 'mp', side_effect=fake_mp):
            result = adapter.automatic_seo_sources(self.portal, card, {'sku': '9001', 'reason': 'Подтверждённая сопоставимость.'}, {'d1': '2026-09-20', 'd2': '2026-10-19'}, {}, self.user)
        query = result['semantic'][0]
        self.assertIsNone(query['position'])
        self.assertEqual(query['dynamics'], '15 → нет наблюдения')
        self.assertEqual(query['countSourceSku'], '1001')


if __name__ == '__main__':
    unittest.main()
