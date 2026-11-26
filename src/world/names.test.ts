import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.ts';
import { makeName, roman } from './names.ts';

test('names are deterministic and never empty', () => {
  const a = createRng(99);
  const b = createRng(99);
  for (let i = 0; i < 200; i++) {
    const x = makeName(a, i % 2 === 0);
    const y = makeName(b, i % 2 === 0);
    assert.deepEqual(x, y);
    assert.ok(x.latin.length >= 2 && x.cyrillic.length >= 2);
    assert.match(x.latin, /^[A-Z]/);
    assert.match(x.cyrillic, /^[А-ЯЁ]/);
  }
});

test('alien names carry an apostrophe in both spellings', () => {
  const n = makeName(createRng(4), true);
  assert.ok(n.latin.includes("'") && n.cyrillic.includes("'"));
});

test('roman numerals for planet order', () => {
  assert.equal(roman(1), 'I');
  assert.equal(roman(6), 'VI');
  assert.equal(roman(12), '12');
});
