import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTIFACT_COUNT, MIN_ARTIFACT_SPACING, WORLD_RADIUS, dist, generateAsteroids, generateWorld } from './generate.ts';

const SEEDS = [1, 7, 1337, 2024, 99991, 123456789];

test('the same seed builds the same system', () => {
  assert.deepEqual(generateWorld(1337), generateWorld(1337));
  assert.notDeepEqual(generateWorld(1337).artifacts, generateWorld(1338).artifacts);
});

for (const seed of SEEDS) {
  test(`seed ${seed}: exactly ${ARTIFACT_COUNT} artifacts, all reachable and apart`, () => {
    const w = generateWorld(seed);
    assert.equal(w.artifacts.length, ARTIFACT_COUNT);
    assert.equal(new Set(w.artifacts.map((a) => a.id)).size, ARTIFACT_COUNT);
    for (const a of w.artifacts) {
      assert.ok(dist(a.position, w.sun.position) > w.sun.radius * 1.5, `${a.id} is inside the star`);
      assert.ok(Math.hypot(...a.position) < WORLD_RADIUS, `${a.id} is outside the map`);
      for (const p of w.planets) assert.ok(dist(a.position, p.position) > p.radius + 300, `${a.id} is inside ${p.id}`);
      assert.ok(dist(a.position, a.hint.center) < a.hint.radius, `${a.id} lies outside its own map hint`);
    }
    for (let i = 0; i < w.artifacts.length; i++)
      for (let j = i + 1; j < w.artifacts.length; j++)
        assert.ok(dist(w.artifacts[i]!.position, w.artifacts[j]!.position) >= MIN_ARTIFACT_SPACING);
  });

  test(`seed ${seed}: the system has everything the game promises`, () => {
    const w = generateWorld(seed);
    assert.equal(w.planets.length, 6);
    assert.equal(w.nebulae.length, 4, 'four nebulae');
    assert.equal(w.clusters.length, 4, 'four asteroid clusters');
    assert.ok(w.wrecks.length >= 6, 'wreck sites');
    assert.ok(w.sun.heatRadius > w.sun.radius && w.sun.warnRadius > w.sun.heatRadius);
    // Planets do not overlap the star's heat or each other.
    for (const p of w.planets) assert.ok(dist(p.position, w.sun.position) > w.sun.warnRadius + p.radius);
  });

  test(`seed ${seed}: the player starts in open space, clear of rocks and heat`, () => {
    const w = generateWorld(seed);
    const s = w.spawn.position;
    assert.ok(dist(s, w.sun.position) > w.sun.warnRadius);
    for (const p of w.planets) assert.ok(dist(s, p.position) > p.radius + 500);
    for (const a of generateAsteroids(w)) assert.ok(dist(s, a.position) > a.radius + 100);
  });
}

test('asteroids never sit on top of an artifact or inside a planet', () => {
  const w = generateWorld(1337);
  const rocks = generateAsteroids(w);
  assert.ok(rocks.length > 3000, `expected a dense system, got ${rocks.length}`);
  for (const r of rocks) {
    for (const a of w.artifacts) assert.ok(dist(r.position, a.position) > r.radius + 100);
    for (const p of w.planets) assert.ok(dist(r.position, p.position) > r.radius + p.radius);
    assert.ok(r.radius >= 10 && r.radius <= 320);
  }
});

test('exactly one artifact is placed as a dare near the star, inside the heat zone', () => {
  const w = generateWorld(1337);
  const hot = w.artifacts.filter((a) => dist(a.position, w.sun.position) < w.sun.heatRadius);
  assert.equal(hot.length, 1);
  assert.equal(hot[0]!.context, 'sun');
});
