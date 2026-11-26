import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, LANGS, detectLang, format } from './strings.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language has every key, none empty, with the same placeholders as English', () => {
  const keys = Object.keys(DICTS.en).sort();
  for (const lang of LANGS) {
    const d = DICTS[lang];
    assert.deepEqual(Object.keys(d).sort(), keys, `${lang} keys`);
    for (const k of keys) {
      const v = d[k as keyof typeof d];
      assert.ok(v.trim().length > 0, `${lang}.${k} is empty`);
      assert.deepEqual(placeholders(v), placeholders(DICTS.en[k as keyof typeof d]), `${lang}.${k} placeholders`);
    }
  }
});

test('browser locales map onto the shipped languages', () => {
  assert.equal(detectLang(['ru-RU', 'en']), 'ru');
  assert.equal(detectLang(['pt-PT']), 'pt-BR');
  assert.equal(detectLang(['pt-BR']), 'pt-BR');
  assert.equal(detectLang(['fr-CA']), 'fr');
  assert.equal(detectLang(['es']), 'es');
  assert.equal(detectLang(['de-DE', 'ja']), 'en');
  assert.equal(detectLang([]), 'en');
});

test('format fills known placeholders and leaves unknown ones visible', () => {
  assert.equal(format('Continue — {found}/20', { found: 4 }), 'Continue — 4/20');
  assert.equal(format('{a} {b}', { a: 1 }), '1 {b}');
});
