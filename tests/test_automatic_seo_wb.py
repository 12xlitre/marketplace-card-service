from copy import deepcopy
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import server
from automatic_seo import AutomaticSeoService, SeoError, competitor_sku
from automatic_seo_host import MarketplaceSeoHost, WbSeoHost
from test_automatic_seo import FakeHost, card


class MarketplaceAutomaticSeoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db = server.DB_PATH
        server.DB_PATH = Path(self.tmp.name) / 'test.sqlite3'
        self.env = patch.dict(os.environ, {server.SECRET_KEY_ENV: server.generate_secret_key()})
        self.env.start()
        server.init_db()
        with server.connect_db() as db:
            db.executemany('INSERT INTO users(login,password_hash,full_name,role,user_role,access_level) VALUES (?,?,?,?,?,?)', [
                ('owner','x','Owner','Manager','manager','overview'),
                ('anastasia.tech','x','Анастасия Руднева','Tech','tech','readonly_wb'),
                ('other','x','Other','Manager','manager','overview')])
            self.users = {r['login']: dict(r) for r in db.execute('SELECT * FROM users')}
        self.owner, self.tech = self.users['owner'], self.users['anastasia.tech']
        team = {'lead':'owner','manager':'owner','tech':'anastasia.tech'}
        self.wb = server.create_portal('WB','Wildberries','full','owner',team)
        self.ozon = server.create_portal('Ozon','Ozon','full','owner',team)
        self.other = server.create_portal('Foreign','Wildberries','full','other',{'manager':'other'})
        self.period = self.plan(self.wb)
        self.raw_cards = [{'nmID':'1001','cardKey':'1001','title':'Смеситель ТЕСТ','vendorCode':'TEST-1001'}]

    def tearDown(self):
        self.env.stop()
        server.DB_PATH = self.old_db
        self.tmp.cleanup()

    def plan(self, portal):
        return server.create_portal_work_period(portal, {'start':'2026-10-01','end':'2026-10-31',
            'tasks':[{'key':'content','label':'Контент'}]}, self.owner if portal != self.other else self.users['other'])

    def create(self, links=None):
        return server.create_workset_tasks(self.wb, self.raw_cards, self.owner,
            {'optimizationMode':'automatic','workTypes':['content'],
             'workPeriodLinks': links if links is not None else [{'periodId':self.period['id'],'taskKey':'content'}]})

    def plan_status(self, portal):
        return server.list_portal_work_periods(portal,self.owner)['periods'][0]['tasks'][0]['status']

    def test_wb_automatic_task_is_separate_from_manual_and_plan_is_atomic(self):
        server.create_workset_tasks(self.wb, self.raw_cards, self.owner, {'workTypes':['content']})
        with server.connect_db() as db:
            before = db.execute('SELECT payload_json FROM card_drafts WHERE portal_id=?',(self.wb,)).fetchone()[0]
        created = self.create()
        self.assertEqual(created['tasksCreated'],1)
        self.assertEqual(self.plan_status(self.wb),'in_progress')
        task = server.list_wb_automatic_tasks(self.wb,self.tech)['tasks'][0]
        self.assertEqual(task['optimizationMode'],'automatic')
        with server.connect_db() as db:
            self.assertEqual(db.execute('SELECT payload_json FROM card_drafts WHERE portal_id=?',(self.wb,)).fetchone()[0],before)
        with self.assertRaisesRegex(ValueError,'seo_task_already_exists'):
            self.create()

    def test_bad_or_foreign_plan_rolls_back_wb_task_creation(self):
        foreign = self.plan(self.other)
        for link in [{'periodId':foreign['id'],'taskKey':'content'}, {'periodId':self.period['id'],'taskKey':'missing'}]:
            with self.subTest(link=link), self.assertRaises(ValueError):
                self.create([link])
            self.assertEqual(server.list_wb_automatic_tasks(self.wb,self.owner)['tasks'],[])
            self.assertEqual(self.plan_status(self.wb),'planned')

    def test_ozon_creation_links_plan_and_tracks_statuses(self):
        period = self.plan(self.ozon)
        task = {'id':'task1','cardKey':'ozon:1001','sku':'1001','title':'Товар','batchId':'ozon-batch',
                'workTypes':['semantic','content'],'status':'draft'}
        result = server.save_ozon_tasks(self.ozon,{'tasks':[task],'linkBatchId':'ozon-batch',
            'workPeriodLinks':[{'periodId':period['id'],'taskKey':'content'}]},self.tech)
        self.assertEqual(self.plan_status(self.ozon),'in_progress')
        self.assertEqual(set(result['workPeriods'][0]['tasks'][0]['linkedTaskIds']),{'semantic:ozon-batch','content:ozon-batch'})
        task.update(status='done')
        server.save_ozon_tasks(self.ozon,{'tasks':[task]},self.tech)
        self.assertEqual(self.plan_status(self.ozon),'done')
        task.update(status='returned')
        server.save_ozon_tasks(self.ozon,{'tasks':[task]},self.tech)
        self.assertEqual(self.plan_status(self.ozon),'in_progress')
        server.save_ozon_tasks(self.ozon,{'tasks':[]},self.tech)
        item = server.list_portal_work_periods(self.ozon,self.owner)['periods'][0]['tasks'][0]
        self.assertEqual(item['linkedTaskIds'],[])

    def test_bad_ozon_plan_rolls_back_tasks_and_leaves_existing_data(self):
        task = {'id':'t','cardKey':'1001','sku':'1001','title':'Товар','batchId':'ozon-batch','workTypes':['content']}
        with self.assertRaisesRegex(ValueError,'work_period_not_found'):
            server.save_ozon_tasks(self.ozon,{'tasks':[task],'linkBatchId':'ozon-batch',
                'workPeriodLinks':[{'periodId':self.period['id'],'taskKey':'content'}]},self.tech)
        self.assertEqual(server.list_ozon_tasks(self.ozon,self.tech)['tasks'],[])

    def test_wb_link_cannot_be_read_or_generated_from_another_portal(self):
        self.create()
        with self.assertRaises(PermissionError):
            server.list_wb_automatic_tasks(self.wb,self.users['other'])
        with self.assertRaisesRegex(ValueError,'wb_portal_required'):
            server.create_workset_tasks(self.ozon,self.raw_cards,self.owner,{'optimizationMode':'automatic'})
        for good in ['9001','https://www.wildberries.ru/catalog/9001/detail.aspx']:
            self.assertEqual(competitor_sku(good,'Wildberries'),'9001')
        for bad in ['https://ozon.ru/product/9001/','https://www.wildberries.ru.evil.test/catalog/9001/detail.aspx',
                    'https://user@wildberries.ru/catalog/9001/detail.aspx']:
            with self.assertRaises(SeoError): competitor_sku(bad,'Wildberries')

    def test_wb_generation_download_and_approval_update_plan_without_marketplace_writes(self):
        created = self.create(); batch = created['batchId']
        service = server.automatic_seo_service()
        fake = FakeHost()
        own = card('1001'); own.update(nmID=1001,vendorCode='TEST-1001',subjectID=100)
        def mp_get(token,path,**kwargs):
            if path.endswith('/versions'):
                return [{'version':'v1','date':'2026-10-01'}]
            return {'full_name':'Конкурент ТЕСТ','description':'Смеситель для раковины — кран для умывальника.',
                    'param_names':['Материал'],'param_values':['латунь']}
        with patch.object(server,'content_reoptimization_configured',return_value=True), \
             patch.object(server,'get_service_integration_secret',return_value='test-only'), \
             patch.object(server,'get_wb_token_for_portal',return_value=('test-only','encrypted')), \
             patch.object(server,'fetch_wb_content_cards_for_publication',return_value=[own]), \
             patch.object(server,'fetch_wb_subject_characteristics',return_value={'characteristics':[{'charcID':100,'name':'Материал','charcType':1,'maxCount':1}]}), \
             patch.object(server,'mpstats_get_json',side_effect=mp_get), \
             patch.object(server,'mpstats_post_body_json',return_value={'data':{'words':[{'query':'кран для умывальника','count':38,'avg_position':3}]}}), \
             patch.object(server,'audit_llm_chat_completion',side_effect=lambda messages,**kwargs: fake.audit_llm_chat_completion(messages)), \
             patch.object(server,'ozon_request_json',side_effect=AssertionError('Ozon must not be called')), \
             patch.object(server,'wb_request_json',side_effect=AssertionError('No publication')):
            service.action(self.wb,batch,self.tech,{'action':'generate','version':0,'competitors':{'1001':'https://www.wildberries.ru/catalog/9001/detail.aspx'}})
            deadline = time.monotonic()+10
            while time.monotonic()<deadline:
                state = service.view(self.wb,batch,self.tech)
                version = state['versions'][-1]
                if version['status']!='running': break
                time.sleep(.01)
            self.assertEqual(version['status'],'review',version)
            self.assertEqual(state['marketplace'],'Wildberries')
            self.assertTrue(service.download(self.wb,batch,self.tech,1).startswith(b'PK'))
            service.action(self.wb,batch,self.tech,{'action':'accept','version':1,'acknowledgeIssues':True})
            self.assertEqual(self.plan_status(self.wb),'review')
            service.action(self.wb,batch,self.owner,{'action':'approve','version':1})
            self.assertEqual(self.plan_status(self.wb),'done')

    def test_wb_characteristics_use_wb_ids_and_limits(self):
        host = WbSeoHost(server)
        own = card('1001'); own['marketplace']='Wildberries'
        result = {'sources':{'definitions':[{'id':4180,'charcType':4,'max_value_count':1}]},
                  'characteristics':[{'id':'4180','values':['2']}]}
        host.automatic_seo_verify_characteristics(self.wb,own,result,{},self.tech)
        result['characteristics'][0]['values']=['2','3']
        with self.assertRaisesRegex(SeoError,'seo_characteristic_value_limit'):
            host.automatic_seo_verify_characteristics(self.wb,own,result,{},self.tech)


if __name__=='__main__': unittest.main()
