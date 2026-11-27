import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerfStats, Rolling, compactCount, formatReport, percentile } from './perfStats.ts';

test('percentile uses the nearest rank', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(v, 0.95), 10);
  assert.equal(percentile(v, 0.5), 5);
  assert.equal(percentile(v, 0), 1);
  assert.ok(Number.isNaN(percentile([], 0.5)));
});

test('a rolling window keeps only the newest samples', () => {
  const r = new Rolling(3);
  for (const v of [100, 100, 1, 2, 3]) r.push(v);
  const s = r.summary();
  assert.equal(s.n, 3);
  assert.equal(s.avg, 2);
  assert.equal(s.max, 3);
});

test('non-finite and negative samples never reach the averages', () => {
  const r = new Rolling(8);
  for (const v of [10, NaN, Infinity, -5, 20]) r.push(v);
  assert.deepEqual(r.summary(), { avg: 15, p95: 20, max: 20, n: 2 });
});

test('an empty window reports NaN rather than zero', () => {
  const s = new Rolling(4).summary();
  assert.equal(s.n, 0);
  assert.ok(Number.isNaN(s.avg));
});

test('fps comes from the average frame interval', () => {
  const p = new PerfStats(10);
  for (let i = 0; i < 10; i++) p.frame.push(16);
  assert.equal(Math.round(p.report().fps * 100) / 100, 62.5);
  assert.equal(p.report().gpuMs, null);
  p.gpuSupported = true;
  p.gpu.push(4);
  assert.equal(p.report().gpuMs?.avg, 4);
  p.reset();
  assert.equal(p.report().frameMs.n, 0);
});

test('counts print compactly', () => {
  assert.equal(compactCount(5_520_000), '5.52M');
  assert.equal(compactCount(41_200), '41.2k');
  assert.equal(compactCount(812), '812');
  assert.equal(compactCount(NaN), '–');
});

test('the overlay text survives a report with no samples yet', () => {
  const lines = formatReport(new PerfStats().report());
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => !l.includes('NaN')));
  assert.match(lines[1]!, /GPU n\/a/);
});
