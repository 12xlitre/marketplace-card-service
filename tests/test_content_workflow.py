import base64
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import server


CONTACT={'name':'Клиент','phone':'+79000000000','email':'client@example.invalid'}
CARD={'nmID':'1001','cardKey':'1001','sku':'1001','title':'Антимоль спрей','description':'Защищает одежду от моли.','characteristics':[{'name':'Форма','value':['спрей']}]}
SELECTED={'query':'средство от моли','wbCount':100,'ozonCount':60,'relevanceReason':'Назначение подтверждено описанием','source':'mpstats-expanding'}
FINAL={'selected':[SELECTED],'removal':[],'semanticCore':{'current':[],'rankedKeywords':[],'allKeywords':[SELECTED]}}


class ContentWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'test.sqlite3'
        self.patches=[patch.object(server,'DB_PATH',self.path),patch.object(server,'start_workflow_worker'),
                      patch.object(server,'start_semantic_worker'),patch.object(server,'content_reoptimization_configured',return_value=True),
                      patch.dict(os.environ,{server.SECRET_KEY_ENV:base64.urlsafe_b64encode(b'1'*32).decode()})]
        for p in self.patches:p.start()
        server.init_db()
        with server.connect_db() as db:
            for login,role in [('account','manager'),('other','manager'),('tech','tech'),('admin','admin'),('lead','manager')]:
                db.execute('INSERT INTO users(login,password_hash,full_name,role,user_role,access_level) VALUES(?,?,?,?,?,?)',(login,'x',login,role,role,'all' if login=='lead' else 'overview'))
            self.users={r['login']:dict(r) for r in db.execute('SELECT * FROM users')}
        self.portal=server.create_portal('WB','Wildberries','full','account',{'manager':'account','tech':'tech','lead':'lead'})
        self.ozon=server.create_portal('Ozon','Ozon','full','account',{'manager':'account','tech':'tech'})
        self.other=server.create_portal('Other','Wildberries','full','other',{'manager':'other','tech':'tech'})
        with server.connect_db() as db:
            db.execute('UPDATE portals SET cards_snapshot_json=?',(json.dumps([CARD]),))

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()

    def plan(self,portal=None,**extra):
        payload={'requestId':'plan-1','title':'Ноябрь','start':'2026-11-09','end':'2026-11-30','tasks':['semantic_core_collection','content'],'cardKeys':['1001'],'assignee':'tech','contact':CONTACT,**extra}
        return server.workflow_create_plan(portal or self.portal,payload,self.users['other' if portal==self.other else 'account'])

    def list(self,portal=None,user='account'):
        return server.workflow_list(portal or self.portal,self.users[user])

    def batch(self,kind='semantic',portal=None):
        return next(b for b in self.list(portal,'other' if portal==self.other else 'account')['batches'] if b['kind']==kind)

    def approve_plan(self,plan,portal=None):
        proof={'name':'approval.txt','dataUrl':'data:text/plain;base64,'+base64.b64encode(b'Client approved').decode(),'size':15}
        return server.workflow_approve_plan(portal or self.portal,{'periodId':plan['periodId'],'version':1,'day':'2026-11-09','proof':proof},self.users['account'])

    def reviewed_semantic(self,portal=None):
        portal=portal or self.portal
        plan=self.plan(portal)
        batch=self.batch(portal=portal)
        server.workflow_schedule_task(portal,{'batchId':batch['id'],'day':'2026-11-09','minutes':30},self.users['tech'])
        with server.connect_db() as db:
            db.execute("UPDATE workflow_cards SET state='ready' WHERE batch_id=?",(batch['id'],))
            if portal==self.ozon:
                sem={'cardKey':'1001','final':[SELECTED],'finalSelection':{'current':[],'selected':[SELECTED],'removal':[]}}
                db.execute('INSERT INTO ozon_semantic_drafts(portal_id,card_key,payload_json) VALUES(?,?,?)',(portal,'1001',json.dumps(sem)))
            else:
                db.execute('INSERT INTO card_drafts(portal_id,card_key,payload_json) VALUES(?,?,?)',(portal,'1001',json.dumps({'meta':{'semanticCoreFinal':FINAL}})))
        server.workflow_review_card(portal,{'batchId':batch['id'],'cardKey':'1001'},self.users['tech'])
        files=server.workflow_export_files(portal,{'batchId':batch['id']},self.users['tech'])
        return plan,batch,files['fileIds'][0]

    def file(self,file_id):
        with server.connect_db() as db:return dict(db.execute('SELECT * FROM workflow_files WHERE id=?',(file_id,)).fetchone())

    def test_plan_is_atomic_idempotent_and_contacts_and_scope_are_required(self):
        with self.assertRaisesRegex(ValueError,'contacts_required'):self.plan(contact={})
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_plans').fetchone()[0],0)
        plan=self.plan()
        self.assertEqual(self.plan(),plan)
        self.assertEqual(len(self.list()['plans']),1)
        self.assertEqual({b['kind'] for b in self.list()['batches']},{'semantic','content'})
        with self.assertRaisesRegex(ValueError,'card_not_found'):self.plan(requestId='bad-scope',cardKeys=['9999'])
        self.assertEqual(len(self.list()['plans']),1)

    def test_account_plan_approval_needs_evidence_and_lead_cannot_approve(self):
        plan=self.plan()
        with self.assertRaisesRegex(ValueError,'proof_required'):
            server.workflow_approve_plan(self.portal,{'periodId':plan['periodId'],'version':1,'day':'2026-11-09'},self.users['account'])
        for login in ('tech','lead'):
            with self.assertRaises(PermissionError):server.workflow_approve_plan(self.portal,{'periodId':plan['periodId'],'version':1},self.users[login])
        self.approve_plan(plan)
        public=self.list()['plans'][0]
        self.assertEqual(public['status'],'approved')
        self.assertNotIn('dataUrl',public['approval']['proof'])
        with self.assertRaises(PermissionError):server.workflow_list(self.portal,self.users['other'])

    def test_pdf_is_real_embedded_unicode_and_versioned(self):
        import font_roboto
        from reportlab.pdfbase.ttfonts import TTFont
        font=TTFont('test-roboto',str(Path(font_roboto.__file__).parent/'files/Roboto-Regular.ttf'))
        self.assertIn(ord('Я'),font.face.charToGlyph)
        plan=self.plan();file=server.workflow_export_plan(self.portal,plan,self.users['account'])
        self.assertEqual(file,server.workflow_export_plan(self.portal,plan,self.users['account']))
        self.assertTrue(self.file(file['fileId'])['body'].startswith(b'%PDF-'))

    def test_cross_client_day_limit_and_concurrent_reservations(self):
        self.plan();self.plan(self.other)
        first=self.batch('content');second=self.batch('content',self.other)
        barrier=threading.Barrier(2);results=[]
        def save(portal,batch,login):
            barrier.wait()
            try:server.workflow_schedule_task(portal,{'batchId':batch['id'],'day':'2026-11-09','minutes':300},self.users[login]);results.append('ok')
            except ValueError as e:results.append(str(e))
        threads=[threading.Thread(target=save,args=(self.portal,first,'account')),threading.Thread(target=save,args=(self.other,second,'other'))]
        for t in threads:t.start()
        for t in threads:t.join(15)
        self.assertEqual(sorted(results),['ok','workflow_day_overloaded'])
        calendar=server.workflow_calendar(self.users['tech'],'tech','2026-11-09','2026-11-15')
        self.assertEqual(calendar['days'][0]['used'],300)
        with self.assertRaisesRegex(ValueError,'nonworking_day'):
            server.workflow_schedule_task(self.portal,{'batchId':first['id'],'day':'2026-11-14','minutes':60},self.users['tech'])

    def test_semantic_workbook_preserves_demand_reasons_and_client_rejection(self):
        from openpyxl import load_workbook
        _,batch,file_id=self.reviewed_semantic()
        original=self.file(file_id)
        book=load_workbook(io.BytesIO(original['body']))
        sheet=book[book['_OptiCards'].cell(2,1).value]
        self.assertEqual(sheet['E2'].value,100)
        self.assertEqual(sheet['F2'].value,60)
        self.assertEqual(sheet['K2'].value,SELECTED['relevanceReason'])
        sheet['G2']='Нет'
        raw=io.BytesIO();book.save(raw)
        payload={'fileId':file_id,'body':base64.b64encode(raw.getvalue()).decode()}
        preview=server.workflow_approve_file(self.portal,payload,self.users['account'],True,True)
        self.assertEqual(preview['changeCount'],1)
        result=server.workflow_approve_file(self.portal,{**payload,'previewHash':preview['hash']},self.users['account'],True)
        accepted=json.loads(self.file(result['fileId'])['snapshot_json'])
        self.assertEqual(accepted['cards']['1001']['final']['selected'],[])
        self.assertEqual(self.batch()['status'],'approved')

    def test_import_rejects_other_task_file_formulas_and_stale_manifest(self):
        from openpyxl import load_workbook
        _,_,file_id=self.reviewed_semantic()
        original=self.file(file_id)
        book=load_workbook(io.BytesIO(original['body']))
        book['_OptiCards']['A1']='other-file'
        raw=io.BytesIO();book.save(raw)
        with self.assertRaisesRegex(ValueError,'version_conflict'):
            server.workflow_approve_file(self.portal,{'fileId':file_id,'body':base64.b64encode(raw.getvalue()).decode()},self.users['account'],True,True)
        with self.assertRaises(PermissionError):server.workflow_approve_file(self.portal,{'fileId':file_id},self.users['tech'])

    def test_content_uses_frozen_agreed_semantic_and_independent_files(self):
        plan,_,file_id=self.reviewed_semantic()
        server.workflow_approve_file(self.portal,{'fileId':file_id},self.users['account'])
        self.approve_plan(plan)
        batch=self.batch('content')
        server.workflow_schedule_task(self.portal,{'batchId':batch['id'],'day':'2026-11-09','minutes':30},self.users['tech'])
        server.workflow_start_batch(self.portal,{'batchId':batch['id']},self.users['account'])
        server.workflow_process_batch(batch['id'])
        fake={'draftContent':{'title':{'value':'Название по принятому СЯ'},'description':{'value':'Описание по принятому СЯ'},'characteristics':{'shape':{'name':'Форма','value':['спрей']}}}}
        with patch.object(server,'build_card_content_reoptimization',return_value=fake) as model:
            server.workflow_process_batch(batch['id'])
        self.assertTrue(model.call_args.kwargs['frozen_semantic'])
        self.assertEqual(model.call_args.args[3][0]['query'],SELECTED['query'])
        card=server.workflow_list(self.portal,self.users['account'],batch['id'])['batch']['cards'][0]
        self.assertEqual(card['result']['characteristics'],[{'name':'Форма','value':'спрей'}])
        server.workflow_review_card(self.portal,{'batchId':batch['id'],'cardKey':'1001','content':card['result']},self.users['tech'])
        files=server.workflow_export_files(self.portal,{'batchId':batch['id']},self.users['tech'])['fileIds']
        self.assertEqual({self.file(f)['kind'] for f in files},{'main','description'})
        server.workflow_approve_file(self.portal,{'fileId':files[0]},self.users['account'])
        self.assertNotEqual(self.batch('content')['status'],'approved')
        server.workflow_approve_file(self.portal,{'fileId':files[1]},self.users['account'])
        self.assertEqual(self.batch('content')['status'],'approved')

    def test_ozon_batch_uses_same_task_approval_contract(self):
        _,batch,file_id=self.reviewed_semantic(self.ozon)
        server.workflow_approve_file(self.ozon,{'fileId':file_id},self.users['account'])
        self.assertEqual(self.batch(portal=self.ozon)['status'],'approved')

    def test_mail_is_explicit_idempotent_and_unknown_delivery_is_not_repeated(self):
        _,_,file_id=self.reviewed_semantic()
        config={'action':'smtp','host':'smtp.example.invalid','port':465,'tls':'ssl','login':'service','password':'fixture-password','from':'service@example.invalid'}
        public=server.workflow_settings(self.users['admin'],config)
        self.assertNotIn('fixture-password',json.dumps(public))
        with self.assertRaises(PermissionError):server.workflow_settings(self.users['lead'],config)
        draft=server.workflow_legacy_smtp_draft(self.portal,{'fileId':file_id},self.users['account'])
        payload={**draft,'requestId':'mail-1'}
        first=server.workflow_legacy_enqueue_smtp(self.portal,payload,self.users['account'])
        self.assertEqual(first,server.workflow_legacy_enqueue_smtp(self.portal,payload,self.users['account']))
        with patch.object(server,'workflow_send_smtp',side_effect=TimeoutError('secret provider response')) as send:
            server.workflow_deliver_one();server.workflow_deliver_one()
        send.assert_called_once()
        with server.connect_db() as db:
            row=db.execute('SELECT * FROM workflow_outbox WHERE id=?',(first['deliveryId'],)).fetchone()
        self.assertEqual(row['status'],'uncertain')
        self.assertNotIn('secret provider',row['error'])

    def content_files(self):
        plan,_,file_id=self.reviewed_semantic()
        server.workflow_approve_file(self.portal,{'fileId':file_id},self.users['account'])
        self.approve_plan(plan)
        batch=self.batch('content')
        server.workflow_schedule_task(self.portal,{'batchId':batch['id'],'day':'2026-11-09','minutes':30},self.users['tech'])
        with server.connect_db() as db:
            db.execute("UPDATE workflow_batches SET status='review',semantic_file_id=? WHERE id=?",(file_id,batch['id']))
            db.execute("UPDATE workflow_cards SET state='reviewed',result_json=? WHERE batch_id=?",(json.dumps({'title':'Название','description':'Описание','characteristics':[{'name':'Форма','value':'спрей'}]}),batch['id']))
        files=server.workflow_export_files(self.portal,{'batchId':batch['id']},self.users['tech'])['fileIds']
        return plan,batch,{self.file(f)['kind']:f for f in files}

    def returned(self,file_id,cell,value):
        from openpyxl import load_workbook
        book=load_workbook(io.BytesIO(self.file(file_id)['body']))
        book[book['_OptiCards'].cell(2,1).value][cell]=value
        raw=io.BytesIO();book.save(raw)
        payload={'fileId':file_id,'body':base64.b64encode(raw.getvalue()).decode()}
        preview=server.workflow_approve_file(self.portal,payload,self.users['account'],True,True)
        return server.workflow_approve_file(self.portal,{**payload,'previewHash':preview['hash']},self.users['account'],True)

    def test_client_edits_to_two_files_merge_without_overwriting_other_sections(self):
        _,batch,files=self.content_files()
        main=self.returned(files['main'],'E2','Принятое наименование')
        description=self.returned(files['description'],'E2','Принятое описание')
        detail=server.workflow_list(self.portal,self.users['tech'],batch['id'])['batch']
        self.assertEqual(detail['cards'][0]['result']['title'],'Принятое наименование')
        self.assertEqual(detail['cards'][0]['result']['description'],'Принятое описание')
        self.assertEqual(detail['status'],'approved')
        self.assertEqual(set(json.loads(self.file(main['fileId'])['snapshot_json'])['cards']['1001']['content']),{'title','characteristics'})
        self.assertEqual(set(json.loads(self.file(description['fileId'])['snapshot_json'])['cards']['1001']['content']),{'description'})
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_returns').fetchone()[0],2)

    def test_description_approval_survives_title_rework(self):
        _,batch,files=self.content_files()
        description=self.returned(files['description'],'E2','Принятое описание')
        self.returned(files['main'],'F2','Нет')
        content=server.workflow_list(self.portal,self.users['tech'],batch['id'])['batch']['cards'][0]['result']
        server.workflow_review_card(self.portal,{'batchId':batch['id'],'cardKey':'1001','content':{**content,'title':'Исправленное название'}},self.users['tech'])
        ids=server.workflow_export_files(self.portal,{'batchId':batch['id']},self.users['tech'])['fileIds']
        current={self.file(f)['kind']:self.file(f) for f in ids}
        self.assertEqual(current['description']['status'],'approved')
        self.assertEqual(current['main']['status'],'review')
        server.workflow_approve_file(self.portal,{'fileId':current['main']['id']},self.users['account'])
        self.assertEqual(self.batch('content')['status'],'approved')

    def test_revision_archives_old_tasks_keeps_approval_history_and_reuses_semantic(self):
        plan,old,file_id=self.reviewed_semantic()
        server.workflow_approve_file(self.portal,{'fileId':file_id},self.users['account'])
        self.approve_plan(plan)
        current=self.list()['plans'][0]
        result=server.workflow_revise_plan(self.portal,{**current,'periodId':plan['periodId'],'tasks':[t['key'] for t in current['tasks']],'title':'Исправленный план'},self.users['account'])
        self.assertEqual(result['version'],2)
        plans=self.list()['plans'];self.assertEqual(plans[0]['status'],'draft');self.assertEqual(plans[0]['approval'],{})
        with server.connect_db() as db:
            old_approval=json.loads(db.execute('SELECT approval_json FROM workflow_plan_versions WHERE period_id=? AND version=1',(plan['periodId'],)).fetchone()[0])
            self.assertIn('proof',old_approval)
            self.assertEqual(db.execute('SELECT status FROM workflow_batches WHERE id=?',(old['id'],)).fetchone()[0],'archived')
        new=next(b for b in self.list()['batches'] if b['kind']=='semantic' and b['planVersion']==2)
        self.assertEqual(new['status'],'approved')
        self.assertEqual(new['cards'][0]['state'],'reviewed')
        with self.assertRaisesRegex(ValueError,'version_conflict'):
            server.workflow_approve_file(self.portal,{'fileId':file_id},self.users['account'])
        with self.assertRaisesRegex(ValueError,'version_conflict'):
            server.workflow_review_card(self.portal,{'batchId':old['id'],'cardKey':'1001'},self.users['tech'])

    def test_plan_idempotency_rejects_different_payload_and_account_cannot_be_executor(self):
        self.plan()
        with self.assertRaisesRegex(ValueError,'version_conflict'):self.plan(title='Другая операция')
        with self.assertRaisesRegex(ValueError,'assignee_required'):self.plan(requestId='other',assignee='account')

    def test_producer_drains_more_than_eight_cards_and_notifies_once(self):
        cards=[{**CARD,'nmID':str(i),'cardKey':str(i),'sku':str(i)} for i in range(1001,1013)]
        with server.connect_db() as db:db.execute('UPDATE portals SET cards_snapshot_json=? WHERE id=?',(json.dumps(cards),self.portal))
        self.plan(cardKeys=[c['cardKey'] for c in cards])
        batch=self.batch();create=server.semantic_create_job
        source={'source':'mpstats-expanding','semanticCore':{'marketplace':'Wildberries','allKeywords':[SELECTED],'current':[]}}
        def enqueue(*args,**kwargs):return create(*args,**kwargs,source=source)
        worker=server.SemanticJobWorker(self.path)
        with patch.object(server,'semantic_create_job',side_effect=enqueue):
            for _ in range(15):server.workflow_process_batch(batch['id'])
            with server.connect_db() as db:
                jobs=[r[0] for r in db.execute('SELECT id FROM semantic_jobs')]
            self.assertEqual(len(jobs),8)
            with patch.object(server,'semantic_classify_query_batch',side_effect=lambda card,rows:[{**r,'relevance':'relevant','relevanceReason':'Назначение'} for r in rows]):
                for _ in range(25):
                    with server.connect_db() as db:active=[r[0] for r in db.execute("SELECT id FROM semantic_jobs WHERE status IN ('queued','classifying','saving','collecting')")]
                    for job in active:worker.step(job)
                    server.workflow_process_batch(batch['id'])
        self.assertEqual(self.batch()['status'],'review')
        with server.connect_db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM semantic_jobs').fetchone()[0],12)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_outbox').fetchone()[0],1)

    def test_unknown_paid_report_is_not_recreated_on_retry_or_plan_revision(self):
        self.plan();batch=self.batch()
        job=server.semantic_create_job(self.portal,CARD,'',self.users['account'],workflow_batch=batch['id'],source={'source':'mpstats-expanding','semanticCore':{'allKeywords':[SELECTED]}})
        with server.connect_db() as db:
            db.execute("UPDATE semantic_jobs SET status='failed',provider_json=? WHERE id=?",(json.dumps({'creating':True}),job['jobId']))
            db.execute("UPDATE workflow_cards SET job_id=?,state='failed' WHERE batch_id=?",(job['jobId'],batch['id']))
            db.execute("UPDATE workflow_batches SET status='partial' WHERE id=?",(batch['id'],))
        server.workflow_start_batch(self.portal,{'batchId':batch['id']},self.users['tech'])
        with patch.object(server,'semantic_create_job',side_effect=AssertionError('must retry the existing report')):
            server.workflow_process_batch(batch['id'])
        self.assertEqual(server.workflow_list(self.portal,self.users['tech'],batch['id'])['batch']['cards'][0]['error'],'semantic_report_creation_unknown')
        current=self.list()['plans'][0]
        server.workflow_revise_plan(self.portal,{**current,'periodId':current['id'],'tasks':[t['key'] for t in current['tasks']]},self.users['account'])
        new=next(b for b in self.list()['batches'] if b['kind']=='semantic' and b['planVersion']==2)
        with patch.object(server,'semantic_create_job',side_effect=AssertionError('must not recreate ambiguous report')):
            server.workflow_process_batch(new['id'])
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM semantic_jobs').fetchone()[0],1)

    def test_content_cancellation_fences_late_model_response(self):
        plan,_,file_id=self.reviewed_semantic();self.approve_plan(plan)
        server.workflow_approve_file(self.portal,{'fileId':file_id},self.users['account'])
        batch=self.batch('content');server.workflow_start_batch(self.portal,{'batchId':batch['id']},self.users['tech']);server.workflow_process_batch(batch['id'])
        def late(*args,**kwargs):
            server.workflow_start_batch(self.portal,{'batchId':batch['id'],'action':'cancel'},self.users['tech'])
            return {'draftContent':{'title':'Поздний ответ','description':'Позднее описание','characteristics':[]}}
        with patch.object(server,'build_card_content_reoptimization',side_effect=late):server.workflow_process_batch(batch['id'])
        detail=server.workflow_list(self.portal,self.users['tech'],batch['id'])['batch']
        self.assertEqual(detail['status'],'cancelled');self.assertIsNone(detail['cards'][0]['result'])

    def test_assigned_ozon_technician_can_edit_local_drafts_but_not_credentials(self):
        self.plan(self.ozon)
        self.assertTrue(server.user_can_edit_card_content(self.users['tech'],self.ozon))
        self.assertFalse(server.user_can_edit_portal(self.users['tech'],self.ozon))
        server.ensure_ozon_portal_access(self.ozon,self.users['tech'],True,local_work=True)
        with self.assertRaises(PermissionError):server.ensure_ozon_portal_access(self.ozon,self.users['tech'],True)
        with self.assertRaises(PermissionError):server.ensure_ozon_portal_access(self.ozon,self.users['other'],True,local_work=True)

    def test_human_review_requires_estimated_time_and_portal_delete_cascades(self):
        self.plan();batch=self.batch()
        with server.connect_db() as db:db.execute("UPDATE workflow_cards SET state='ready' WHERE batch_id=?",(batch['id'],))
        with self.assertRaisesRegex(ValueError,'schedule_required'):
            server.workflow_review_card(self.portal,{'batchId':batch['id'],'cardKey':'1001'},self.users['tech'])
        with server.connect_db() as db:
            db.execute('DELETE FROM portals WHERE id=?',(self.portal,))
            for table in ['workflow_plans','workflow_plan_versions','workflow_batches','workflow_cards','workflow_files','workflow_returns','workflow_events','workflow_schedule','workflow_outbox']:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0,table)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_plan_revision_does_not_copy_content_after_product_facts_change(self):
        plan,batch,files=self.content_files()
        with server.connect_db() as db:db.execute('UPDATE portals SET cards_snapshot_json=? WHERE id=?',(json.dumps([{**CARD,'description':'Другой состав товара.'}]),self.portal))
        current=self.list()['plans'][0]
        server.workflow_revise_plan(self.portal,{**current,'periodId':current['id'],'tasks':[t['key'] for t in current['tasks']]},self.users['account'])
        new=next(b for b in self.list()['batches'] if b['kind']=='content' and b['planVersion']==2)
        self.assertEqual(new['status'],'planned')
        detail=server.workflow_list(self.portal,self.users['tech'],new['id'])['batch']
        self.assertIsNone(detail['cards'][0]['result'])
        self.assertEqual(detail['files'],[])

    def test_retry_keeps_exact_semantic_file_and_regeneration_is_explicit(self):
        plan,batch,files=self.content_files()
        with server.connect_db() as db:
            original=dict(db.execute('SELECT * FROM workflow_batches WHERE id=?',(batch['id'],)).fetchone())
            parent=dict(db.execute('SELECT * FROM workflow_batches WHERE id=?',(original['parent_id'],)).fetchone())
            source=self.file(original['semantic_file_id'])
            snapshot=json.loads(source['snapshot_json'])['cards']
            snapshot['1001']['final']['selected']=[{'query':'Другой запрос','wbCount':3}]
            later=server.workflow_make_file(db,parent,'semantic',snapshot,self.users['account'],'approved')
            db.execute("UPDATE workflow_cards SET state='failed' WHERE batch_id=?",(batch['id'],))
            db.execute("UPDATE workflow_batches SET status='partial' WHERE id=?",(batch['id'],))
        server.workflow_start_batch(self.portal,{'batchId':batch['id']},self.users['tech'])
        server.workflow_process_batch(batch['id'])
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT semantic_file_id FROM workflow_batches WHERE id=?',(batch['id'],)).fetchone()[0],original['semantic_file_id'])
        server.workflow_start_batch(self.portal,{'batchId':batch['id'],'action':'cancel'},self.users['tech'])
        before=server.workflow_list(self.portal,self.users['tech'],batch['id'])['batch']['generation']
        server.workflow_start_batch(self.portal,{'batchId':batch['id'],'action':'regenerate'},self.users['tech'])
        after=server.workflow_list(self.portal,self.users['tech'],batch['id'])['batch']
        self.assertEqual(after['generation'],before+1)
        self.assertIsNone(after['cards'][0]['result'])

    def test_legacy_period_mutation_cannot_bypass_new_plan_version(self):
        plan=self.plan()
        with self.assertRaisesRegex(ValueError,'versioned_plan_required'):
            server.update_portal_work_period(self.portal,{'periodId':plan['periodId'],'action':'update','title':'Подмена'},self.users['account'])
        with self.assertRaisesRegex(ValueError,'versioned_plan_required'):
            server.ensure_work_period_link_target(self.portal,plan['periodId'],'content')

    def test_list_finishes_reader_before_nested_permission_connection(self):
        self.plan()
        original=server.user_can_access_portal;called=[]
        def access(user,portal):
            if user['login']=='tech' and not called:
                called.append(True);done=threading.Event();errors=[]
                def writer():
                    try:
                        with server.semantic_job_connection() as db:db.execute('UPDATE portals SET updated_at=CURRENT_TIMESTAMP WHERE id=?',(portal,))
                    except Exception as exc:errors.append(exc)
                    finally:done.set()
                thread=threading.Thread(target=writer);thread.start()
                self.assertTrue(done.wait(3),'permission check still holds a reader that blocks the writer')
                thread.join();self.assertEqual(errors,[])
            return original(user,portal)
        with patch.object(server,'user_can_access_portal',side_effect=access):self.list()
        self.assertEqual(called,[True])

    def test_new_period_delete_cancels_durable_jobs_and_requires_account(self):
        plan=self.plan();batch=self.batch()
        job=server.semantic_create_job(self.portal,CARD,'',self.users['account'],workflow_batch=batch['id'],source={'source':'mpstats-expanding','semanticCore':{'allKeywords':[SELECTED]}})
        with self.assertRaises(PermissionError):server.delete_portal_work_period(self.portal,plan['periodId'],self.users['tech'])
        server.delete_portal_work_period(self.portal,plan['periodId'],self.users['account'])
        with server.connect_db() as db:
            self.assertEqual(db.execute('SELECT status FROM semantic_jobs WHERE id=?',(job['jobId'],)).fetchone()[0],'cancelled')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_batches').fetchone()[0],0)

    def test_smtp_attachment_is_exact_file_and_tls_context_is_verified(self):
        from unittest.mock import MagicMock
        _,_,file_id=self.reviewed_semantic();file=self.file(file_id);client=MagicMock();client.send_message.return_value={}
        config={'host':'smtp.example.invalid','port':465,'tls':'ssl','login':'fixture','password':'fixture-password','from':'service@example.invalid','fromName':'Компания, Отдел'}
        with patch.object(server.smtplib,'SMTP_SSL',return_value=client) as factory:
            server.workflow_send_smtp(config,{'deliveryId':'test-id','to':'client@example.invalid','subject':'Проверка','body':'Файл на согласование'},file)
        self.assertEqual(factory.call_args.kwargs['timeout'],20)
        self.assertTrue(factory.call_args.kwargs['context'].check_hostname)
        message=client.send_message.call_args.args[0]
        self.assertEqual(next(message.iter_attachments()).get_payload(decode=True),file['body'])
        self.assertEqual(str(message['Message-ID']),'<test-id@opticards.weboptai.ru>')

    def test_moving_one_calendar_slot_preserves_other_day_parts(self):
        self.plan();batch=self.batch('content')
        for day in ['2026-11-09','2026-11-12']:
            server.workflow_schedule_task(self.portal,{'batchId':batch['id'],'day':day,'minutes':120},self.users['tech'])
        server.workflow_schedule_task(self.portal,{'batchId':batch['id'],'day':'2026-11-10','minutes':180,'moveFrom':'2026-11-09'},self.users['tech'])
        detail=server.workflow_list(self.portal,self.users['tech'],batch['id'])['batch']
        self.assertEqual({s['day']:s['minutes'] for s in detail['schedule']},{'2026-11-10':180,'2026-11-12':120})


if __name__=='__main__':unittest.main()
