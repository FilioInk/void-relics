import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gigaSpheres, megaSpheres } from '../world/megastructures.ts';
import {
  CORRIDOR,
  Director,
  GIGA_AHEAD,
  GIGA_BEHIND,
  GIGA_CHANCE,
  GIGA_CLEAR,
  GIGA_FROM,
  MEGA_CHANCE,
  MEGA_FROM,
  Path,
  SEGMENT,
  cruiseSpeed,
  distance,
  fieldRocks,
  isGiga,
  isMega,
  wantedSegments,
  type Thing,
} from './director.ts';

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

/** How far out a thing reaches, for the corridor check (a megastructure as the spheres that hold it). */
function reach(t: Thing): Array<{ at: [number, number, number]; r: number }> {
  if (isMega(t)) return megaSpheres(t);
  if (isGiga(t)) return gigaSpheres(t);
  const one = reachOne(t);
  return one ? [one] : [];
}

function reachOne(t: Thing): { at: [number, number, number]; r: number } | null {
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
    // Megastructures at a third of the stretches, so every kind is checked.
    const d = new Director(seed, { megaChance: 0.35 });
    const path = d.path;
    for (let i = 0; i < N; i++) {
      for (const t of d.segment(i).things)
        for (const r of reach(t)) {
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

test('megastructures turn up in the share asked for', () => {
  for (const chance of [0.05, MEGA_CHANCE, 0.3]) {
    const d = new Director(1337, { megaChance: chance });
    const n = 4000;
    let hits = 0;
    for (let i = MEGA_FROM; i < MEGA_FROM + n; i++) if (d.hasMega(i)) hits++;
    // Within four standard deviations of the binomial.
    const sd = Math.sqrt(n * chance * (1 - chance));
    assert.ok(Math.abs(hits - n * chance) < 4 * sd, `chance ${chance}: ${hits} of ${n}`);
  }
});

test('the default share is ten percent, and the URL can set it from none to every stretch', () => {
  assert.equal(new Director(1).megaChance, 0.1);
  const none = new Director(9, { megaChance: 0 });
  const all = new Director(9, { megaChance: 1 });
  for (let i = 0; i < 40; i++) {
    assert.notEqual(none.segment(i).kind, 'mega');
    assert.equal(all.segment(i).kind === 'mega', i >= MEGA_FROM, `segment ${i}`);
  }
  assert.equal(new Director(1, { megaChance: 7 }).megaChance, 1);
  assert.equal(new Director(1, { megaChance: -1 }).megaChance, 0);
  assert.equal(new Director(1, { megaChance: NaN }).megaChance, MEGA_CHANCE);
});

test('a higher chance only adds megastructures, never moves them', () => {
  const low = new Director(21, { megaChance: 0.1 });
  const high = new Director(21, { megaChance: 0.3 });
  let added = 0;
  for (let i = 0; i < 400; i++) {
    if (low.hasMega(i)) assert.ok(high.hasMega(i), `stretch ${i} lost its megastructure`);
    else if (high.hasMega(i)) added++;
  }
  assert.ok(added > 0);
});

test('a megastructure has the sky to itself and is one of three kinds', () => {
  const kinds = new Set<string>();
  for (const seed of [1, 2, 3, 1337]) {
    const d = new Director(seed, { megaChance: 0.25 });
    const segs = Array.from({ length: 160 }, (_, i) => d.segment(i));
    for (const s of segs) {
      if (s.kind !== 'mega') {
        assert.ok(!s.things.some((t) => t.type === 'gate' || t.type === 'habitat' || t.type === 'lattice'), `seed ${seed}: megastructure outside a mega stretch`);
        continue;
      }
      assert.equal(s.things.filter(isMega).length, 1);
      kinds.add(s.things[0]!.type);
      for (const k of [s.index - 1, s.index + 1]) assert.ok(!['planet', 'star'].includes(segs[k]?.kind ?? ''), `seed ${seed}: ${segs[k]?.kind} next to a megastructure at ${s.index}`);
    }
  }
  assert.deepEqual([...kinds].sort(), ['gate', 'habitat', 'lattice']);
});

test('a megastructure keeps to the middle of its stretch', () => {
  const d = new Director(77, { megaChance: 1 });
  for (let i = MEGA_FROM; i < MEGA_FROM + 30; i++) {
    const m = d.segment(i).things[0]!;
    if (m.type !== 'gate' && m.type !== 'habitat' && m.type !== 'lattice') assert.fail(`segment ${i} holds a ${m.type}`);
    const mid = d.path.frame((i + 0.5) * SEGMENT);
    for (const { at } of megaSpheres(m)) {
      // How far along the path the part sits from the middle of the stretch.
      const along = (at[0] - mid.position[0]) * mid.forward[0] + (at[1] - mid.position[1]) * mid.forward[1] + (at[2] - mid.position[2]) * mid.forward[2];
      assert.ok(Math.abs(along) < SEGMENT * 0.36, `segment ${i}: ${m.type} part ${along.toFixed(0)} m from the middle`);
    }
  }
});

test('the autopilot slows down to take in a megastructure', () => {
  assert.ok(cruiseSpeed('mega') < cruiseSpeed('nebula'));
});

test('gigastructures are rarer, and turn up in the share asked for', () => {
  assert.ok(GIGA_CHANCE < MEGA_CHANCE);
  const d = new Director(1337);
  const n = 20000;
  let hits = 0;
  for (let i = GIGA_FROM; i < GIGA_FROM + n; i++) if (d.hasGiga(i)) hits++;
  const sd = Math.sqrt(n * GIGA_CHANCE * (1 - GIGA_CHANCE));
  assert.ok(Math.abs(hits - n * GIGA_CHANCE) < 4 * sd, `${hits} of ${n}`);
  assert.equal(new Director(1, { gigaChance: 0 }).hasGiga(50), false);
});

test('a gigastructure comes with its own star, which lights its stretch', () => {
  const d = new Director(8, { gigaChance: 1, megaChance: 0 });
  const kinds = new Set<string>();
  for (let i = 0; i < GIGA_FROM + 12; i++) {
    const s = d.segment(i);
    const g = s.things.find(isGiga);
    assert.equal(!!g, i >= GIGA_FROM, `segment ${i}`);
    if (!g) continue;
    kinds.add(g.type);
    const star = s.things.find((t) => t.type === 'star');
    assert.ok(star?.type === 'star' && distance(star.position, g.center) < 1e-6, 'its star sits at its centre');
    assert.deepEqual(s.light, g.center);
    assert.ok(!['planet', 'star'].includes(s.kind));
  }
  assert.deepEqual([...kinds].sort(), ['armillary', 'ringworld']);
});

test('a ringworld arches over the path, and the path runs inside it', () => {
  const d = new Director(3, { gigaChance: 1 });
  let rings = 0;
  for (let i = GIGA_FROM; i < GIGA_FROM + 20; i++) {
    const g = d.segment(i).things.find(isGiga);
    if (g?.type !== 'ringworld') continue;
    rings++;
    const mid = d.path.at((i + 0.5) * SEGMENT);
    const fromCenter = distance(mid, g.center);
    assert.ok(fromCenter < g.radius, 'inside the ring');
    const overhead = g.radius - fromCenter;
    assert.ok(overhead > GIGA_CLEAR && overhead < 90000, `band ${overhead.toFixed(0)} m overhead`);
  }
  assert.ok(rings > 3);
});

for (const seed of [5, 42]) {
  test(`seed ${seed}: a gigastructure stays clear of the path and of everything loaded with it`, () => {
    const d = new Director(seed, { gigaChance: 0.15, megaChance: 0.2 });
    let checked = 0;
    for (let k = GIGA_FROM; k < 70; k++) {
      const g = d.segment(k).things.find(isGiga);
      if (!g) continue;
      checked++;
      const spheres = gigaSpheres(g);
      // The ship is somewhere in k-GIGA_AHEAD..k+GIGA_BEHIND while it is loaded.
      for (let s = Math.max(0, (k - GIGA_AHEAD) * SEGMENT); s <= (k + GIGA_BEHIND + 1) * SEGMENT; s += 250) {
        const p = d.path.at(s);
        for (const x of spheres) assert.ok(distance(p, x.at) > GIGA_CLEAR + x.r - 300, `segment ${k}: ${g.type} too near the path`);
      }
      // Everything in memory alongside it keeps clear of it (a star by its body, not its glow).
      for (let i = Math.max(0, k - GIGA_AHEAD - 1); i <= k + GIGA_BEHIND + 3; i++)
        for (const t of d.segment(i).things) {
          if (isGiga(t) || (t.type === 'star' && i === k)) continue;
          const r = t.type === 'star' ? { at: t.position, r: t.radius * 1.2 } : reach(t)[0];
          if (!r) continue;
          for (const x of spheres) assert.ok(distance(r.at, x.at) > r.r + x.r * 0.5, `segment ${i}: a ${t.type} touches the ${g.type} of ${k}`);
        }
    }
    assert.ok(checked > 3);
  });
}

test('a gigastructure is loaded early and kept a while', () => {
  const at = (i: number) => wantedSegments((i + 0.5) * SEGMENT, (k) => k === 20);
  assert.ok(!at(20 - GIGA_AHEAD - 1).includes(20));
  assert.ok(at(20 - GIGA_AHEAD).includes(20));
  assert.ok(at(20 + GIGA_BEHIND).includes(20));
  assert.ok(!at(20 + GIGA_BEHIND + 1).includes(20));
  assert.deepEqual(at(5), [4, 5, 6, 7, 8]);
});
