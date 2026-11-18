import assert from 'node:assert/strict';
import test from 'node:test';
import {workflowCalendarLabel, workflowCardRun, workflowDeliveryText} from '../src/workflowPresentation.js';

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

test('automatic Bitrix notification explains its cause and original result',()=>{
  assert.equal(workflowDeliveryText({kind:'bitrix',good:49,total:77}),'Автоматическое уведомление о завершении подбора СЯ. Готово 49 из 77 карточек.');
  assert.equal(workflowDeliveryText({kind:'crm_email',subject:'Согласование СЯ'}),'Тема: Согласование СЯ');
});
