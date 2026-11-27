import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { HULL_MAX, REPAIR_DELAY, collideBand, collideDisc, collideSphere, createHull, damageHull, impactDamage, repairHull, sunHeat, tickHull } from './hazards.ts';

const sun = { radius: 2600, heatRadius: 2600 * 1.9, warnRadius: 2600 * 2.6 };

test('no heat damage far from the star, and no warning either', () => {
  assert.deepEqual(sunHeat(20000, sun), { dps: 0, level: 0, lethal: false });
});

test('between the warning and heat radius the HUD warns but the hull is safe', () => {
  const h = sunHeat((sun.warnRadius + sun.heatRadius) / 2, sun);
  assert.equal(h.dps, 0);
  assert.ok(h.level > 0 && h.level < 1);
});

test('heat damage grows the closer the ship gets', () => {
  const far = sunHeat(sun.heatRadius - 200, sun).dps;
  const near = sunHeat(sun.radius + 200, sun).dps;
  assert.ok(far > 0 && near > far * 10);
});

test('touching the surface is lethal', () => {
  assert.equal(sunHeat(sun.radius - 1, sun).lethal, true);
});

test('the hull breaks at zero and repairs itself only after a quiet spell', () => {
  const h = createHull();
  damageHull(h, 30);
  assert.equal(h.hp, HULL_MAX - 30);
  tickHull(h, REPAIR_DELAY / 2);
  assert.equal(h.hp, HULL_MAX - 30, 'no repair during the grace period');
  tickHull(h, REPAIR_DELAY);
  assert.ok(h.hp > HULL_MAX - 30);
  damageHull(h, 1000);
  assert.equal(h.hp, 0);
  assert.equal(h.destroyed, true);
  tickHull(h, 100);
  assert.equal(h.hp, 0, 'a wreck does not repair itself');
  repairHull(h);
  assert.equal(h.hp, HULL_MAX);
  assert.equal(h.destroyed, false);
});

test('negative or NaN damage is ignored', () => {
  const h = createHull();
  damageHull(h, -5);
  damageHull(h, Number.NaN);
  assert.equal(h.hp, HULL_MAX);
});

test('flying into a rock pushes the ship out and bounces it back', () => {
  const pos = new Vector3(0, 0, 105);
  const vel = new Vector3(0, 0, -200);
  const impact = collideSphere(pos, vel, 10, new Vector3(0, 0, 0), 100);
  assert.equal(impact, 200);
  assert.ok(pos.z >= 110 - 1e-9, 'outside the rock');
  assert.ok(vel.z > 0, 'moving away');
});

test('no contact, no change', () => {
  const pos = new Vector3(0, 0, 500);
  const vel = new Vector3(0, 0, -200);
  assert.equal(collideSphere(pos, vel, 10, new Vector3(), 100), 0);
  assert.equal(vel.z, -200);
});

test('impact damage: a scrape is free, a boosted ram hurts but is capped', () => {
  assert.equal(impactDamage(30), 0);
  assert.ok(impactDamage(280) > 10);
  assert.equal(impactDamage(1e6), 120);
});

test('a thin disc stops the ship on the side it came from, even a step past its middle', () => {
  const n = [0, 0, 1] as const;
  // Coming in along -z from the front, a sub-step that lands just behind the plane.
  const p = new Vector3(0, 0, -1);
  const v = new Vector3(0, 0, -100);
  const hit = collideDisc(p, v, 7, [0, 0, 0], n, 50, 6);
  assert.equal(hit, 100);
  assert.ok(Math.abs(p.z - 10) < 1e-9, `pushed back to the front: ${p.z}`);
  assert.ok(v.z > 0, 'bounced');
  // Past the rim, or clear of the slab: no contact.
  assert.equal(collideDisc(new Vector3(60, 0, 0), new Vector3(0, 0, -100), 7, [0, 0, 0], n, 50, 6), 0);
  assert.equal(collideDisc(new Vector3(0, 0, 20), new Vector3(0, 0, -100), 7, [0, 0, 0], n, 50, 6), 0);
});

test('a band holds the ship off its floor and its walls', () => {
  const band = { center: [0, 0, 0] as const, axis: [0, 1, 0] as const, radius: 80000, width: 6000, thickness: 90, wall: 600 };
  // Diving at the floor from inside the ring: pushed back inward.
  const p = new Vector3(79970, 0, 0);
  const v = new Vector3(200, 0, 0);
  assert.ok(collideBand(p, v, 7, band) > 0);
  assert.ok(Math.abs(p.x - (80000 - 52)) < 1e-6, `${p.x}`);
  assert.ok(v.x < 0);
  // Flying into a rim wall from the land side: pushed back along the axis.
  const q = new Vector3(79800, 2990, 0);
  const w = new Vector3(0, 150, 0);
  assert.ok(collideBand(q, w, 7, band) > 0);
  assert.ok(q.y < 3000 - 50, `${q.y}`);
  // Well above the land, or past the edge: nothing.
  assert.equal(collideBand(new Vector3(70000, 0, 0), new Vector3(100, 0, 0), 7, band), 0);
  assert.equal(collideBand(new Vector3(80000, 5000, 0), new Vector3(100, 0, 0), 7, band), 0);
});
