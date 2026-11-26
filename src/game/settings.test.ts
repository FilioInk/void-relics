import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, parseSettings } from './settings.ts';

const base = defaultSettings();

test('no saved settings gives the defaults', () => {
  assert.deepEqual(parseSettings(null, base), base);
  assert.deepEqual(parseSettings('garbage', base), base);
});

test('saved settings are restored', () => {
  const saved = { music: false, musicVolume: 0.35, sound: true, sensitivity: 1.7, invertY: true };
  assert.deepEqual(parseSettings(JSON.stringify(saved), base), saved);
});

test('a broken field falls back alone, and sensitivity is clamped', () => {
  const s = parseSettings(JSON.stringify({ lang: 'fr', music: 'yes', sensitivity: 99, invertY: true }), base);
  assert.deepEqual(s, { music: true, musicVolume: 0.9, sound: true, sensitivity: 2.5, invertY: true });
});

test('music starts 10% under full volume, and a saved volume is clamped to 0..1', () => {
  assert.equal(base.musicVolume, 0.9);
  // Settings saved before the volume existed get the new default.
  assert.equal(parseSettings(JSON.stringify({ music: true, sound: true }), base).musicVolume, 0.9);
  assert.equal(parseSettings(JSON.stringify({ musicVolume: 3 }), base).musicVolume, 1);
  assert.equal(parseSettings(JSON.stringify({ musicVolume: -1 }), base).musicVolume, 0);
  assert.equal(parseSettings(JSON.stringify({ musicVolume: 'loud' }), base).musicVolume, 0.9);
});
