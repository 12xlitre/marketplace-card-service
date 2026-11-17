import json
import unittest
from unittest.mock import patch

import server
from tests import test_semantic_jobs as jobs
from tests import test_content_workflow as workflow


class SemanticEmptyTest(unittest.TestCase):
    setUp = jobs.SemanticJobsTest.setUp
    tearDown = jobs.SemanticJobsTest.tearDown
    create = jobs.SemanticJobsTest.create
    finish = jobs.SemanticJobsTest.finish

    def test_empty_source_is_not_success_and_does_not_create_a_draft(self):
        job=self.create(result=jobs.source(0))
        with patch.object(server,'semantic_classify_query_batch',side_effect=AssertionError('empty provider response needs no model')):
            done=self.finish(job)
        self.assertEqual(done['status'],'empty')
        self.assertFalse(done['autoSaved'])
        self.assertEqual(done['result']['status'],'empty')
        self.assertIsNone(server.get_card_draft(self.wb,'1001',jobs.USER))

    def test_empty_new_ozon_source_preserves_previous_work_and_final_exactly(self):
        payload={'cardKey':'1001','semanticCore':{'relevanceVersion':server.SEMANTIC_RELEVANCE_VERSION,'allKeywords':[{'query':'сохранённый','ozonCount':5,'manualDecision':'included'}]},'selected':[{'query':'сохранённый','ozonCount':5}],'final':[{'query':'согласованный','ozonCount':8}],'finalSelection':{'current':[],'selected':[{'query':'согласованный','ozonCount':8}],'removal':[]}}
        raw=json.dumps(payload)
        with server.connect_db() as db:
            db.execute('INSERT INTO ozon_semantic_drafts(portal_id,card_key,payload_json) VALUES(?,?,?)',(self.ozon,'1001',raw))
        done=self.finish(self.create(portal=self.ozon,result=jobs.source(0,'Ozon')))
        self.assertEqual(done['status'],'empty');self.assertFalse(done['autoSaved'])
        with server.connect_db() as db:
            self.assertEqual(db.execute('SELECT payload_json FROM ozon_semantic_drafts WHERE portal_id=? AND card_key=?',(self.ozon,'1001')).fetchone()[0],raw)

    def test_legacy_zero_ready_rows_are_reported_as_empty_without_migration(self):
        job=self.create(result=jobs.source(0))
        with server.connect_db() as db:
            db.execute("UPDATE semantic_jobs SET status='ready',auto_saved=1 WHERE id=?",(job['jobId'],))
        self.assertEqual(server.semantic_get_job(job['jobId'],self.wb,jobs.USER)['status'],'empty')
        self.assertEqual(server.semantic_list_jobs(self.wb,jobs.USER)['jobs'][0]['status'],'empty')
        with server.connect_db() as db:
            self.assertEqual(db.execute('SELECT status FROM semantic_jobs WHERE id=?',(job['jobId'],)).fetchone()[0],'ready')

    def test_classification_failures_keep_the_actual_safe_error(self):
        for code in ('semantic_relevance_incomplete','semantic_relevance_invalid_response'):
            job=self.create(result=jobs.source(1))
            with patch.object(server,'semantic_classify_query_batch',side_effect=ValueError(code)):
                done=self.finish(job)
            self.assertEqual(done['status'],'failed');self.assertEqual(done['error'],code)

    def test_auto_seed_contains_own_product_phrase_instead_of_only_three_title_words(self):
        for title in ['Монтажная пена полиуретановая всесезонная','Бытовая монтажная пена с трубкой','Огнестойкая профессиональная монтажная пена']:
            seeds=server.mpstats_expanding_seed_queries({'title':title},'')
            self.assertEqual(seeds[0],' '.join(title.split()[:3]));self.assertIn('монтажная пена',seeds)
            self.assertLessEqual(len(seeds),6);self.assertNotIn('пена с',seeds)

    def test_auto_seed_can_skip_explicit_brand_but_manual_query_is_kept(self):
        card={'title':'Герметик KOLT силиконовый белый, 280 мл','brand':'KOLT'}
        self.assertIn('герметик силиконовый',server.mpstats_expanding_seed_queries(card,''))
        self.assertEqual(server.mpstats_expanding_seed_queries(card,'герметик KOLT белый'),['герметик KOLT белый'])


