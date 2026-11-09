import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import server


CARD = {'nmID': '1001', 'title': 'Антимоль спрей', 'description': 'Спрей защищает одежду от моли.',
        'characteristics': [{'name': 'Форма', 'value': ['спрей']}]}
USER = {'login': 'owner', 'role': 'Manager', 'user_role': 'manager', 'access_level': 'overview'}


def source(count=33, marketplace='Wildberries'):
    rows = [{'query': f'средство от моли {index}', 'wbCount': index+10, 'ozonCount': index+1} for index in range(count)]
    return {'source': 'mpstats-expanding', 'semanticCore': {'marketplace': marketplace,
            'allKeywords': rows, 'current': [], 'seedQuery': 'от моли', 'period': {'d1': '2026-10-01', 'd2': '2026-10-30'}}}


def classify(card, rows):
    return [{**row, 'relevance': 'relevant', 'relevanceReason': 'Подтверждено назначение',
             'relevanceEvidence': [{'factId': 'description', 'quote': 'защищает одежду от моли'}]} for row in rows]


class SemanticJobsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'jobs.sqlite3'
        self.patches = [patch.object(server, 'DB_PATH', self.path),
                        patch.object(server, 'content_reoptimization_configured', return_value=True),
                        patch.object(server, 'start_semantic_worker'),
                        patch.object(server, 'audit_cache_get', return_value=None),
                        patch.object(server, 'audit_cache_set'),
                        patch.object(server, 'semantic_classify_query_batch', side_effect=classify)]
        for item in self.patches: item.start()
        server.init_db()
        with server.connect_db() as db:
            for login in ('owner', 'other'):
                db.execute('INSERT INTO users(login,password_hash,full_name,role,user_role,access_level) VALUES(?,?,?,?,?,?)',
                           (login, 'x', login, 'Manager', 'manager', 'overview'))
        self.wb = server.create_portal('WB', 'Wildberries', 'full', 'owner', {'lead': 'owner'})
        self.ozon = server.create_portal('Ozon', 'Ozon', 'full', 'owner', {'lead': 'owner'})
        with server.connect_db() as db:
            db.execute('UPDATE portals SET cards_snapshot_json=?', (json.dumps([CARD, {**CARD, 'nmID': '1002'}]),))
        self.worker = server.SemanticJobWorker(self.path)

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        self.tmp.cleanup()

    def create(self, portal=None, result=None, card=None, **kwargs):
        return server.semantic_create_job(portal or self.wb, card or CARD, 'от моли', USER,
                                          source=result if result is not None else source(), **kwargs)

    def finish(self, job, limit=12):
        for _ in range(limit):
            self.worker.step(job['jobId'])
            value = server.semantic_get_job(job['jobId'], job['portalId'], USER)
            if value['status'] not in server.SEMANTIC_JOB_ACTIVE:
                return value
        self.fail('job did not complete')

    def test_checkpoint_per_query_survives_sort_and_frequency_changes(self):
        job = self.create()
        self.worker.step(job['jobId'])
        self.assertEqual(server.semantic_get_job(job['jobId'], self.wb, USER)['completed'], 32)
        server.semantic_job_action(job['jobId'], self.wb, USER, 'cancel')
        changed = source()
        changed['semanticCore']['allKeywords'].reverse()
        for row in changed['semanticCore']['allKeywords']: row['wbCount'] += 10000
        other = self.create(result=changed)
        with patch.object(server, 'semantic_classify_query_batch', side_effect=classify) as model:
            done = self.finish(other)
        self.assertEqual(done['status'], 'ready')
        model.assert_called_once()
        self.assertEqual(len(model.call_args.args[1]), 1)
        self.assertEqual(done['result']['semanticCore']['allKeywords'][0]['wbCount'], 10042)

    def test_late_model_response_cannot_finish_cancelled_job_or_write_draft(self):
        job = self.create(result=source(1))
        def late(card, rows):
            server.semantic_job_action(job['jobId'], self.wb, USER, 'cancel')
            return classify(card, rows)
        with patch.object(server, 'semantic_classify_query_batch', side_effect=late):
            self.worker.step(job['jobId'])
        self.assertEqual(server.semantic_get_job(job['jobId'], self.wb, USER)['status'], 'cancelled')
        self.assertIsNone(server.get_card_draft(self.wb, '1001', USER))
        server.semantic_job_action(job['jobId'], self.wb, USER, 'retry')
        with patch.object(server, 'semantic_classify_query_batch', side_effect=AssertionError('cached reply must not be paid twice')):
            self.assertEqual(self.finish(job)['status'], 'ready')

    def test_card_identity_and_owner_cannot_be_overridden(self):
        job = self.create()
        for portal, user in ((self.ozon, USER), (self.wb, {**USER, 'login': 'other'})):
            with self.assertRaisesRegex(ValueError, 'not_found'):
                server.semantic_get_job(job['jobId'], portal, user)
            with self.assertRaisesRegex(ValueError, 'not_found'):
                server.semantic_job_action(job['jobId'], portal, user, 'cancel')
        self.assertEqual(server.semantic_list_jobs(self.wb, {**USER, 'login': 'other'})['jobs'], [])
        other = {**USER, 'login': 'other', 'access_level': 'all'}
        with server.connect_db() as db: db.execute("UPDATE users SET access_level='all' WHERE login='other'")
        with self.assertRaisesRegex(ValueError, 'semantic_card_busy'):
            server.semantic_create_job(self.wb, CARD, 'another query', other, source=source())
        repeated = self.create()
        self.assertEqual(repeated['jobId'], job['jobId'])

    def test_autosave_merges_latest_manual_decisions_preserving_content_and_final(self):
        job = self.create(result=source(2))
        self.worker.step(job['jobId'])
        final = {'id': 'approved-final', 'selected': [{'query': 'approved'}], 'semanticCore': {'present': True}}
        previous = {'auditStatus': 'done', 'content': {'title': {'value': 'Ручной заголовок'}}, 'meta': {
            'semanticCoreFinal': final, 'approvalSections': {'content': {'status': 'approved'}},
            'semanticCoreReports': [{'id': 'older', 'semanticCore': {'allKeywords': [
                {'query': 'средство от моли 0', 'manualDecision': 'excluded'}]}}],
            'semanticCoreSelected': [{'query': 'другой подбор', 'wbCount': 50}],
        }}
        with server.connect_db() as db:
            db.execute('INSERT INTO card_drafts(portal_id,card_key,payload_json,audit_status) VALUES(?,?,?,?)',
                       (self.wb, '1001', json.dumps(previous), 'done'))
        done = self.finish(job)
        self.assertEqual(done['status'], 'ready')
        saved = server.get_card_draft(self.wb, '1001', USER)['draft']
        self.assertEqual(saved['content']['title']['value'], 'Ручной заголовок')
        self.assertEqual(saved['meta']['semanticCoreFinal'], final)
        self.assertEqual(saved['meta']['approvalSections'], previous['meta']['approvalSections'])
        self.assertEqual({row['query'] for row in saved['meta']['semanticCoreSelected']}, {'другой подбор', 'средство от моли 1'})
        self.assertTrue(done['autoSaved'])

    def test_ozon_autosave_preserves_final_snapshot_and_uses_ozon_demand(self):
        result = source(2, 'Ozon');result['semanticCore']['allKeywords'][0]['ozonCount'] = 0
        old = {'cardKey': '1001', 'final': [{'query': 'итог'}], 'finalSelection': {'selected': [{'query': 'итог'}]}}
        server.save_ozon_semantic_draft(self.ozon, old, USER)
        old = server.get_ozon_semantic_draft(self.ozon, '1001', USER)['draft']['draft']
        done = self.finish(self.create(portal=self.ozon, result=result))
        self.assertEqual(done['status'], 'ready')
        data = server.get_ozon_semantic_draft(self.ozon, '1001', USER)['draft']['draft']
        self.assertEqual([row['query'] for row in data['selected']], ['средство от моли 1'])
        self.assertEqual(data['final'], old['final'])
        self.assertEqual(data['finalSelection']['selected'], old['finalSelection']['selected'])

    def test_unsaved_manual_decision_is_checkpointed_with_start_without_writing_content(self):
        initial = {'decisions': [{'query': 'средство от моли 0', 'manualDecision': 'excluded'}], 'selected': [], 'removal': []}
        job = self.create(result=source(1), selection_state=initial)
        self.assertEqual(self.finish(job)['status'], 'ready')
        self.assertEqual(server.get_card_draft(self.wb, '1001', USER)['draft']['meta']['semanticCoreSelected'], [])

    def test_unsaved_and_concurrently_saved_manual_decisions_are_both_retained(self):
        rows = source(3)['semanticCore']['allKeywords']
        def payload(selected, decisions):
            return {'content': {'title': {'value': 'Ручной текст'}}, 'meta': {
                'semanticCoreSelected': selected, 'semanticCoreRemoval': [],
                'semanticCoreReports': [{'semanticCore': {'allKeywords': [
                    {'query': key, 'manualDecision': value} for key, value in decisions.items()]}}]}}
        before = payload(rows[:2], {rows[0]['query']: 'included', rows[1]['query']: 'included'})
        with server.connect_db() as db:
            db.execute('INSERT INTO card_drafts(portal_id,card_key,payload_json) VALUES(?,?,?)', (self.wb, '1001', json.dumps(before)))
        initial = {'selected': [rows[1]], 'removal': [], 'decisions': [{'query': rows[0]['query'], 'manualDecision': 'excluded'}]}
        job = self.create(result=source(3), selection_state=initial)
        latest = payload([rows[0]], {rows[0]['query']: 'included', rows[1]['query']: 'excluded'})
        with server.connect_db() as db:
            db.execute('UPDATE card_drafts SET payload_json=? WHERE portal_id=? AND card_key=?', (json.dumps(latest), self.wb, '1001'))
        self.assertEqual(self.finish(job)['status'], 'ready')
        saved = server.get_card_draft(self.wb, '1001', USER)['draft']
        self.assertEqual([row['query'] for row in saved['meta']['semanticCoreSelected']], [rows[2]['query']])
        self.assertEqual(saved['content']['title']['value'], 'Ручной текст')

    def test_changed_facts_and_revoked_access_fail_closed(self):
        job = self.create(result=source(1))
        self.worker.step(job['jobId'])
        with server.connect_db() as db:
            db.execute('UPDATE portals SET cards_snapshot_json=? WHERE id=?', (json.dumps([{**CARD, 'description': 'Другой товар'}]), self.wb))
        done = self.finish(job)
        self.assertEqual(done['error'], 'semantic_card_changed')
        self.assertIsNone(server.get_card_draft(self.wb, '1001', USER))
        other = self.create(portal=self.ozon)
        with server.connect_db() as db: db.execute("UPDATE users SET is_active=0 WHERE login='owner'")
        self.assertEqual(self.finish(other)['error'], 'forbidden')

    def test_no_overall_deadline_and_eta_uses_observed_model_work(self):
        job = self.create()
        with server.connect_db() as db:
            db.execute('UPDATE semantic_jobs SET created_at=? WHERE id=?', (time.time()-7200, job['jobId']))
        self.worker.step(job['jobId'])
        with server.connect_db() as db:
            db.execute('UPDATE semantic_jobs SET model_seconds=64 WHERE id=?', (job['jobId'],))
        pending = server.semantic_get_job(job['jobId'], self.wb, USER)
        self.assertGreater(pending['etaHighSeconds'], 0)
        self.assertEqual(self.finish(job)['status'], 'ready')

    def test_provider_report_hash_survives_poll_and_worker_restart(self):
        job = server.semantic_create_job(self.wb, CARD, 'от моли', USER)
        with patch.object(server, 'get_service_integration_secret', return_value='fixture'), \
             patch.object(server, 'mpstats_post_body_json', return_value={'reportHash': 'persisted-report'}) as create, \
             patch.object(server, 'mpstats_get_json', return_value={}):
            self.worker.step(job['jobId'])
        create.assert_called_once()
        with server.connect_db() as db:
            state = json.loads(db.execute('SELECT provider_json FROM semantic_jobs WHERE id=?', (job['jobId'],)).fetchone()[0])
        self.assertEqual(state['reportHash'], 'persisted-report')
        other_worker = server.SemanticJobWorker(self.path)
        with patch.object(server, 'get_service_integration_secret', return_value='fixture'), \
             patch.object(server, 'mpstats_post_body_json', side_effect=AssertionError('must not create a second report')), \
             patch.object(server, 'mpstats_get_json', return_value={'words': [{'word': 'антимоль', 'wb_count': 30}]}):
            other_worker.step(job['jobId'])
            self.assertEqual(self.finish(job)['status'], 'ready')

    def test_ambiguous_report_creation_is_not_retried_automatically(self):
        job = server.semantic_create_job(self.wb, CARD, 'от моли', USER)
        with patch.object(server, 'get_service_integration_secret', return_value='fixture'), \
             patch.object(server, 'mpstats_post_body_json', side_effect=server.MpstatsApiError(503, 'provider-secret', retryable=True)):
            self.worker.step(job['jobId'])
        with self.assertRaisesRegex(ValueError, 'semantic_report_creation_unknown'):
            server.semantic_job_action(job['jobId'], self.wb, USER, 'retry')
        public = server.semantic_get_job(job['jobId'], self.wb, USER)
        self.assertNotIn('provider-secret', json.dumps(public))

    def test_new_job_reuses_persistent_source_after_memory_cache_is_lost(self):
        job = self.create(result=source(1))
        self.assertEqual(self.finish(job)['status'], 'ready')
        new = server.semantic_create_job(self.wb, CARD, 'от моли', USER)
        with patch.object(server, 'fetch_mpstats_semantic_expansion', side_effect=AssertionError('persistent source must be reused')), \
             patch.object(server, 'semantic_classify_query_batch', side_effect=AssertionError('persistent decision must be reused')):
            self.assertEqual(self.finish(new)['status'], 'ready')

    def test_1660_queries_finish_without_truncation_and_repeat_uses_cache(self):
        job = self.create(result=source(1660))
        with patch.object(server, 'semantic_classify_query_batch', side_effect=classify) as model:
            done = self.finish(job, limit=55)
        self.assertEqual(done['status'], 'ready')
        self.assertEqual([len(call.args[1]) for call in model.call_args_list], [32] * 51 + [28])
        self.assertEqual(done['completed'], 1660)
        saved = server.get_card_draft(self.wb, '1001', USER)['draft']['meta']
        self.assertEqual(len(saved['semanticCoreSelected']), 1660)
        self.assertEqual(len(saved['semanticCoreReports'][0]['semanticCore']['allKeywords']), 1660)
        with patch.object(server, 'semantic_classify_query_batch', side_effect=AssertionError('must reuse decisions')):
            self.assertEqual(self.finish(self.create(result=source(1660)))['status'], 'ready')

    def test_retry_obeys_active_queue_limit(self):
        job = self.create(result=source(1))
        server.semantic_job_action(job['jobId'], self.wb, USER, 'cancel')
        with server.connect_db() as db:
            template = dict(db.execute('SELECT * FROM semantic_jobs WHERE id=?', (job['jobId'],)).fetchone())
            for index in range(8):
                copy = {**template, 'id': f'queued-{index}', 'card_key': f'other-{index}', 'status': 'queued'}
                db.execute('INSERT INTO semantic_jobs (' + ','.join(copy) + ') VALUES (' + ','.join('?' for _ in copy) + ')', tuple(copy.values()))
        with self.assertRaisesRegex(ValueError, 'semantic_relevance_busy'):
            server.semantic_job_action(job['jobId'], self.wb, USER, 'retry')
        self.assertEqual(server.semantic_get_job(job['jobId'], self.wb, USER)['status'], 'cancelled')

    def test_legacy_ozon_final_freezes_old_selection_before_autosave(self):
        previous = {'cardKey': '1001', 'final': [{'query': 'старый итог'}],
                    'current': [{'query': 'в карточке'}], 'selected': [{'query': 'старый выбор'}], 'removal': []}
        previous = server.normalize_ozon_semantic_payload(previous)
        with server.connect_db() as db:
            db.execute('INSERT INTO ozon_semantic_drafts(portal_id,card_key,payload_json) VALUES(?,?,?)', (self.ozon, '1001', json.dumps(previous)))
        previous = server.get_ozon_semantic_draft(self.ozon, '1001', USER)['draft']['draft']
        self.assertEqual(self.finish(self.create(portal=self.ozon, result=source(1, 'Ozon')))['status'], 'ready')
        saved = server.get_ozon_semantic_draft(self.ozon, '1001', USER)['draft']['draft']
        self.assertEqual(saved['final'], previous['final'])
        self.assertEqual(saved['finalSelection']['selected'], previous['selected'])
        self.assertEqual(saved['finalSelection']['current'], previous['current'])

    def test_facts_or_model_change_invalidates_cache_and_portals_are_separate(self):
        first = self.create(result=source(1));self.finish(first)
        for portal, card, model in ((self.ozon, CARD, server.semantic_model_key()),
                                    (self.wb, {**CARD, 'description': 'Спрей от моли для одежды'}, server.semantic_model_key()),
                                    (self.wb, CARD, 'another-model')):
            with server.connect_db() as db:
                db.execute('UPDATE portals SET cards_snapshot_json=? WHERE id=?', (json.dumps([card]), portal))
            with patch.object(server, 'semantic_model_key', return_value=model), \
                 patch.object(server, 'semantic_classify_query_batch', side_effect=classify) as check:
                self.assertEqual(self.finish(self.create(portal=portal, card=card, result=source(1)))['status'], 'ready')
                check.assert_called_once()

    def test_query_cache_is_isolated_by_user(self):
        self.finish(self.create(result=source(1)))
        with server.connect_db() as db: db.execute("UPDATE users SET access_level='all' WHERE login='other'")
        other = {**USER, 'login': 'other'}
        job = server.semantic_create_job(self.wb, CARD, 'от моли', other, source=source(1))
        with patch.object(server, 'semantic_classify_query_batch', side_effect=classify) as model:
            self.worker.step(job['jobId'])
        model.assert_called_once()

    def test_new_process_resumes_exactly_after_last_committed_batch(self):
        job = self.create()
        trace = Path(self.tmp.name) / 'calls.jsonl'
        script = '''import json,os,sys,time
from pathlib import Path
import server
server.DB_PATH=Path(sys.argv[1]);job_id=sys.argv[2];trace=Path(sys.argv[3]);crash=sys.argv[4]=='crash'
server.content_reoptimization_configured=lambda:True
def classify(card,rows):
 if crash and len(rows)==1: os._exit(23)
 with trace.open('a') as handle: handle.write(json.dumps([row['query'] for row in rows])+'\\n')
 return [{**row,'relevance':'relevant','relevanceReason':'Назначение','relevanceEvidence':[]} for row in rows]
server.semantic_classify_query_batch=classify
worker=server.start_semantic_worker()
for _ in range(300):
 with server.connect_db() as db: row=db.execute('SELECT status FROM semantic_jobs WHERE id=?',(job_id,)).fetchone()
 if row['status'] in ('ready','failed'): break
 time.sleep(.02)
else: raise RuntimeError('worker did not finish')
worker.stop.set();worker.wake.set();worker.thread.join(2)
assert row['status']=='ready',row['status']
'''
        command = [sys.executable, '-c', script, str(self.path), job['jobId'], str(trace)]
        first = subprocess.run([*command, 'crash'], capture_output=True, text=True, timeout=15)
        self.assertEqual(first.returncode, 23, first.stderr)
        self.assertEqual(server.semantic_get_job(job['jobId'], self.wb, USER)['completed'], 32)
        second = subprocess.run([*command, 'resume'], capture_output=True, text=True, timeout=15)
        self.assertEqual(second.returncode, 0, second.stderr)
        calls = [json.loads(line) for line in trace.read_text().splitlines()]
        self.assertEqual([len(rows) for rows in calls], [32, 1])
        self.assertEqual(len(set(sum(calls, []))), 33)
        self.assertTrue(server.semantic_get_job(job['jobId'], self.wb, USER)['autoSaved'])

    def test_single_leader_and_round_robin_batches(self):
        second_card = {**CARD, 'nmID': '1002', 'title': 'Антимоль спрей для вещей'}
        with server.connect_db() as db:
            db.execute('UPDATE portals SET cards_snapshot_json=? WHERE id=?', (json.dumps([CARD, second_card]), self.wb))
        jobs = [self.create(), self.create(card=second_card)]
        workers = [server.SemanticJobWorker(self.path), server.SemanticJobWorker(self.path)]
        calls = []
        def model(card, rows):
            calls.append((card['nmID'], len(rows)))
            time.sleep(.025)
            return classify(card, rows)
        try:
            with patch.object(server, 'semantic_classify_query_batch', side_effect=model):
                for worker in workers: worker.thread.start()
                for _ in range(150):
                    if all(server.semantic_get_job(job['jobId'], self.wb, USER)['status'] == 'ready' for job in jobs):
                        break
                    time.sleep(.02)
                else: self.fail('leader did not finish queue')
        finally:
            for worker in workers: worker.stop.set(); worker.wake.set()
            for worker in workers: worker.thread.join(3)
        self.assertEqual(calls, [('1001', 32), ('1002', 32), ('1001', 1), ('1002', 1)])


if __name__ == '__main__':
    unittest.main()
