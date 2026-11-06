import json
import http.client
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import server


CARD = {"title": "Антимоль спрей", "description": "Спрей защищает одежду от моли.",
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
        server.SEMANTIC_RELEVANCE_JOBS.clear()
        self.cache = {}
        self.patches = [
            patch.object(server, "content_reoptimization_configured", return_value=True),
            patch.object(server, "audit_cache_get", side_effect=lambda key: self.cache.get(key)),
            patch.object(server, "audit_cache_set", side_effect=lambda key, value, ttl: self.cache.setdefault(key, value)),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        server.SEMANTIC_RELEVANCE_JOBS.clear()

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
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.OpticardsHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        self.db_patch.stop()
        self.tmp.cleanup()

    def request(self, data, authenticated=True):
        client = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Cookie"] = server.SESSION_COOKIE + "=" + self.session
        client.request("POST", "/api/mpstats/semantic-expansion", json.dumps(data), headers)
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


if __name__ == "__main__":
    unittest.main()
