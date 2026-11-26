import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.ts';
import { makeName, roman } from './names.ts';

test('names are deterministic, capitalised and never empty', () => {
  const a = createRng(99);
  const b = createRng(99);
  for (let i = 0; i < 200; i++) {
    const x = makeName(a, i % 2 === 0);
    assert.equal(x, makeName(b, i % 2 === 0));
    assert.ok(x.length >= 2);
    assert.match(x, /^[A-Z][a-z']+$/);
  }
});

test('alien names carry an apostrophe', () => {
  assert.ok(makeName(createRng(4), true).includes("'"));
});

test('roman numerals for planet order', () => {
  assert.equal(roman(1), 'I');
  assert.equal(roman(6), 'VI');
  assert.equal(roman(12), '12');
});
