import json
import importlib.util
import threading
import unittest
from unittest.mock import patch

import server
from tests import test_content_workflow as fixture


class WorkCalendarTest(unittest.TestCase):
    setUp=fixture.ContentWorkflowTest.setUp
    tearDown=fixture.ContentWorkflowTest.tearDown
    plan=fixture.ContentWorkflowTest.plan
    list=fixture.ContentWorkflowTest.list
    batch=fixture.ContentWorkflowTest.batch

    def calendar(self,who='tech',assignee=None):
        return server.workflow_calendar(self.users[who],assignee,'2026-11-09','2026-11-15')

    def legacy(self,portal=None):
        portal=portal or self.portal
        server.create_workset_tasks(portal,[fixture.CARD],self.users['account'],{'workTypes':['semantic','content'],'title':'Existing WB task'})
        return next(t for t in self.calendar()['tasks'] if t['source']=='legacy' and t['groupKey'].startswith('semantic:') and t['portalId']==str(portal))

    def schedule(self,task,day='2026-11-09',minutes=60,who='tech',**extra):
        return server.workflow_calendar_schedule(int(task['portalId']),{'taskId':task['id'],'day':day,'minutes':minutes,**extra},self.users[who])

    def test_personal_plan_spans_projects_and_includes_unestimated_tasks(self):
        self.plan();self.plan(self.ozon);self.plan(self.other)
        result=self.calendar()
        self.assertFalse(result['canManage'])
        self.assertEqual(result['assignee'],'tech')
        self.assertEqual({t['portalId'] for t in result['tasks']},{str(self.portal),str(self.ozon),str(self.other)})
        self.assertEqual(len(result['tasks']),6)
        self.assertTrue(all(not t['schedule'] for t in result['tasks']))
        self.assertEqual([p['login'] for p in result['people']],['tech'])
        for target in ('all','account','admin'):
            with self.assertRaises(PermissionError):self.calendar(assignee=target)

    def test_manager_sees_team_but_no_hidden_project_names_or_tasks(self):
        self.plan();self.plan(self.other)
        other=self.batch(portal=self.other)
        server.workflow_schedule_task(self.other,{'batchId':other['id'],'day':'2026-11-09','minutes':180,'startTime':'09:00'},self.users['tech'])
        result=self.calendar('account')
        self.assertTrue(result['canManage']);self.assertEqual(result['assignee'],'all')
        self.assertEqual({t['portalId'] for t in result['tasks']},{str(self.portal)})
        monday=next(d for d in result['days'] if d['assignee']=='tech' and d['day']=='2026-11-09')
        self.assertEqual(monday['used'],180);self.assertEqual(monday['tasks'],[])
        self.assertNotIn('Other',json.dumps(result))
        with self.assertRaises(PermissionError):self.schedule({'id':other['id'],'portalId':self.other},who='account')

    def test_lead_global_read_does_not_grant_edit(self):
        self.plan();self.plan(self.other)
        result=self.calendar('lead');self.assertTrue(result['canManage'])
        self.assertEqual({t['portalId'] for t in result['tasks']},{str(self.portal),str(self.other)})
        self.assertTrue(all(not t['canEdit'] for t in result['tasks']))
        with self.assertRaises(PermissionError):self.schedule(result['tasks'][0],who='lead')

    def test_inactive_user_and_removed_portal_access_are_rechecked(self):
        self.plan()
        with server.connect_db() as db:db.execute("UPDATE users SET is_active=0 WHERE login='tech'")
        with self.assertRaises(PermissionError):self.calendar()
        with server.connect_db() as db:
            db.execute("UPDATE users SET is_active=1 WHERE login='tech'")
            db.execute("DELETE FROM portal_members WHERE user_login='tech'")
        self.assertEqual(self.calendar()['tasks'],[])

    def test_existing_manual_wb_and_ozon_tasks_appear_without_provider_calls(self):
        wb=self.legacy()
        raw={'id':'old-ozon','cardKey':'1001','title':'Ozon source','batchId':'ozon-existing','batchTitle':'Existing Ozon','workTypes':['semantic','content'],'status':'draft'}
        server.save_ozon_tasks(self.ozon,{'tasks':[raw]},self.users['account'])
        with patch.object(server,'start_workflow_worker') as worker,patch.object(server,'start_semantic_worker') as semantic:
            result=self.calendar()
            self.assertEqual(len(result['tasks']),4)
            self.assertEqual({t['marketplace'] for t in result['tasks']},{'Wildberries','Ozon'})
            worker.assert_not_called();semantic.assert_not_called()
        self.schedule(wb,minutes=120,startTime='10:00')
        result=self.calendar();saved=next(t for t in result['tasks'] if t['id']==wb['id'])
        self.assertEqual(saved['schedule'][0]['startMinute'],600)
        self.assertEqual(saved['schedule'][0]['minutes'],120)

    def test_existing_automatic_tasks_keep_original_group(self):
        raw={'id':'auto-task','cardKey':'1001','batchId':'automatic-batch','batchTitle':'Automatic task','optimizationMode':'automatic','workTypes':['content']}
        with server.connect_db() as db:
            db.execute("INSERT INTO automatic_seo_tasks(portal_id,batch_id,task_id,card_key,sku,payload_json,status,created_by,updated_by) VALUES(?,?,?,?,?,?,'draft','account','account')",(self.portal,'automatic-batch','auto-task','1001','1001',json.dumps(raw)))
        tasks=self.calendar()['tasks'];self.assertEqual(len(tasks),1)
        self.assertEqual(tasks[0]['groupKey'],'content:automatic-batch')
        self.schedule(tasks[0],minutes=90,startTime='09:30')
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_batches').fetchone()[0],0)

    def test_shared_day_limit_counts_old_and_new_tasks_in_both_directions(self):
        old=self.legacy();self.plan(self.ozon)
        new=next(t for t in self.calendar()['tasks'] if t['source']=='workflow')
        self.schedule(old,minutes=420,startTime='09:00')
        with self.assertRaisesRegex(ValueError,'day_overloaded') as failure:self.schedule(new,minutes=120,startTime='16:00')
        self.assertEqual(failure.exception.details['used'],420)
        self.assertTrue(failure.exception.details['suggestions'])
        self.schedule(new,day='2026-11-10',minutes=420)
        with self.assertRaisesRegex(ValueError,'day_overloaded'):self.schedule(old,day='2026-11-10',minutes=120)

    def test_time_overlap_is_global_and_adjacent_intervals_are_allowed(self):
        old=self.legacy();self.plan(self.ozon)
        new=next(t for t in self.calendar()['tasks'] if t['source']=='workflow')
        self.schedule(old,minutes=120,startTime='10:00')
        with self.assertRaisesRegex(ValueError,'time_overlap'):self.schedule(new,minutes=60,startTime='11:30')
        self.schedule(new,minutes=60,startTime='12:00')
        # A legacy duration-only edit must preserve and validate the existing time.
        with self.assertRaisesRegex(ValueError,'time_overlap'):self.schedule(old,minutes=180)
        current=next(t for t in self.calendar()['tasks'] if t['id']==old['id'])
        self.assertEqual(current['schedule'][0]['minutes'],120)

    def test_time_validation_and_transactional_move(self):
        old=self.legacy()
        for bad in ('25:00','10:99','x','23:30'):
            with self.assertRaisesRegex(ValueError,'invalid_time'):self.schedule(old,minutes=120,startTime=bad)
        self.schedule(old,minutes=60,startTime='09:00')
        self.schedule(old,day='2026-11-10',minutes=30,startTime='10:00')
        self.schedule(old,day='2026-11-11',minutes=60,startTime='11:00',moveFrom='2026-11-09')
        task=next(t for t in self.calendar()['tasks'] if t['id']==old['id'])
        self.assertEqual({s['day'] for s in task['schedule']},{'2026-11-10','2026-11-11'})
        slot=next(s for s in task['schedule'] if s['day']=='2026-11-10')
        with self.assertRaises(PermissionError):server.workflow_calendar_unschedule(self.portal,{'taskId':old['id'],'scheduleId':slot['id']},self.users['other'])
        server.workflow_calendar_unschedule(self.portal,{'taskId':old['id'],'scheduleId':slot['id']},self.users['tech'])
        self.assertEqual(len(next(t for t in self.calendar()['tasks'] if t['id']==old['id'])['schedule']),1)

    def test_bulk_semantic_start_transfers_schedule_without_duplicate_load(self):
        old=self.legacy();self.schedule(old,minutes=90,startTime='10:00')
        payload={'requestId':'legacy-start','legacyGroupKey':old['groupKey'],'cardKeys':['1001'],'title':'Bulk semantic'}
        created=server.workflow_create_standalone(self.portal,payload,self.users['account'])
        self.assertEqual(server.workflow_create_standalone(self.portal,payload,self.users['account']),created)
        result=self.calendar()
        self.assertNotIn(old['id'],{t['id'] for t in result['tasks']})
        task=next(t for t in result['tasks'] if t['id']==created['batchId'])
        self.assertEqual(task['schedule'][0]['startMinute'],600)
        self.assertEqual(result['days'][0]['used'],90)
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_legacy_schedule').fetchone()[0],0)

    def test_concurrent_legacy_and_workflow_writes_share_one_limit(self):
        old=self.legacy();self.plan(self.ozon)
        new=next(t for t in self.calendar()['tasks'] if t['source']=='workflow')
        barrier=threading.Barrier(2);results=[]
        def write(task):
            barrier.wait()
            try:self.schedule(task,minutes=300);results.append('ok')
            except ValueError as e:results.append(str(e))
        workers=[threading.Thread(target=write,args=(task,)) for task in [old,new]]
        for t in workers:t.start()
        for t in workers:t.join(20)
        self.assertEqual(sorted(results),['ok','workflow_day_overloaded'])

    @unittest.skipUnless(importlib.util.find_spec("pymupdf"), "PDF visual acceptance reader is optional")
    def test_owner_pdf_template_is_dynamic_unicode_and_escapes_notes(self):
        import pymupdf
        plan=self.plan(customerTitle='ООО Новый клиент',tasks=[{'key':'supplier_matrix_analysis','description':'Проверить <приоритетные> товары & результат'}])
        exported=server.workflow_export_plan(self.portal,plan,self.users['account'])
        with server.connect_db() as db:body=db.execute('SELECT body FROM workflow_files WHERE id=?',(exported['fileId'],)).fetchone()[0]
        pdf=pymupdf.open(stream=body,filetype='pdf');text='\n'.join(page.get_text() for page in pdf)
        self.assertGreaterEqual(len(pdf),4)
        for expected in ['ООО Новый клиент','Команда проекта','Зачем нужно:','Ответственные специалисты:','Проверить <приоритетные> товары & результат','WWW.WEBOPTIMIZE.RU']:
            self.assertIn(expected,text)
        self.assertNotIn('ИП Левина',text);self.assertNotIn('Дементьева',text)
        self.assertTrue(pdf[0].get_images())

    @unittest.skipUnless(importlib.util.find_spec('pymupdf'), 'PDF visual acceptance reader is optional')
    def test_long_customer_cover_does_not_overlap_and_logo_retains_original_mask(self):
        import pymupdf
        data={'title':'План на ноябрь','start':'2026-11-09','end':'2026-11-30','contact':fixture.CONTACT,'cardKeys':['1001'],'tasks':[{'key':'content','label':'Контент'}],'presentation':{'customer':'Общество с ограниченной ответственностью «Очень длинное название компании заказчика»','team':[]}}
        body=server.workflow_plan_pdf(data,1,'Ozon');pdf=pymupdf.open(stream=body,filetype='pdf');page=pdf[0]
        spans=[span for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for span in line['spans']]
        customer=[s for s in spans if s['color']==0xe21e23]
        subtitle=next(s for s in spans if s['text'].startswith('Ноябрь'))
        self.assertTrue(customer)
        self.assertLess(max(s['bbox'][3] for s in customer),subtitle['bbox'][1])
        pixel=page.get_pixmap().pixel(368,572)
        self.assertTrue(all(channel>245 for channel in pixel),pixel)
