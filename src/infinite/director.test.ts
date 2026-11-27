import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORRIDOR, Director, Path, SEGMENT, cruiseSpeed, distance, fieldRocks, wantedSegments, type Thing } from './director.ts';

const N = 60;

test('the same seed flies the same journey', () => {
  const a = new Director(7);
  const b = new Director(7);
  for (let i = 0; i < 20; i++) assert.deepEqual(a.segment(i), b.segment(i));
  assert.notDeepEqual(new Director(8).segment(5), a.segment(5));
});

test('segments can be asked for out of order and still match', () => {
  const a = new Director(3);
  const late = a.segment(15);
  const b = new Director(3);
  for (let i = 0; i < 15; i++) b.segment(i);
  assert.deepEqual(b.segment(15), late);
});

test('the path runs through its control points, smoothly, and stays near level', () => {
  const path = new Path(11);
  for (let i = 0; i < 30; i++) {
    const p = path.at(i * SEGMENT);
    assert.ok(distance(p, path.point(i)) < 1e-6, `passes control point ${i}`);
  }
  for (let s = 0; s < 30 * SEGMENT; s += 50) {
    const a = path.tangent(s);
    const b = path.tangent(s + 50);
    const turn = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    assert.ok(turn < 0.02, `gentle at ${s}: ${turn}`);
    assert.ok(Math.abs(a[1]) < 0.35, `not too steep at ${s}`);
  }
});

test('pacing: calm start, stars rare, no repeats where repeats would bore', () => {
  for (const seed of [1, 2, 3, 1337]) {
    const d = new Director(seed);
    const kinds = Array.from({ length: 200 }, (_, i) => d.segment(i).kind);
    assert.equal(kinds[0], 'drift');
    assert.equal(kinds[1], 'field');
    const stars = kinds.flatMap((k, i) => (k === 'star' ? [i] : []));
    assert.ok(stars.length >= 5, `seed ${seed}: some stars (${stars.length})`);
    for (let k = 1; k < stars.length; k++) assert.ok(stars[k]! - stars[k - 1]! >= 6, `seed ${seed}: stars apart`);
    for (let i = 1; i < kinds.length; i++) {
      if (['nebula', 'planet', 'star', 'drift'].includes(kinds[i]!)) assert.notEqual(kinds[i], kinds[i - 1], `seed ${seed}: ${kinds[i]} twice at ${i}`);
      if (i >= 2) assert.ok(!(kinds[i] === 'field' && kinds[i - 1] === 'field' && kinds[i - 2] === 'field'), 'three fields in a row');
    }
    for (const k of ['field', 'nebula', 'planet', 'ruins', 'drift'] as const) assert.ok(kinds.includes(k), `seed ${seed}: has ${k}`);
  }
});

/** How far out a thing reaches, for the corridor check. */
function reach(t: Thing): { at: [number, number, number]; r: number } | null {
  switch (t.type) {
    case 'planet':
      return { at: t.planet.position, r: t.planet.radius * (t.planet.ring ? 2.4 : 1.05) };
    case 'star':
      return { at: t.position, r: t.radius * 2.5 };
    case 'station':
      return { at: t.position, r: t.size };
    case 'wreck':
      return { at: t.position, r: t.size * 1.5 };
    case 'graveyard':
      return { at: t.center, r: t.radius * 1.3 };
    default:
      return null;
  }
}

for (const seed of [5, 42]) {
  test(`seed ${seed}: nothing solid sits in the corridor`, () => {
    const d = new Director(seed);
    const path = d.path;
    for (let i = 0; i < N; i++) {
      for (const t of d.segment(i).things) {
        const r = reach(t);
        if (!r) continue;
        const c = path.clearance(r.at, (i - 3) * SEGMENT, (i + 4) * SEGMENT, 50);
        assert.ok(c > CORRIDOR + r.r - 25, `segment ${i}: ${t.type} at ${c.toFixed(0)} m, needs ${(CORRIDOR + r.r).toFixed(0)}`);
      }
    }
  });

  test(`seed ${seed}: fields are threaded, not blocked`, () => {
    const d = new Director(seed);
    let fields = 0;
    for (let i = 0; i < N; i++) {
      for (const t of d.segment(i).things) {
        if (t.type !== 'rocks') continue;
        const rocks = fieldRocks(t, d.path, i);
        if (t.count > 300) {
          fields++;
          assert.ok(rocks.length > t.count * 0.5, `most rocks survive (${rocks.length}/${t.count})`);
        }
        for (const r of rocks) {
          const c = d.path.clearance(r.position, (i - 1) * SEGMENT, (i + 2) * SEGMENT, 20);
          assert.ok(c > CORRIDOR + r.radius - 20, `rock at ${c.toFixed(0)} m from the path`);
        }
      }
    }
    assert.ok(fields > 5);
  });
}

test('streaming keeps one segment behind and three ahead', () => {
  assert.deepEqual(wantedSegments(0), [0, 1, 2, 3]);
  assert.deepEqual(wantedSegments(SEGMENT * 5.5), [4, 5, 6, 7, 8]);
  assert.deepEqual(wantedSegments(-10), [0, 1, 2, 3]);
});

test('the autopilot slows for fields and ruins and opens up in empty space', () => {
  assert.ok(cruiseSpeed('field') < cruiseSpeed('nebula'));
  assert.ok(cruiseSpeed('ruins') < cruiseSpeed('planet'));
  assert.ok(cruiseSpeed('drift') > cruiseSpeed('star'));
});