class WorkflowEmptyTest(unittest.TestCase):
    setUp=workflow.ContentWorkflowTest.setUp
    tearDown=workflow.ContentWorkflowTest.tearDown
    plan=workflow.ContentWorkflowTest.plan
    list=workflow.ContentWorkflowTest.list
    batch=workflow.ContentWorkflowTest.batch

    def test_empty_job_stops_batch_for_attention_instead_of_marking_ready(self):
        self.plan();batch=self.batch()
        job=server.semantic_create_job(self.portal,workflow.CARD,'',self.users['account'],workflow_batch=batch['id'],source=jobs.source(0))
        worker=server.SemanticJobWorker(self.path);worker.step(job['jobId']);server.workflow_process_batch(batch['id'])
        batch=self.batch()
        self.assertEqual(batch['status'],'partial');self.assertEqual(batch['cards'][0]['state'],'empty');self.assertEqual(batch['cards'][0]['job']['status'],'empty')

    def test_retry_from_card_updates_existing_plan_task_without_restarting_batch(self):
        self.plan();batch=self.batch()
        job=server.semantic_create_job(self.portal,workflow.CARD,'',self.users['account'],workflow_batch=batch['id'],source=jobs.source(1))
        worker=server.SemanticJobWorker(self.path)
        with patch.object(server,'semantic_classify_query_batch',side_effect=ValueError('semantic_relevance_incomplete')):
            worker.step(job['jobId'])
        server.workflow_process_batch(batch['id']);self.assertEqual(self.batch()['status'],'partial')
        server.semantic_job_action(job['jobId'],self.portal,self.users['account'],'retry')
        self.assertEqual(self.batch()['cards'][0]['state'],'collecting')
        with patch.object(server,'semantic_classify_query_batch',side_effect=jobs.classify):
            worker.step(job['jobId']);worker.step(job['jobId'])
        self.assertEqual(self.batch()['cards'][0]['state'],'ready')
        self.assertEqual(self.batch()['status'],'review')

    def test_explicit_restart_replaces_only_empty_source_and_preserves_finished_card(self):
        card2={**workflow.CARD,'nmID':'1002','cardKey':'1002','sku':'1002'}
        with server.connect_db() as db:
            db.execute('UPDATE portals SET cards_snapshot_json=? WHERE id=?',(json.dumps([workflow.CARD,card2]),self.portal))
        self.plan(cardKeys=['1001','1002']);batch=self.batch()
        empty=server.semantic_create_job(self.portal,workflow.CARD,'',self.users['account'],workflow_batch=batch['id'],source=jobs.source(0))
        full=server.semantic_create_job(self.portal,card2,'',self.users['account'],workflow_batch=batch['id'],source=jobs.source(1))
        with server.connect_db() as db:
            db.execute("UPDATE semantic_jobs SET status='ready',auto_saved=1 WHERE id IN (?,?)",(empty['jobId'],full['jobId']))
            db.execute("UPDATE workflow_cards SET state='ready' WHERE batch_id=?",(batch['id'],))
            db.execute("UPDATE workflow_batches SET status='review' WHERE id=?",(batch['id'],))
        public=self.batch();self.assertEqual(public['status'],'partial');self.assertEqual([c['state'] for c in public['cards']],['empty','ready'])
        server.workflow_start_batch(self.portal,{'batchId':batch['id']},self.users['tech'])
        with server.connect_db() as db:
            rows=[dict(r) for r in db.execute('SELECT card_key,state,job_id FROM workflow_cards WHERE batch_id=? ORDER BY position',(batch['id'],))]
        self.assertEqual(rows,[{'card_key':'1001','state':'queued','job_id':None},{'card_key':'1002','state':'ready','job_id':full['jobId']}])
        self.assertEqual(len(server.semantic_list_jobs(self.portal,self.users['account'])['jobs']),2)
