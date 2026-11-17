import datetime as dt
import json
import unittest
from unittest.mock import patch

import server
from tests import test_content_workflow as fixture


class CardMetricsTest(unittest.TestCase):
    def setUp(self):
        fixture.ContentWorkflowTest.setUp(self)
        with server.CARD_METRICS_CACHE_LOCK: server.CARD_METRICS_CACHE.clear()
    tearDown = fixture.ContentWorkflowTest.tearDown

    def read(self, portal=None, card='1001', who='account'):
        return server.get_card_metrics(str(portal or self.portal),card,self.users[who])

    def ozon_context(self):
        original=server.card_metrics_context
        def context(portal,key,user):
            row,card,_=original(portal,key,user)
            return row,card,{'clientId':'123','apiKey':'ozon-secret'}
        return patch.object(server,'card_metrics_context',side_effect=context)

    def wb(self, **extra):
        return {'data':{'products':[{'product':{'nmId':1001,'feedbackRating':4.6},'statistic':{'selected':{'buyoutCount':7,'buyoutSum':1234.5,**extra}}}]}}

    def test_wb_real_counts_period_zero_and_cache(self):
        with patch.object(server,'get_service_integration_secret',return_value=''),patch.object(server,'get_wb_token_for_portal',return_value=('wb-key','encrypted')),patch.object(server,'wb_request_json',return_value=self.wb(buyoutCount=0,buyoutSum=0)) as api,patch.object(server,'fetch_wb_public_product',return_value={'id':1001,'reviewRating':4.8,'feedbacks':0}),patch.object(server,'utc_now',return_value=dt.datetime(2026,11,17,22,tzinfo=dt.timezone.utc)):
            a=self.read();b=self.read()
            self.assertEqual(a,b);self.assertEqual(api.call_count,1)
            self.assertEqual(a['period'],{'start':'2026-10-19','end':'2026-11-17'})
            self.assertEqual({k:v['value'] for k,v in a['metrics'].items()},{'sales':0,'revenue':0,'rating':4.6,'feedbacks':0})
            self.assertEqual(api.call_args.args[2]['nmIds'],[1001]);self.assertIn('pastPeriod',api.call_args.args[2])
            self.assertNotIn('wb-key',json.dumps(a))

    def test_access_and_card_scope_checked_before_any_source_even_with_cache(self):
        with patch.object(server,'get_wb_token_for_portal') as token,patch.object(server,'fetch_wb_public_product') as public:
            with self.assertRaises(PermissionError):self.read(who='other')
            with self.assertRaisesRegex(ValueError,'card_not_found'):self.read(card='9999')
            token.assert_not_called();public.assert_not_called()

    def test_malformed_or_foreign_response_is_not_reported_as_zero(self):
        with patch.object(server,'get_service_integration_secret',return_value=''),patch.object(server,'get_wb_token_for_portal',return_value=('wb-key','encrypted')),patch.object(server,'wb_request_json',return_value={'data':{'products':[{'product':{'nmId':9999},'statistic':{'selected':{'buyoutCount':999,'buyoutSum':999}}}]}}),patch.object(server,'fetch_wb_public_product',return_value={'id':9999,'feedbacks':999}):
            self.assertEqual(self.read()['metrics'],{})
        for value in (True,-1,'NaN','Infinity',{},[],None):self.assertIsNone(server.card_metric_number(value))
        self.assertIsNone(server.card_metric_number(3.5,True));self.assertIsNone(server.card_metric_number(100,maximum=5))

    def test_optional_source_failure_keeps_other_metrics_and_never_returns_error_body(self):
        with patch.object(server,'get_service_integration_secret',return_value=''),patch.object(server,'get_wb_token_for_portal',return_value=('different-key','encrypted')),patch.object(server,'wb_request_json',side_effect=server.WbApiError(403,'secret-token')),patch.object(server,'fetch_wb_public_product',return_value={'id':1001,'reviewRating':4.9,'feedbacks':18}):
            result=self.read();self.assertEqual(set(result['metrics']),{'rating','feedbacks'})
            self.assertIn({'name':'WB Analytics','status':'access_denied'},result['sources'])
            self.assertNotIn('secret-token',json.dumps(result))

    def test_access_revoked_during_fetch_does_not_release_response(self):
        def revoke(*args,**kwargs):
            with server.connect_db() as db:
                db.execute("DELETE FROM portal_members WHERE portal_id=? AND user_login='tech'",(self.portal,))
            return {'id':1001,'feedbacks':1}
        with patch.object(server,'get_service_integration_secret',return_value=''),patch.object(server,'get_wb_token_for_portal',return_value=('','missing')),patch.object(server,'fetch_wb_public_product',side_effect=revoke):
            with self.assertRaises(PermissionError):self.read(who='tech')
            with self.assertRaises(PermissionError):self.read(who='tech')

    def test_changed_credentials_discard_result_and_do_not_reuse_previous_cache(self):
        with patch.object(server,'get_wb_token_for_portal',side_effect=[('first-key','encrypted'),('second-key','encrypted'),('second-key','encrypted'),('second-key','encrypted')]),patch.object(server,'wb_request_json',return_value=self.wb()) as api,patch.object(server,'fetch_wb_public_product',return_value={'id':1001,'feedbacks':1}):
            with self.assertRaisesRegex(ValueError,'card_metrics_changed'):self.read()
            self.assertIn('sales',self.read()['metrics']);self.assertEqual(api.call_count,2)

    def test_deactivated_user_is_rechecked_before_returning_cached_metrics(self):
        with patch.object(server,'get_service_integration_secret',return_value=''),patch.object(server,'get_wb_token_for_portal',return_value=('','missing')),patch.object(server,'fetch_wb_public_product',return_value={'id':1001,'feedbacks':0}):
            self.read()
            with server.connect_db() as db:db.execute("UPDATE users SET is_active=0 WHERE login='account'")
            with self.assertRaises(PermissionError):self.read()

    def test_ozon_sku_filter_order_semantics_and_mpstats_rating(self):
        original=server.card_metrics_context
        def context(portal,key,user):
            row,card,_=original(portal,key,user)
            return row,card,{'clientId':'123','apiKey':'ozon-secret'}
        def api(client,key,path,payload,**kwargs):
            if path=='/v2/review/list':return {'reviews':[], 'has_next':False}
            self.assertEqual(path,'/v1/analytics/data');self.assertEqual(payload['filters'],[{'key':'sku','op':'EQ','value':'1001'}])
            self.assertEqual(payload['metrics'],['ordered_units','revenue'])
            return {'result':{'data':[{'dimensions':[{'id':'1001'}],'metrics':[12,2500.5]}]}}
        with patch.object(server,'card_metrics_context',side_effect=context),patch.object(server,'get_service_integration_secret',return_value='mpstats-key'),patch.object(server,'ozon_request_json',side_effect=api),patch.object(server,'mpstats_get_json',return_value={'id':1001,'rating':4.7,'comments':42}),patch.object(server,'fetch_wb_public_product') as wb:
            result=self.read(self.ozon)
            self.assertEqual({k:v['value'] for k,v in result['metrics'].items()},{'sales':12,'revenue':2500.5,'rating':4.7,'feedbacks':0})
            self.assertIn('заказано',result['salesLabel']);wb.assert_not_called()
            self.assertNotIn('ozon-secret',json.dumps(result));self.assertNotIn('mpstats-key',json.dumps(result))

    def test_missing_ozon_credentials_returns_source_status_without_zeros(self):
        with patch.object(server,'get_service_integration_secret',return_value=''):
            result=self.read(self.ozon)
            self.assertEqual(result['metrics'],{});self.assertTrue(all(s['status']=='not_connected' for s in result['sources']))

    def test_complete_primary_metrics_never_request_mpstats(self):
        with patch.object(server,'get_service_integration_secret',side_effect=AssertionError('Backup must not be opened')),patch.object(server,'get_wb_token_for_portal',return_value=('wb-key','encrypted')),patch.object(server,'wb_request_json',return_value=self.wb()),patch.object(server,'fetch_wb_public_product',return_value={'id':1001,'reviewRating':4.9,'feedbacks':2}),patch.object(server,'mpstats_get_json') as backup:
            result=self.read()
            self.assertEqual(result['metrics']['rating']['value'],4.6)
            self.assertEqual(result['metrics']['rating']['source'],'WB Analytics')
            backup.assert_not_called()

    def test_ozon_reviews_api_is_first_and_fallback_fills_only_missing_rating(self):
        calls=[]
        def api(client,key,path,payload,**kwargs):
            calls.append(path)
            if path=='/v2/review/list':return {'reviews':[{'id':'review1','sku':1001,'rating':1}], 'has_next':False}
            return {'result':{'data':[{'dimensions':[{'id':'1001'}],'metrics':[0,0]}]}}
        def backup(token,path,**kwargs):
            calls.append('MPStats')
            self.assertIn('/full?',path)
            return {'id':1001,'rating':4.8,'comments':999,'sales':999,'revenue':999}
        with self.ozon_context(),patch.object(server,'get_service_integration_secret',return_value='mpstats-key'),patch.object(server,'ozon_request_json',side_effect=api),patch.object(server,'mpstats_get_json',side_effect=backup):
            result=self.read(self.ozon)
            self.assertEqual(calls,['/v1/analytics/data','/v2/review/list','MPStats'])
            self.assertEqual({k:v['value'] for k,v in result['metrics'].items()},{'sales':0,'revenue':0,'feedbacks':1,'rating':4.8})
            self.assertEqual(result['metrics']['feedbacks']['source'],'Ozon Seller API')
            self.assertEqual(result['metrics']['sales']['source'],'Ozon Seller API')
            self.assertEqual(result['metrics']['rating']['source'],'MPStats')

    def test_ozon_denied_reviews_fall_back_without_overwriting_sales(self):
        def api(client,key,path,payload,**kwargs):
            if path=='/v2/review/list':raise server.OzonSellerError('ozon_auth_error',409)
            return {'result':{'data':[{'dimensions':[{'id':'1001'}],'metrics':[9,123]}]}}
        with self.ozon_context(),patch.object(server,'get_service_integration_secret',return_value='mpstats-key'),patch.object(server,'ozon_request_json',side_effect=api),patch.object(server,'mpstats_get_json',return_value={'id':1001,'rating':4.8,'comments':5}) as backup:
            result=self.read(self.ozon)
            self.assertEqual(result['metrics']['feedbacks']['value'],5)
            self.assertEqual(result['metrics']['feedbacks']['source'],'MPStats')
            self.assertEqual(result['metrics']['sales']['value'],9)
            self.assertEqual(backup.call_count,1)
            self.assertIn({'name':'Ozon Seller API · отзывы','status':'access_denied'},result['sources'])

    def test_missing_period_metrics_use_same_period_mpstats_and_estimate_labels(self):
        calls=[]
        def backup(token,path,**kwargs):
            calls.append(path)
            if '/full?' in path:
                self.assertIn('d1=',path);self.assertIn('d2=',path)
                return {'id':1001,'rating':4.8,'comments':5,'period_stats':{'sales':17,'revenue':170}}
            return {'id':1001,'rating':4.8,'comments':5}
        with self.ozon_context(),patch.object(server,'get_service_integration_secret',return_value='mpstats-key'),patch.object(server,'ozon_request_json',side_effect=server.OzonSellerError('ozon_auth_error',409)),patch.object(server,'mpstats_get_json',side_effect=backup):
            result=self.read(self.ozon)
            self.assertEqual(len(calls),1)
            self.assertEqual(result['metrics']['sales']['value'],17)
            self.assertTrue(result['metrics']['sales']['estimated'])
            self.assertIn('оценка MPStats',result['metrics']['revenue']['label'])

    def test_mpstats_identity_endpoint_is_not_used_for_missing_review_metrics(self):
        def api(client,key,path,payload,**kwargs):
            if path=='/v2/review/list':raise server.OzonSellerError('ozon_auth_error',409)
            return {'result':{'data':[{'dimensions':[{'id':'1001'}],'metrics':[0,0]}]}}
        def backup(token,path,**kwargs):
            self.assertIn('/items/1001/full?',path)
            return {'id':1001,'rating':4.8,'comments':12,'period_stats':{'sales':99,'revenue':999}}
        with self.ozon_context(),patch.object(server,'get_service_integration_secret',return_value='mpstats-key'),patch.object(server,'ozon_request_json',side_effect=api),patch.object(server,'mpstats_get_json',side_effect=backup) as call:
            result=self.read(self.ozon)
            self.assertEqual({k:v['value'] for k,v in result['metrics'].items()},{'sales':0,'revenue':0,'rating':4.8,'feedbacks':12})
            self.assertEqual(call.call_count,1)

    def test_mpstats_full_requires_exact_product_identity(self):
        with self.ozon_context(),patch.object(server,'get_service_integration_secret',return_value='mpstats-key'),patch.object(server,'ozon_request_json',side_effect=server.OzonSellerError('ozon_auth_error',409)),patch.object(server,'mpstats_get_json',return_value={'id':9999,'rating':4.8,'comments':12,'period_stats':{'sales':1,'revenue':100}}):
            result=self.read(self.ozon)
            self.assertEqual(result['metrics'],{})
            self.assertTrue(all(s['status']=='invalid_response' for s in result['sources'] if s['name'].startswith('MPStats')))

    def test_expired_fallback_cache_returns_to_primary_api(self):
        primary={'available':False}
        def api(client,key,path,payload,**kwargs):
            if not primary['available']:raise server.OzonSellerError('ozon_auth_error',409)
            if path=='/v2/review/list':return {'reviews':[], 'has_next':False}
            return {'result':{'data':[{'dimensions':[{'id':'1001'}],'metrics':[0,0]}]}}
        def backup(token,path,**kwargs):
            return {'id':1001,'rating':4.8,'comments':12,'period_stats':{'sales':100,'revenue':1000}}
        with self.ozon_context(),patch.object(server,'get_service_integration_secret',return_value='mpstats-key'),patch.object(server,'ozon_request_json',side_effect=api),patch.object(server,'mpstats_get_json',side_effect=backup):
            self.assertEqual(self.read(self.ozon)['metrics']['sales']['source'],'MPStats')
            with server.CARD_METRICS_CACHE_LOCK:
                for key,(_,value) in list(server.CARD_METRICS_CACHE.items()):server.CARD_METRICS_CACHE[key]=(0,value)
            primary['available']=True
            result=self.read(self.ozon)
            self.assertEqual(result['metrics']['sales']['source'],'Ozon Seller API')
            self.assertEqual(result['metrics']['sales']['value'],0)
            self.assertEqual(result['metrics']['feedbacks']['source'],'Ozon Seller API')
            self.assertEqual(result['metrics']['feedbacks']['value'],0)

    def test_broken_backup_configuration_keeps_primary_metrics(self):
        def api(client,key,path,payload,**kwargs):
            if path=='/v2/review/list':return {'reviews':[], 'has_next':False}
            return {'result':{'data':[{'dimensions':[{'id':'1001'}],'metrics':[2,100]}]}}
        with self.ozon_context(),patch.object(server,'get_service_integration_secret',side_effect=server.InvalidTag),patch.object(server,'ozon_request_json',side_effect=api):
            result=self.read(self.ozon)
            self.assertEqual({k:v['value'] for k,v in result['metrics'].items()},{'sales':2,'revenue':100,'feedbacks':0})
            self.assertIn({'name':'MPStats','status':'unavailable'},result['sources'])

    def test_bad_mpstats_does_not_discard_primary_metrics(self):
        def api(client,key,path,payload,**kwargs):
            if path=='/v2/review/list':return {'reviews':[], 'has_next':False}
            return {'result':{'data':[{'dimensions':[{'id':'1001'}],'metrics':[2,100]}]}}
        with self.ozon_context(),patch.object(server,'get_service_integration_secret',return_value='mpstats-key'),patch.object(server,'ozon_request_json',side_effect=api),patch.object(server,'mpstats_get_json',side_effect=server.MpstatsApiError(429,'private-key',True)):
            result=self.read(self.ozon)
            self.assertEqual({k:v['value'] for k,v in result['metrics'].items()},{'sales':2,'revenue':100,'feedbacks':0})
            self.assertNotIn('private-key',json.dumps(result))

    def test_plan_defaults_are_sourced_and_missing_notes_are_not_fabricated(self):
        tasks=server.workflow_plan_tasks(['margin_calculation','semantic_core_collection'],'Ozon')
        self.assertEqual(tasks[0]['description'],'для определения допустимой цены и рекламных расходов по каждому SKU.')
        self.assertEqual(tasks[1]['description'],'')
        tasks=server.workflow_plan_tasks([{'key':'margin_calculation','description':'Правка клиента'}],'Wildberries')
        self.assertEqual(tasks[0]['description'],'Правка клиента')
        self.assertIn('Wildberries',server.workflow_task_explanations('Wildberries')['keyword_positions_report'])
        self.assertNotIn('Ozon',server.workflow_task_explanations('Wildberries')['keyword_positions_report'])


