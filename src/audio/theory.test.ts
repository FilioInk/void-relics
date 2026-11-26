import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.ts';
import { MODES, chord, degreeToMidi, inScale, melodyPool, midiToFreq, progression, type ModeName } from './theory.ts';

test('A4 is 440 Hz and an octave doubles the frequency', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(81) - 880) < 1e-9);
});

test('scale degrees wrap into the next and previous octave', () => {
  assert.equal(degreeToMidi(57, 'aeolian', 0), 57);
  assert.equal(degreeToMidi(57, 'aeolian', 7), 69);
  assert.equal(degreeToMidi(57, 'aeolian', -1), 55);
});

test('every chord and melody note stays inside the mode', () => {
  for (const mode of Object.keys(MODES) as ModeName[]) {
    for (let d = 0; d < 7; d++) {
      for (const n of chord(45, mode, d)) assert.ok(inScale(n, 45, mode), `${mode} chord ${d}`);
      for (const n of melodyPool(45, mode, d)) assert.ok(inScale(n, 45, mode), `${mode} melody ${d}`);
    }
  }
});

test('the tonic minor-seventh chord of A aeolian is A C E G', () => {
  assert.deepEqual(chord(57, 'aeolian', 0), [57, 60, 64, 67]);
});

test('progressions start on the tonic, are seeded, and never repeat a chord twice in a row', () => {
  const a = progression(createRng(3), 16);
  assert.deepEqual(a, progression(createRng(3), 16));
  assert.equal(a[0], 0);
  assert.equal(a.length, 16);
  for (let i = 1; i < a.length; i++) assert.notEqual(a[i], a[i - 1]);
});
