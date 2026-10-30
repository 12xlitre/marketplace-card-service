import test from 'node:test';
import assert from 'node:assert/strict';
import { seoProgress, formatSeoDuration } from '../src/seoProgress.js';

const started = '2026-10-29T13:30:00Z';
const now = Date.parse('2026-10-29T13:40:00Z');
const base = { status: 'running', total: 58, done: 0, createdAt: started };
test('initial overall bar stays honest while current keyword check advances', () => {
  const p = seoProgress({ ...base, stage: 'Проверка запросов 161–192 из 245: 760063411' }, now);
  assert.equal(p.percentage, 0);
  assert.equal(p.remaining, null);
  assert.deepEqual(p.query, { label: 'Проверка запросов', done: 160, total: 245, from: 161, to: 192 });
});
test('ETA requires observed completed cards and produces a range', () => {
  assert.equal(seoProgress({ ...base, done: 1 }, now).remaining, null);
  const p = seoProgress({ ...base, done: 2 }, now);
  assert.equal(p.percentage, 3);
  assert.ok(p.remaining[0] < p.remaining[1]);
  assert.equal(p.elapsedSeconds, 600);
  assert.equal(seoProgress({ ...base, done: 2, createdAt: 'bad' }, now).remaining, null);
});
test('Excel assembly is not reported as file ready', () => {
  const p = seoProgress({ ...base, done: 58 }, now);
  assert.equal(p.percentage, 99); assert.equal(p.complete, false); assert.equal(p.assembling, true);
  const ready = seoProgress({ ...base, done: 58, status: 'review', sha256: 'verified', finishedAt: '2026-10-29T13:35:00Z' }, now);
  assert.equal(ready.percentage, 100); assert.equal(ready.elapsedSeconds, 300); assert.equal(ready.complete, true);
  assert.equal(seoProgress({ ...base, done: 58, status: 'partial' }, now).complete, false);
});
test('46 prepared cards out of 58 cannot show 100 percent readiness', () => {
  const p = seoProgress({ ...base, done: 58, completedCount: 46, status: 'partial' }, now);
  assert.equal(p.percentage, 79);
  assert.equal(p.prepared, 46);
  assert.equal(p.partial, true);
  assert.equal(p.complete, false);
  assert.equal(p.remaining, null);
});
test('bad counters and impossible query numbers cannot overflow progress', () => {
  const p = seoProgress({ ...base, done: 1000, stage: 'Проверка запросов 999–1000 из 245: 123' }, now);
  assert.equal(p.done, 58); assert.equal(p.percentage, 99); assert.equal(p.query.done, 245);
  assert.equal(seoProgress({ ...base, total: 'bad' }, now).percentage, 0);
  assert.equal(formatSeoDuration(3660), '1 ч 1 мин');
  assert.equal(formatSeoDuration(30), 'меньше минуты');
});
