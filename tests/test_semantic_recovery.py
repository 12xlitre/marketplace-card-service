import json
import unittest
import threading
import time
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

    def test_gigachat_compact_transport_starts_with_sixty_four_without_changing_cache_revision(self):
        with patch.object(server, 'OPTICARDS_LLM_PROVIDER', 'gigachat'):
            job = self.create(result=jobs.source(65))
            with patch.object(server, 'semantic_classify_query_batch', side_effect=jobs.classify) as model:
                self.worker.step(job['jobId'])
            self.assertEqual(len(model.call_args.args[1]), 64)

    def test_partial_valid_response_is_durable_and_only_missing_queries_are_repeated(self):
        job = self.create(result=jobs.source(4))
        accepted = jobs.classify(jobs.CARD, jobs.source(4)['semanticCore']['allKeywords'][::2])
        with patch.object(server, 'semantic_classify_query_batch', side_effect=server.SemanticClassificationIncomplete(accepted)):
            self.worker.step(job['jobId'])
        value = server.semantic_get_job(job['jobId'], self.wb, jobs.USER)
        self.assertEqual((value['status'], value['completed']), ('classifying', 2))
        self.assertIsNone(server.get_card_draft(self.wb, '1001', jobs.USER))
        self.worker = server.SemanticJobWorker(self.path)
        with patch.object(server, 'semantic_classify_query_batch', side_effect=jobs.classify) as model:
            done = self.finish(job)
        self.assertEqual((done['status'], done['completed']), ('ready', 4))
        self.assertEqual([row['query'] for row in model.call_args.args[1]], ['средство от моли 1', 'средство от моли 3'])

    def test_new_gigachat_transport_recovers_old_small_portions_without_losing_cache(self):
        with patch.object(server, 'OPTICARDS_LLM_PROVIDER', 'gigachat'):
            job = self.create(result=jobs.source(65))
            with server.connect_db() as db:
                db.execute('UPDATE semantic_jobs SET provider_json=? WHERE id=?',
                           (json.dumps({'reportHash':'paid','classifier':{'batchSize':1,'failures':2}}),job['jobId']))
            with patch.object(server, 'semantic_classify_query_batch', side_effect=jobs.classify) as model:
                self.worker.step(job['jobId'])
            self.assertEqual(len(model.call_args.args[1]), 64)
            with server.connect_db() as db:
                state=json.loads(db.execute('SELECT provider_json FROM semantic_jobs WHERE id=?',(job['jobId'],)).fetchone()[0])
            self.assertEqual(state['reportHash'], 'paid')
            self.assertEqual(state['classifier'], {'batchSize':64,'transport':server.SEMANTIC_COMPACT_TRANSPORT})

    def test_fast_gigachat_portions_grow_back_and_keep_paid_progress(self):
        with patch.object(server, 'OPTICARDS_LLM_PROVIDER', 'gigachat'):
            job = self.create(result=jobs.source(17))
            with server.connect_db() as db:
                db.execute('UPDATE semantic_jobs SET provider_json=? WHERE id=?',
                           (json.dumps({'classifier':{'batchSize':4,'transport':server.SEMANTIC_COMPACT_TRANSPORT}}),job['jobId']))
            with patch.object(server, 'semantic_classify_query_batch', side_effect=jobs.classify) as model:
                done = self.finish(job)
            self.assertEqual((done['status'], done['completed']), ('ready', 17))
            self.assertEqual([len(call.args[1]) for call in model.call_args_list], [4, 8, 5])
            self.assertEqual(len({row['query'] for call in model.call_args_list for row in call.args[1]}), 17)

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
    def test_compact_arrays_keep_independent_decisions_evidence_and_demand(self):
        decisions={'q0':['r','Назначение совпадает','description','защищает одежду от моли'],
                   'q1':['d','Лавандовый аромат не указан','',''],
                   'q2':['r','Название подтверждает тип','title','Антимоль спрей']}
        rows=[{'query':q,'ozonCount':10+i} for i,q in enumerate(['средство от моли','от моли лаванда','антимоль'])]
        payload={'choices':[{'message':{'content':json.dumps(decisions)},'finish_reason':'stop'}]}
        with patch.object(server,'OPTICARDS_LLM_PROVIDER','gigachat'), patch.object(server,'audit_llm_chat_completion',return_value=(payload,'model','gigachat')) as model:
            checked=server.semantic_classify_query_batch(jobs.CARD,rows)
        self.assertTrue(model.call_args.kwargs['structured_output'])
        self.assertEqual(model.call_args.kwargs['response_schema']['properties']['q0']['type'],'array')
        self.assertEqual([r['relevance'] for r in checked], ['relevant','disputed','relevant'])
        self.assertEqual([r['ozonCount'] for r in checked], [10,11,12])
        self.assertEqual(checked[0]['relevanceEvidence'][0]['factId'], 'description')
        self.assertEqual(checked[2]['relevanceEvidence'][0]['factId'], 'title')

    def test_malformed_row_is_not_cached_but_other_decisions_survive(self):
        payload={'choices':[{'message':{'content':json.dumps({'q0':['i','Другой товар','',''],'q1':['r','Неполный ответ']})}}]}
        with patch.object(server,'audit_llm_chat_completion',return_value=(payload,'model','gigachat')):
            with self.assertRaises(server.SemanticClassificationIncomplete) as caught:
                server.semantic_classify_query_batch(jobs.CARD,[{'query':'чайник'},{'query':'антимоль'}])
        self.assertEqual([r['query'] for r in caught.exception.checked], ['чайник'])

    def test_compact_answer_cannot_use_unknown_ids_or_fabricated_citation(self):
        decisions={'q0':['r','Аромат лаванды','description','лаванда']}
        def payload():return {'choices':[{'message':{'content':json.dumps(decisions)}}]}
        with patch.object(server,'audit_llm_chat_completion',side_effect=lambda *a,**k:(payload(),'model','gigachat')):
            self.assertEqual(server.semantic_classify_query_batch(jobs.CARD,[{'query':'от моли лаванда'}])[0]['relevance'],'disputed')
            decisions['q1']=decisions.pop('q0')
            with self.assertRaisesRegex(ValueError,'invalid_response'):
                server.semantic_classify_query_batch(jobs.CARD,[{'query':'от моли лаванда'}])

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


