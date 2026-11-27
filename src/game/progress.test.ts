import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTIFACT_COUNT } from '../world/generate.ts';
import { collect, createProgress, formatTime, isComplete, markBroken, parseProgress } from './progress.ts';

const ids = new Set(Array.from({ length: ARTIFACT_COUNT }, (_, i) => `relic-${i}`));

test('an artifact counts once, however many times the ship passes through it', () => {
  const p = createProgress(1);
  assert.equal(collect(p, 'relic-3'), true);
  assert.equal(collect(p, 'relic-3'), false);
  assert.equal(p.found.length, 1);
});

test('the hunt is complete at the twentieth relic, and the finish time is kept', () => {
  const p = createProgress(1);
  for (let i = 0; i < ARTIFACT_COUNT; i++) {
    assert.equal(isComplete(p), false);
    p.elapsed = i * 10;
    collect(p, `relic-${i}`);
  }
  assert.equal(isComplete(p), true);
  assert.equal(p.finishedAt, (ARTIFACT_COUNT - 1) * 10);
});

test('saved progress survives a round trip', () => {
  const p = createProgress(42);
  collect(p, 'relic-1');
  collect(p, 'relic-7');
  p.elapsed = 321;
  assert.deepEqual(parseProgress(JSON.stringify(p), 42, ids), p);
});

test('a save from another galaxy, junk, or foreign ids is not trusted', () => {
  const p = createProgress(42);
  collect(p, 'relic-1');
  assert.deepEqual(parseProgress(JSON.stringify(p), 43, ids).found, []);
  assert.deepEqual(parseProgress('{not json', 42, ids).found, []);
  assert.deepEqual(parseProgress('null', 42, ids).found, []);
  assert.deepEqual(parseProgress(JSON.stringify({ seed: 42, found: ['relic-1', 'relic-1', 'hack', 5], elapsed: -3 }), 42, ids), {
    seed: 42,
    found: ['relic-1'],
    elapsed: 0,
    finishedAt: null,
    salvage: 0,
    broken: [],
  });
});

test('a save from before the lasers loads with no salvage and nothing broken', () => {
  const old = JSON.stringify({ seed: 42, found: ['relic-2'], elapsed: 50, finishedAt: null });
  const p = parseProgress(old, 42, ids);
  assert.deepEqual([p.found, p.salvage, p.broken], [['relic-2'], 0, []]);
});

test('salvage and broken targets survive a round trip; junk in them does not', () => {
  const p = createProgress(42);
  assert.equal(markBroken(p, 'rock:17'), true);
  assert.equal(markBroken(p, 'rock:17'), false);
  markBroken(p, 'shell:3');
  p.salvage = 5;
  assert.deepEqual(parseProgress(JSON.stringify(p), 42, ids), p);
  const bad = parseProgress(JSON.stringify({ seed: 42, found: [], elapsed: 0, salvage: -2, broken: ['rock:1', 'rock:1', 'planet:2', 'rock:x', 7] }), 42, ids);
  assert.deepEqual([bad.salvage, bad.broken], [0, ['rock:1']]);
  assert.equal(parseProgress(JSON.stringify({ seed: 42, found: [], elapsed: 0, salvage: 2.5 }), 42, ids).salvage, 0);
});

test('time reads as m:ss, or h:mm:ss past an hour', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(75.9), '1:15');
  assert.equal(formatTime(3725), '1:02:05');
});
