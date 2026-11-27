import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BREAKABLE_ROCK, lootOf, segmentBand, segmentDisc, segmentSphere, stepBolts, targetHp, targetId, type Bolt } from './targets.ts';

test('a segment finds where it enters a sphere, misses one beside it, and hits from inside at 0', () => {
  const t = segmentSphere(0, 0, 0, 100, 0, 0, 50, 0, 0, 10);
  assert.ok(t !== null && Math.abs(t - 0.4) < 1e-9);
  assert.equal(segmentSphere(0, 0, 0, 100, 0, 0, 50, 20, 0, 10), null);
  assert.equal(segmentSphere(0, 0, 0, 30, 0, 0, 50, 0, 0, 10), null, 'stops short');
  assert.equal(segmentSphere(60, 0, 0, 100, 0, 0, 50, 0, 0, 5), null, 'already past it');
  assert.equal(segmentSphere(50, 0, 0, 100, 0, 0, 50, 0, 0, 10), 0);
  assert.equal(segmentSphere(5, 5, 5, 5, 5, 5, 0, 0, 0, 1), null, 'zero-length outside');
});

test('rocks take more hits the bigger they are; mountains, hulls and stations never break', () => {
  assert.equal(targetHp({ kind: 'rock', radius: 10 }), 1);
  assert.ok(targetHp({ kind: 'rock', radius: 120 }) > targetHp({ kind: 'rock', radius: 40 }));
  assert.equal(targetHp({ kind: 'rock', radius: MAX_BREAKABLE_ROCK + 1 }), Infinity);
  assert.equal(targetHp({ radius: 50 }), Infinity);
  assert.equal(targetHp({ kind: 'junk', radius: 3 }), 1);
  assert.ok(targetHp({ kind: 'shell', radius: 30 }) > 5);
});

test('loot is fixed by the seed and the object, rare in rocks, common in satellites', () => {
  assert.equal(lootOf(7, 'rock', 12, 30), lootOf(7, 'rock', 12, 30));
  const rate = (kind: 'rock' | 'satellite' | 'junk') => {
    let n = 0;
    for (let i = 0; i < 5000; i++) if (lootOf(1337, kind, i, 30)) n++;
    return n / 5000;
  };
  assert.ok(rate('rock') > 0.03 && rate('rock') < 0.09, `rock ${rate('rock')}`);
  assert.ok(rate('satellite') > 0.35 && rate('satellite') < 0.55, `satellite ${rate('satellite')}`);
  for (let i = 0; i < 200; i++) assert.equal(lootOf(1, 'rock', i, MAX_BREAKABLE_ROCK + 10), null, 'unbreakable rocks hold nothing');
  for (let i = 0; i < 200; i++) assert.equal(lootOf(1, 'shell', i), null);
  assert.equal(targetId('rock', 4), 'rock:4');
});

const bolt = (x: number, vx: number, life = 1): Bolt => ({ x, y: 0, z: 0, vx, vy: 0, vz: 0, life });

test('bolts fly, expire, and stop at the first thing they hit', () => {
  const bolts = [bolt(0, 1000), bolt(0, 1000, 0.01), bolt(0, -1000)];
  const wall = { name: 'wall' };
  const hits = stepBolts(bolts, 0.1, (ax, _ay, _az, bx) => {
    // A wall at x = 50 for bolts flying +x.
    if (bx > 50 && ax <= 50) return { t: (50 - ax) / (bx - ax), target: wall };
    return null;
  });
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.target, wall);
  assert.ok(Math.abs(hits[0]!.x - 50) < 1e-9);
  assert.deepEqual([hits[0]!.dirX, hits[0]!.dirY], [1, 0]);
  assert.equal(bolts.length, 1, 'only the bolt flying away survives');
  assert.ok(Math.abs(bolts[0]!.x + 100) < 1e-9);
  stepBolts(bolts, 2, () => null);
  assert.equal(bolts.length, 0, 'and then it burns out');
});

test('a bad time step moves nothing', () => {
  const bolts = [bolt(0, 1000)];
  assert.deepEqual(stepBolts(bolts, NaN, () => null), []);
  assert.equal(bolts[0]!.x, 0);
});

test('a bolt crosses a disc inside its rim and misses past it', () => {
  const t = segmentDisc([0, 0, 10], [0, 0, -30], [0, 0, 0], [0, 0, 1], 5);
  assert.ok(t !== null && Math.abs(t - 0.25) < 1e-9);
  assert.equal(segmentDisc([8, 0, 10], [8, 0, -30], [0, 0, 0], [0, 0, 1], 5), null);
  assert.equal(segmentDisc([0, 0, 10], [0, 0, 1], [0, 0, 0], [0, 0, 1], 5), null, 'stops short');
});

test('a bolt meets a band where it reaches its radius, within its width', () => {
  const t = segmentBand([79000, 0, 0], [81000, 0, 0], [0, 0, 0], [0, 1, 0], 80000, 6000);
  assert.ok(t !== null && Math.abs(t - 0.5) < 1e-9);
  assert.equal(segmentBand([79000, 4000, 0], [81000, 4000, 0], [0, 0, 0], [0, 1, 0], 80000, 6000), null, 'past the edge');
  assert.equal(segmentBand([70000, 0, 0], [71000, 0, 0], [0, 0, 0], [0, 1, 0], 80000, 6000), null, 'short of it');
});
