import base64
from concurrent.futures import ThreadPoolExecutor
import io
import hashlib
import importlib.util
import json
import unittest
from unittest.mock import patch
import zlib

from pypdf import PdfReader
import server
import test_content_workflow as fixture


def data(**extra):
    return {'title':'Только нужные работы','start':'2026-11-01','end':'2026-11-30','contact':fixture.CONTACT,'cardKeys':['1001'],
            'tasks':[{'key':'supplier_matrix_analysis','label':'Анализ матрицы поставщика','description':'Проверить <приоритетные> товары & результат.'}],
            'presentation':{'customer':'ООО Новый клиент','manager':{'name':'Анна Иванова','email':'anna@example.invalid','phone':'+7 (900) 111-22-33'}},**extra}


class OriginalPdfTest(unittest.TestCase):
    def render(self,value):return server.workflow_plan_pdf(value,1,'Ozon')
    def test_original_pages_and_dynamic_fields_contain_no_sample_personal_data(self):
        reader=PdfReader(io.BytesIO(self.render(data())))
        self.assertEqual(len(reader.pages),4)
        text='\n'.join(page.extract_text() for page in reader.pages)
        for expected in ['ООО Новый клиент','01.11.26-30.11.26','Ноябрь 2026','Анна Иванова','anna@example.invalid','+7 (900) 111-22-33','Проверить <приоритетные> товары & результат.']:
            self.assertIn(expected,text)
        for forbidden in ['Левина','Дементьева','svetlana@','969','HR3101','Вожжей','WebOptimize ·','Согласование этой версии','Версия 1']:
            self.assertNotIn(forbidden,text)
        self.assertEqual(float(reader.pages[0].mediabox.width),595.5)

    @unittest.skipUnless(importlib.util.find_spec('pymupdf'), 'Optional visual PDF acceptance reader')
    def test_original_static_page_and_artwork_are_preserved(self):
        import pymupdf
        template=pymupdf.open(stream=zlib.decompress(base64.b64decode(server.WORKFLOW_PDF_TEMPLATE_ASSETS['pdf'])),filetype='pdf')
        result=pymupdf.open(stream=self.render(data()),filetype='pdf')
        for source_index,target_index,rects in [(0,0,[(175,383,590,515)]),(1,1,[]),(3,3,[(215,205,590,299)])]:
            expected=template[source_index].get_pixmap();actual=result[target_index].get_pixmap()
            self.assertEqual((expected.width,expected.height),(actual.width,actual.height))
            a=bytearray(expected.samples);b=bytearray(actual.samples)
            for x1,y1,x2,y2 in rects:
                for y in range(y1,y2):
                    start=(y*expected.width+x1)*expected.n;end=(y*expected.width+x2)*expected.n
                    a[start:end]=b[start:end]=b'\xff'*(end-start)
            self.assertEqual(hashlib.sha256(a).hexdigest(),hashlib.sha256(b).hexdigest(),'Static original PDF changed on page '+str(target_index+1))

    def test_new_alphabet_numbers_and_punctuation_are_not_lost_to_subset_fonts(self):
        alphabet='АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ абвгдеёжзийклмнопрстуфхцчшщъыьэюя ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 «» № & < > – — + ( ) /'
        value=data(tasks=[{'key':'content','label':'Ёж, Щука и Цифры','description':alphabet}])
        text='\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(self.render(value))).pages[2:-1])
        compact=''.join(text.split())
        self.assertIn(''.join(alphabet.split()),compact)
        with self.assertRaisesRegex(ValueError,'workflow_pdf_unsupported_character'):
            self.render(data(presentation={'customer':'Клиент 🦄'}))

    def test_all_selected_tasks_and_long_notes_paginate_without_loss(self):
        tasks=[{'key':key,'label':label,'description':f'Контроль {i}: '+('Проверить результат и передать клиенту. '*38)} for i,(key,label) in enumerate(server.WORK_PERIOD_TASK_LABELS.items()) if key not in {'semantic','content','prices','stocks'}]
        reader=PdfReader(io.BytesIO(self.render(data(tasks=tasks))))
        self.assertGreater(len(reader.pages),10)
        body=' '.join(p.extract_text() for p in reader.pages[2:-1])
        for i in range(len(tasks)):self.assertEqual(body.count(f'Контроль {i}:'),1)
        self.assertEqual(body.count('Зачем нужно:'),len(tasks))
        self.assertEqual(body.count('Ответственные специалисты:'),len(tasks))
        self.assertIn('WWW.WEBOPTIMIZE.RU',reader.pages[-1].extract_text())

    @unittest.skipUnless(importlib.util.find_spec('pymupdf'), 'Optional visual PDF acceptance reader')
    def test_long_customer_multimonth_and_contact_fields_fit(self):
        import pymupdf
        value=data(start='2026-11-17',end='2027-01-12',presentation={'customer':'Общество с ограниченной ответственностью «Очень длинное название компании заказчика»','manager':{'name':'Анна Александровна Иванова','email':'long.manager.contact@example.invalid'}})
        result=pymupdf.open(stream=self.render(value),filetype='pdf')
        cover=result[0];spans=[s for b in cover.get_text('dict')['blocks'] for line in b.get('lines',[]) for s in line['spans']]
        customer=[s for s in spans if s['color']==0xe21e23]
        self.assertTrue(customer);self.assertLess(max(s['bbox'][3] for s in customer),495)
        self.assertIn('Ноябрь 2026–Январь 2027',cover.get_text())
        for page in result:
            for word in page.get_text('words'):
                self.assertGreaterEqual(word[0],0);self.assertLessEqual(word[2],595.5)
                self.assertGreaterEqual(word[1],0);self.assertLessEqual(word[3],841.98)

    def test_parallel_documents_do_not_share_customer_or_contact_fields(self):
        values=[data(presentation={'customer':'Клиент '+str(i),'manager':{'name':'Менеджер '+str(i),'email':f'manager{i}@example.invalid'}}) for i in range(3)]
        with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(self.render,values))
        for i,result in enumerate(results):
            text='\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(result)).pages)
            self.assertIn('Клиент '+str(i),text);self.assertIn(f'manager{i}@example.invalid',text)
            for other in range(3):
                if other!=i:self.assertNotIn(f'manager{other}@example.invalid',text)


class PdfSnapshotTest(unittest.TestCase):
    setUp=fixture.ContentWorkflowTest.setUp
    tearDown=fixture.ContentWorkflowTest.tearDown
    plan=fixture.ContentWorkflowTest.plan

    def test_manager_fields_are_versioned_and_saved_pdf_is_immutable(self):
        result=self.plan(managerName='Анна Иванова',managerPhone='+7 (900) 111-22-33',managerEmail='anna@example.invalid')
        exported=server.workflow_export_plan(self.portal,result,self.users['account'])
        with server.connect_db() as db:
            plan=json.loads(db.execute('SELECT data_json FROM workflow_plans WHERE period_id=?',(result['periodId'],)).fetchone()[0])
            body=db.execute('SELECT body,snapshot_json FROM workflow_files WHERE id=?',(exported['fileId'],)).fetchone()
        self.assertEqual(plan['presentation']['manager']['email'],'anna@example.invalid')
        self.assertEqual(json.loads(body['snapshot_json'])['templateId'],server.WORKFLOW_PDF_TEMPLATE_ID)
        with patch.object(server,'workflow_plan_pdf',side_effect=AssertionError('Saved PDF must not be regenerated')):
            self.assertEqual(exported,server.workflow_export_plan(self.portal,result,self.users['account']))
