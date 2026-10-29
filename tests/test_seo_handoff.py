from copy import deepcopy
import json,os,tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

import server
from automatic_seo import SeoError, fingerprint
import test_automatic_seo as fixtures


class SeoHandoffTest(unittest.TestCase):
    def setUp(self):
        self.case=fixtures.AutomaticSeoTest();self.case.setUp()
        self.case.action();self.case.finish()
        self.service=self.case.service;self.host=self.case.host
        directory=self.service.directory(1,'batch')
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            try:
                with self.service.lock(directory,'run.lock',blocking=False):break
            except BlockingIOError:time.sleep(.01)
        state=self.service.load(directory);version=deepcopy(state['versions'][0]);version['number']=2
        for sku in ['1003','1004','1005']:
            self.host.tasks.append({'id':'task-'+sku,'cardKey':sku,'sku':sku,'offerId':sku,'status':'draft'})
            version['cards'].append(fixtures.card(sku))
            version['competitors'][sku]={'sku':'9001','reason':'Сопоставимы назначение и конструкция.'}
        version.update(status='running',done=3,total=5,errors=[{'sku':'1003','code':'seo_mpstats_request_failed'}])
        version.pop('sha256',None);version.pop('file',None);version.pop('finishedAt',None)
        version.pop('processedSkus',None)
        version['taskHash']=fingerprint([(t['id'],t['cardKey'],t['sku']) for t in self.host.tasks])
        state['versions'].append(version);self.service.save(directory,state)
        self.version=version;self.before={k:fingerprint(v) for k,v in version['results'].items()}
        self.host.calls=[];self.host.automatic_seo_parallelism=lambda:4

    def tearDown(self):self.case.tearDown()

    def test_parallel_resume_keeps_version_results_and_monotonic_counter(self):
        original=self.service.generate;active=0;peak=0;mutex=threading.Lock();counts=[]
        def generate(*args,**kwargs):
            nonlocal active,peak
            with mutex:active+=1;peak=max(peak,active)
            time.sleep(.03)
            try:return original(*args,**kwargs)
            finally:
                with mutex:active-=1
        update=self.service.update
        def save(directory,version,*args):
            if version['number']==2:counts.append(version['done'])
            return update(directory,version,*args)
        with patch.object(self.service,'generate',side_effect=generate),patch.object(self.service,'update',side_effect=save):
            self.service.resume(1,'batch',self.case.tech,2,self.version['taskHash'])
            finished=self.case.finish()
        self.assertEqual(finished['status'],'review',finished)
        self.assertEqual(finished['number'],2);self.assertEqual(finished['done'],5)
        self.assertEqual(finished['completedCount'],5);self.assertGreaterEqual(peak,2)
        self.assertEqual(set(self.host.calls),{'1003','1004','1005'})
        self.assertEqual(counts,sorted(counts));self.assertGreaterEqual(min(counts),3);self.assertLessEqual(max(counts),5)
        state=self.service.load(self.service.directory(1,'batch'));after=state['versions'][-1]
        self.assertEqual(len(state['versions']),2)
        self.assertTrue(all(fingerprint(after['results'][sku])==digest for sku,digest in self.before.items()))
        self.assertEqual(after['errors'],[]);self.assertEqual(after['resolvedErrors'][0]['sku'],'1003')
        manifests=list(self.service.directory(1,'batch').glob('checkpoints/*/manifest.json'))
        self.assertEqual(len(manifests),1);self.assertEqual(json.loads(manifests[0].read_text())['preservedResults'],self.before)
        self.assertEqual(manifests[0].stat().st_mode & 0o777,0o600)
        self.assertTrue(self.service.download(1,'batch',self.case.tech,2))

    def test_wrong_scope_or_second_live_resume_does_not_start_duplicate_work(self):
        with self.assertRaisesRegex(SeoError,'scope_changed'):
            self.service.resume(1,'batch',self.case.tech,2,'wrong')
        gate=threading.Event();original=self.service.generate
        def generate(*a,**kw):gate.wait(3);return original(*a,**kw)
        try:
            with patch.object(self.service,'generate',side_effect=generate):
                self.service.resume(1,'batch',self.case.tech,2,self.version['taskHash'])
                with self.assertRaisesRegex(SeoError,'already_running'):
                    self.service.resume(1,'batch',self.case.tech,2,self.version['taskHash'])
                gate.set();self.assertEqual(self.case.finish()['status'],'review')
        finally:gate.set()

    def test_split_plan_retains_every_keyword_id(self):
        keywords={f'k{i}':f'Ключ {i}' for i in range(35)}
        evidence={'ownEvidence':{'title':'Товар'},'marketplace':'Wildberries','competitor':{'description':'Текст'},
                  'competitorProfile':{'structure':['Назначение'],'phrases':[]},'keywordIds':keywords,
                  'semantic':[{'query':f'запрос {i}'} for i in range(50)],'remarks':[],'planFields':['title','characteristics','keywords']}
        seen=[]
        def chat(instruction,data,**kw):
            if 'semanticCandidates' in data:
                return {'additionalKeywords':[]}
            if data.get('keywordIds'):
                if len(data['keywordIds'])>6:raise SeoError('seo_llm_response_truncated')
                seen.extend(data['keywordIds'])
                return {'keywords':{k:{'outputPhrase':v,'reason':'Подтверждено','decision':'использовать'} for k,v in data['keywordIds'].items()}}
            return {'compatibility':{'comparable':True,'reason':'Назначение'},'title':{'value':'Товар','reason':'Факты'},'characteristics':[],'issues':[]}
        with patch.object(self.service,'chat',side_effect=chat):
            result=self.service.plan_in_parts('План',evidence,{'sku':'1003'},{})
        self.assertEqual(set(result['keywords']),set(keywords));self.assertEqual(len(seen),35)


