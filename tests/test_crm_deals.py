import json
import unittest
from unittest.mock import patch

import server
import test_content_workflow as base


class CrmDealsTest(unittest.TestCase):
    setUp=base.ContentWorkflowTest.setUp
    tearDown=base.ContentWorkflowTest.tearDown

    def configured(self):
        with server.connect_db() as db:
            db.execute("INSERT INTO workflow_people(login,bitrix_id) VALUES('account',8)")

    def row(self,identifier=123,**extra):
        return {'ID':str(identifier),'TITLE':'Клиент WB/Ozon','CATEGORY_ID':'11','ASSIGNED_BY_ID':'8',
                'CLOSED':'N','STAGE_SEMANTIC_ID':'P',**extra}

    def test_filter_and_pagination_are_enforced_on_server_and_output(self):
        self.configured()
        rows=[self.row(),self.row(124,ASSIGNED_BY_ID='99'),self.row(125,CATEGORY_ID='3'),self.row(126,CLOSED='Y')]
        with patch.object(server,'workflow_crm_request',return_value={'result':rows,'next':100}) as api:
            result=server.workflow_crm_deals(self.portal,self.users['account'],'мёд',50)
        payload=api.call_args.args[1]
        self.assertEqual(payload['filter'],{'CATEGORY_ID':11,'ASSIGNED_BY_ID':8,'CLOSED':'N','%TITLE':'мёд'})
        self.assertEqual(payload['start'],50)
        self.assertEqual([d['dealId'] for d in result['deals']],[123])
        self.assertEqual(result['next'],100);self.assertTrue(result['ownOnly'])
        self.assertNotIn('ASSIGNED_BY_ID',json.dumps(result))

    def test_numeric_search_and_completed_deals(self):
        self.configured()
        with patch.object(server,'workflow_crm_request',return_value={'result':[self.row(CLOSED='Y',STAGE_SEMANTIC_ID='S')]}) as api:
            result=server.workflow_crm_deals(self.portal,self.users['account'],'123',closed='1')
        self.assertEqual(api.call_args.args[1]['filter'],{'CATEGORY_ID':11,'ASSIGNED_BY_ID':8,'ID':123})
        self.assertEqual(result['deals'][0]['status'],'won');self.assertIsNone(result['next'])

    def test_no_mapping_never_falls_back_to_all_deals(self):
        with patch.object(server,'workflow_crm_request') as api:
            with self.assertRaisesRegex(ValueError,'crm_account_mapping_required'):
                server.workflow_crm_deals(self.portal,self.users['account'])
        api.assert_not_called()

    def test_technician_foreign_account_and_readonly_lead_cannot_list(self):
        self.configured()
        with patch.object(server,'workflow_crm_request') as api:
            for login in ['tech','other','lead']:
                with self.assertRaises(PermissionError):server.workflow_crm_deals(self.portal,self.users[login])
        api.assert_not_called()

    def test_admin_lists_category_but_global_account_still_only_own(self):
        self.configured()
        with server.connect_db() as db:db.execute("UPDATE users SET access_level='all' WHERE login='account'")
        with patch.object(server,'workflow_crm_request',return_value={'result':[]}) as api:
            self.assertTrue(server.workflow_crm_deals(self.portal,self.users['account'])['ownOnly'])
            self.assertEqual(api.call_args.args[1]['filter']['ASSIGNED_BY_ID'],8)
            self.assertFalse(server.workflow_crm_deals(self.portal,self.users['admin'])['ownOnly'])
            self.assertNotIn('ASSIGNED_BY_ID',api.call_args.args[1]['filter'])

    def test_role_or_mapping_change_while_crm_runs_discards_results(self):
        self.configured()
        def api(*args):
            with server.connect_db() as db:db.execute("UPDATE workflow_people SET bitrix_id=99 WHERE login='account'")
            return {'result':[self.row()]}
        with patch.object(server,'workflow_crm_request',side_effect=api):
            with self.assertRaisesRegex(ValueError,'workflow_version_conflict'):
                server.workflow_crm_deals(self.portal,self.users['account'])

    def test_search_and_provider_response_validation(self):
        self.configured()
        with patch.object(server,'workflow_crm_request') as api:
            for query,start,closed in [('x'*161,0,'0'),('x\ny',0,'0'),('',-1,'0'),('',1,'0'),('',1000050,'0'),('',0,'yes'),('0',0,'0')]:
                with self.assertRaisesRegex(ValueError,'crm_invalid_search'):
                    server.workflow_crm_deals(self.portal,self.users['account'],query,start,closed)
            api.assert_not_called()
        for response in [{'result':{}},{'result':[self.row(ID='invalid')]},{'result':[],'next':0},{'result':[],'next':51}]:
            with patch.object(server,'workflow_crm_request',return_value=response):
                with self.assertRaisesRegex(ValueError,'crm_invalid_response'):
                    server.workflow_crm_deals(self.portal,self.users['account'])

    def test_preview_and_bind_recheck_owner_and_category_before_contact(self):
        self.configured()
        with patch.object(server,'workflow_crm_request') as api:
            for fields,error in [({'CATEGORY_ID':'2'},'crm_deal_category_required'),({'ASSIGNED_BY_ID':'99'},'crm_deal_owner_required')]:
                api.return_value={'result':self.row(**fields)}
                for action in [lambda:server.workflow_crm_deal(123,self.users['account']),
                               lambda:server.workflow_crm_bind(self.portal,{'dealId':123},self.users['account'])]:
                    with self.assertRaisesRegex(ValueError,error):action()
                self.assertTrue(all(c.args[0]=='crm.deal.get' for c in api.call_args_list))
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_crm_links').fetchone()[0],0)

    def test_selection_does_not_create_link_until_confirmed(self):
        self.configured()
        with patch.object(server,'workflow_crm_request',return_value={'result':self.row()}),patch.object(server,'workflow_crm_hook',return_value='https://weboptimize.bitrix24.ru/rest/1/fixture/'):
            preview=server.workflow_crm_deal(123,self.users['account'])
            with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_crm_links').fetchone()[0],0)
            server.workflow_crm_bind(self.ozon,{'dealId':preview['dealId']},self.users['account'])
            with server.connect_db() as db:
                self.assertEqual(db.execute('SELECT deal_id FROM workflow_crm_links WHERE portal_id=?',(self.ozon,)).fetchone()[0],123)
                self.assertIsNone(db.execute('SELECT 1 FROM workflow_crm_links WHERE portal_id=?',(self.portal,)).fetchone())
