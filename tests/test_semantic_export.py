import base64
import hashlib
import io
import json
import sqlite3
import unittest
from unittest.mock import patch

from openpyxl import load_workbook, Workbook
import server

PERIOD={'d1':'2026-10-18','d2':'2026-11-16'}
ADD={'query':'новый запрос','wbCount':150,'ozonCount':70,'relevanceReason':'Назначение подтверждено описанием.',
     'relevanceEvidence':[{'factId':'description','quote':'Для наружных работ.'}]}
REMOVE={'query':'старый запрос','removalReason':'Не соответствует товару.'}
RANK={'query':'ранжируемый запрос','orgPos':12.5}
FINAL={'selected':[ADD],'current':[{'query':'действующий запрос'}],'removal':[REMOVE],
       'period':PERIOD,'semanticCore':{'rankedKeywords':[RANK],'allKeywords':[ADD]}}
BATCH={'id':'batch','generation':1,'marketplace':'Ozon'}
CARDS={'1001':{'card':{'title':'Товар'},'final':FINAL}}


class SemanticExportTest(unittest.TestCase):
    def workbook(self,marketplace='Ozon',cards=None):
        raw=server.workflow_workbook('file',{**BATCH,'marketplace':marketplace},'semantic',1,cards or CARDS)
        book=load_workbook(io.BytesIO(raw));sheet=book[book['_OptiCards']['A2'].value]
        return raw,book,sheet

    def test_marketplace_columns_explanations_colors_and_readability(self):
        for marketplace,label,count in [('Ozon','Ozon',70),('Wildberries','WB',150)]:
            with self.subTest(marketplace=marketplace):
                _,_,sheet=self.workbook(marketplace)
                self.assertEqual(sheet.max_column,10)
                self.assertEqual(sheet['E1'].value,f'Частота {label} ключа к добавлению')
                self.assertEqual(sheet['E2'].value,count)
                self.assertEqual(sheet['B2'].value,RANK['query']);self.assertEqual(sheet['C2'].value,12.5)
                self.assertEqual(sheet['F2'].value,ADD['relevanceReason']+'\nВ карточке: «Для наружных работ.»')
                self.assertEqual([sheet.cell(1,c).fill.fgColor.rgb[-6:] for c in (1,4,8)],['E3EBF5','E2F0E9','F8E8E3'])
                self.assertFalse(sheet.sheet_view.showGridLines)
                for row in sheet:
                    for cell in row:
                        self.assertTrue(all(getattr(cell.border,edge).style=='thin' for edge in ('left','right','top','bottom')))
                self.assertTrue(sheet['F2'].alignment.wrap_text)
                self.assertFalse(sheet.protection.formatColumns);self.assertFalse(sheet.protection.formatRows)
                self.assertTrue(sheet['F2'].protection.locked);self.assertFalse(sheet['G2'].protection.locked)
                self.assertGreater(sheet.row_dimensions[1].height,50)

    def test_no_other_marketplace_frequency_is_used_when_target_is_missing(self):
        final={**FINAL,'selected':[{**ADD,'ozonCount':0}]}
        _,_,sheet=self.workbook(cards={'1001':{'card':{},'final':final}})
        self.assertEqual(sheet['E2'].value,0)

    def test_new_and_old_workbooks_import_agreements_and_reject_protected_changes(self):
        raw,book,sheet=self.workbook()
        for legacy in (False,True):
            if legacy:
                sheet.cell(1,6,'Частота Ozon ключа к добавлению');sheet.cell(2,6,70)
                sheet.cell(1,11,'Обоснование добавления');sheet.cell(2,11,ADD['relevanceReason'])
                buffer=io.BytesIO();book.save(buffer);raw=buffer.getvalue()
            expected=load_workbook(io.BytesIO(raw));target=expected[sheet.title]
            target['G2']='Нет';target['J2']='Нет'
            # Resizing is allowed and does not invalidate returned agreements.
            target.column_dimensions['F'].width=90;target.row_dimensions[2].height=150
            buffer=io.BytesIO();expected.save(buffer)
            file={'body':raw,'kind':'semantic','sha256':hashlib.sha256(raw).hexdigest()}
            preview=server.workflow_import_preview(None,file,BATCH,{'cards':CARDS},base64.b64encode(buffer.getvalue()).decode())
            self.assertEqual(preview['cards']['1001']['final']['selected'],[])
            self.assertEqual(preview['cards']['1001']['final']['removal'],[])
            target['C2']=999;buffer=io.BytesIO();expected.save(buffer)
            with self.assertRaisesRegex(ValueError,'scope_mismatch'):
                server.workflow_import_preview(None,file,BATCH,{'cards':CARDS},base64.b64encode(buffer.getvalue()).decode())

    def test_rank_normalization_snapshot_and_period_isolation(self):
        core={'relevanceVersion':server.SEMANTIC_RELEVANCE_VERSION,'allKeywords':[ADD],'period':PERIOD,
              'rankedKeywords':[RANK], 'rankingSource':'mpstats','rankingPeriod':PERIOD}
        final={'current':[],'selected':[ADD],'removal':[],'period':PERIOD,'rankedKeywords':[RANK],
               'rankingSource':'mpstats','rankingPeriod':PERIOD}
        normalized=server.normalize_ozon_semantic_payload({'cardKey':'1001','semanticCore':core,'final':[ADD],'finalSelection':final})
        self.assertEqual(normalized['semanticCore']['rankedKeywords'][0]['orgPos'],12.5)
        self.assertEqual(normalized['finalSelection']['rankedKeywords'][0]['orgPos'],12.5)
        with sqlite3.connect(':memory:') as db:
            db.row_factory=sqlite3.Row
            db.execute('CREATE TABLE ozon_semantic_drafts(portal_id,card_key,payload_json)')
            db.execute('INSERT INTO ozon_semantic_drafts VALUES(1,?,?)',('1001',json.dumps(normalized)))
            result=server.workflow_final_from_card(db,1,'1001','Ozon')
            self.assertEqual(result['semanticCore']['rankedKeywords'][0]['orgPos'],12.5)
            del normalized['finalSelection']['rankedKeywords'];del normalized['finalSelection']['rankingSource']
            normalized['semanticCore']['period']={'d1':'2026-11-01','d2':'2026-11-16'}
            db.execute('UPDATE ozon_semantic_drafts SET payload_json=?',(json.dumps(normalized),))
            self.assertNotIn('rankedKeywords',server.workflow_final_from_card(db,1,'1001','Ozon')['semanticCore'])

    def test_ozon_rankings_use_sku_get_original_period_and_existing_cache(self):
        with patch.object(server,'get_service_integration_secret',return_value='fixture'),patch.object(server,'audit_cache_get',return_value=None),patch.object(server,'audit_cache_set'),patch.object(server,'mpstats_usage_record'),patch.object(server,'mpstats_get_json',return_value=[{'query':'запрос','position':17.5}]) as get,patch.object(server,'mpstats_post_body_json') as post:
            result=server.fetch_mpstats_keywords_core({'sku':'1001','nmID':'wrong','title':'Товар'},period=PERIOD,marketplace='Ozon')
            self.assertEqual(result['keywords'][0]['avgPos'],17.5)
            self.assertIn('/oz/items/1001/keywords?d1=2026-10-18&d2=2026-11-16',get.call_args.args[1]);post.assert_not_called()
            with patch.object(server,'audit_cache_get',return_value=[{'query':'кеш','avg_position':8}]):
                cached=server.fetch_mpstats_keywords_core({'sku':'1001'},period=PERIOD,marketplace='Ozon')
                self.assertTrue(cached['cached']);self.assertEqual(get.call_count,1)

    def test_ranking_values_are_real_positive_positions_not_counts(self):
        core={'allKeywords':[{'query':'частотный','wbCount':9999},{'query':'позиция','position':'4.5'},
                             {'query':'ноль','orgPos':0},{'query':'нет','avgPos':'NaN'}]}
        self.assertEqual(server.semantic_export_ranking_rows(core),[{'query':'позиция','position':4.5}])

    def test_ozon_source_distinguishes_empty_from_invalid_and_rejects_non_sku_paths(self):
        with patch.object(server,'get_service_integration_secret',return_value='fixture'),patch.object(server,'audit_cache_get',return_value=None),patch.object(server,'audit_cache_set'),patch.object(server,'mpstats_get_json',return_value={'error':'unexpected response'}) as get:
            with self.assertRaisesRegex(ValueError,'mpstats_rankings_invalid_response'):
                server.fetch_mpstats_keywords_core({'sku':'1001'},period=PERIOD,marketplace='Ozon')
            get.return_value={'no_data':True}
            result=server.fetch_mpstats_keywords_core({'sku':'1001'},period=PERIOD,marketplace='Ozon')
            self.assertEqual(result['status'],'empty');self.assertEqual(result['keywords'],[])
            get.reset_mock()
            with self.assertRaisesRegex(ValueError,'invalid_ozon_sku'):
                server.fetch_mpstats_keywords_core({'sku':'../not-a-sku'},period=PERIOD,marketplace='Ozon')
            get.assert_not_called()
