import copy
import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import server


def product(product_id, sku=None, offer=None):
    return {"id": product_id, "sku": sku or product_id + 1000, "offer_id": offer or f"offer-{product_id}",
            "name": f"Товар {product_id}", "description_category_id": 20, "type_id": 30,
            "price": "150.00", "primary_image": ["https://example.org/photo.jpg"],
            "stocks": {"stocks": [{"present": 0, "reserved": 2, "source": "fbo"}]}}


def attributes(product_id):
    return {"id": product_id, "attributes": [
        {"id": 85, "values": [{"dictionary_value_id": 7, "value": "Honeybear"}]},
        {"id": 4191, "values": [{"dictionary_value_id": 0, "value": "Описание товара"}]},
        {"id": 8229, "values": [{"dictionary_value_id": 8, "value": "Мёд"}]}], "complex_attributes": [{"id": 9000, "complex_id": 10, "values": [{"dictionary_value_id": 0, "value": "Видео"}]}]}


def fake_api(products, page_size=None):
    def request(client_id, api_key, path, payload, **kwargs):
        if path == "/v3/product/list":
            start = int(payload.get("last_id") or 0)
            limit = page_size or payload["limit"]
            items = products[start:start+limit]
            return {"result": {"items": [{"product_id": p["id"], "sku": p["sku"], "offer_id": p["offer_id"]} for p in items],
                               "total": len(products), "last_id": str(start+len(items))}}
        if path == "/v3/product/info/list":
            return {"items": [copy.deepcopy(p) for p in reversed(products) if p["id"] in payload["product_id"]]}
        if path == "/v4/product/info/attributes":
            return {"result": [attributes(p["id"]) for p in products if p["id"] in payload["filter"]["product_id"]]}
        if path == "/v1/description-category/attribute":
            return {"result": [{"id": 85, "name": "Бренд"}, {"id": 4191, "name": "Аннотация"}, {"id": 8229, "name": "Тип"}]}
        raise AssertionError(path)
    return request


