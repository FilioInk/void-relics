import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, parseSettings } from './settings.ts';

const base = defaultSettings();

test('no saved settings gives the defaults', () => {
  assert.deepEqual(parseSettings(null, base), base);
  assert.deepEqual(parseSettings('garbage', base), base);
});

test('saved settings are restored', () => {
  const saved = { music: false, sound: true, sensitivity: 1.7, invertY: true };
  assert.deepEqual(parseSettings(JSON.stringify(saved), base), saved);
});

test('a broken field falls back alone, and sensitivity is clamped', () => {
  const s = parseSettings(JSON.stringify({ lang: 'fr', music: 'yes', sensitivity: 99, invertY: true }), base);
  assert.deepEqual(s, { music: true, sound: true, sensitivity: 2.5, invertY: true });
});
