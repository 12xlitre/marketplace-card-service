import test from 'node:test';
import assert from 'node:assert/strict';
import {matchWorkflowCards} from '../src/workflowCardSelection.js';

test('WB Excel column and seller articles select unique cards without removing punctuation or leading zeroes', () => {
  const cards=[{nmID:1001,vendorCode:'AB-01'},{nmID:1002,vendorCode:'AB01'},{nmID:1003,vendorCode:'00123'}];
  const found=matchWorkflowCards(cards,'1001\r\nab-01, 00123;1001\tUNKNOWN');
  assert.deepEqual(found.cardKeys,['1001','1003']);
  assert.deepEqual(found.missing,['UNKNOWN']);
  assert.deepEqual(matchWorkflowCards(cards,'123').cardKeys,[]);
});

test('Ozon matches SKU, product id and offer id but never another cabinet or a numeric substring', () => {
  const found=matchWorkflowCards([{cardKey:'ozon:7',sku:'9001',productId:'71',offer_id:'OFFER-7'}],'9001;71;offer-7;9002;900');
  assert.deepEqual(found.cardKeys,['ozon:7']);
  assert.deepEqual(found.missing,['9002','900']);
});

test('shared seller article or conflicting numeric identifiers require explicit card choice', () => {
  const found=matchWorkflowCards([{nmID:'1001',vendorCode:'same'},{nmID:'1002',vendorCode:'same'},{cardKey:'third',sku:'1001'}],'same;1001');
  assert.deepEqual(found.cardKeys,[]);
  assert.deepEqual(found.ambiguous,['same','1001']);
});
