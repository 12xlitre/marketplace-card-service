import assert from 'node:assert/strict';
import test from 'node:test';
import {contentTextDiff, titleMeasurementChanges} from '../src/workflowContentReview.js';

test('the diff preserves both texts and highlights the exchanged unit',()=>{
  const before='Пена KOLT 70+ 1000 г';
  const after='Пена KOLT 70+ 1000 мл';
  const diff=contentTextDiff(before,after);
  for(const [key,value] of [['before',before],['after',after]]){
    assert.equal(diff[key].map(part=>part.text).join(''),value);
  }
  assert.deepEqual(diff.before.filter(part=>part.changed).map(part=>part.text),['г']);
  assert.deepEqual(diff.after.filter(part=>part.changed).map(part=>part.text),['мл']);
  assert.deepEqual(titleMeasurementChanges(before,after),{removed:['1000 г'],added:['1000 мл']});
});

test('alternate spellings of units are equivalent and decimal quantities stay distinct',()=>{
  assert.deepEqual(titleMeasurementChanges('950 гр., 1,5 л','950 г, 15 л'),{
    removed:['1,5 л'],added:['15 л'],
  });
});

test('large fully rewritten text retains both versions and unchanged portions',()=>{
  const before='Введение. '+('старый '.repeat(800))+'Конец';
  const after='Введение. '+('новый '.repeat(800))+'Конец';
  const diff=contentTextDiff(before,after);
  assert.equal(diff.before.map(part=>part.text).join(''),before);
  assert.equal(diff.after.map(part=>part.text).join(''),after);
  assert.equal(diff.before.at(-1).changed,false);
});
