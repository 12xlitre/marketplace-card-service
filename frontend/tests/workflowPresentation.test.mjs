import assert from 'node:assert/strict';
import test from 'node:test';
import {nextWorkflowContentCard, ozonWorkflowReviewStatus, workflowCalendarLabel, workflowCardRun, workflowDeliveryText, workflowSemanticProgress} from '../src/workflowPresentation.js';

test('work included in a period does not imply a calendar day',()=>{
  assert.equal(workflowCalendarLabel({status:'planned',periodId:'16'}),'День выполнения не назначен');
  assert.equal(workflowCalendarLabel({schedule:[],plannedDays:[{day:'2026-12-01'}]}),'Назначено: 2026-12-01');
  assert.equal(workflowCalendarLabel({schedule:[{day:'2026-12-02'},{day:'2026-12-01'}],plannedDays:[{day:'2026-12-01'}]}),'Назначено: 2026-12-01, 2026-12-02');
});

test('semantic navigation follows only the chosen batch and starts at the opened card',()=>{
  const batch={id:'own-batch',kind:'semantic',title:'СЯ',cards:[{cardKey:'second',title:'Вторая'},{cardKey:'first',title:'Первая'}]};
  const run=workflowCardRun(batch,'first');
  assert.equal(run.currentIndex,1);assert.equal(run.workflowBatchId,'own-batch');
  assert.deepEqual(run.items.map(c=>c.cardKey),['second','first']);
  assert.equal(workflowCardRun({...batch,kind:'work'},'first'),null);
});

test('the working list skips saved finals and retains their identity for review',()=>{
  const batch = {id:'workset', kind:'semantic', title:'СЯ', cards:[
    {cardKey:'first', title:'Первая', reviewed:false, hasSemanticFinal:true},
    {cardKey:'second', title:'Вторая', reviewed:false, hasSemanticFinal:false},
    {cardKey:'third', title:'Третья', reviewed:false, hasSemanticFinal:false},
  ]};
  const {pending, finalized} = workflowSemanticProgress(batch.cards);
  assert.deepEqual(finalized.map(card=>card.cardKey), ['first']);
  assert.deepEqual(workflowCardRun(batch, 'second', pending).items.map(card=>card.cardKey), ['second', 'third']);
  assert.equal(workflowCardRun(batch, 'third', pending).currentIndex, 1);
  assert.equal(finalized[0].reviewed, false);
  assert.equal(batch.cards.length, 3);
});

test('automatic Bitrix notification explains its cause and original result',()=>{
  assert.equal(workflowDeliveryText({kind:'bitrix',good:49,total:77}),'Автоматическое уведомление о завершении подбора СЯ. Готово 49 из 77 карточек.');
  assert.equal(workflowDeliveryText({kind:'crm_email',subject:'Согласование СЯ'}),'Тема: Согласование СЯ');
});

test('content review follows the batch order and skips cards without a draft or already checked',()=>{
  const result={title:'Готовый черновик'};
  const cards=[
    {cardKey:'queued',state:'queued'},
    {cardKey:'first',state:'generated',result},
    {cardKey:'invalid',state:'generated'},
    {cardKey:'checked',state:'reviewed',reviewed:true,result},
    {cardKey:'failed',state:'failed'},
    {cardKey:'last',state:'generated',result},
  ];
  assert.equal(nextWorkflowContentCard(cards)?.cardKey,'first');
  assert.equal(nextWorkflowContentCard(cards,'first')?.cardKey,'last');
  assert.equal(nextWorkflowContentCard(cards,'last'),null);
  assert.equal(nextWorkflowContentCard(cards,'another-task'),null);
});

test('content uses the same card navigation and shows the save time in Moscow',()=>{
  const cards=[{cardKey:'1',state:'reviewed'},{cardKey:'2',state:'generated'}];
  const run=workflowCardRun({kind:'content',id:'task',title:'Заголовки',cards},'2');
  assert.equal(run.currentIndex,1);
  assert.equal(run.workType,'content');
  assert.equal(run.workflowBatchId,'task');
  assert.deepEqual(run.items.map(card=>card.cardKey),['1','2']);
  assert.match(ozonWorkflowReviewStatus({reviewedAt:'2026-11-26T22:20:00+00:00',taskTitle:'Заголовки'}),
    /Сохранено 27 ноября 2026 г\. в 01:20 МСК · Заголовки/);
  assert.equal(ozonWorkflowReviewStatus(null,'planned'),'Задача на изменение не запускалась');
});
