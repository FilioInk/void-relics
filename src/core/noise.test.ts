import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoise3, fbm3 } from './noise.ts';

test('noise is deterministic for a seed', () => {
  const a = createNoise3(3);
  const b = createNoise3(3);
  for (let i = 0; i < 50; i++) assert.equal(a(i * 0.37, i * 0.11, -i * 0.73), b(i * 0.37, i * 0.11, -i * 0.73));
});

test('noise and fbm stay roughly inside [-1, 1] and are not flat', () => {
  const n = createNoise3(11);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const v = fbm3(n, i * 0.173, i * 0.071, i * 0.031);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert.ok(min >= -1.01 && max <= 1.01, `range ${min}..${max}`);
  assert.ok(max - min > 0.4, 'noise should vary');
});

test('noise is zero on integer lattice points (gradient noise property)', () => {
  const n = createNoise3(1);
  assert.equal(n(2, 3, 4), 0);
});
