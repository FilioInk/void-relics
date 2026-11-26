import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashString } from './rng.ts';

test('the same seed gives the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('different seeds give different sequences', () => {
  const a = createRng(1);
  const b = createRng(2);
  const same = Array.from({ length: 20 }, () => a.next() === b.next()).filter(Boolean).length;
  assert.ok(same < 2);
});

test('next() stays in [0, 1) and int() stays inside its bounds', () => {
  const r = createRng(7);
  for (let i = 0; i < 5000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
    const n = r.int(-3, 3);
    assert.ok(Number.isInteger(n) && n >= -3 && n <= 3);
  }
});

test('onSphere() returns unit vectors and inSphere() stays inside the unit ball', () => {
  const r = createRng(9);
  for (let i = 0; i < 500; i++) {
    const [x, y, z] = r.onSphere();
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-9);
    const [a, b, c] = r.inSphere();
    assert.ok(Math.hypot(a, b, c) <= 1);
  }
});

test('fork() does not depend on how far the parent has advanced', () => {
  const a = createRng(5);
  const b = createRng(5);
  b.next();
  b.next();
  assert.equal(a.fork('planets').next(), b.fork('planets').next());
  assert.notEqual(a.fork('planets').next(), a.fork('nebulae').next());
});

test('pick() refuses an empty array instead of returning undefined', () => {
  assert.throws(() => createRng(1).pick([]));
});

test('hashString is stable', () => {
  assert.equal(hashString('void'), hashString('void'));
  assert.notEqual(hashString('void'), hashString('relic'));
});
