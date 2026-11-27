import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HABITAT, habitatHalfLength, habitatReach, latticePanels, latticePoint, megaFrame, megaSpheres, parseMegaPercent, type Lattice } from './megastructures.ts';
import type { Vec3 } from './generate.ts';

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
  assert.equal(parseMegaPercent('25'), 0.25);
  assert.equal(parseMegaPercent('0'), 0);
  assert.equal(parseMegaPercent('100'), 1);
  assert.equal(parseMegaPercent('12.5'), 0.125);
  for (const bad of [null, '', ' ', 'abc', '-5', '150', 'Infinity']) assert.equal(parseMegaPercent(bad), undefined, String(bad));
});
