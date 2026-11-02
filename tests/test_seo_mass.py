from copy import deepcopy
import json
import unittest
from unittest.mock import patch

import test_automatic_seo as fixtures
from test_seo_ready import response
from automatic_seo import SeoError, fingerprint, unsupported_text_properties


class MassComparisonTest(unittest.TestCase):
    def setUp(self):
        self.case=fixtures.AutomaticSeoTest();self.case.setUp();self.addCleanup(self.case.tearDown)
        self.service,self.host=self.case.service,self.case.host
        self.card=fixtures.card('1001');self.sources=fixtures.sources(self.card,self.case.mapping['1001'])
        self.sources['semantic'] += [{'query':'запрос '+str(i),'source':'MPStats','count':i,'position':None} for i in range(1000)]
        self.profile={'structure':['Назначение','Материал'],'phrases':[{'phrase':'кран для умывальника','quote':'кран для умывальника'}]}
        self.cache={'_massComparisonWorkflow':True,'_readyWorkflowV2':True}
        key='profile:ready-title-description-v3:'+fingerprint({k:v for k,v in self.sources['competitor'].items() if k!='reason'})
        self.cache[key]=deepcopy(self.profile)
        self.calls=[]

    def answer(self,messages):
        data=json.loads(messages[1]['content']);self.calls.append(data)
        if data.get('sku')==self.sources['competitor']['sku']:
            return response(self.profile)
        if 'keywordIds' in data:
            self.assertIn('mpstatsEvidence',data)
            return response({'keywords':{'K0':{'outputPhrase':'кран для умывальника','decision':'использовать',
                'reason':'Назначение смесителя соответствует собственному описанию изделия.', 'factIds':['F1']}}})
        if 'selectedMeanings' in data and 'competitorDescription' in data:
            return response({'title':{'value':'Смеситель для раковины ТЕСТ, латунь',
                    'reason':'Название сохраняет назначение, собственный бренд и латунный материал товара.'},
                'description':{'value':'**Латунный кран для умывальника ТЕСТ** подходит для раковины.',
                    'reason':'Описание полностью переписано по структуре конкурента с сохранением собственных фактов.'},
                'placements':{'K0':'кран для умывальника'}})
        if 'finalTexts' in data:
            self.assertIn('selectedMeanings',data);self.assertIn('retainedCharacteristics',data)
            return response({'ready':True,'problems':[],'sourceQuestions':[],
                'keywordBindings':{key:next(identifier for identifier,text in data['finalTexts'].items() if text.startswith('описание:')) for key in data['selectedMeanings']}})
        raise AssertionError('Unexpected stage: '+str(data.keys()))

    def test_full_comparison_and_rewrite_does_not_send_raw_query_batches_to_model(self):
        with patch.object(self.host,'audit_llm_chat_completion',side_effect=self.answer):
            result=self.service.generate_mass(self.card,self.sources,[],None,self.cache)
        self.assertEqual(len(self.calls),3)
        self.assertFalse(any('queries' in data or 'newCodes' in data or 'sampleQueries' in data for data in self.calls))
        self.assertEqual(result['quality']['revision'],4)
        self.assertEqual(result['quality']['checkedQueries'],1001)
        self.assertEqual([row['query'] for row in result['semanticDecisions']],[row['query'] for row in self.sources['semantic']])
        self.assertTrue(all(row['measurementOnly'] for row in result['semanticDecisions']))
        self.assertNotEqual(result['description']['value'],self.card['description'])
        self.assertNotIn('**',result['description']['value'])
        self.assertEqual(result['comparison'][0]['action'],'использовать')
        self.service.verify_ready_result(self.card,result)
        changed=deepcopy(result);changed['description']['value']+=' Постороннее утверждение.'
        with self.assertRaisesRegex(SeoError,'seo_content_repair_incomplete'):
            self.service.verify_ready_result(self.card,changed)
        changed=deepcopy(result);changed['sources']['semantic'][0]['count']=12345
        with self.assertRaisesRegex(SeoError,'seo_content_repair_incomplete'):
            self.service.verify_ready_result(self.card,changed)
        self.result=result

    def test_mass_export_keeps_eight_sheets_all_measurements_and_full_rewrite(self):
        from automatic_seo_xlsx import build_workbook
        from openpyxl import load_workbook
        with patch.object(self.host,'audit_llm_chat_completion',side_effect=self.answer):
            result=self.service.generate_mass(self.card,self.sources,[],None,self.cache)
        self.case.action();self.case.finish()
        version=deepcopy(self.service.load(self.service.directory(1,'batch'))['versions'][0])
        version.update(cards=[self.card],results={'1001':result},workflowRevision=4,quality={'state':'ready'})
        path=self.service.root/'mass.xlsx';build_workbook(path,version)
        workbook=load_workbook(path,rich_text=True)
        self.assertEqual(len(workbook.sheetnames),8)
        self.assertEqual(workbook['Описания'].cell(4,4).value,'Полный рерайт описания')
        self.assertEqual(str(workbook['Описания'].cell(5,4).value),result['description']['value'])
        self.assertIn('Сравнение',workbook['Конкуренты'].cell(4,9).value)
        self.assertEqual(workbook['Семантика'].max_row,1001+4)
        self.assertEqual(workbook['Семантика'].cell(6,7).value,'Нет точного вхождения')

    def test_reviewer_binds_real_title_quote_and_ignores_writer_placement(self):
        def answer(messages):
            data=json.loads(messages[1]['content'])
            if 'competitorDescription' in data:
                return response({'title':{'value':'Латунный кран для умывальника ТЕСТ',
                    'reason':'Заголовок содержит собственное назначение и материал изделия.'},
                    'description':{'value':'Смеситель ТЕСТ изготовлен из латуни и подходит для раковины.',
                    'reason':'Самостоятельный текст передаёт подтверждённые материал и назначение.'},
                    'placements':{'K0':'ВЫДУМАННАЯ ЦИТАТА'}})
            if 'finalTexts' in data:
                return response({'ready':True,'problems':[],'sourceQuestions':[], 'keywordBindings':{'K0':'T0'}})
            return self.answer(messages)
        with patch.object(self.host,'audit_llm_chat_completion',side_effect=answer):
            result=self.service.generate_mass(self.card,self.sources,[],None,self.cache)
        self.assertEqual(result['keywords'][0]['destination'],'заголовок')
        self.assertEqual(result['keywords'][0]['outputPhrase'],result['title']['value'])
        self.assertNotIn('ВЫДУМАННАЯ',json.dumps(result,ensure_ascii=False))
        self.service.verify_mass_result(self.card,result)

    def test_missing_meaning_and_invalid_reviewer_ids_cannot_be_ready(self):
        for binding,code in [('MISSING','seo_content_repair_incomplete'),('T999','seo_invalid_content_audit'),
                             ({'quote':'выдумано'},'seo_invalid_content_audit')]:
            def answer(messages):
                data=json.loads(messages[1]['content'])
                if 'finalTexts' in data:
                    return response({'ready':True,'problems':[],'sourceQuestions':[], 'keywordBindings':{'K0':binding}})
                return self.answer(messages)
            with self.subTest(binding=binding), patch.object(self.host,'audit_llm_chat_completion',side_effect=answer):
                with self.assertRaisesRegex(SeoError,code):
                    self.service.generate_mass(self.card,self.sources,[],None,deepcopy(self.cache))

    def test_plate_shape_is_bound_to_its_object(self):
        own='Тарелка плоская 21,6см - 6шт; глубокие салатники - 6шт'
        self.assertTrue(unsupported_text_properties('Шесть глубоких обеденных тарелок.',own))
        self.assertFalse(unsupported_text_properties('Плоские тарелки и глубокие салатники.',own))
        self.assertFalse(unsupported_text_properties('Глубокие тарелки.',own+'; глубокие тарелки - 6шт'))
        self.assertTrue(unsupported_text_properties('Серые рукоятки ножей.', 'Молочная подставка. Пластиковые рукояти.'))
        self.assertFalse(unsupported_text_properties('Серые рукоятки ножей.', 'Рукояти серого цвета.'))

    def test_disputed_total_is_removed_before_independent_audit(self):
        conflict={'claims':['18 предметов','16 шт.'],'factIds':['F0','F1'],
            'issue':{'field':'Количество предметов','detail':'В источниках 18 и 16.',
                'question':'Сколько предметов: 18 или 16?','blocking':False}}
        self.assertEqual(self.service.neutral_ready_facts('Набор 16 предметов; 18 шт.',[conflict]),'Набор.')
        writes=[];audits=[]
        def answer(messages):
            data=json.loads(messages[1]['content'])
            if 'competitorDescription' in data:
                writes.append(data)
                if len(writes)==1:
                    return response({'title':{'value':self.card['title'],'reason':'Заголовок сохраняет назначение товара.'},
                        'description':{'value':'В набор входят 18 предметов.', 'reason':'Полный рерайт под собственный товар.'}})
            if 'finalTexts' in data:audits.append(data)
            return self.answer(messages)
        with patch.object(self.service,'ready_source_conflicts',return_value=[conflict]), \
             patch.object(self.host,'audit_llm_chat_completion',side_effect=answer):
            result=self.service.generate_mass(self.card,self.sources,[],None,self.cache)
        self.assertEqual(len(writes),2)
        self.assertEqual(len(audits),1)
        self.assertIn('disputedClaims',writes[0])
        self.assertTrue(any(row['kind']=='conflicting_source' for row in writes[1]['problems']))

    def test_only_matching_schema_echo_may_precede_json_answer(self):
        from automatic_seo import schema_object, TEXT
        schema=schema_object({'value':TEXT});answer={'value':'Готовое описание'}
        echo=deepcopy(schema);echo.pop('required');echo.pop('additionalProperties')
        self.assertEqual(self.service.parse_response_json(json.dumps(echo)+'\n'+json.dumps(answer),schema),answer)
        for prefix in [{'value':'Первый ответ'},{'type':'object','properties':{'other':TEXT}}]:
            with self.assertRaises(ValueError):
                self.service.parse_response_json(json.dumps(prefix)+'\n'+json.dumps(answer),schema)
        with self.assertRaises(ValueError):
            self.service.parse_response_json(json.dumps(echo)+'\n'+json.dumps(answer)+'\n{}',schema)

    def test_new_mass_repair_rewrites_old_ready_results_and_preserves_all_frozen_sources(self):
        self.case.action();self.case.finish()
        directory=self.service.directory(1,'batch');state=self.service.load(directory)
        original=state['versions'][0];original_hash=fingerprint(original['results'])
        partial=deepcopy(original);partial['number']=2;partial['status']='partial'
        partial['results'].pop('1002');partial['results']['1001']['quality']={'state':'ready','revision':3}
        partial['errors']=[{'sku':'1002','code':'old_failure'}];partial.pop('sha256',None)
        state['versions'].append(partial);self.service.save(directory,state)
        self.host.automatic_seo_mass_workflow=lambda:True
        with patch.object(self.host,'audit_llm_chat_completion',side_effect=self.answer), \
             patch.object(self.host,'automatic_seo_sources',side_effect=AssertionError('frozen sources must be preserved')):
            launched=self.case.action(action='repair',version=2,refreshSources=False)
            final=self.case.finish()
        self.assertEqual(final['status'],'review',final)
        self.assertEqual(final['workflowRevision'],4)
        self.assertEqual(final['continuation']['preservedCount'],0)
        self.assertEqual(final['completedCount'],2)
        after=self.service.load(directory)
        self.assertTrue(all(row['quality']['revision']==4 for row in after['versions'][-1]['results'].values()))
        self.assertEqual(fingerprint(after['versions'][0]['results']),original_hash)
        self.assertLess(len(self.calls),12)

if __name__=='__main__':unittest.main()
