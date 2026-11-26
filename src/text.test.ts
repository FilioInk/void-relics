import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, format, t } from './text.ts';

test('no user-facing string is empty', () => {
  for (const [k, v] of Object.entries(STRINGS)) assert.ok(v.trim().length > 0, `${k} is empty`);
});

test('format fills known placeholders and leaves unknown ones visible', () => {
  assert.equal(format('Continue — {found}/20', { found: 4 }), 'Continue — 4/20');
  assert.equal(format('{a} {b}', { a: 1 }), '1 {b}');
  assert.equal(t('galaxy', { seed: 7 }), 'Galaxy #7');
});
