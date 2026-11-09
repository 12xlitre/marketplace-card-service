import base64
import json
import unittest
from unittest.mock import patch,MagicMock
from urllib.error import HTTPError
from io import BytesIO
import server
import test_content_workflow as base


class CrmMailTest(unittest.TestCase):
    setUp=base.ContentWorkflowTest.setUp
    tearDown=base.ContentWorkflowTest.tearDown
    plan=base.ContentWorkflowTest.plan
    list=base.ContentWorkflowTest.list
    batch=base.ContentWorkflowTest.batch
    approve_plan=base.ContentWorkflowTest.approve_plan
    reviewed_semantic=base.ContentWorkflowTest.reviewed_semantic

    def fake(self,method,payload=None):
        self.calls.append((method,payload))
        values={'scope':['crm','im'],'crm.deal.get':{'ID':'123','TITLE':'Клиент WB/Ozon','CONTACT_ID':'99','ASSIGNED_BY_ID':'8'},
                'crm.contact.get':{'EMAIL':[{'VALUE':'client@example.invalid'}]},'crm.activity.list':[], 'crm.activity.add':801}
        return {'result':values[method]}

    def mocks(self):
        self.calls=[]
        with server.connect_db() as db:db.execute("INSERT INTO workflow_people(login,bitrix_id) VALUES('account',8)")
        for p in [patch.object(server,'workflow_crm_hook',return_value='https://weboptimize.bitrix24.ru/rest/1/fixture/'),patch.object(server,'workflow_crm_request',side_effect=self.fake)]:
            p.start();self.addCleanup(p.stop)

    def bind(self,portal=None):
        portal=portal or self.portal
        server.workflow_crm_bind(portal,{'action':'link_deal','dealId':'123'},self.users['account'])
        return server.workflow_mail_draft(portal,{},self.users['account'])

    def envelope(self,draft=None):
        return {**(draft or self.bind()),'requestId':'outgoing-1','to':'client@example.invalid','subject':'План на согласование','body':'Добрый день!'}

    def test_link_is_explicit_and_draft_uses_crm_recipient_without_smtp(self):
        self.mocks();draft=self.bind()
        self.assertEqual(draft['to'],'client@example.invalid');self.assertTrue(draft['configured'])
        self.assertEqual(draft['deal']['url'],'https://weboptimize.bitrix24.ru/crm/deal/details/123/')
        self.assertNotIn('fixture',json.dumps(draft));self.assertFalse(any(m=='crm.activity.add' for m,_ in self.calls))

    def test_technician_and_other_account_cannot_read_preview_link_or_send(self):
        self.mocks()
        for user in ['tech','other']:
            with self.assertRaises(PermissionError):server.workflow_crm_mailbox(self.portal,self.users[user])
            with self.assertRaises(PermissionError):server.workflow_crm_bind(self.portal,{'dealId':'123'},self.users[user])
        self.assertEqual(self.calls,[])
        # Global lead can read an explicitly bound cabinet but cannot modify it.
        self.bind();self.assertFalse(server.workflow_crm_mailbox(self.portal,self.users['lead'])['canManage'])
        with self.assertRaises(PermissionError):server.workflow_mail_draft(self.portal,{},self.users['lead'])

    def test_missing_crm_scope_returns_actionable_state(self):
        self.mocks()
        with patch.object(server,'workflow_crm_request',return_value={'result':['mailservice']}):
            value=server.workflow_crm_mailbox(self.portal,self.users['account'])
        self.assertEqual(value['error'],'crm_scope_required');self.assertEqual(value['messages'],[])

    def test_mailbox_filters_exact_binding_and_paginates_without_html(self):
        self.mocks();self.bind()
        def api(method,payload=None):
            if method=='scope':return {'result':['crm']}
            self.assertEqual(payload['filter'],{'BINDINGS':[{'OWNER_TYPE_ID':2,'OWNER_ID':123}],'TYPE_ID':4,'<ID':800})
            return {'result':[{'ID':'799','DIRECTION':1,'SUBJECT':'Ответ','DESCRIPTION_TYPE':2,'DESCRIPTION':'<script>secret()</script><p>Принято<img src="https://tracker.invalid/pixel"></p>','COMMUNICATIONS':[{'TYPE':'EMAIL','VALUE':'client@example.invalid'}],'FILES':[{'id':1}]}],'next':50}
        with patch.object(server,'workflow_crm_request',side_effect=api):value=server.workflow_crm_mailbox(self.portal,self.users['account'],'800')
        self.assertEqual(value['messages'][0]['body'],'Принято');self.assertTrue(value['hasMore']);self.assertEqual(value['before'],'799')
        self.assertNotIn('tracker',json.dumps(value));self.assertEqual(value['messages'][0]['direction'],'in')

    def test_foreign_deal_urls_cannot_change_request_destination(self):
        self.mocks()
        for value in ['https://evil.invalid/crm/deal/details/123/','http://127.0.0.1/123','https://weboptimize.bitrix24.ru:444/crm/deal/details/123/','0','-3']:
            with self.assertRaises(ValueError):server.workflow_crm_deal(value)
        self.assertEqual(self.calls,[])

    def test_idempotency_conflict_and_attachment_is_exact_saved_version(self):
        self.mocks();_,_,file_id=self.reviewed_semantic();self.bind()
        draft=server.workflow_mail_draft(self.portal,{'fileId':file_id},self.users['account']);payload=self.envelope(draft)
        first=server.workflow_enqueue_mail(self.portal,payload,self.users['account'])
        self.assertEqual(first,server.workflow_enqueue_mail(self.portal,payload,self.users['account']))
        with self.assertRaises(ValueError):server.workflow_enqueue_mail(self.portal,{**payload,'body':'Другой текст'},self.users['account'])
        server.workflow_deliver_one()
        fields=next(p['fields'] for m,p in self.calls if m=='crm.activity.add')
        self.assertEqual((fields['TYPE_ID'],fields['DIRECTION'],fields['COMPLETED']),(4,2,'Y'))
        self.assertEqual(fields['OWNER_ID'],123);self.assertNotIn('MESSAGE_FROM',fields)
        with server.connect_db() as db:
            file=db.execute('SELECT * FROM workflow_files WHERE id=?',(file_id,)).fetchone()
            self.assertEqual(base64.b64decode(fields['FILES'][0]['fileData'][1]),file['body'])
            delivery=db.execute('SELECT status FROM workflow_outbox WHERE id=?',(first['deliveryId'],)).fetchone()
        self.assertEqual(delivery[0],'sent')

    def test_link_cannot_change_with_pending_mail_and_stale_draft_is_rejected(self):
        self.mocks();draft=self.bind();payload=self.envelope(draft)
        server.workflow_enqueue_mail(self.portal,payload,self.users['account'])
        with self.assertRaisesRegex(ValueError,'crm_delivery_pending'):
            server.workflow_crm_bind(self.portal,{'action':'unlink_deal','previousLinkId':draft['linkId']},self.users['account'])
        with self.assertRaisesRegex(ValueError,'workflow_version_conflict'):
            server.workflow_enqueue_mail(self.portal,{**payload,'requestId':'2','linkId':'stale'},self.users['account'])

    def test_uncertain_delivery_is_not_repeated_and_can_only_be_confirmed_from_crm(self):
        self.mocks();payload=self.envelope();delivery=server.workflow_enqueue_mail(self.portal,payload,self.users['account'])['deliveryId']
        def unknown(method,payload=None):
            if method=='crm.activity.add':raise TimeoutError('private response')
            return self.fake(method,payload)
        with patch.object(server,'workflow_crm_request',side_effect=unknown) as request:
            server.workflow_deliver_one();server.workflow_deliver_one()
            self.assertEqual(sum(c.args[0]=='crm.activity.add' for c in request.call_args_list),1)
        with server.connect_db() as db:
            row=db.execute('SELECT * FROM workflow_outbox WHERE id=?',(delivery,)).fetchone()
        self.assertEqual(row['status'],'uncertain');self.assertNotIn('private',row['error'])
        with self.assertRaisesRegex(ValueError,'workflow_delivery_unknown'):
            server.workflow_crm_reconcile(self.portal,{'deliveryId':delivery},self.users['account'])
        with patch.object(server,'workflow_crm_request',return_value={'result':[{'ID':801,'ORIGIN_ID':delivery,'ORIGINATOR_ID':'OPTICARDS','COMPLETED':'Y'}]}):
            self.assertTrue(server.workflow_crm_reconcile(self.portal,{'deliveryId':delivery},self.users['account'])['confirmed'])

    def test_revoked_manager_cannot_deliver_existing_queue(self):
        self.mocks();delivery=server.workflow_enqueue_mail(self.portal,self.envelope(),self.users['account'])['deliveryId']
        with server.connect_db() as db: db.execute("UPDATE users SET is_active=0 WHERE login='account'")
        server.workflow_deliver_one()
        self.assertFalse(any(m=='crm.activity.add' for m,_ in self.calls))
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT status FROM workflow_outbox WHERE id=?',(delivery,)).fetchone()[0],'failed')

    def test_attachment_version_conflict_fails_before_queue(self):
        self.mocks();_,_,file_id=self.reviewed_semantic();self.bind()
        draft=server.workflow_mail_draft(self.portal,{'fileId':file_id},self.users['account'])
        with self.assertRaisesRegex(ValueError,'workflow_version_conflict'):
            server.workflow_enqueue_mail(self.portal,self.envelope({**draft,'fileSha':'wrong'}),self.users['account'])

    def test_transport_never_retries_mutation_and_hides_provider_body(self):
        with patch.object(server,'workflow_crm_hook',return_value='https://weboptimize.bitrix24.ru/rest/1/fixture/'),patch('urllib.request.build_opener') as opener,patch.object(server.time,'sleep'):
            opener.return_value.open.side_effect=HTTPError('secret',502,'secret',{},BytesIO(b'private'))
            with self.assertRaisesRegex(ValueError,'crm_unavailable'):server.workflow_crm_request('crm.activity.add',{})
            self.assertEqual(opener.return_value.open.call_count,1)
            opener.return_value.open.reset_mock()
            with self.assertRaisesRegex(ValueError,'crm_unavailable'):server.workflow_crm_request('scope')
            self.assertEqual(opener.return_value.open.call_count,3)
            with self.assertRaisesRegex(ValueError,'crm_invalid_method'):server.workflow_crm_request('crm.deal.delete',{})

    def test_encrypted_existing_webhook_works_inside_queue_transaction(self):
        self.calls=[]
        with server.connect_db() as db:db.execute("INSERT INTO workflow_people(login,bitrix_id) VALUES('account',8)")
        server.save_service_integration('bitrix-notifications','https://weboptimize.bitrix24.ru/rest/1/fixture/',self.users['admin'])
        with patch.object(server,'workflow_crm_request',side_effect=self.fake):
            payload=self.envelope()
            result=server.workflow_enqueue_mail(self.portal,payload,self.users['account'])
            server.workflow_deliver_one()
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT status FROM workflow_outbox WHERE id=?',(result['deliveryId'],)).fetchone()[0],'sent')

    def test_account_cannot_discover_foreign_deal_through_broad_webhook(self):
        self.mocks()
        with server.connect_db() as db:db.execute("UPDATE workflow_people SET bitrix_id=999 WHERE login='account'")
        with self.assertRaisesRegex(ValueError,'crm_deal_owner_required'):
            server.workflow_crm_deal('123',self.users['account'])
        self.assertEqual([m for m,_ in self.calls],['crm.deal.get'])
        self.assertEqual(server.workflow_crm_deal('123',self.users['admin'])['dealId'],123)

    def test_link_cascades_on_cabinet_delete(self):
        self.mocks();self.bind()
        with server.connect_db() as db:
            db.execute('DELETE FROM portals WHERE id=?',(self.portal,))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_crm_links').fetchone()[0],0)
