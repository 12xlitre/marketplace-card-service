from copy import deepcopy
from io import BytesIO
import hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from openpyxl import Workbook
from automatic_seo import AutomaticSeoService,SeoError,fingerprint
import test_automatic_seo as fixtures


class PreparedReviewImportTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.host=fixtures.FakeHost();self.host.user_is_admin=lambda user:user['login']=='tech'
        self.service=AutomaticSeoService(self.host,self.root/'automatic-seo');self.user={'login':'tech'}
        self.context=self.service.context(1,'batch',self.user,edit=True)
        self.cards=[fixtures.card(t['sku']) for t in self.context['tasks']]
        self.sources={c['sku']:fixtures.sources(c,{'sku':'9001','reason':'Назначение совпадает.'}) for c in self.cards}
        self.results={}
        for card in self.cards:
            sku=card['sku'];source=self.sources[sku]
            result={'revision':'source-grounded-review-v1','title':card['title'],
                'description':card['description']+' Кран для умывальника.',
                'attributes':{'fields':{},'sourceQuestions':[]},'unplaced':[],'textProblems':[],
                'semanticDecisions':[{'query':'кран для умывальника','status':'use','field':'описание','witness':'Кран для умывальника','witnessParts':[]}],
                'quality':{'unplacedRelevantRows':0,'conditionalRows':0,'requiresSpecialistReview':True}}
            result['inputHash']=fingerprint({'revision':result['revision'],'card':card,'sources':source})
            result['outputHash']=fingerprint(result);self.results[sku]=result
        packet={'cards':self.cards,'sourcesBySku':self.sources,'sourceCapturedAt':'2026-10-29','period':{'d1':'2026-09-29','d2':'2026-10-28'}}
        b=Workbook();b.remove(b.active)
        for name in ['Итог','Семантика','Заголовки','Характеристики','Описания','Конкуренты','Противоречия','Изменения версии']:
            s=b.create_sheet(name);s.append([name]);s.append(['note']);s.append([]);s.append(['nmID'])
            if name in {'Итог','Семантика'}:
                for c in self.cards:s.append([c['sku']])
        out=BytesIO();b.save(out);self.artifact=out.getvalue();self.sha=hashlib.sha256(self.artifact).hexdigest()
        self.package={'schema':'prepared-review-v1','portal':1,'batch':'batch','previousVersion':13,
            'previousSha256':self.sha,'sha256':self.sha,'taskHash':fingerprint([(t['id'],t['cardKey'],t['sku']) for t in self.context['tasks']]),
            'sources':packet,'results':self.results,'verification':{'sha256':self.sha,'cards':2,'semanticRows':2,'unplacedRelevantRows':0,'requiresSpecialistReview':True,'auditKind':'source-rules'}}
        self.directory=self.service.directory(1,'batch');self.directory.mkdir(parents=True)
        old={'number':13,'status':'review','createdAt':'2026-11-02','sourceCapturedAt':packet['sourceCapturedAt'],'period':packet['period'],
            'done':2,'completedCount':2,'total':2,'errors':[],'issues':[],'results':{c['sku']:{'sources':self.sources[c['sku']]} for c in self.cards},
            'cards':self.cards,'competitors':{c['sku']:{'sku':'9001','reason':'Назначение совпадает.'} for c in self.cards},
            'taskHash':self.package['taskHash'],'sha256':self.sha,'file':'seo-v13.xlsx'}
        self.service.save(self.directory,{'versions':[old]});(self.directory/'seo-v13.xlsx').write_bytes(self.artifact)
        self.before=(self.directory/'state.json').read_bytes();self.oldrows=json.loads(self.before)['versions']
        self.stage()

    def tearDown(self):self.temp.cleanup()

    def stage(self):
        raw=json.dumps(self.package,ensure_ascii=False).encode();identifier=hashlib.sha256(raw).hexdigest()
        self.staged=self.root/'seo-review-imports'/'1'/identifier;self.staged.mkdir(parents=True,exist_ok=True)
        (self.staged/'manifest.json').write_bytes(raw);(self.staged/'report.xlsx').write_bytes(self.artifact)
        self.payload={'action':'import_review','version':13,'importId':identifier}

    def test_append_download_and_repeat_keep_old_version_and_no_generation(self):
        view=self.service.action(1,'batch',self.user,self.payload)
        self.assertEqual(view['versions'][-1]['number'],14);self.assertEqual(view['versions'][-1]['status'],'review')
        self.assertTrue(view['versions'][-1]['quality']['requiresSpecialistReview'])
        self.assertEqual(self.service.download(1,'batch',self.user,14),self.artifact)
        self.assertEqual(json.loads((self.directory/'state.json').read_text())['versions'][:-1],self.oldrows)
        self.assertEqual(len(self.service.action(1,'batch',self.user,self.payload)['versions']),2)
        self.assertEqual(self.host.calls,[]);self.assertEqual(self.host.statuses,[])

    def test_technician_cannot_import_and_another_portal_is_denied(self):
        self.host.user_is_admin=lambda user:False
        with self.assertRaises(PermissionError):self.service.action(1,'batch',self.user,self.payload)
        with self.assertRaises(PermissionError):self.service.action(2,'batch',self.user,self.payload)
        self.assertEqual((self.directory/'state.json').read_bytes(),self.before)

    def test_reject_changed_source_before_any_append(self):
        self.package['sources']['cards']=deepcopy(self.cards)
        self.package['sources']['cards'][0]['title']='Чужой товар';self.stage()
        with self.assertRaisesRegex(SeoError,'seo_review_import_source_mismatch'):
            self.service.action(1,'batch',self.user,self.payload)
        self.assertEqual((self.directory/'state.json').read_bytes(),self.before)

    def test_reject_changed_binary_wrong_scope_and_stale_version(self):
        (self.staged/'report.xlsx').write_bytes(b'PK\x03\x04wrong')
        with self.assertRaisesRegex(SeoError,'seo_file_verification_failed'):
            self.service.action(1,'batch',self.user,self.payload)
        self.stage();self.package['portal']=2;self.stage()
        with self.assertRaisesRegex(SeoError,'seo_review_import_scope_mismatch'):
            self.service.action(1,'batch',self.user,self.payload)
        self.assertEqual((self.directory/'state.json').read_bytes(),self.before)

    def test_validate_only_does_not_append(self):
        result=self.service.action(1,'batch',self.user,dict(self.payload,validateOnly=True))
        self.assertEqual(result['preparedImport']['version'],14)
        self.assertEqual((self.directory/'state.json').read_bytes(),self.before)
        self.assertFalse((self.directory/'seo-v14.xlsx').exists())

    def test_import_reads_source_cache_without_materializing_old_model_responses(self):
        from automatic_seo import SeoObjects
        raw={'words':[{'query':'исходный запрос'}]}
        digest=SeoObjects(self.directory).put(raw)
        path=self.directory/'state.json';packed=json.loads(path.read_text())
        packed['versions'][-1]['_cacheEntries']={'wb-keywords:1001:period':digest,'response:old-model':'f'*64}
        path.write_text(json.dumps(packed));old=deepcopy(packed['versions'])
        self.service.action(1,'batch',self.user,self.payload)
        self.assertEqual(json.loads(path.read_text())['versions'][:-1],old)
        cache=self.service.load(self.directory)['versions'][-1]['cache']
        self.assertEqual(set(cache),{'wb-keywords:1001:period'})
        self.assertEqual(cache['wb-keywords:1001:period'],raw)

    def test_busy_batch_and_symlink_are_rejected(self):
        with self.service.lock(self.directory,'run.lock'):
            with self.assertRaisesRegex(SeoError,'seo_already_running'):
                self.service.action(1,'batch',self.user,self.payload)
        (self.staged/'report.xlsx').unlink();(self.staged/'report.xlsx').symlink_to(self.directory/'seo-v13.xlsx')
        with self.assertRaisesRegex(SeoError,'seo_review_import_invalid'):
            self.service.action(1,'batch',self.user,self.payload)

    def test_failed_metadata_save_restores_previous_history_and_file(self):
        metadata=(self.directory/'metadata.json').read_bytes()
        with patch.object(self.service,'save',side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):self.service.action(1,'batch',self.user,self.payload)
        self.assertEqual((self.directory/'state.json').read_bytes(),self.before)
        self.assertEqual((self.directory/'metadata.json').read_bytes(),metadata)
        self.assertFalse((self.directory/'seo-v14.xlsx').exists())

    def test_prune_removes_old_files_and_unreferenced_objects_keeps_sources_and_next_number(self):
        self.service.action(1,'batch',self.user,self.payload)
        before=self.service.load(self.directory)['versions'][-1]
        expected={k:deepcopy(before[k]) for k in ('cards','results','cache','sha256')}
        from automatic_seo import SeoObjects
        orphan=SeoObjects(self.directory).put({'oldResponse':'unused'})
        other=self.service.directory(1,'another-batch');other.mkdir(parents=True)
        (other/'seo-v1.xlsx').write_bytes(b'other report')
        view=self.service.action(1,'batch',self.user,{'action':'prune_history','version':14})
        self.assertEqual([v['number'] for v in view['versions']],[14])
        self.assertEqual(view['pruning']['removedVersions'],[13])
        self.assertEqual(view['pruning']['pendingFiles'],0)
        self.assertGreater(view['pruning']['freedBytes'],0)
        self.assertFalse((self.directory/'seo-v13.xlsx').exists())
        self.assertFalse((self.directory/'objects'/(orphan+'.json')).exists())
        self.assertFalse((self.directory/'checkpoints').exists())
        self.assertFalse((self.directory/'state-before-object-storage.json').exists())
        self.assertEqual((other/'seo-v1.xlsx').read_bytes(),b'other report')
        current=self.service.load(self.directory)['versions'][0]
        self.assertEqual({k:current[k] for k in expected},expected)
        self.assertEqual(self.service.download(1,'batch',self.user,14),self.artifact)
        with self.assertRaisesRegex(SeoError,'seo_report_missing'):
            self.service.download(1,'batch',self.user,13)
        self.service.action(1,'batch',self.user,{'action':'prune_history','version':14})
        self.assertEqual(self.service.download(1,'batch',self.user,14),self.artifact)
        with patch('automatic_seo.threading.Thread') as thread:
            thread.return_value.start.side_effect=lambda:thread.call_args.kwargs['args'][-1].close()
            result=self.service.action(1,'batch',self.user,{'action':'generate','version':14})
        self.service.slots.release()
        self.assertEqual(result['versions'][-1]['number'],15)

    def test_prune_checks_admin_scope_version_lock_and_file(self):
        self.service.action(1,'batch',self.user,self.payload)
        payload={'action':'prune_history','version':14}
        self.host.user_is_admin=lambda user:False
        with self.assertRaises(PermissionError):self.service.action(1,'batch',self.user,payload)
        self.host.user_is_admin=lambda user:True
        with self.assertRaises(PermissionError):self.service.action(2,'batch',self.user,payload)
        with self.assertRaisesRegex(SeoError,'seo_version_conflict'):
            self.service.action(1,'batch',self.user,dict(payload,version=13))
        with self.service.lock(self.directory,'run.lock'):
            with self.assertRaisesRegex(SeoError,'seo_already_running'):
                self.service.action(1,'batch',self.user,payload)
        (self.directory/'seo-v14.xlsx').write_bytes(b'corrupted')
        with self.assertRaisesRegex(SeoError,'seo_file_verification_failed'):
            self.service.action(1,'batch',self.user,payload)
        self.assertTrue((self.directory/'seo-v13.xlsx').exists())

    def test_prune_rejects_symlink_and_restores_state_on_failed_save(self):
        self.service.action(1,'batch',self.user,self.payload)
        payload={'action':'prune_history','version':14};before=(self.directory/'state.json').read_bytes()
        outside=self.root/'private';outside.write_bytes(b'preserve')
        link=self.directory/'checkpoints'/'external';link.symlink_to(outside)
        with self.assertRaisesRegex(SeoError,'seo_snapshot_invalid'):
            self.service.action(1,'batch',self.user,payload)
        self.assertEqual(outside.read_bytes(),b'preserve');link.unlink()
        with patch.object(self.service,'save',side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):self.service.action(1,'batch',self.user,payload)
        self.assertEqual((self.directory/'state.json').read_bytes(),before)
        self.assertTrue((self.directory/'seo-v13.xlsx').exists())


if __name__=='__main__':unittest.main()
