import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld, dist } from '../world/generate.ts';
import { nebulaDensityAt, regionAt } from '../world/regions.ts';
import { sunHeat } from './hazards.ts';
import { BENCH_SPOTS, benchSpot } from './benchSpots.ts';

for (const seed of [1337, 7, 424242]) {
  const world = generateWorld(seed);

  test(`bench spots are finite and look somewhere (seed ${seed})`, () => {
    for (const name of BENCH_SPOTS) {
      const s = benchSpot(world, name);
      assert.equal(s.name, name);
      assert.ok([...s.position, ...s.lookAt].every(Number.isFinite), name);
      assert.ok(dist(s.position, s.lookAt) > 100, name);
    }
  });

  test(`the nebula spot is at full density (seed ${seed})`, () => {
    const s = benchSpot(world, 'nebula');
    assert.equal(nebulaDensityAt(s.position, world.nebulae).density, 1);
  });

  test(`the belt spot sits at the belt and looks along it (seed ${seed})`, () => {
    const s = benchSpot(world, 'belt');
    const r = Math.hypot(s.position[0], s.position[2]);
    assert.ok(r < world.belt.inner && r > world.belt.inner - 1000);
    const lr = Math.hypot(s.lookAt[0], s.lookAt[2]);
    assert.ok(lr > world.belt.inner && lr < world.belt.outer);
    assert.equal(regionAt(s.lookAt, world).kind === 'belt' || regionAt(s.lookAt, world).kind === 'field', true);
  });

  test(`the star spot is close but takes no heat damage (seed ${seed})`, () => {
    const s = benchSpot(world, 'star');
    const heat = sunHeat(dist(s.position, world.sun.position), world.sun);
    assert.equal(heat.dps, 0);
    assert.ok(heat.level > 0, 'inside the warning zone');
  });
}
