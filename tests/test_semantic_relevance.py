import json
import http.client
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import server


CARD = {"nmID": "1001", "title": "Антимоль спрей", "description": "Спрей защищает одежду от моли.",
        "characteristics": [{"name": "Форма", "value": ["спрей"]}]}
USER = {"login": "semantic-test"}


def result_for(rows):
    return {"source": "mpstats-expanding", "semanticCore": {
        "source": "mpstats-expanding", "allKeywords": rows, "recommended": rows, "current": [], "totalKeywords": len(rows)}}


def wait_for_job(job_id):
    for _ in range(200):
        value = server.semantic_relevance_job_payload(job_id, "1", USER)
        if value["status"] != "classifying":
            return value
        time.sleep(.005)
    raise AssertionError("job did not finish")


class SemanticRelevanceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(server, "DB_PATH", Path(self.tmp.name) / "test.sqlite3")
        self.db_patch.start()
        server.init_db()
        with server.connect_db() as db:
            db.execute("INSERT INTO users(login,password_hash,full_name,role,user_role,access_level) VALUES('semantic-test','x','Test','Manager','manager','overview')")
        server.create_portal("Test", "Wildberries", "full", "semantic-test", {"lead": "semantic-test"})
        with server.connect_db() as db:
            db.execute("UPDATE portals SET cards_snapshot_json=? WHERE id=1", (json.dumps([CARD]),))
        self.cache = {}
        self.patches = [
            patch.object(server, "content_reoptimization_configured", return_value=True),
            patch.object(server, "audit_cache_get", side_effect=lambda key: self.cache.get(key)),
            patch.object(server, "audit_cache_set", side_effect=lambda key, value, ttl: self.cache.setdefault(key, value)),
            patch.object(server, "fetch_mpstats_keywords_core", return_value={"keywords": [], "source": "mpstats", "period": {}}),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        worker = server.SEMANTIC_JOB_WORKERS.get(str(server.DB_PATH.resolve()))
        if worker:
            worker.stop.set(); worker.wake.set(); worker.thread.join(3)
        for item in reversed(self.patches):
            item.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_model_checks_every_query_with_all_card_fields_and_keeps_uncertain(self):
        rows = [{"query": query, "wbCount": 100} for query in ["средство от моли", "от моли лаванда", "секции от моли"]]
        decisions = {
            "q0": {"status": "relevant", "reason": "Совпадает назначение", "evidence": [{"factId": "description", "quote": "защищает одежду от моли"}]},
            "q1": {"status": "disputed", "reason": "Лавандовый аромат не указан", "evidence": []},
            "q2": {"status": "irrelevant", "reason": "Спрей, а не секции", "evidence": [{"factId": "characteristics", "quote": "спрей"}]},
        }
        payload = {"choices": [{"message": {"function_call": {"arguments": decisions}}}]}
        with patch.object(server, "audit_llm_chat_completion", return_value=(payload, "model", "gigachat")) as model:
            checked = server.semantic_classify_query_batch(CARD, rows)
        self.assertEqual([row["relevance"] for row in checked], ["relevant", "disputed", "irrelevant"])
        sent = json.loads(model.call_args.args[0][1]["content"])
        self.assertEqual({fact["id"] for fact in sent["facts"]}, {"title", "description", "characteristics"})
        self.assertEqual(len(sent["queries"]), 3)
        self.assertEqual([row["wbCount"] for row in checked], [100, 100, 100])

    def test_fabricated_evidence_cannot_auto_include_a_query(self):
        decision = {"q0": {"status": "relevant", "reason": "Есть аромат", "evidence": [{"factId": "description", "quote": "лаванда"}]}}
        payload = {"choices": [{"message": {"content": json.dumps(decision)}}]}
        with patch.object(server, "audit_llm_chat_completion", return_value=(payload, "model", "openai")):
            checked = server.semantic_classify_query_batch(CARD, [{"query": "от моли лаванда"}])
        self.assertEqual(checked[0]["relevance"], "disputed")

    def test_missing_decision_is_an_error(self):
        payload = {"choices": [{"message": {"content": "{}"}}]}
        with patch.object(server, "audit_llm_chat_completion", return_value=(payload, "model", "openai")):
            with self.assertRaisesRegex(ValueError, "incomplete"):
                server.semantic_classify_query_batch(CARD, [{"query": "от моли"}])

    def test_compact_decision_keeps_evidence_checks_and_rejects_malformed_fields(self):
        valid = {"q0": {"s": "r", "r": "Назначение совпадает", "f": "description", "q": "защищает одежду от моли"}}
        with patch.object(server, "audit_llm_chat_completion", return_value=({"choices": [{"message": {"content": json.dumps(valid)}}]}, "model", "openai")) as model:
            result = server.semantic_classify_query_batch(CARD, [{"query": "средство от моли"}])
        self.assertEqual(result[0]["relevance"], "relevant")
        self.assertEqual(set(model.call_args.kwargs["response_schema"]["properties"]["q0"]["properties"]), {"s", "r", "f", "q"})
        valid["q0"]["q"] = None
        with patch.object(server, "audit_llm_chat_completion", return_value=({"choices": [{"message": {"content": json.dumps(valid)}}]}, "model", "openai")):
            with self.assertRaisesRegex(ValueError, "invalid_response"):
                server.semantic_classify_query_batch(CARD, [{"query": "средство от моли"}])

    def test_expansion_preserves_all_queries_for_classification(self):
        raw = {"words": [{"word": "средство от моли", "wb_count": 4000},
                         {"word": "совсем другой товар", "wb_count": 10},
                         {"word": "от моли лаванда", "count": 500},
                         {"word": "без прямой частоты", "wbcount": 9999}]}
        with patch.object(server, "get_service_integration_secret", return_value="test"), \
             patch.object(server, "mpstats_post_body_json", return_value={"reportHash": "test-report"}), \
             patch.object(server, "mpstats_get_json", return_value=raw):
            value = server.fetch_mpstats_semantic_expansion(CARD, query="средство от моли")
        self.assertEqual(len(value["semanticCore"]["allKeywords"]), 4)
        self.assertEqual(value["semanticCore"]["allKeywords"][-1]["wbCount"], 0)

    def test_ozon_expansion_uses_ozon_market_and_separate_cache(self):
        raw = {"words": [{"word": "спрей от моли", "wb_count": 9999, "count": 0},
                         {"word": "средство от моли", "wb_count": 0, "count": 50}]}
        with patch.object(server, "get_service_integration_secret", return_value="test"), \
             patch.object(server, "mpstats_post_body_json", return_value={"reportHash": "report"}) as create, \
             patch.object(server, "mpstats_get_json", return_value=raw):
            wb = server.fetch_mpstats_semantic_expansion(CARD, query="от моли")
            ozon = server.fetch_mpstats_semantic_expansion(CARD, query="от моли", marketplace="Ozon")
            cached = server.fetch_mpstats_semantic_expansion(CARD, query="от моли", marketplace="Ozon")
        self.assertEqual([call.kwargs["body"]["mp"] for call in create.call_args_list], [0, 1])
        self.assertTrue(cached["cached"])
        self.assertEqual(wb["semanticCore"]["allKeywords"][0]["wbCount"], 9999)
        self.assertEqual(ozon["semanticCore"]["marketplace"], "Ozon")
        self.assertEqual(ozon["semanticCore"]["allKeywords"][0]["ozonCount"], 50)

    def test_ozon_current_contains_only_actual_queries_with_ozon_demand(self):
        rows = [{"query": "спрей", "ozonCount": 20, "relevance": "relevant"},
                {"query": "одежду от моли", "wbCount": 500, "relevance": "relevant"},
                {"query": "защищает одежду", "ozonCount": 100, "relevance": "irrelevant"}]
        result = result_for(rows)
        result["semanticCore"]["marketplace"] = "Ozon"
        core = server.semantic_relevance_result(result, CARD, rows)["semanticCore"]
        self.assertEqual([row["query"] for row in core["current"]], ["спрей"])
        self.assertEqual(len(core["allKeywords"]), 3)

    def test_partial_job_is_not_returned_as_complete_and_scope_is_checked(self):
        started, release = threading.Event(), threading.Event()
        rows = [{"query": "от моли", "wbCount": 20}]
        def classify(card, batch):
            started.set()
            release.wait(2)
            return [{**row, "relevance": "relevant", "relevanceReason": "Назначение"} for row in batch]
        with patch.object(server, "semantic_classify_query_batch", side_effect=classify) as model:
            job = server.start_semantic_relevance_job(result_for(rows), CARD, "1", USER)
            self.assertTrue(started.wait(1))
            try:
                pending = server.semantic_relevance_job_payload(job["jobId"], "1", USER)
                self.assertEqual(pending["status"], "classifying")
                self.assertNotIn("semanticCore", pending)
                for portal, user in [("2", USER), ("1", {"login": "someone-else"})]:
                    with self.assertRaisesRegex(ValueError, "not_found"):
                        server.semantic_relevance_job_payload(job["jobId"], portal, user)
                repeated = server.start_semantic_relevance_job(result_for(rows), CARD, "1", USER)
                self.assertEqual(repeated["jobId"], job["jobId"])
            finally:
                release.set()
            completed = wait_for_job(job["jobId"])
            self.assertEqual(completed["semanticCore"]["relevanceCounts"]["relevant"], 1)
            model.assert_called_once()

    def test_failed_job_hides_provider_error_and_retry_reuses_complete_batches(self):
        rows = [{"query": "от моли " + str(index), "wbCount": index + 1} for index in range(33)]
        def classify(card, batch):
            if len(batch) == 1:
                raise RuntimeError("secret-token and provider response")
            return [{**row, "relevance": "relevant", "relevanceReason": "Назначение"} for row in batch]
        with patch.object(server, "semantic_classify_query_batch", side_effect=classify):
            first = server.start_semantic_relevance_job(result_for(rows), CARD, "1", USER)
            failed = wait_for_job(first["jobId"])
        self.assertEqual(failed["status"], "failed")
        self.assertNotIn("secret-token", json.dumps(failed))
        with patch.object(server, "semantic_classify_query_batch", side_effect=lambda card, batch: [
            {**row, "relevance": "disputed", "relevanceReason": "Проверить"} for row in batch]) as model:
            retry = server.start_semantic_relevance_job(result_for(rows), CARD, "1", USER)
            complete = wait_for_job(retry["jobId"])
        self.assertEqual(len(complete["semanticCore"]["allKeywords"]), 33)
        self.assertEqual(len(model.call_args.args[1]), 1)
        model.assert_called_once()


class SemanticRelevanceHttpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(server, "DB_PATH", Path(self.tmp.name) / "test.sqlite3")
        self.db_patch.start()
        server.init_db()
        with server.connect_db() as db:
            for login in ("owner", "other"):
                db.execute("INSERT INTO users(login,password_hash,full_name,role,user_role,access_level) VALUES(?,?,?,?,?,?)",
                           (login, "x", login, "Manager", "manager", "overview"))
            uid = db.execute("SELECT id FROM users WHERE login='owner'").fetchone()["id"]
            self.session = server.create_session(db, uid)
        self.portal = server.create_portal("Test", "Wildberries", "full", "owner", {"lead": "owner", "tech": "owner"})
        self.foreign = server.create_portal("Other", "Wildberries", "full", "other", {"lead": "other"})
        self.ozon = server.create_portal("Ozon", "Ozon", "full", "owner", {"lead": "owner"})
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.OpticardsHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        self.db_patch.stop()
        self.tmp.cleanup()

    def request(self, data, authenticated=True, path="/api/mpstats/semantic-expansion", method="POST"):
        client = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Cookie"] = server.SESSION_COOKIE + "=" + self.session
        client.request(method, path, json.dumps(data) if data is not None else None, headers)
        response = client.getresponse()
        result = response.status, json.loads(response.read())
        client.close()
        return result

    def test_poll_requires_session_portal_access_and_job_owner(self):
        data = {"portalId": str(self.portal), "relevanceJobId": "missing"}
        self.assertEqual(self.request(data, authenticated=False)[0], 401)
        self.assertEqual(self.request({**data, "portalId": str(self.foreign)})[0], 403)
        self.assertEqual(self.request(data)[0], 404)
        with patch.object(server, "semantic_relevance_job_payload", return_value={"status": "classifying", "jobId": "test", "completed": 0, "total": 4}) as poll, \
             patch.object(server, "fetch_mpstats_semantic_expansion", side_effect=AssertionError("poll must not query MPStats")):
            status, payload = self.request(data)
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "classifying")
        self.assertEqual(poll.call_args.args[:2], ("missing", str(self.portal)))

    def test_durable_api_create_discover_cancel_and_resume_are_scoped(self):
        with server.connect_db() as db:
            db.execute("UPDATE portals SET cards_snapshot_json=? WHERE id=?", (json.dumps([CARD]), self.portal))
        endpoint = "/api/semantic-jobs"
        with patch.object(server, "content_reoptimization_configured", return_value=True), patch.object(server, "start_semantic_worker"):
            status, result = self.request({"portalId": self.portal, "card": CARD, "query": "от моли"}, path=endpoint)
            self.assertEqual(status, 200)
            job = result["job"]
            query = endpoint + f"?portal_id={self.portal}&card_key=1001"
            self.assertEqual(self.request(None, path=query, method="GET")[1]["jobs"][0]["jobId"], job["jobId"])
            self.assertEqual(self.request(None, authenticated=False, path=query, method="GET")[0], 401)
            self.assertEqual(self.request(None, path=endpoint+f"?portal_id={self.foreign}", method="GET")[0], 403)
            self.assertEqual(self.request(None, path=endpoint+f"?portal_id={self.ozon}&job_id={job['jobId']}", method="GET")[0], 404)
            for action, expected in (("cancel", "cancelled"), ("retry", "queued")):
                status, result = self.request({"portalId": self.portal, "jobId": job["jobId"], "action": action}, path=endpoint)
                self.assertEqual(status, 200)
                self.assertEqual(result["job"]["status"], expected)

    def test_marketplace_is_taken_from_portal_instead_of_client_card(self):
        with server.connect_db() as db:
            db.execute("UPDATE portals SET cards_snapshot_json=? WHERE id IN (?,?)", (json.dumps([CARD]), self.portal, self.ozon))
        with patch.object(server, "content_reoptimization_configured", return_value=True), \
             patch.object(server, "start_semantic_worker"), \
             patch.object(server, "fetch_mpstats_semantic_expansion", side_effect=AssertionError("start must return before network")):
            for portal, expected in ((self.ozon, "Ozon"), (self.portal, "Wildberries")):
                status, payload = self.request({"portalId": str(portal), "marketplace": "untrusted", "card": CARD, "query": "от моли"})
                self.assertEqual(status, 200)
                job = server.semantic_get_job(payload["jobId"], portal, {"login": "owner"})
                self.assertEqual(job["marketplace"], expected)
                self.assertEqual(job["status"], "queued")

    def test_ozon_readonly_cannot_start_paid_queries(self):
        with server.connect_db() as db:
            db.execute("UPDATE portals SET cards_snapshot_json=? WHERE id=?", (json.dumps([CARD]), self.ozon))
            db.execute("UPDATE users SET role='Tech',user_role='tech',access_level='readonly_wb' WHERE login='owner'")
        with patch.object(server, "fetch_mpstats_semantic_expansion", side_effect=AssertionError("no network")):
            self.assertEqual(self.request({"portalId": str(self.ozon), "card": CARD, "query": "от моли"})[0], 403)

    def test_missing_model_and_card_content_fail_before_mpstats(self):
        with patch.object(server, "fetch_mpstats_semantic_expansion", side_effect=AssertionError("no network")):
            with patch.object(server, "content_reoptimization_configured", return_value=False):
                status, payload = self.request({"portalId": str(self.ozon), "card": CARD, "query": "от моли"})
                self.assertEqual((status, payload["error"]), (400, "semantic_relevance_not_configured"))
            with patch.object(server, "content_reoptimization_configured", return_value=True):
                status, payload = self.request({"portalId": str(self.ozon), "card": {}, "query": "от моли"})
                self.assertEqual((status, payload["error"]), (400, "semantic_card_content_missing"))

    def test_large_ozon_draft_persists_all_decisions_and_keeps_final_separate(self):
        rows = [{"query": f"от моли {index}", "ozonCount": index + 1, "wbCount": 10,
                 "relevance": "relevant", "relevanceReason": "Назначение " * 45,
                 "manualDecision": "excluded" if index == 0 else "included",
                 "relevanceEvidence": [{"factId": "description", "quote": "защищает одежду от моли"}]}
                for index in range(650)]
        core = {"relevanceVersion": server.SEMANTIC_RELEVANCE_VERSION, "allKeywords": rows,
                "current": [], "decisions": [rows[0]], "period": {"d1": "2026-10-01", "d2": "2026-10-30"}}
        draft = {"cardKey": "1001", "sku": "1001", "selected": rows[1:], "semanticCore": core,
                 "final": [{"query": "прежнее итоговое СЯ"}],
                 "finalSelection": {"selected": [{"query": "прежнее итоговое СЯ"}]}}
        self.assertGreater(len(json.dumps(draft, ensure_ascii=False).encode()), server.MAX_JSON_BYTES)
        client = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        client.request("POST", f"/api/portals/{self.ozon}/ozon-semantic-draft", json.dumps(draft),
                       {"Cookie": server.SESSION_COOKIE + "=" + self.session, "Content-Type": "application/json"})
        response = client.getresponse()
        saved = json.loads(response.read())
        client.close()
        self.assertEqual(response.status, 200)
        readback = server.get_ozon_semantic_draft(self.ozon, "1001", {"login": "owner", "role": "Manager", "user_role": "manager", "access_level": "overview"})["draft"]["draft"]
        self.assertEqual(len(readback["semanticCore"]["allKeywords"]), 650)
        self.assertEqual(len(readback["selected"]), 649)
        self.assertEqual(readback["semanticCore"]["allKeywords"][0]["manualDecision"], "excluded")
        self.assertEqual(readback["semanticCore"]["allKeywords"][1]["relevanceEvidence"], rows[1]["relevanceEvidence"])
        self.assertEqual(readback["final"][0]["query"], "прежнее итоговое СЯ")
        self.assertEqual(readback["finalSelection"]["selected"][0]["query"], "прежнее итоговое СЯ")


if __name__ == "__main__":
    unittest.main()
