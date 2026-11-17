import json
import unittest
from unittest.mock import patch
from urllib import error

import server
from tests import test_semantic_jobs as jobs


class SemanticRecoveryTest(unittest.TestCase):
    setUp = jobs.SemanticJobsTest.setUp
    tearDown = jobs.SemanticJobsTest.tearDown
    create = jobs.SemanticJobsTest.create
    finish = jobs.SemanticJobsTest.finish

    def test_timeout_splits_portion_and_process_restart_reuses_paid_checkpoint(self):
        with patch.object(server, 'OPTICARDS_LLM_PROVIDER', 'openai'):
            job = self.create(result=jobs.source(65))
            self.worker.step(job['jobId'])
            with patch.object(server, 'semantic_classify_query_batch', side_effect=TimeoutError):
                self.worker.step(job['jobId'])
            value = server.semantic_get_job(job['jobId'], self.wb, jobs.USER)
            self.assertEqual((value['status'], value['completed']), ('classifying', 32))
            with server.connect_db() as db:
                row = db.execute('SELECT scheduled_at,provider_json FROM semantic_jobs WHERE id=?', (job['jobId'],)).fetchone()
            self.assertEqual(json.loads(row['provider_json'])['classifier']['batchSize'], 16)
            self.assertGreater(row['scheduled_at'], server.time.time())
            self.worker = server.SemanticJobWorker(self.path)
            with patch.object(server, 'semantic_classify_query_batch', side_effect=jobs.classify) as model:
                done = self.finish(job)
            self.assertEqual((done['status'], done['completed']), ('ready', 65))
            self.assertEqual([len(call.args[1]) for call in model.call_args_list], [16, 16, 1])
            self.assertTrue(all(int(row['query'].rsplit(' ', 1)[1]) >= 32 for call in model.call_args_list for row in call.args[1]))

    def test_gigachat_starts_with_sixteen_without_changing_cache_revision(self):
        with patch.object(server, 'OPTICARDS_LLM_PROVIDER', 'gigachat'):
            job = self.create()
            with patch.object(server, 'semantic_classify_query_batch', side_effect=jobs.classify) as model:
                self.worker.step(job['jobId'])
            self.assertEqual(len(model.call_args.args[1]), 16)

    def test_malformed_response_is_bounded_and_never_saved_as_complete(self):
        job = self.create(result=jobs.source(1))
        with patch.object(server, 'semantic_classify_query_batch', side_effect=ValueError('semantic_relevance_invalid_response')) as model:
            done = self.finish(job)
        self.assertEqual(model.call_count, 3)
        self.assertEqual((done['status'], done['error'], done['completed']), ('failed', 'semantic_relevance_invalid_response', 0))
        self.assertIsNone(server.get_card_draft(self.wb, '1001', jobs.USER))

    def test_access_denied_has_no_automatic_retry(self):
        job = self.create(result=jobs.source(1))
        exc = error.HTTPError('https://model.invalid', 403, 'denied', {}, None)
        with patch.object(server, 'semantic_classify_query_batch', side_effect=exc) as model:
            done = self.finish(job)
        self.assertEqual(model.call_count, 1)
        self.assertEqual(done['error'], 'semantic_model_access_denied')

    def test_refusal_keeps_provider_queries_visible_without_marking_them_checked(self):
        job = self.create(result=jobs.source(2))
        with patch.object(server, 'semantic_classify_query_batch', side_effect=ValueError('semantic_model_refused')) as model:
            done = self.finish(job)
        self.assertEqual(model.call_count, 1)
        self.assertEqual((done['status'], done['error'], done['completed']), ('failed', 'semantic_model_refused', 0))
        self.assertEqual(done['sourcePreview']['rows'], jobs.source(2)['semanticCore']['allKeywords'])
        self.assertNotIn('sourcePreview', server.semantic_list_jobs(self.wb, jobs.USER)['jobs'][0])
        self.assertIsNone(server.get_card_draft(self.wb, '1001', jobs.USER))
        with self.assertRaisesRegex(ValueError, '^semantic_model_refused$'):
            server.semantic_job_action(job['jobId'], self.wb, jobs.USER, 'retry')
        with self.assertRaisesRegex(ValueError, 'not_found'):
            server.semantic_get_job(job['jobId'], self.wb, {'login':'other'})

    def test_explicit_retry_resets_attempts_but_keeps_the_learned_size(self):
        job = self.create(result=jobs.source(2))
        with patch.object(server, 'semantic_classify_query_batch', side_effect=TimeoutError):
            self.assertEqual(self.finish(job)['error'], 'semantic_model_timeout')
        server.semantic_job_action(job['jobId'], self.wb, jobs.USER, 'retry')
        with server.connect_db() as db:
            state = json.loads(db.execute('SELECT provider_json FROM semantic_jobs WHERE id=?', (job['jobId'],)).fetchone()[0])
        self.assertEqual(state['classifier'], {'batchSize':1})

    def test_retry_after_is_respected_and_provider_report_checkpoint_survives(self):
        job = self.create(result=jobs.source(2))
        with server.connect_db() as db:
            db.execute('UPDATE semantic_jobs SET provider_json=? WHERE id=?', (json.dumps({'reportHash':'paid-report','creating':False}), job['jobId']))
        exc = error.HTTPError('https://model.invalid', 429, 'limit', {'Retry-After':'125'}, None)
        started = server.time.time()
        with patch.object(server, 'semantic_classify_query_batch', side_effect=exc):
            self.worker.step(job['jobId'])
        with server.connect_db() as db:
            row = db.execute('SELECT scheduled_at,provider_json FROM semantic_jobs WHERE id=?', (job['jobId'],)).fetchone()
        self.assertGreaterEqual(row['scheduled_at'], started + 125)
        self.assertEqual(json.loads(row['provider_json'])['reportHash'], 'paid-report')
        self.finish(job)
        with server.connect_db() as db:
            state = json.loads(db.execute('SELECT provider_json FROM semantic_jobs WHERE id=?', (job['jobId'],)).fetchone()[0])
        self.assertEqual(state, {'reportHash':'paid-report','creating':False,'classifier':{'batchSize':1}})

    def test_first_source_fetch_does_not_lose_new_report_checkpoint(self):
        job = self.create(result=jobs.source(1))
        with server.connect_db() as db:
            db.execute('UPDATE semantic_jobs SET source_json=NULL WHERE id=?', (job['jobId'],))
        def fetch(*args, **kwargs):
            kwargs['checkpoint']({'reportHash':'fresh-paid-report','creating':False})
            return jobs.source(1)
        with patch.object(server, 'fetch_mpstats_semantic_expansion', side_effect=fetch):
            self.worker.step(job['jobId'])
        with server.connect_db() as db:
            state = json.loads(db.execute('SELECT provider_json FROM semantic_jobs WHERE id=?', (job['jobId'],)).fetchone()[0])
        self.assertEqual(state['reportHash'], 'fresh-paid-report')

    def test_cancel_during_timeout_cannot_reschedule_job(self):
        job = self.create(result=jobs.source(1))
        def cancel(*args):
            server.semantic_job_action(job['jobId'], self.wb, jobs.USER, 'cancel')
            raise TimeoutError()
        with patch.object(server, 'semantic_classify_query_batch', side_effect=cancel):
            self.worker.step(job['jobId'])
        self.assertEqual(server.semantic_get_job(job['jobId'], self.wb, jobs.USER)['status'], 'cancelled')


class SemanticMalformedJsonTest(unittest.TestCase):
    def test_provider_refusal_has_specific_code_and_is_not_retried(self):
        for reason in ('blacklist', 'content_filter'):
            payload = {'choices':[{'message':{'content':'Refused'},'finish_reason':reason}]}
            with patch.object(server, 'audit_llm_chat_completion', return_value=(payload, 'model', 'gigachat')) as model:
                with self.assertRaisesRegex(ValueError, '^semantic_model_refused$'):
                    server.semantic_classify_query_batch(jobs.CARD, [{'query':'средство от моли'}])
            self.assertEqual(model.call_count, 1)

    def test_broken_function_arguments_get_specific_safe_error(self):
        payload = {'choices':[{'message':{'function_call':{'arguments':'{"q0":'}}}]}
        with patch.object(server, 'audit_llm_chat_completion', return_value=(payload, 'model', 'gigachat')):
            with self.assertRaisesRegex(ValueError, '^semantic_relevance_invalid_response$'):
                server.semantic_classify_query_batch(jobs.CARD, [{'query':'средство от моли'}])
