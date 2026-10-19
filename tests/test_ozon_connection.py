import json
import os
import tempfile
import threading
import http.client
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import server
import server as ozon_seller


class OzonConnectionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db = server.DB_PATH
        server.DB_PATH = Path(self.tmp.name) / "test.sqlite3"
        self.env = patch.dict(os.environ, {server.SECRET_KEY_ENV: server.generate_secret_key()})
        self.env.start()
        server.init_db()
        with server.connect_db() as db:
            db.execute("""INSERT INTO users (login, password_hash, full_name, role, user_role, access_level)
                VALUES ('owner', 'x', 'Owner', 'Manager', 'manager', 'overview'),
                       ('reader', 'x', 'Reader', 'Tech', 'tech', 'readonly_wb'),
                       ('other', 'x', 'Other', 'Manager', 'manager', 'overview')""")
        self.owner = {"login": "owner", "role": "Manager", "user_role": "manager", "access_level": "overview"}
        self.reader = {"login": "reader", "role": "Tech", "user_role": "tech", "access_level": "readonly_wb"}
        self.other = {**self.owner, "login": "other"}
        self.portal = server.create_portal("Ozon", "Ozon", "selected", "owner", {"lead": "owner", "tech": "reader"})
        self.second = server.create_portal("Other Ozon", "Ozon", "selected", "owner", {"lead": "owner"})
        self.wb = server.create_portal("WB", "Wildberries", "full", "owner", {"lead": "owner"})
        self.credentials = {"clientId": "37844", "apiKey": "test-key-" + "a" * 32}
        server.OZON_CONNECTION_NEXT_CHECK.clear()
        server.OZON_CONNECTION_INFLIGHT.clear()
        self.transport = patch.object(server, "check_ozon_credentials", return_value={"productCount": 12})
        self.check = self.transport.start()

    def tearDown(self):
        self.transport.stop()
        self.env.stop()
        server.DB_PATH = self.old_db
        server.OZON_CONNECTION_NEXT_CHECK.clear()
        server.OZON_CONNECTION_INFLIGHT.clear()
        self.tmp.cleanup()

    def connect(self, portal=None):
        return server.update_ozon_connection(portal or self.portal, self.credentials, self.owner)

    def create_connected(self, team=None, scope="full", manual_source=""):
        return server.create_connected_ozon_portal("Honeybear Ozon", scope, self.owner, team if team is not None else {"lead": "owner"}, self.credentials, manual_source=manual_source, client_name="Honeybear")

    def portal_count(self):
        with server.connect_db() as db:
            return db.execute("SELECT COUNT(*) FROM portals").fetchone()[0]

    def test_creation_saves_cabinet_team_and_encrypted_access_together(self):
        portal_id, result = self.create_connected()
        row = server.get_portal_row(portal_id, self.owner)
        self.assertEqual(row["marketplace"], "Ozon")
        self.assertEqual(row["client_name"], "Honeybear")
        self.assertEqual(row["api_connected"], 0)
        self.assertEqual(row["card_count"], 0)
        self.assertEqual(result["productCount"], 12)
        connection = server.ozon_connection_row(portal_id)
        self.assertEqual(connection["status"], "verified")
        self.assertEqual(json.loads(server.decrypt_secret(connection["token_nonce"], connection["token_ciphertext"], server.integration_aad(portal_id, "ozon"))), self.credentials)

    def test_failed_auth_does_not_create_empty_cabinet(self):
        before = self.portal_count()
        self.check.side_effect = server.OzonSellerError("ozon_auth_error", 409)
        with self.assertRaises(server.OzonSellerError):
            self.create_connected()
        self.assertEqual(self.portal_count(), before)

    def test_creation_encryption_failure_rolls_back_cabinet(self):
        before = self.portal_count()
        with patch.object(server, "encrypt_secret", side_effect=RuntimeError("secret_storage_unavailable")):
            with self.assertRaises(RuntimeError):
                self.create_connected()
        self.assertEqual(self.portal_count(), before)

    def test_creation_invalid_team_rolls_back_cabinet(self):
        before = self.portal_count()
        with self.assertRaises(server.sqlite3.IntegrityError):
            self.create_connected(team={"lead": "nonexistent-user"})
        self.assertEqual(self.portal_count(), before)

    def test_duplicate_creation_does_not_create_empty_cabinet(self):
        self.connect()
        before = self.portal_count()
        with self.assertRaisesRegex(ValueError, "ozon_account_already_connected"):
            self.create_connected()
        self.assertEqual(self.portal_count(), before)

    def test_readonly_cannot_create_api_cabinet(self):
        before = self.portal_count()
        with self.assertRaises(PermissionError):
            server.create_connected_ozon_portal("Ozon", "full", self.reader, {}, self.credentials)
        self.assertEqual(self.portal_count(), before)
        self.check.assert_not_called()

    def test_selected_creation_requires_card_source(self):
        with self.assertRaisesRegex(ValueError, "ozon_selected_cards_required"):
            self.create_connected(scope="selected")
        self.check.assert_not_called()

    def test_encrypted_per_portal_and_public_metadata_contains_no_secrets(self):
        before = dict(server.get_portal_row(self.portal))
        result = self.connect()
        row = server.ozon_connection_row(self.portal)
        self.assertNotIn(self.credentials["apiKey"], json.dumps(dict(row)))
        self.assertNotIn(self.credentials["clientId"], json.dumps(dict(row)))
        decoded = server.decrypt_secret(row["token_nonce"], row["token_ciphertext"], server.integration_aad(self.portal, "ozon"))
        self.assertEqual(json.loads(decoded), self.credentials)
        with self.assertRaises(server.InvalidTag):
            server.decrypt_secret(row["token_nonce"], row["token_ciphertext"], server.integration_aad(self.second, "ozon"))
        public = json.dumps(server.public_ozon_connection(self.portal, self.reader))
        self.assertNotIn("apiKey", public)
        self.assertNotIn("clientId", public)
        self.assertEqual(result["productCount"], 12)
        after = dict(server.get_portal_row(self.portal))
        for field in ["api_connected", "cards_snapshot_json", "status", "card_count"]:
            self.assertEqual(before[field], after[field])

    def test_readonly_and_other_tenant_cannot_change_connection(self):
        for user in [self.reader, self.other]:
            with self.assertRaises(PermissionError):
                server.update_ozon_connection(self.portal, self.credentials, user)
        with self.assertRaises(PermissionError):
            server.public_ozon_connection(self.portal, self.other)
        self.check.assert_not_called()

    def test_wb_portal_and_header_injection_rejected_before_network(self):
        with self.assertRaisesRegex(ValueError, "ozon_portal_required"):
            self.connect(self.wb)
        with self.assertRaisesRegex(ValueError, "ozon_credentials_required"):
            server.update_ozon_connection(self.portal, {**self.credentials, "apiKey": "a" * 30 + "\r\nInjected: true"}, self.owner)
        self.check.assert_not_called()

    def test_invalid_replacement_preserves_working_credentials(self):
        self.connect()
        before = dict(server.ozon_connection_row(self.portal))
        server.OZON_CONNECTION_NEXT_CHECK.clear()
        self.check.side_effect = ozon_seller.OzonSellerError("ozon_auth_error", 409)
        with self.assertRaises(ozon_seller.OzonSellerError):
            server.update_ozon_connection(self.portal, {**self.credentials, "apiKey": "b" * 30}, self.owner)
        self.assertEqual(before, dict(server.ozon_connection_row(self.portal)))

    def test_duplicate_account_cannot_be_bound_to_other_portal(self):
        self.connect()
        with self.assertRaisesRegex(ValueError, "ozon_account_already_connected"):
            self.connect(self.second)
        self.assertIsNone(server.ozon_connection_row(self.second))

    def test_replacement_cannot_silently_switch_store(self):
        self.connect()
        before = dict(server.ozon_connection_row(self.portal))
        server.OZON_CONNECTION_NEXT_CHECK.clear()
        with self.assertRaisesRegex(ValueError, "ozon_account_mismatch"):
            server.update_ozon_connection(self.portal, {**self.credentials, "clientId": "55555"}, self.owner)
        self.assertEqual(before, dict(server.ozon_connection_row(self.portal)))

    def test_saved_check_uses_own_credentials_and_updates_failure_status(self):
        self.connect()
        server.OZON_CONNECTION_NEXT_CHECK.clear()
        self.check.side_effect = ozon_seller.OzonSellerError("ozon_auth_error", 409)
        with self.assertRaises(ozon_seller.OzonSellerError):
            server.update_ozon_connection(self.portal, {"action": "check"}, self.owner)
        self.check.assert_called_with(self.credentials["clientId"], self.credentials["apiKey"])
        self.assertEqual(server.public_ozon_connection(self.portal, self.owner)["connection"]["status"], "ozon_auth_error")

    def test_rate_limit_prevents_repeated_external_calls(self):
        self.connect()
        with self.assertRaisesRegex(ozon_seller.OzonSellerError, "ozon_check_rate_limited"):
            server.update_ozon_connection(self.portal, {"action": "check"}, self.owner)
        self.assertEqual(self.check.call_count, 1)

    def test_stale_check_cannot_mark_replaced_key_as_verified(self):
        self.connect()
        server.OZON_CONNECTION_NEXT_CHECK.clear()
        def rotate(*args):
            with server.connect_db() as db:
                db.execute("UPDATE portal_integrations SET token_digest='replacement', status='stored' WHERE portal_id=?", (self.portal,))
            return {"productCount": 12}
        self.check.side_effect = rotate
        with self.assertRaisesRegex(ValueError, "ozon_connection_changed"):
            server.update_ozon_connection(self.portal, {"action": "check"}, self.owner)
        self.assertEqual(server.ozon_connection_row(self.portal)["status"], "stored")

    def test_http_routes_require_session_and_return_only_public_metadata(self):
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.OpticardsHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        path = f"/api/portals/{self.portal}/ozon-connection"
        try:
            for method in ["GET", "POST"]:
                client = http.client.HTTPConnection(*httpd.server_address, timeout=5)
                client.request(method, path, body="{}" if method == "POST" else None)
                response = client.getresponse()
                self.assertEqual(response.status, 401)
                response.read()
                client.close()
            with server.connect_db() as db:
                user_id = db.execute("SELECT id FROM users WHERE login='owner'").fetchone()["id"]
                session = server.create_session(db, user_id)
            client = http.client.HTTPConnection(*httpd.server_address, timeout=5)
            client.request("POST", path, json.dumps(self.credentials), headers={"Content-Type": "application/json", "Cookie": f"{server.SESSION_COOKIE}={session}"})
            response = client.getresponse()
            body = response.read().decode()
            self.assertEqual(response.status, 200, body)
            self.assertEqual(json.loads(body)["connection"]["status"], "verified")
            self.assertNotIn(self.credentials["apiKey"], body)
            client.close()
            creation = {"mode": "api", "marketplace": "Ozon", "scope": "full", "name": "Created Ozon", "clientName": "Honeybear", "teamRoles": {"lead": "owner"}, **self.credentials, "clientId": "55555"}
            with patch.object(server, "fetch_wb_cards", side_effect=AssertionError("WB must not run")), patch.object(server, "refresh_manual_portal_from_mpstats", side_effect=AssertionError("MPStats bootstrap must not run")):
                client = http.client.HTTPConnection(*httpd.server_address, timeout=5)
                client.request("POST", "/api/portals", json.dumps(creation), headers={"Content-Type": "application/json", "Cookie": f"{server.SESSION_COOKIE}={session}"})
                response = client.getresponse()
                body = response.read().decode()
                self.assertEqual(response.status, 201, body)
                self.assertNotIn(self.credentials["apiKey"], body)
                created = json.loads(body)["portal"]
                self.assertEqual(created["marketplace"], "Ozon")
                self.assertEqual(server.ozon_connection_row(created["id"])["status"], "verified")
                client.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)


