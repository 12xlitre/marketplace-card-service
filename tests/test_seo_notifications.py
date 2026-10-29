import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import server
import automatic_seo_host as host
from automatic_seo import SeoError
import test_portal_creation_permissions as fixtures
import test_automatic_seo as seo_fixtures

HOOK = 'https://weboptimize.bitrix24.ru/rest/1/local-test-not-a-secret/'


class SeoNotificationsTest(unittest.TestCase):
    setUp = fixtures.PortalCreationPermissionsTest.setUp
    tearDown = fixtures.PortalCreationPermissionsTest.tearDown
    request = fixtures.PortalCreationPermissionsTest.request

    def ready(self):
        with server.connect_db() as db:
            db.execute("INSERT INTO users(login,password_hash,full_name,role,user_role,access_level) VALUES('admin','x','Admin','Admin','admin','admin')")
            self.admin = dict(db.execute("SELECT * FROM users WHERE login='admin'").fetchone())
            self.cookies['admin'] = f'{server.SESSION_COOKIE}={server.create_session(db,self.admin["id"])}'
        self.portal = server.create_portal('Test WB','Wildberries','full','owner',{'lead':'owner','tech':'anastasia.tech'})
        self.notifier = server.bitrix_seo_notifier()
        with patch.object(host,'bitrix_notification_request',return_value=['im']):
            self.notifier.configure(HOOK,self.admin)
        self.version = {'number':2,'status':'review','total':58,'done':58,'sha256':'checked','errors':[]}

    def test_config_requires_admin_and_stores_only_encrypted_secret(self):
        self.ready()
        with patch.object(host,'bitrix_notification_request') as call:
            for login in ['anastasia.tech','owner','kristina.manager']:
                self.assertEqual(self.request(login,'POST','/api/integrations/bitrix-notifications',{'webhook':HOOK})[0],403)
                self.assertEqual(self.request(login,'GET','/api/integrations/bitrix-notifications')[0],403)
            call.assert_not_called()
        status,body=self.request('admin','GET','/api/integrations/bitrix-notifications')
        self.assertEqual(status,200,body);self.assertTrue(body['integration']['enabled'])
        self.assertNotIn(HOOK,json.dumps(body))
        with server.connect_db() as db:
            value=dict(db.execute("SELECT * FROM service_integrations WHERE provider='bitrix-notifications'").fetchone())
        self.assertNotIn('local-test-not-a-secret',json.dumps(value))
        self.assertEqual(server.get_service_integration_secret('bitrix-notifications'),HOOK)

    def test_webhook_restrictions_and_missing_im_do_not_save(self):
        self.ready()
        for url in ['http://weboptimize.bitrix24.ru/rest/1/test/','https://other.bitrix24.ru/rest/1/test/',
                    HOOK+'?redirect=elsewhere','https://secret@weboptimize.bitrix24.ru/rest/1/test/',HOOK+'scope.json']:
            with self.subTest(url=url),self.assertRaises(ValueError):host.clean_bitrix_notification_webhook(url)
        with patch.object(host,'bitrix_notification_request',return_value=['crm']),self.assertRaisesRegex(SeoError,'im_scope_required'):
            self.notifier.configure(HOOK,self.admin)

    def test_once_per_version_and_current_tech_assignment(self):
        self.ready()
        self.notifier.enqueue(self.portal,'batch',self.version)
        self.notifier.enqueue(self.portal,'batch',self.version)
        directory=self.notifier.service.directory(self.portal,'batch')
        paths=list(directory.glob('bitrix-notification-v*.json'));self.assertEqual(len(paths),1)
        self.assertEqual(paths[0].stat().st_mode & 0o777,0o600)
        with patch.object(host,'bitrix_notification_request',return_value=1234) as send:
            self.notifier.process();self.notifier.process()
        self.assertEqual(send.call_count,1)
        payload=send.call_args.args[2]
        self.assertEqual(payload['USER_ID'],91)
        self.assertIn('Файл готов к проверке',payload['MESSAGE'])
        self.assertIn(f'?portal={self.portal}&tab=tasks',payload['MESSAGE'])
        self.assertEqual(json.loads(paths[0].read_text())['status'],'sent')
        self.notifier.enqueue(self.portal,'batch',{**self.version,'number':3})
        with server.connect_db() as db:db.execute("UPDATE portal_members SET user_login='reader' WHERE portal_id=? AND project_role='tech'",(self.portal,))
        with patch.object(host,'bitrix_notification_request') as send:self.notifier.process();send.assert_not_called()
        self.assertEqual(json.loads((directory/'bitrix-notification-v3.json').read_text())['status'],'cancelled')

    def test_timeout_is_not_repeated_and_failure_does_not_claim_a_ready_file(self):
        self.ready();version={**self.version,'status':'partial','sha256':None,'errors':[{'code':'test_failure'}]}
        self.notifier.enqueue(self.portal,'batch',version)
        with patch.object(host,'bitrix_notification_request',side_effect=SeoError('bitrix_notifications_delivery_unknown')) as send:
            self.notifier.process();self.notifier.process()
        self.assertEqual(send.call_count,1)
        payload=send.call_args.args[2]
        self.assertIn('с ошибками',payload['MESSAGE']);self.assertNotIn('Файл готов',payload['MESSAGE'])
        path=self.notifier.service.directory(self.portal,'batch')/'bitrix-notification-v2.json'
        self.assertEqual(json.loads(path.read_text())['status'],'uncertain')
        self.assertEqual(version['status'],'partial')

    def test_transport_hides_secrets_does_not_retry_uncertain_send_and_honors_429(self):
        opener=unittest.mock.Mock()
        opener.open.side_effect=URLError('contains '+HOOK)
        with patch('urllib.request.build_opener',return_value=opener):
            with self.assertRaisesRegex(SeoError,'delivery_unknown') as raised:
                host.bitrix_notification_request(HOOK,'im.notify.system.add',{'USER_ID':91})
        self.assertNotIn(HOOK,str(raised.exception));self.assertEqual(opener.open.call_count,1)
        response=unittest.mock.MagicMock();response.__enter__.return_value.read.return_value=b'{"result":123}'
        opener=unittest.mock.Mock();opener.open.side_effect=[HTTPError(HOOK,429,'error',{'Retry-After':'2'},None),response]
        with patch('urllib.request.build_opener',return_value=opener),patch.object(host.time,'sleep') as sleep:
            self.assertEqual(host.bitrix_notification_request(HOOK,'im.notify.system.add',{'USER_ID':91}),123)
        sleep.assert_called_once_with(2)

    def test_authorized_handoff_can_queue_until_connection_is_configured(self):
        self.ready();self.notifier.disconnect()
        self.notifier.enqueue(self.portal,'batch',{**self.version,'_resumeIntentId':123})
        path=self.notifier.service.directory(self.portal,'batch')/'bitrix-notification-v2.json'
        self.assertEqual(json.loads(path.read_text())['status'],'pending')
        with patch.object(host,'bitrix_notification_request') as send:
            self.notifier.process();send.assert_not_called()
        with patch.object(host,'bitrix_notification_request',return_value=['im']):
            self.notifier.configure(HOOK,self.admin)
        with patch.object(host,'bitrix_notification_request',return_value=12) as send:
            self.notifier.process();self.assertEqual(send.call_count,1)
        self.assertEqual(json.loads(path.read_text())['status'],'sent')


class CompletionHookIsolationTest(unittest.TestCase):
    def test_notification_failure_cannot_change_completed_seo_or_lose_file(self):
        case=seo_fixtures.AutomaticSeoTest();case.setUp()
        try:
            with patch.object(case.host,'automatic_seo_completed',side_effect=RuntimeError('notification unavailable'),create=True) as notify:
                case.action();version=case.finish()
                self.assertEqual(version['status'],'review')
                self.assertTrue(case.service.download(1,'batch',case.tech,1))
                self.assertEqual(notify.call_count,1)
        finally:case.tearDown()
