import http.client
import json
import threading
import unittest
from unittest.mock import patch

import server
import test_content_workflow as base


class CrmOnboardingTest(unittest.TestCase):
    def setUp(self):
        base.ContentWorkflowTest.setUp(self)
        with server.connect_db() as db:
            db.execute("INSERT INTO workflow_people(login,bitrix_id) VALUES('account',8)")
            self.cookies={login:f'{server.SESSION_COOKIE}={server.create_session(db,row["id"])}' for login,row in self.users.items()}
        self.calls=[]
        self.crm_patch=patch.object(server,'workflow_crm_request',side_effect=self.crm)
        self.hook_patch=patch.object(server,'workflow_crm_hook',return_value='https://weboptimize.bitrix24.ru/rest/1/fixture/')
        self.crm_patch.start();self.hook_patch.start()
        self.httpd=server.ThreadingHTTPServer(('127.0.0.1',0),server.OpticardsHandler)
        self.thread=threading.Thread(target=self.httpd.serve_forever,daemon=True);self.thread.start()
        server.OZON_CONNECTION_NEXT_CHECK.clear()

    def tearDown(self):
        self.httpd.shutdown();self.httpd.server_close();self.thread.join(3)
        self.crm_patch.stop();self.hook_patch.stop()
        server.OZON_CONNECTION_NEXT_CHECK.clear()
        base.ContentWorkflowTest.tearDown(self)

    def crm(self,method,payload=None):
        self.calls.append((method,payload))
        deal={'ID':'123','TITLE':'Сопровождение','CATEGORY_ID':'11','ASSIGNED_BY_ID':'8','CONTACT_ID':'99','COMPANY_ID':'77','CLOSED':'N'}
        return {'result':{'crm.deal.get':deal,'crm.deal.list':[deal],
            'crm.contact.get':{'NAME':'Анна','LAST_NAME':'Иванова','PHONE':[{'VALUE':'+70000000000'}],'EMAIL':[{'VALUE':'contact@example.invalid'}]},
            'crm.company.get':{'TITLE':'ООО Клиент','PHONE':[{'VALUE':'+71111111111'}],'EMAIL':[{'VALUE':'company@example.invalid'}]}}[method]}

    def request(self,login,method,path,payload=None):
        client=http.client.HTTPConnection(*self.httpd.server_address,timeout=10)
        client.request(method,path,json.dumps(payload) if payload is not None else None,{'Content-Type':'application/json',**({'Cookie':self.cookies[login]} if login else {})})
        response=client.getresponse();result=(response.status,json.loads(response.read()));client.close();return result

    def payload(self,market='Wildberries',mode='manual',**extra):
        return {'name':'CRM кабинет','marketplace':market,'mode':mode,'scope':'full','teamRoles':{'manager':'account','tech':'tech'},'crmDealId':123,**extra}

    def test_listing_before_creation_keeps_responsible_filter_and_admin_scope(self):
        for login in ('account','admin'):
            status,value=self.request(login,'GET','/api/content-workflow/crm-deals')
            self.assertEqual(status,200,value);self.assertEqual(value['ownOnly'],login=='account')
            filters=self.calls[-1][1]['filter'];self.assertEqual(filters['CATEGORY_ID'],11)
            self.assertEqual(filters.get('ASSIGNED_BY_ID'),8 if login=='account' else None)
        self.calls.clear()
        for login in ('tech',None):
            status,_=self.request(login,'GET','/api/content-workflow/crm-deals')
            self.assertEqual(status,403 if login else 401)
        self.assertEqual(self.calls,[])

    def test_preview_reads_contact_and_company_without_sending_messages(self):
        status,value=self.request('account','POST','/api/content-workflow/crm-preview',{'dealId':123})
        self.assertEqual(status,200,value)
        self.assertEqual(value['clientName'],'ООО Клиент');self.assertEqual(value['clientContact']['name'],'Анна Иванова')
        self.assertEqual(value['clientContact']['email'],'contact@example.invalid')
        self.assertEqual(value['clientContact']['phone'],'+70000000000')
        self.assertEqual([m for m,_ in self.calls],['crm.deal.get','crm.contact.get','crm.company.get'])
        for login in ('tech',None):
            self.assertEqual(self.request(login,'POST','/api/content-workflow/crm-preview',{'dealId':123})[0],403 if login else 401)

    def test_missing_values_stay_empty_and_company_is_only_phone_email_fallback(self):
        original=self.crm
        def api(method,payload=None):
            if method=='crm.contact.get':return {'result':{'NAME':'Анна'}}
            return original(method,payload)
        with patch.object(server,'workflow_crm_request',side_effect=api):
            value=server.workflow_crm_preview(None,{'dealId':123},self.users['account'])
        self.assertEqual(value['clientContact']['email'],'company@example.invalid')
        self.assertEqual(value['clientContact']['phone'],'+71111111111')

    def test_manual_wb_and_ozon_save_company_contact_and_link_together(self):
        for market in ('Wildberries','Ozon'):
            status,value=self.request('account','POST','/api/portals',self.payload(market))
            self.assertEqual(status,201,value);portal=value['portal']
            self.assertEqual(portal['clientName'],'ООО Клиент');self.assertEqual(portal['clientContact']['name'],'Анна Иванова')
            status,binding=self.request('account','GET','/api/content-workflow/crm-binding?portalId='+str(portal['id']))
            self.assertEqual(status,200,binding);self.assertEqual(binding['link']['dealId'],123)
        self.assertFalse(any(method=='crm.activity.add' for method,_ in self.calls))

    def test_both_api_creation_paths_keep_reviewed_contacts_and_binding(self):
        snapshot={'cards':[base.CARD],'stats':{'cardCount':1},'tokenMeta':{}}
        ozon={'cards':[{'id':'71','sku':'9001','productId':'71','offerId':'OFFER','title':'Товар','marketplace':'ozon','issueCount':0}],'productCount':1,'loadedAt':'2026-11-10T12:00:00+00:00'}
        with patch.object(server,'fetch_wb_cards',return_value=snapshot),patch.object(server,'fetch_ozon_seller_cards',return_value=ozon):
            for market in ('Wildberries','Ozon'):
                status,value=self.request('account','POST','/api/portals',self.payload(market,'api',apiKey='x'*32,clientId='12345',clientName='Исправленное название',clientContact=base.CONTACT))
                self.assertEqual(status,201,value);self.assertEqual(value['portal']['clientName'],'Исправленное название')
                self.assertEqual(value['portal']['clientContact'],{**base.CONTACT,'comment':''})
                with server.connect_db() as db:self.assertEqual(db.execute('SELECT deal_id FROM workflow_crm_links WHERE portal_id=?',(value['portal']['id'],)).fetchone()[0],123)

    def test_foreign_or_revoked_deal_cannot_create_empty_cabinet_or_call_marketplace(self):
        with server.connect_db() as db:
            before=db.execute('SELECT COUNT(*) FROM portals').fetchone()[0]
            db.execute("UPDATE workflow_people SET bitrix_id=999 WHERE login='account'")
        with patch.object(server,'fetch_wb_cards') as wb:
            status,value=self.request('account','POST','/api/portals',self.payload(mode='api',apiKey='x'*32))
        self.assertEqual(status,403,value);wb.assert_not_called()
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM portals').fetchone()[0],before)
        self.assertEqual([m for m,_ in self.calls],['crm.deal.get'])

    def test_transaction_rolls_back_if_account_mapping_changes_during_api_check(self):
        with server.connect_db() as db:before=db.execute('SELECT COUNT(*) FROM portals').fetchone()[0]
        def fetch(*args,**kwargs):
            with server.connect_db() as db:db.execute("UPDATE workflow_people SET bitrix_id=999 WHERE login='account'")
            return {'cards':[base.CARD],'stats':{'cardCount':1},'tokenMeta':{}}
        with patch.object(server,'fetch_wb_cards',side_effect=fetch):
            status,value=self.request('account','POST','/api/portals',self.payload(mode='api',apiKey='x'*32))
        self.assertEqual(status,403,value)
        with server.connect_db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM portals').fetchone()[0],before)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_crm_links').fetchone()[0],0)

    def test_api_encryption_failure_rolls_back_binding_and_cabinet_for_both_markets(self):
        snapshot={'cards':[base.CARD],'stats':{'cardCount':1},'tokenMeta':{}}
        ozon={'cards':[],'productCount':0,'loadedAt':'2026-11-10T12:00:00+00:00'}
        with server.connect_db() as db:before=db.execute('SELECT COUNT(*) FROM portals').fetchone()[0]
        with patch.object(server,'fetch_wb_cards',return_value=snapshot),patch.object(server,'fetch_ozon_seller_cards',return_value=ozon),patch.object(server,'encrypt_secret',side_effect=RuntimeError('secret_storage_unavailable')):
            for market in ('Wildberries','Ozon'):
                status,value=self.request('account','POST','/api/portals',self.payload(market,'api',apiKey='x'*32,clientId='12345'))
                self.assertEqual(status,500,value)
                with server.connect_db() as db:
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM portals').fetchone()[0],before)
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_crm_links').fetchone()[0],0)

    def test_preview_does_not_return_contacts_after_role_revocation(self):
        original=self.crm
        def api(method,payload=None):
            if method=='crm.company.get':
                with server.connect_db() as db:db.execute("UPDATE users SET is_active=0 WHERE login='account'")
            return original(method,payload)
        with patch.object(server,'workflow_crm_request',side_effect=api):
            status,value=self.request('account','POST','/api/content-workflow/crm-preview',{'dealId':123})
        self.assertEqual(status,403);self.assertEqual(value,{'error':'forbidden'})

    def test_settings_import_is_explicit_scoped_and_rolls_back_invalid_contacts(self):
        payload={'portalId':self.portal,'action':'link_deal','dealId':123,'importContacts':True,'clientName':'Название после проверки','clientContact':base.CONTACT}
        status,value=self.request('account','POST','/api/content-workflow',payload)
        self.assertEqual(status,200,value)
        with server.connect_db() as db:
            self.assertEqual(db.execute('SELECT client_name FROM portals WHERE id=?',(self.portal,)).fetchone()[0],'Название после проверки')
            self.assertEqual(db.execute('SELECT client_name FROM portals WHERE id=?',(self.ozon,)).fetchone()[0],'')
            link=db.execute('SELECT id FROM workflow_crm_links WHERE portal_id=?',(self.portal,)).fetchone()[0]
        status,value=self.request('account','POST','/api/content-workflow',{**payload,'previousLinkId':link,'clientContact':{}})
        self.assertEqual(status,400,value)
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT id FROM workflow_crm_links WHERE portal_id=?',(self.portal,)).fetchone()[0],link)
        self.assertEqual(self.request('other','GET','/api/content-workflow/crm-binding?portalId='+str(self.portal))[0],403)


if __name__=='__main__':unittest.main()
