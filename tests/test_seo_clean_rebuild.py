import unittest

from seo_clean_rebuild import (CleanRebuilder,CleanError,contains_components,
    query_groups,select_phrases,literal,typed_query_decision,verified_value,distributed_witness)
from seo_grounded_batch import facts,classify_query,compile_attributes,finalize,neutralize_disputed


class CleanContractTest(unittest.TestCase):
    def test_pad_width_does_not_establish_bucket_capacity(self):
        card={'sku':'1','title':'Швабра с ведром','description':'Насадка 10x32 см. Ведро для воды.',
              'characteristics':[{'id':1,'name':'Материал','value':['микрофибра','пластик']}]}
        self.assertEqual(classify_query(card,facts(card),'швабра с ведром 10 литров')[0],'confirm')

    def test_number_of_cups_is_distinct_from_total_set_size(self):
        card={'title':'Чайный набор 9 предметов на 4 персоны','description':'Чашки и блюдца на подставке.',
              'characteristics':[{'id':1,'name':'Количество предметов в упаковке','value':['9']},
                 {'id':2,'name':'Комплектация','value':['чашки - 4 шт., блюдца - 4 шт., подставка - 1 шт.']}]}
        self.assertIsNone(typed_query_decision(card,'чашки 4 шт'))
        self.assertEqual(typed_query_decision(card,'чашки 9 шт')[0],'exclude')
        self.assertEqual(typed_query_decision(card,'набор 4 предмета')[0],'exclude')
        profile=facts(card,[{'question':'Сколько предметов в полном наборе?'}])
        self.assertEqual(classify_query(card,profile,'чашки 4 шт')[0],'use')

    def test_date_does_not_override_set_people_and_piece_counts(self):
        card={'title':'Набор столовый 6 персон 19 предметов','description':'Столовая посуда для семьи.',
              'characteristics':[]}
        self.assertEqual(classify_query(card,facts(card),'набор посуды на 6 персон 19 предметов')[0],'use')
        self.assertEqual(classify_query(card,facts(card),'подарок дочке на 8 марта 8 лет')[0],'confirm')

    def test_distributed_evidence_is_real_and_preserves_direction(self):
        fields={'описание':'Набор посуды — подарок папе от дочки. Новогодний стол для всей семьи.'}
        field,parts=distributed_witness('новогодний подарок папе от дочки',fields)
        self.assertEqual(field,'описание');self.assertTrue(parts)
        self.assertTrue(all(p in fields[field] for p in parts))
        self.assertFalse(distributed_witness('новогодний подарок дочке от папы',fields)[1])

    def test_field_extension_keeps_details_and_conditionally_lists_foreign_claims(self):
        card={'title':'Набор 19 предметов на 6 персон','description':'Белая стеклокерамика.',
              'characteristics':[{'id':1,'name':'Комплектация','value':['тарелки - 12 шт.','салатники - 7 шт.']}]}
        sources={'competitor':{'characteristics':{'Комплектация':'Набор для 6 персон из 19 предметов',
              'Особенности посуды':'ударопрочная'}},'definitions':[{'id':1,'name':'Комплектация','maxCount':4},
              {'id':2,'name':'Особенности посуды','maxCount':3}]}
        plan=compile_attributes(card,sources,facts(card))
        self.assertEqual(plan['fields']['1']['values'][:2],['тарелки - 12 шт.','салатники - 7 шт.'])
        self.assertEqual(plan['fields']['2']['action'],'confirm')
        self.assertNotIn('ударопрочная',CleanRebuilder.final_fields(card,plan)['характеристики'])

    def test_unplaced_key_prevents_final_export_status(self):
        with self.assertRaisesRegex(CleanError,'grounded_review_incomplete'):
            finalize({'sku':'1'},{},{'unplaced':['белые тарелки'],'textProblems':[]})

    def test_neutralizing_conflict_leaves_grammatical_copy(self):
        profile={'disputedMeasurements':[('31.5','см')],'total':None,
                 'sourceQuestions':[{'question':'Сколько предметов в наборе?'}]}
        text=neutralize_disputed('Набор из 11 предметов. Диаметр 31,5 см — подходит для подачи.',profile)
        self.assertNotIn('из .',text);self.assertNotIn('Диаметр —',text)

    def test_negation_numbers_and_product_words_cannot_disappear(self):
        for query,phrase in [('набор на 6 персон','набор на 4 персоны'),
            ('посуда без кружек','посуда с кружками'),
            ('посуда без кружек','Посуда без рисунка с кружками'),
            ('столовый сервиз','удобный набор'),
            ('набор тарелок белый','набор тарелок чёрный')]:
            with self.subTest(query=query):self.assertFalse(contains_components(query,phrase))
        self.assertTrue(contains_components('посуда керамика для кухни','Керамическая посуда для кухни'))

    def test_every_source_variant_and_its_row_index_survive_grouping(self):
        source={'semantic':[{'query':'тарелки белые','count':10},
            {'query':'белые тарелки','count':20},{'query':'тарелки чёрные','count':5},
            {'query':'тарелки без рисунка','count':6}]}
        groups=query_groups(source)
        self.assertEqual(sorted(i for row in groups.values() for i in row['rowIndices']),[0,1,2,3])
        self.assertEqual(len(groups),3)
        self.assertEqual(groups['R0']['queries'],['тарелки белые','белые тарелки'])

    def test_plan_cannot_hide_relevant_key_with_general_phrase(self):
        groups={'R0':{'queries':['белые тарелки']}}
        with self.assertRaisesRegex(CleanError,'clean_plan_coverage_missing'):
            select_phrases(groups,{'R0':{'status':'use','wording':'удобная посуда'}})

    def test_exact_occurrence_keeps_word_order_and_forms(self):
        self.assertFalse(literal('набор тарелок','тарелки в наборе'))
        self.assertTrue(literal('набор тарелок','Белый набор тарелок на 6 персон'))

    def test_gift_giver_and_recipient_cannot_swap_during_grouping(self):
        source={'semantic':[{'query':'подарок папе от дочки'},{'query':'подарок дочке от папы'}]}
        self.assertEqual(len(query_groups(source)),2)
        self.assertFalse(contains_components('подарок папе от дочки','Подарок дочке от папы'))


    def test_size_number_does_not_confirm_pack_quantity(self):
        card={'marketplace':'Wildberries','title':'Набор 19 предметов на 6 персон',
            'description':'Салатник 16 см.','brand':'JEWEL','characteristics':[
                {'id':1,'name':'Количество предметов в упаковке','value':['19 шт.']},
                {'id':2,'name':'Материал','value':['стеклокерамика']}]}
        self.assertEqual(typed_query_decision(card,'набор посуды 16 предметов')[0],'exclude')
        self.assertEqual(typed_query_decision(card,'набор посуды из стекла')[0],'confirm')

    def test_competitor_steel_and_color_cannot_become_own_properties(self):
        card={'marketplace':'Wildberries','title':'Швабра с ведром','description':'Насадка из микрофибры.',
            'characteristics':[{'id':1,'name':'Цвет','value':['серый']},
                {'id':2,'name':'Материал','value':['пластик','микрофибра']}]}
        self.assertIsNone(verified_value('нержавеющая сталь',{'name':'Материал'},card))
        self.assertIsNone(verified_value('белый',{'name':'Цвет'},card))
        self.assertEqual(typed_query_decision(card,'белая швабра')[0],'exclude')




if __name__=='__main__':unittest.main()
