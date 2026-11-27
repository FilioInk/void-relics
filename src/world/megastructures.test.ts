import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HABITAT, habitatHalfLength, habitatReach, latticePanels, latticePoint, megaFrame, megaSpheres, parsePercent, type Lattice } from './megastructures.ts';
import type { Vec3 } from './generate.ts';
import { ARMILLARY_THICK, armillaryRings, bandDistance, chance, gigaBands, gigaSpheres, megaColliders, type Armillary, type Gate, type Habitat, type Ringworld } from './megastructures.ts';

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const LATTICE: Lattice = { type: 'lattice', center: [100, 2000, -500], facing: [0, -1, 0], along: [0, 0, -1], curve: 11000, width: 1500, height: 1000, cell: 110, seed: 4242 };

test('a frame is right-handed and orthonormal, z along the axis', () => {
  const { x, y, z } = megaFrame([0, 0.1, -1], [0, 1, 0]);
  for (const v of [x, y, z]) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
  assert.ok(Math.abs(dot(x, y)) < 1e-9 && Math.abs(dot(y, z)) < 1e-9 && Math.abs(dot(x, z)) < 1e-9);
  assert.ok(dot(z, [0, 0.1, -1]) > 0.99);
  assert.ok(y[1] > 0.99);
});

test('the lattice sphere passes through its centre and curves toward the path', () => {
  assert.ok(dist(latticePoint(LATTICE, 0, 0), LATTICE.center) < 1e-6);
  const edge = latticePoint(LATTICE, LATTICE.width, 0);
  // Facing is -y: the edge sits lower (nearer the path) than the centre, by about w²/2R.
  const sag = LATTICE.center[1] - edge[1];
  assert.ok(Math.abs(sag - LATTICE.width ** 2 / (2 * LATTICE.curve)) < 5, `sag ${sag}`);
});

test('lattice panels are torn at the edge, face the path, and sit inside the checked spheres', () => {
  const panels = latticePanels(LATTICE);
  const area = Math.PI * LATTICE.width * LATTICE.height;
  const full = area / (LATTICE.cell ** 2 * Math.sqrt(3) / 2);
  assert.ok(panels.length > full * 0.35 && panels.length < full * 0.95, `${panels.length} of ~${full.toFixed(0)}`);
  assert.ok(panels.some((p) => p.glow) && panels.some((p) => !p.glow));
  const spheres = megaSpheres(LATTICE);
  for (const p of panels) {
    assert.ok(dot(p.normal, LATTICE.facing) > 0.95, 'faces the hollow side');
    // The whole hexagon (circumradius ~0.58 cell) fits in some sphere.
    assert.ok(spheres.some((s) => dist(s.at, p.at) + LATTICE.cell * 0.6 < s.r), 'covered by the corridor check');
  }
  assert.deepEqual(latticePanels(LATTICE), panels, 'deterministic');
});

test('habitat spheres cover the caps, the mirrors and the crown', () => {
  const h = { type: 'habitat' as const, center: [0, 0, 0] as Vec3, axis: [0, 0, -1] as Vec3, up: [1, 0, 0] as Vec3, radius: 500, length: 2400, seed: 1 };
  const reach = habitatReach(h.radius, h.length);
  assert.ok(reach >= h.radius * (HABITAT.crown + HABITAT.tube));
  assert.ok(reach >= h.radius + Math.sin(HABITAT.mirrorTilt) * HABITAT.mirrorLength * h.length);
  const spheres = megaSpheres(h);
  const half = habitatHalfLength(h.radius, h.length);
  // Both tips of the spindle lie inside a sphere.
  for (const z of [-half, half]) assert.ok(spheres.some((s) => dist(s.at, [0, 0, z]) <= s.r));
});

test('?mega= reads a percentage and ignores nonsense', () => {
  assert.equal(parsePercent('25'), 0.25);
  assert.equal(parsePercent('0'), 0);
  assert.equal(parsePercent('100'), 1);
  assert.equal(parsePercent('12.5'), 0.125);
  for (const bad of [null, '', ' ', 'abc', '-5', '150', 'Infinity']) assert.equal(parsePercent(bad), undefined, String(bad));
});


const GATE_: Gate = { type: 'gate', center: [0, 0, 0], axis: [0, 0, -1], up: [0, 1, 0], radius: 800, seed: 3 };
const HABITAT_: Habitat = { type: 'habitat', center: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0], radius: 500, length: 2400, seed: 1 };
const RING: Ringworld = { type: 'ringworld', center: [0, 0, 0], axis: [0, 1, 0], up: [1, 0, 0], radius: 80000, width: 6000, seed: 9 };
const ARM: Armillary = { type: 'armillary', center: [0, 0, 0], inner: 5400, outer: 6600, rings: 4, seed: 12 };