class ReviewCountTest(unittest.TestCase):
    def test_paginated_sku_count_uses_complete_list_and_same_deadline(self):
        responses=[{'reviews':[{'id':'one','sku':1001}], 'has_next':True,'last_id':'cursor1'}, {'reviews':[{'id':'two','sku':1001}], 'has_next':False}]
        with patch.object(server,'ozon_request_json',side_effect=responses) as api:
            self.assertEqual(server.fetch_ozon_card_review_count({'clientId':'123','apiKey':'secret'},'1001',1234,{'portalId':7}),2)
            self.assertEqual(api.call_args_list[0].args[3]['filters'],{'sku':[1001]})
            self.assertEqual(api.call_args_list[1].args[3]['last_id'],'cursor1')
            self.assertTrue(all(c.kwargs['deadline']==1234 for c in api.call_args_list))

    def test_wrong_sku_missing_pagination_and_duplicate_ids_are_rejected(self):
        for result in [{'reviews':[{'id':'one','sku':9999}], 'has_next':False}, {'reviews':[]}, {'reviews':[{'id':'one','sku':1001},{'id':'one','sku':1001}],'has_next':False}, {'reviews':[], 'has_next':True, 'last_id':'loop'}]:
            with self.subTest(result=result),patch.object(server,'ozon_request_json',return_value=result):
                with self.assertRaises(ValueError):server.fetch_ozon_card_review_count({'clientId':'123','apiKey':'secret'},'1001',1234,{})

    def test_incomplete_pages_never_return_partial_count(self):
        first={'reviews':[{'id':'one','sku':1001}], 'has_next':True,'last_id':'cursor1'}
        with patch.object(server,'ozon_request_json',side_effect=[first,server.OzonSellerError('ozon_unavailable')]):
            with self.assertRaises(server.OzonSellerError):server.fetch_ozon_card_review_count({'clientId':'123','apiKey':'secret'},'1001',1234,{})


if __name__=='__main__':unittest.main()
