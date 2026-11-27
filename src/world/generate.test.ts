import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARTIFACT_COUNT, JUNK_VARIANTS, MIN_ARTIFACT_SPACING, WORLD_RADIUS, dist, generateAsteroids, generateJunk, generateWorld, junkNormal, type Vec3 } from './generate.ts';
import { SYSTEM_FAMILIES, SYSTEM_STAR_MAX_M, gameRadius } from './stars.ts';

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

test('every class of star leaves the system playable', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 150; seed++) {
    const w = generateWorld(seed);
    const { sun } = w;
    seen.add(sun.star.family);
    assert.ok(SYSTEM_FAMILIES.includes(sun.star.family), `seed ${seed}: ${sun.star.family}`);
    assert.equal(sun.radius, gameRadius(sun.star));
    assert.ok(sun.radius <= SYSTEM_STAR_MAX_M, `seed ${seed}: ${sun.radius.toFixed(0)} m`);
    for (const p of w.planets) assert.ok(dist(p.position, sun.position) > sun.warnRadius + p.radius, `seed ${seed}: ${p.name} in the heat of a ${sun.star.spectral}`);
    assert.equal(w.artifacts.length, ARTIFACT_COUNT);
    const hot = w.artifacts.filter((a) => dist(a.position, sun.position) < sun.heatRadius);
    assert.deepEqual(hot.map((a) => a.context), ['sun'], `seed ${seed}: one dare by a ${sun.star.spectral}`);
    for (const a of w.artifacts) assert.ok(dist(a.position, sun.position) > sun.radius * 1.5, `seed ${seed}: ${a.id} inside the star`);
    assert.ok(dist(w.spawn.position, sun.position) > sun.warnRadius);
  }
  assert.deepEqual([...seen].sort(), [...SYSTEM_FAMILIES].sort(), 'every kind of star turns up');
});

// The layout of three galaxies as it was before stations, satellites and the junk ring existed
// (positions, sizes, names, the asteroid count and a sample of rocks), around the yellow sun of
// 2600 m every system had then. Saves point at relics by id, so none of this may move, except
// what the star's class moves by design: its own radius, and the dare relic, which is drawn at
// the same point of a heat zone that now has the star's size. Numbers are compared to a
// centimetre: Math.sin and friends differ in the last bit between CPUs, so an exact hash passed
// on a Mac and failed on CI.
const BEFORE_DEBRIS = JSON.parse(readFileSync(new URL('./fixtures/before-debris.json', import.meta.url), 'utf8')) as Record<
  string,
  { points: number[][]; sizes: number[]; names: string[]; contexts: string[]; rocks: number; rockSample: number[][] }
>;

const near = (a: number[], b: number[], what: string) => {
  assert.equal(a.length, b.length, what);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < 0.01, `${what}[${i}]: ${v} vs ${b[i]}`));
};

/** The heat zone of the 2600 m sun the fixture was recorded with. */
const FIXTURE_HEAT = 2600 * 1.9;

test("adding debris and the star's class moved nothing else that was already in the system", () => {
  for (const [seed, before] of Object.entries(BEFORE_DEBRIS)) {
    const w = generateWorld(Number(seed));
    const rocks = generateAsteroids(w);
    const points = [w.sun.position, ...w.planets.map((p) => p.position), ...w.clusters.map((c) => c.center), ...w.nebulae.map((n) => n.center), ...w.wrecks.map((x) => x.position), ...w.artifacts.map((a) => a.position), w.spawn.position];
    const dare = points.length - 1 - w.artifacts.length + w.artifacts.findIndex((a) => a.context === 'sun');
    const expected = before.points.map((p, i) => (i === dare ? p.map((v) => (v * w.sun.heatRadius) / FIXTURE_HEAT) : p));
    near(points.flat(), expected.flat(), `seed ${seed} positions`);
    assert.equal(w.sun.radius, gameRadius(w.sun.star));
    near([...w.planets.map((p) => p.radius), ...w.clusters.map((c) => c.radius), ...w.nebulae.map((n) => n.radius), ...w.wrecks.map((x) => x.size)], before.sizes.slice(1), `seed ${seed} sizes`);
    assert.deepEqual([w.sun.name, w.belt.name, ...w.planets.map((p) => p.name), ...w.clusters.map((c) => c.name), ...w.nebulae.map((n) => n.name), ...w.wrecks.map((x) => x.name), ...w.artifacts.map((a) => a.name)], before.names);
    assert.deepEqual(w.artifacts.map((a) => a.context), before.contexts);
    assert.equal(rocks.length, before.rocks, `seed ${seed} rock count`);
    near(rocks.filter((_, i) => i % 300 === 0).flatMap((r) => [...r.position, r.radius]), before.rockSample.flat(), `seed ${seed} rocks`);
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