test('a gate is solid all round and open through the middle', () => {
  const cs = megaColliders(GATE_);
  // A ship flying down the axis touches nothing; one at the rim does.
  for (const c of cs) assert.ok(Math.hypot(...c.position) - c.radius > GATE_.radius * 0.6);
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    const p: Vec3 = [Math.cos(a) * GATE_.radius, Math.sin(a) * GATE_.radius, 0];
    assert.ok(cs.some((c) => dist(c.position, p) < c.radius), `gap at ${a.toFixed(2)}`);
  }
});

test('the habitat bumps the ship at its hull, not far off it', () => {
  const cs = megaColliders(HABITAT_);
  const touches = (p: Vec3) => cs.some((c) => (c.normal ? false : dist(c.position, p) < c.radius + 7));
  // On the hull along its length: solid. Two hundred metres out from the middle: free.
  for (let z = -1000; z <= 1000; z += 100) assert.ok(touches([HABITAT_.radius * 0.99, 0, z]), `hull at z ${z}`);
  assert.ok(!touches([HABITAT_.radius + 200, 0, 0]));
  // The mirrors are discs, three rows of them.
  assert.ok(cs.filter((c) => c.normal).length >= 9);
});

test('lattice colliders are its panels, as discs facing the path', () => {
  const cs = megaColliders(LATTICE);
  assert.equal(cs.length, latticePanels(LATTICE).length);
  for (const c of cs) assert.ok(c.normal && dot(c.normal, LATTICE.facing) > 0.95 && c.thick! > 0);
});

test('a band is measured from its strip and its walls', () => {
  const [b] = gigaBands(RING);
  assert.ok(b && b.wall > 0 && b.thickness > 0);
  assert.ok(bandDistance([80000, 0, 0], b) < 1e-6, 'on the floor');
  assert.ok(Math.abs(bandDistance([79000, 0, 0], b) - 1000) < 1e-6, 'a kilometre above the floor');
  assert.ok(bandDistance([80000 - b.wall / 2, b.width / 2, 0], b) < 1e-6, 'on a wall');
  assert.ok(bandDistance([0, 0, 0], b) > 70000, 'the star is far from it');
});

test('every part of a gigastructure lies inside the spheres the director checks', () => {
  for (const g of [RING, ARM]) {
    const spheres = gigaSpheres(g);
    for (const b of gigaBands(g)) {
      const u: Vec3 = Math.abs(b.axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const x = [b.axis[1] * u[2] - b.axis[2] * u[1], b.axis[2] * u[0] - b.axis[0] * u[2], b.axis[0] * u[1] - b.axis[1] * u[0]] as Vec3;
      const xl = Math.hypot(...x);
      const e1 = x.map((v) => v / xl) as Vec3;
      const e2: Vec3 = [b.axis[1] * e1[2] - b.axis[2] * e1[1], b.axis[2] * e1[0] - b.axis[0] * e1[2], b.axis[0] * e1[1] - b.axis[1] * e1[0]];
      for (let a = 0; a < Math.PI * 2; a += 0.013)
        for (const across of [-0.5, 0, 0.5]) {
          const p: Vec3 = [0, 1, 2].map((k) => b.center[k]! + (e1[k]! * Math.cos(a) + e2[k]! * Math.sin(a)) * b.radius + b.axis[k]! * across * b.width) as Vec3;
          assert.ok(spheres.some((s) => dist(s.at, p) <= s.r), `${g.type} uncovered at ${a.toFixed(2)}`);
        }
    }
  }
});

test('Dyson rings are nested, tilted every which way, and never cross', () => {
  const rings = armillaryRings(ARM);
  assert.equal(rings.length, ARM.rings);
  assert.deepEqual(armillaryRings(ARM), rings, 'deterministic');
  for (let k = 0; k < rings.length; k++) {
    const r = rings[k]!;
    assert.ok(r.radius >= ARM.inner - 1e-6 && r.radius <= ARM.outer + 1e-6);
    assert.ok(Math.abs(Math.hypot(...r.axis) - 1) < 1e-9 && Math.abs(dot(r.axis, r.up)) < 1e-9);
    // Each ring lies on its own shell around the star, with room between the shells.
    if (k > 0) assert.ok(r.radius - Math.hypot(rings[k - 1]!.radius, rings[k - 1]!.width / 2) > ARMILLARY_THICK * 2);
  }
});

test('chances are clamped, and junk falls back to the default', () => {
  assert.equal(chance(undefined, 0.1), 0.1);
  assert.equal(chance(NaN, 0.1), 0.1);
  assert.equal(chance(2, 0.1), 1);
  assert.equal(chance(-1, 0.1), 0);
  assert.equal(chance(0.3, 0.1), 0.3);
});