class OzonTransportTest(unittest.TestCase):
    def response(self, status, body=b'{"result":{"items":[],"total":0}}', retry=None):
        response = Mock(status=status)
        response.read.return_value = body
        response.getheader.return_value = retry
        connection = Mock()
        connection.getresponse.return_value = response
        return connection

    def test_auth_errors_not_retried_or_exposed(self):
        connection = self.response(403, b'upstream echoed sensitive content')
        with patch.object(ozon_seller.http.client, "HTTPSConnection", return_value=connection) as constructor:
            with self.assertRaises(ozon_seller.OzonSellerError) as caught:
                ozon_seller.check_ozon_credentials("123", "secret")
            self.assertEqual(str(caught.exception), "ozon_auth_error")
            self.assertEqual(constructor.call_count, 1)
            self.assertEqual(connection.request.call_args.args[:2], ("POST", "/v3/product/list"))

    def test_transient_retry_then_empty_store_is_valid(self):
        with patch.object(ozon_seller.http.client, "HTTPSConnection", side_effect=[self.response(503), self.response(200)]), patch.object(ozon_seller.time, "sleep") as sleep:
            self.assertEqual(ozon_seller.check_ozon_credentials("123", "secret"), {"productCount": 0})
            sleep.assert_called_once_with(0.5)

    def test_long_retry_after_does_not_retry_early(self):
        with patch.object(ozon_seller.http.client, "HTTPSConnection", return_value=self.response(429, retry="30")) as constructor, patch.object(ozon_seller.time, "sleep") as sleep:
            with self.assertRaisesRegex(ozon_seller.OzonSellerError, "ozon_rate_limited"):
                ozon_seller.check_ozon_credentials("123", "secret")
            self.assertEqual(constructor.call_count, 1)
            sleep.assert_not_called()

    def test_redirects_and_malformed_success_are_rejected(self):
        for connection in [self.response(302), self.response(200, b'{}'), self.response(200, b'not-json')]:
            with patch.object(ozon_seller.http.client, "HTTPSConnection", return_value=connection):
                with self.assertRaisesRegex(ozon_seller.OzonSellerError, "ozon_invalid_response"):
                    ozon_seller.check_ozon_credentials("123", "secret")


if __name__ == "__main__":
    unittest.main()