class OzonFetchTest(unittest.TestCase):
    credentials = {"clientId": "123", "apiKey": "test-key-" + "x" * 32}

    def test_pagination_batches_and_sku_distinction_with_full_content(self):
        products = [product(i) for i in range(1, 103)]
        with patch.object(server, "ozon_request_json", side_effect=fake_api(products, page_size=60)) as request:
            snapshot = server.fetch_ozon_seller_cards(self.credentials)
        self.assertEqual(len(snapshot["cards"]), 102)
        card = snapshot["cards"][0]
        self.assertEqual((card["productId"], card["sku"], card["id"]), ("1", "1001", "1001"))
        self.assertEqual(card["stock"], 0)
        self.assertEqual(card["price"], 150)
        self.assertEqual(card["description"], "Описание товара")
        self.assertEqual(card["brand"], "Honeybear")
        self.assertEqual(card["category"], "Мёд")
        self.assertEqual(card["characteristics"][0]["name"], "Бренд")
        self.assertEqual(card["rawFields"]["attributes"]["attributes"][0]["values"][0]["dictionary_value_id"], 7)
        self.assertEqual(card["source"], "ozon-seller-api")
        self.assertEqual(card["characteristics"][-1]["complexId"], 10)
        self.assertNotIn("sales", card)
        paths = [call.args[2] for call in request.call_args_list]
        self.assertEqual(paths.count("/v3/product/list"), 2)
        self.assertEqual(paths.count("/v3/product/info/list"), 2)
        self.assertEqual(paths.count("/v1/description-category/attribute"), 1)
        self.assertTrue(all(call.kwargs["deadline"] == request.call_args_list[0].kwargs["deadline"] for call in request.call_args_list))

    def test_selected_identifiers_resolved_inside_this_account(self):
        with patch.object(server, "ozon_request_json", side_effect=fake_api([product(1), product(2), product(3)])):
            snapshot = server.fetch_ozon_seller_cards(self.credentials, "selected", "Ozon SKU / offer ID: 1001, offer-3\nКомментарий")
        self.assertEqual([c["productId"] for c in snapshot["cards"]], ["1", "3"])
        self.assertEqual(snapshot["productCount"], 3)

    def test_selected_not_found_does_not_broaden_scope(self):
        with patch.object(server, "ozon_request_json", side_effect=fake_api([product(1)])):
            with self.assertRaisesRegex(server.OzonSellerError, "ozon_selected_cards_not_found"):
                server.fetch_ozon_seller_cards(self.credentials, "selected", "1001, foreign-offer")

    def test_pasted_sku_column_keeps_every_row_in_legacy_source(self):
        skus = [1753743119, 1753742199, 1354236110, 1736511259, 2006792225]
        products = [product(i, sku=sku) for i, sku in enumerate(skus, 1)] + [product(6)]
        source = "Ozon SKU / offer ID: " + "\r\n".join(map(str, skus))
        for text in (source, source + "\nКомментарий: 1006 не добавлять", "\n".join(map(str, skus))):
            with self.subTest(source=text), patch.object(server, "ozon_request_json", side_effect=fake_api(products)):
                snapshot = server.fetch_ozon_seller_cards(self.credentials, "selected", text)
            self.assertEqual([card["sku"] for card in snapshot["cards"]], list(map(str, skus)))

    def test_missing_sku_on_second_row_blocks_partial_import(self):
        with patch.object(server, "ozon_request_json", side_effect=fake_api([product(1)])):
            with self.assertRaisesRegex(server.OzonSellerError, "ozon_selected_cards_not_found"):
                server.fetch_ozon_seller_cards(self.credentials, "selected", "Ozon SKU / offer ID: 1001\n9999")

    def test_missing_info_or_attributes_fails_closed(self):
        for broken_path, field in [("/v3/product/info/list", "items"), ("/v4/product/info/attributes", "result")]:
            request = fake_api([product(1), product(2)])
            def broken(client_id, api_key, path, payload, **kwargs):
                data = request(client_id, api_key, path, payload, **kwargs)
                if path == broken_path:
                    data[field] = data[field][:1]
                return data
            with patch.object(server, "ozon_request_json", side_effect=broken):
                with self.assertRaisesRegex(server.OzonSellerError, "ozon_incomplete_response"):
                    server.fetch_ozon_seller_cards(self.credentials)

    def test_looping_cursor_and_oversized_store_are_rejected(self):
        responses = [{"result": {"items": [{"product_id": 1}], "total": 3, "last_id": "same"}},
                     {"result": {"items": [{"product_id": 2}], "total": 3, "last_id": "same"}}]
        with patch.object(server, "ozon_request_json", side_effect=responses):
            with self.assertRaisesRegex(server.OzonSellerError, "ozon_incomplete_response"):
                server.fetch_ozon_seller_cards(self.credentials)
        with patch.object(server, "ozon_request_json", return_value={"result": {"items": [], "total": 2001}}):
            with self.assertRaisesRegex(server.OzonSellerError, "ozon_sync_limit"):
                server.fetch_ozon_seller_cards(self.credentials)

    def test_empty_store_and_unknown_stock_are_distinct_from_zero(self):
        with patch.object(server, "ozon_request_json", side_effect=fake_api([])):
            self.assertEqual(server.fetch_ozon_seller_cards(self.credentials)["cards"], [])
        p = product(1); p.pop("stocks")
        card = server.ozon_seller_snapshot_card(p, attributes(1), [], {})
        self.assertIsNone(card["stock"])

    def test_transport_rejects_write_path_and_expired_budget_before_network(self):
        with patch.object(server.http.client, "HTTPSConnection") as request:
            with self.assertRaisesRegex(ValueError, "invalid_ozon_read_path"):
                server.ozon_request_json("123", "test", "/v3/product/import", {})
            with self.assertRaisesRegex(server.OzonSellerError, "ozon_sync_timeout"):
                server.ozon_request_json("123", "test", "/v3/product/list", {}, deadline=server.time.monotonic()-1)
            request.assert_not_called()


class OzonSyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db = server.DB_PATH
        server.DB_PATH = Path(self.tmp.name)/"test.sqlite3"
        self.env = patch.dict(os.environ, {server.SECRET_KEY_ENV: server.generate_secret_key()})
        self.env.start()
        server.init_db()
        with server.connect_db() as db:
            db.execute("""INSERT INTO users (login,password_hash,full_name,role,user_role,access_level) VALUES
                        ('owner','x','Owner','Manager','manager','overview'),
                        ('other','x','Other','Manager','manager','overview'),
                        ('reader','x','Reader','Tech','tech','readonly_wb')""")
        self.owner = {"login": "owner", "role": "Manager", "user_role": "manager", "access_level": "overview"}
        self.portal = server.create_portal("Ozon", "Ozon", "full", "owner", {"lead": "owner", "tech": "reader"})
        self.wb = server.create_portal("WB", "Wildberries", "full", "owner", {"lead": "owner"})
        self.credentials = {"clientId": "123", "apiKey": "test-key-"+"a"*32}
        with patch.object(server, "check_ozon_credentials", return_value={"productCount": 1}):
            server.update_ozon_connection(self.portal, self.credentials, self.owner)
        self.request = patch.object(server, "ozon_request_json", side_effect=fake_api([product(1)]))
        self.mock = self.request.start()

    def tearDown(self):
        self.request.stop()
        self.env.stop()
        server.DB_PATH = self.old_db
        server.OZON_CONNECTION_NEXT_CHECK.clear()
        server.OZON_CONNECTION_INFLIGHT.clear()
        self.tmp.cleanup()

    def test_sync_uses_saved_credentials_without_mpstats_or_wb(self):
        before_wb = dict(server.get_portal_row(self.wb))
        with patch.object(server, "fetch_wb_cards", side_effect=AssertionError("WB")), patch.object(server, "build_ozon_mpstats_probe", side_effect=AssertionError("MPStats")):
            result = server.refresh_ozon_seller_cards(self.portal, self.owner)
        self.assertEqual(result["saved"]["total"], 1)
        self.assertEqual(result["portal"]["mode"], "api")
        self.assertTrue(result["portal"]["ozonApiConnected"])
        self.assertFalse(result["portal"]["apiConnected"])
        self.assertTrue(all(call.args[:2] == ("123", self.credentials["apiKey"]) for call in self.mock.call_args_list))
        self.assertEqual(before_wb, dict(server.get_portal_row(self.wb)))
        self.assertNotIn(self.credentials["apiKey"], json.dumps(result))
        with self.assertRaisesRegex(server.OzonSellerError, "ozon_check_rate_limited"):
            server.refresh_ozon_seller_cards(self.portal, self.owner)

    def test_forbidden_foreign_readonly_and_wb_before_network(self):
        for portal, user, error in [
            (self.portal, {**self.owner, "login": "other"}, PermissionError),
            (self.portal, {"login":"reader","role":"Tech","user_role":"tech","access_level":"readonly_wb"}, PermissionError),
            (self.wb, self.owner, ValueError)]:
            with self.assertRaises(error): server.refresh_ozon_seller_cards(portal, user)
        self.mock.assert_not_called()

    def test_failure_keeps_snapshot_and_work_unchanged(self):
        server.save_ozon_mpstats_cards(self.portal, self.owner, [{"id": "1001", "title": "Старое", "offerId": "offer-1"}])
        server.save_ozon_semantic_draft(self.portal, {"cardKey": "1001", "final": ["мёд"]}, self.owner)
        before = dict(server.get_portal_row(self.portal))
        with server.connect_db() as db:
            drafts_before = [tuple(r) for r in db.execute("SELECT * FROM ozon_semantic_drafts WHERE portal_id=?",(self.portal,))]
        self.mock.side_effect = server.OzonSellerError("ozon_unavailable")
        with self.assertRaises(server.OzonSellerError): server.refresh_ozon_seller_cards(self.portal, self.owner)
        self.assertEqual(before, dict(server.get_portal_row(self.portal)))
        with server.connect_db() as db:
            self.assertEqual(drafts_before,[tuple(r) for r in db.execute("SELECT * FROM ozon_semantic_drafts WHERE portal_id=?",(self.portal,))])

    def test_merge_preserves_card_identity_drafts_and_unreturned_cards(self):
        server.save_ozon_mpstats_cards(self.portal, self.owner, [{"id": "old-sku", "title": "Старое", "offerId": "offer-1"}, {"id": "1002", "title": "Другая", "offerId": "offer-2"}])
        before = server.wb_snapshot_cards_from_row(server.get_portal_row(self.portal))
        result = server.refresh_ozon_seller_cards(self.portal, self.owner)
        cards = result["portal"]["realCards"]
        self.assertEqual(len(cards), 2)
        self.assertEqual((cards[0]["id"], cards[0]["cardKey"]), (before[0]["id"],before[0]["cardKey"]))
        self.assertEqual(cards[0]["sku"], "1001")
        self.assertEqual(cards[0]["description"], "Описание товара")
        self.assertEqual(cards[1],before[1])

    def test_changed_key_during_fetch_cannot_save_old_result(self):
        original = server.fetch_ozon_seller_cards
        def replace_key(*args, **kwargs):
            result = original(*args, **kwargs)
            with server.connect_db() as db:
                db.execute("UPDATE portal_integrations SET token_digest='new-version' WHERE portal_id=? AND provider='ozon'",(self.portal,))
            return result
        with patch.object(server,"fetch_ozon_seller_cards",side_effect=replace_key):
            with self.assertRaisesRegex(ValueError,"ozon_connection_changed"):
                server.refresh_ozon_seller_cards(self.portal,self.owner)
        self.assertEqual(server.get_portal_row(self.portal)["card_count"],0)

    def test_http_refresh_requires_session_and_returns_cards(self):
        with server.connect_db() as db:
            uid = db.execute("SELECT id FROM users WHERE login='owner'").fetchone()[0]
            session = server.create_session(db,uid)
        httpd = server.ThreadingHTTPServer(("127.0.0.1",0),server.OpticardsHandler)
        thread = threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        try:
            for cookie, wanted in [("",401),(f"{server.SESSION_COOKIE}={session}",200)]:
                client=http.client.HTTPConnection(*httpd.server_address,timeout=10)
                client.request("POST",f"/api/portals/{self.portal}/ozon-seller-cards",b'{}',{"Content-Type":"application/json","Cookie":cookie})
                response=client.getresponse();data=json.loads(response.read())
                self.assertEqual(response.status,wanted,data)
                if wanted==200:self.assertEqual(data["portal"]["realCards"][0]["sku"],"1001")
                client.close()
        finally:
            httpd.shutdown();httpd.server_close();thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
