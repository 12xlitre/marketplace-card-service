import assert from 'node:assert/strict';
import test from 'node:test';
import {visibleWorkflowBatches} from '../src/workflowTaskVisibility.js';

const semantic={id:'semantic',periodId:'16',kind:'semantic',status:'review'};
const title={id:'title',periodId:'16',kind:'content',status:'planned'};
const work={id:'report',periodId:'16',kind:'work',status:'planned'};

test('collecting or reviewing semantics does not turn planned work into active tasks',()=>{
  for(const status of ['collecting','review','approved']){
    const batches=[{...semantic,status},title,work];
    assert.deepEqual(visibleWorkflowBatches(batches,'tasks').map(b=>b.id),['semantic']);
    assert.deepEqual(visibleWorkflowBatches(batches,'periods'),batches);
  }
});

test('explicitly started work and tasks created outside a period remain visible',()=>{
  for(const status of ['awaiting_semantic','generating','review','approved','cancelled','in_progress']){
    const started={...title,status},standalone={...title,id:'standalone',periodId:''};
    assert.deepEqual(visibleWorkflowBatches([title,started,standalone],'tasks'),[started,standalone]);
  }
});
