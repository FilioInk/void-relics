import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashString } from '../core/rng.ts';
import { ARTIFACT_COUNT, JUNK_VARIANTS, MIN_ARTIFACT_SPACING, WORLD_RADIUS, dist, generateAsteroids, generateJunk, generateWorld, junkNormal, type Vec3 } from './generate.ts';

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

// Hashes of generateWorld() and generateAsteroids() taken before stations, satellites and the
// junk ring existed. Saves point at relic ids by position, so the old layout must not move.
const BEFORE_DEBRIS: Record<number, [string, string]> = {
  1: ['4a2142ba', '58a4b409'],
  1337: ['b7268e5b', 'b5ccff3c'],
  99991: ['dcfe9de', '60945e92'],
};

test('adding debris moved nothing that was already in the system', () => {
  for (const [seed, [world, rocks]] of Object.entries(BEFORE_DEBRIS)) {
    const w = generateWorld(Number(seed));
    const { stations: _s, graveyards: _g, junk: _j, ...old } = w;
    assert.equal(hashString(JSON.stringify(old)).toString(16), world, `world ${seed}`);
    assert.equal(hashString(JSON.stringify(generateAsteroids(w))).toString(16), rocks, `rocks ${seed}`);
  }
});

const inRocks = (p: Vec3, margin: number, w: ReturnType<typeof generateWorld>): boolean => {
  if (w.clusters.some((c) => dist(p, c.center) < c.radius + margin)) return true;
  const r = Math.hypot(p[0], p[2]);
  return r > w.belt.inner - margin && r < w.belt.outer + margin && Math.abs(p[1]) < w.belt.thickness * 2 + margin;
};

for (const seed of SEEDS) {
  test(`seed ${seed}: stations and satellite graveyards stand clear of everything`, () => {
    const w = generateWorld(seed);
    assert.ok(w.stations.length >= 3 && w.stations.length <= 4, `${w.stations.length} stations`);
    assert.ok(w.graveyards.length >= 8, `${w.graveyards.length} graveyards`);
    const sites = [...w.stations.map((s) => ({ id: s.id, p: s.position, r: s.size })), ...w.graveyards.map((g) => ({ id: g.id, p: g.center, r: g.radius }))];
    for (const s of sites) {
      assert.ok(dist(s.p, w.sun.position) > w.sun.warnRadius + s.r, `${s.id} is in the star's heat`);
      for (const p of w.planets) assert.ok(dist(s.p, p.position) > p.radius * (p.ring ? 2.4 : 1) + s.r, `${s.id} is inside ${p.id}`);
      assert.ok(!inRocks(s.p, s.r, w), `${s.id} sits among rocks`);
      for (const a of w.artifacts) assert.ok(dist(s.p, a.position) > s.r + 300, `${s.id} covers ${a.id}`);
      for (const x of w.wrecks) assert.ok(dist(s.p, x.position) > s.r + x.size * 3, `${s.id} overlaps ${x.id}`);
      assert.ok(dist(s.p, w.spawn.position) > s.r + 2000, `${s.id} is on the spawn`);
    }
    for (let i = 0; i < sites.length; i++)
      for (let j = i + 1; j < sites.length; j++) assert.ok(dist(sites[i]!.p, sites[j]!.p) > sites[i]!.r + sites[j]!.r, `${sites[i]!.id} overlaps ${sites[j]!.id}`);
  });

  test(`seed ${seed}: a junk ring circles the Earth-like world`, () => {
    const w = generateWorld(seed);
    const ring = w.junk;
    assert.ok(ring, 'there is a junk ring');
    const home = w.planets.find((p) => p.id === ring.planetId)!;
    assert.equal(home.kind, 'terran');
    assert.ok(ring.inner > home.radius * 1.3 && ring.outer > ring.inner);
    const n = junkNormal(ring);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9);
    const junk = generateJunk(w);
    let inRing = 0;
    for (const j of junk) {
      assert.ok(j.variant >= 0 && j.variant < JUNK_VARIANTS && j.size > 0);
      assert.ok(!inRocks(j.position, j.size, w), 'junk among rocks');
      for (const a of w.artifacts) assert.ok(dist(j.position, a.position) > j.size + 100, `junk on ${a.id}`);
      for (const p of w.planets) assert.ok(dist(j.position, p.position) > p.radius + j.size, `junk inside ${p.id}`);
      const d = dist(j.position, ring.center);
      if (d > ring.inner * 0.9 && d < ring.outer * 1.1) inRing++;
    }
    assert.ok(inRing > ring.count * 0.6, `most of the ring survives the clearances (${inRing}/${ring.count})`);
  });
}

test('debris is the same for the same seed', () => {
  const a = generateWorld(42);
  const b = generateWorld(42);
  assert.deepEqual([a.stations, a.graveyards, a.junk], [b.stations, b.graveyards, b.junk]);
  assert.deepEqual(generateJunk(a), generateJunk(b));
});