class LlmConcurrencyTest(unittest.TestCase):
    def test_one_request_gate_is_shared_across_card_threads(self):
        active=0;peak=0;lock=threading.Lock()
        def request(*args):
            nonlocal active,peak
            with lock:active+=1;peak=max(peak,active)
            time.sleep(.02)
            with lock:active-=1
            return {},'fake','fake'
        with patch.object(server,'LLM_REQUEST_SLOTS',threading.BoundedSemaphore(1)),patch.object(server,'_audit_llm_chat_completion',side_effect=request):
            with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda _:server.audit_llm_chat_completion([]),range(8)))
        self.assertEqual(peak,1)

    def test_only_automatic_call_sets_larger_explicit_output_budget(self):
        response=unittest.mock.MagicMock();response.__enter__.return_value.read.return_value=b'{"choices":[]}'
        with patch.object(server,'OPTICARDS_LLM_PROVIDER','gigachat'),patch.object(server,'gigachat_access_token',return_value='test-only'),patch.object(server,'gigachat_urlopen',return_value=response) as call:
            server.audit_llm_chat_completion([],response_schema={'type':'object'},max_output_tokens=8192)
        self.assertEqual(json.loads(call.call_args.args[0].data)['max_tokens'],8192)

    def test_capacity_respects_personal_business_and_unknown_scopes(self):
        self.assertEqual(server.llm_request_capacity('gigachat','GIGACHAT_API_PERS'),1)
        self.assertEqual(server.llm_request_capacity('gigachat','unexpected'),1)
        self.assertEqual(server.llm_request_capacity('gigachat','GIGACHAT_API_B2B'),4)
        self.assertEqual(server.llm_request_capacity('gigachat','GIGACHAT_API_CORP'),4)


class FullPlanRecoveryTest(unittest.TestCase):
    def test_truncated_full_plan_recovers_with_all_source_keywords_and_excel(self):
        case=fixtures.AutomaticSeoTest();case.setUp();original=case.host.audit_llm_chat_completion
        def reply(messages):
            data=json.loads(messages[1]['content'])
            if data.get('keywordIds') and 'planFields' in data:
                return {'choices':[{'message':{'content':'{"too-long":'},'finish_reason':'length'}]},'fake','fake'
            if data.get('keywordIds') and 'planFields' not in data:
                answer={'keywords':{k:{'decision':'использовать','outputPhrase':v,'reason':'Подтверждено назначение'} for k,v in data['keywordIds'].items()}}
                return {'choices':[{'message':{'content':json.dumps(answer)}}]},'fake','fake'
            if 'semanticCandidates' in data:
                return {'choices':[{'message':{'content':'{"additionalKeywords":[]}'}}]},'fake','fake'
            return original(messages)
        try:
            with patch.object(case.host,'audit_llm_chat_completion',side_effect=reply):
                case.action();version=case.finish()
            self.assertEqual(version['status'],'review',version)
            state=case.service.load(case.service.directory(1,'batch'))['versions'][-1]
            self.assertTrue(all(result['keywords'] for result in state['results'].values()))
            self.assertTrue(case.service.download(1,'batch',case.tech,1))
        finally:case.tearDown()


class StartupRecoveryTest(unittest.TestCase):
    setUp = SeoHandoffTest.setUp
    tearDown = SeoHandoffTest.tearDown
    def test_startup_recovers_only_explicit_admin_intent_and_acks_terminal_status(self):
        old_db=server.DB_PATH;server.DB_PATH=Path(self.case.tmp.name)/'intent.sqlite3'
        try:
            server.init_db()
            with server.connect_db() as db:
                db.execute("INSERT INTO users(login,password_hash,full_name,role,user_role,access_level) VALUES('tech','x','Owner','Admin','admin','admin')")
                details={'phase':'requested','batchId':'batch','version':2,'taskHash':self.version['taskHash']}
                db.execute("INSERT INTO admin_events(actor_login,action,portal_id,details_json) VALUES('tech','seo_resume_requested',1,?)",(json.dumps(details),))
            with patch.object(server,'automatic_seo_service',return_value=self.service),patch.object(self.host,'automatic_seo_completed',side_effect=server.automatic_seo_completed,create=True):
                server.recover_automatic_seo_handoffs();version=self.case.finish()
                self.assertEqual(version['number'],2);self.assertEqual(version['status'],'review')
                end=time.monotonic()+3
                while time.monotonic()<end:
                    with server.connect_db() as db:phase=json.loads(db.execute('SELECT details_json FROM admin_events').fetchone()[0])['phase']
                    if phase=='finished':break
                    time.sleep(.01)
                self.assertEqual(phase,'finished')
                with patch.object(self.service,'resume') as resume:
                    server.recover_automatic_seo_handoffs();resume.assert_not_called()
        finally:server.DB_PATH=old_db
