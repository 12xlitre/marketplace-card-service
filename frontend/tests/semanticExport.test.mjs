import test from 'node:test';
import assert from 'node:assert/strict';
import {semanticExportHeaders,semanticExportRows,semanticExportWidths,semanticExportRowHeight,semanticAdditionExplanation,ozonFinalExportCore} from '../src/semanticExport.js';

test('each marketplace exports one frequency, three solid header blocks and the service explanation',()=>{
  const add={query:'Ключ',wbCount:150,ozonCount:70,relevanceReason:'Назначение подтверждено.',relevanceEvidence:[{quote:'Для наружных работ.'}]};
  for(const [market,count] of [['Ozon',70],['Wildberries',150]]){
    const rows=semanticExportRows([],[],[add],[],market);
    assert.equal(semanticExportHeaders(market).length,10);
    assert.equal(rows[1][4].value,count);
    assert.equal(rows[1][5].value,'Назначение подтверждено.\nВ карточке: «Для наружных работ.»');
    assert.deepEqual(rows[0].map(c=>c.style),[6,6,6,7,7,7,7,8,8,8]);
    assert.equal(rows[1][6].style,9);assert.equal(rows[1][9].style,9);
  }
  assert.equal(semanticExportRows([],[],[{...add,ozonCount:0}],[],'Ozon')[1][4].value,'');
});

test('long service explanations wrap to a readable initial row height',()=>{
  const text=semanticAdditionExplanation({relevanceReason:'Обоснование '.repeat(60),relevanceEvidence:[{quote:'Цитата из карточки'}]});
  const rows=semanticExportRows([],[],[{query:'Ключ',relevanceReason:text}],[],'Ozon');
  assert(semanticExportRowHeight(rows[1],semanticExportWidths)>100);
});

test('the final snapshot preserves rankings and never borrows a different period',()=>{
  const period={d1:'2026-10-18',d2:'2026-11-16'},ranked=[{query:'Ключ',orgPos:17}];
  const data={semanticCore:{period,rankedKeywords:ranked,rankingSource:'mpstats'},finalSelection:{period,current:[]}};
  assert.deepEqual(ozonFinalExportCore(data).rankedKeywords,ranked);
  assert.deepEqual(ozonFinalExportCore({...data,finalSelection:{...data.finalSelection,rankedKeywords:[]}}).rankedKeywords,[]);
  assert.deepEqual(ozonFinalExportCore({...data,finalSelection:{period:{...period,d1:'2026-11-01'}}}).rankedKeywords,[]);
});
