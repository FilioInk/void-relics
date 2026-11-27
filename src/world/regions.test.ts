import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, type Vec3 } from './generate.ts';
import { SCAN_RANGE, nebulaDensityAt, regionAt, scanRange } from './regions.ts';

const w = generateWorld(1337);

test('each landmark is recognised from its own centre', () => {
  assert.equal(regionAt([0, 0, w.sun.radius * 2], w).kind, 'star');
  const neb = w.nebulae[0]!;
  const r = regionAt(neb.center, w);
  assert.ok(r.kind === 'nebula' || r.kind === 'wreck', `got ${r.kind}`);
  const wr = w.wrecks[w.wrecks.length - 1]!;
  assert.equal(regionAt(wr.position, w).id, wr.id);
  const c = w.clusters[3]!;
  const cr = regionAt(c.center, w);
  assert.ok(cr.kind === 'field' || cr.kind === 'wreck');
});

test('the belt is found in the plane between its radii, and deep space far above it', () => {
  const mid = (w.belt.inner + w.belt.outer) / 2;
  const spots: Vec3[] = [[mid, 0, 0], [0, 0, mid], [-mid, 0, 0], [0, 0, -mid]];
  const kinds = spots.map((p) => regionAt(p, w).kind);
  assert.ok(kinds.includes('belt'), kinds.join(','));
  assert.equal(regionAt([0, 30000, 0], w).kind, 'deep');
});

test('nebula density is 0 outside, 1 at the core, and halves the scanner range there', () => {
  const n = w.nebulae[0]!;
  assert.equal(nebulaDensityAt(n.center, w.nebulae).density, 1);
  assert.equal(nebulaDensityAt([n.center[0] + n.radius * 2, n.center[1], n.center[2]], [n]).density, 0);
  assert.equal(scanRange(0), SCAN_RANGE);
  assert.equal(scanRange(1), SCAN_RANGE / 2);
});

test('stations, satellite graveyards and the junk ring have regions of their own', () => {
  const s = w.stations[0]!;
  assert.deepEqual(regionAt(s.position, w), { kind: 'station', id: s.id, name: s.name });
  const g = w.graveyards[w.graveyards.length - 1]!;
  const gr = regionAt(g.center, w);
  assert.ok(gr.kind === 'graveyard' || gr.kind === 'station', `got ${gr.kind}`);
  const ring = w.junk!;
  const home = w.planets.find((p) => p.id === ring.planetId)!;
  // A point on the middle of the band, in the ring plane.
  const n = [Math.sin(ring.tilt) * Math.cos(ring.yaw), Math.cos(ring.tilt), Math.sin(ring.tilt) * Math.sin(ring.yaw)] as const;
  const side: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [n[1] * side[2] - n[2] * side[1], n[2] * side[0] - n[0] * side[2], n[0] * side[1] - n[1] * side[0]];
  const len = Math.hypot(u[0]!, u[1]!, u[2]!);
  const mid = (ring.inner + ring.outer) / 2;
  const p: Vec3 = [ring.center[0] + (u[0]! / len) * mid, ring.center[1] + (u[1]! / len) * mid, ring.center[2] + (u[2]! / len) * mid];
  const jr = regionAt(p, w);
  assert.ok(jr.kind === 'junk' || jr.kind === 'graveyard' || jr.kind === 'station', `got ${jr.kind}`);
  if (jr.kind === 'junk') assert.equal(jr.name, home.name);
  // Straight above the planet's pole of the ring is no longer the ring.
  const above: Vec3 = [ring.center[0] + n[0] * mid, ring.center[1] + n[1] * mid, ring.center[2] + n[2] * mid];
  assert.notEqual(regionAt(above, w).kind, 'junk');
});

test('a megastructure and a ringworld have regions of their own', () => {
  const w = generateWorld(7, { megaChance: 1, gigaChance: 1 });
  for (const m of w.megastructures) {
    const r = regionAt(m.shape.center, w);
    assert.equal(r.kind, m.shape.type, m.id);
    assert.equal(r.name, m.name);
  }
  // Seed 7 with every site rolled wears Dyson rings or a ringworld; find a galaxy with a ringworld.
  for (let seed = 1; seed < 40; seed++) {
    const g = generateWorld(seed, { gigaChance: 1 }).giga;
    if (g?.shape.type !== 'ringworld') continue;
    const s = g.shape;
    const above: Vec3 = [s.center[0] + s.up[0] * (s.radius - 2000), s.center[1] + s.up[1] * (s.radius - 2000), s.center[2] + s.up[2] * (s.radius - 2000)];
    assert.equal(regionAt(above, generateWorld(seed, { gigaChance: 1 })).kind, 'ringworld');
    return;
  }
  assert.fail('no ringworld in 40 galaxies');
});