class SemanticParallelWorkerTest(unittest.TestCase):
    setUp = jobs.SemanticJobsTest.setUp
    create = jobs.SemanticJobsTest.create

    def tearDown(self):
        self.worker.stop.set();self.worker.wake.set()
        if self.worker.thread.is_alive():self.worker.thread.join(10)
        jobs.SemanticJobsTest.tearDown(self)

    def wait_ready(self, created):
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            values=[server.semantic_get_job(j['jobId'],self.wb,jobs.USER) for j in created]
            if all(j['status']=='ready' for j in values):return values
            time.sleep(.02)
        self.fail('parallel worker did not finish: '+str([(v['status'],v['error']) for v in values]))

    def test_independent_openai_jobs_use_four_slots(self):
        cards=[dict(jobs.CARD,nmID=str(1001+i),title='Антимоль спрей '+str(i)) for i in range(4)]
        with server.connect_db() as db:
            db.execute('UPDATE portals SET cards_snapshot_json=? WHERE id=?',(json.dumps(cards),self.wb))
        created=[self.create(card=card,result=jobs.source(1)) for card in cards]
        entered=threading.Event();release=threading.Event();lock=threading.Lock();active=0;peak=0
        def model(card,rows):
            nonlocal active,peak
            with lock:
                active+=1;peak=max(peak,active)
                if active==4:entered.set()
            release.wait(5)
            with lock:active-=1
            return jobs.classify(card,rows)
        with patch.object(server,'OPTICARDS_LLM_PROVIDER','openai'),patch.object(server,'semantic_classify_query_batch',side_effect=model):
            self.worker.thread.start()
            try:self.assertTrue(entered.wait(5),'four independent jobs must overlap')
            finally:release.set()
            self.wait_ready(created)
        self.assertEqual(peak,4)

    def test_identical_facts_share_one_paid_call_even_with_parallel_capacity(self):
        created=[self.create(card=dict(jobs.CARD,nmID=str(key)),result=jobs.source(1)) for key in (1001,1002)]
        def model(card,rows):time.sleep(.05);return jobs.classify(card,rows)
        with patch.object(server,'OPTICARDS_LLM_PROVIDER','openai'),patch.object(server,'semantic_classify_query_batch',side_effect=model) as call:
            self.worker.thread.start();self.wait_ready(created)
        self.assertEqual(call.call_count,1)

    def test_shutdown_waits_for_paid_reply_and_restart_reuses_it(self):
        created=self.create(result=jobs.source(1));entered=threading.Event();release=threading.Event()
        def model(card,rows):entered.set();release.wait(5);return jobs.classify(card,rows)
        with patch.object(server,'semantic_classify_query_batch',side_effect=model):
            self.worker.thread.start();self.assertTrue(entered.wait(5))
            self.worker.stop.set();self.worker.wake.set()
            try:self.assertTrue(self.worker.thread.is_alive())
            finally:release.set()
            self.worker.thread.join(10)
        self.assertFalse(self.worker.thread.is_alive())
        self.worker=server.SemanticJobWorker(self.path)
        with patch.object(server,'semantic_classify_query_batch',side_effect=AssertionError('paid reply must survive shutdown')):
            self.worker.thread.start();self.wait_ready([created])
