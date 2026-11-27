import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GIGA_CHANCE, MEGA_CHANCE, SYSTEM_SITES, bandDistance, gigaBands, megaBound, megaSpheres } from './megastructures.ts';
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

// The layout of three galaxies as it was before stations, satellites and the junk ring existed
// (positions, sizes, names, the asteroid count and a sample of rocks). Saves point at relics by
// id, so none of this may move. Numbers are compared to a centimetre: Math.sin and friends
// differ in the last bit between CPUs, so an exact hash passed on a Mac and failed on CI.
const BEFORE_DEBRIS = JSON.parse(readFileSync(new URL('./fixtures/before-debris.json', import.meta.url), 'utf8')) as Record<
  string,
  { points: number[][]; sizes: number[]; names: string[]; contexts: string[]; rocks: number; rockSample: number[][] }
>;

const near = (a: number[], b: number[], what: string) => {
  assert.equal(a.length, b.length, what);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < 0.01, `${what}[${i}]: ${v} vs ${b[i]}`));
};

test('adding debris moved nothing that was already in the system', () => {
  for (const [seed, before] of Object.entries(BEFORE_DEBRIS)) {
    const w = generateWorld(Number(seed));
    const rocks = generateAsteroids(w);
    const points = [w.sun.position, ...w.planets.map((p) => p.position), ...w.clusters.map((c) => c.center), ...w.nebulae.map((n) => n.center), ...w.wrecks.map((x) => x.position), ...w.artifacts.map((a) => a.position), w.spawn.position];
    near(points.flat(), before.points.flat(), `seed ${seed} positions`);
    near([w.sun.radius, ...w.planets.map((p) => p.radius), ...w.clusters.map((c) => c.radius), ...w.nebulae.map((n) => n.radius), ...w.wrecks.map((x) => x.size)], before.sizes, `seed ${seed} sizes`);
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

for (const seed of [1, 7, 1337, 2024]) {
  test(`seed ${seed}: mega- and gigastructures stand clear of everything`, () => {
    // Every site rolls one: as many as fit.
    const w = generateWorld(seed, { megaChance: 1, gigaChance: 1 });
    assert.ok(w.megastructures.length >= 12, `${w.megastructures.length} megastructures`);
    assert.ok(w.giga, 'a gigastructure');
    const things = [
      ...w.artifacts.map((a) => ({ id: a.id, p: a.position, r: 0 })),
      ...w.wrecks.map((x) => ({ id: x.id, p: x.position, r: x.size * 3 })),
      ...w.stations.map((x) => ({ id: x.id, p: x.position, r: x.size })),
      ...w.graveyards.map((x) => ({ id: x.id, p: x.center, r: x.radius * 1.3 })),
      ...w.planets.map((x) => ({ id: x.id, p: x.position, r: x.radius * (x.ring ? 2.4 : 1) })),
      { id: 'spawn', p: w.spawn.position, r: 2000 },
    ];
    for (const m of w.megastructures) {
      for (const { at, r } of megaSpheres(m.shape)) {
        assert.ok(dist(at, w.sun.position) > w.sun.warnRadius + r, `${m.id} is in the star's heat`);
        assert.ok(!inRocks(at, r, w), `${m.id} sits among rocks`);
        for (const x of things) assert.ok(dist(at, x.p) > x.r + r, `${m.id} (${m.shape.type}) overlaps ${x.id}`);
        if (w.junk) assert.ok(dist(at, w.junk.center) > w.junk.outer + r, `${m.id} cuts the junk ring`);
      }
      for (const o of w.megastructures) if (o !== m) assert.ok(dist(o.shape.center, m.shape.center) > megaBound(o.shape) + megaBound(m.shape), `${m.id} overlaps ${o.id}`);
    }
    for (const b of gigaBands(w.giga.shape)) {
      for (const x of things) assert.ok(bandDistance(x.p, b) > x.r + b.width / 2, `the ${w.giga.shape.type} cuts ${x.id}`);
      for (const m of w.megastructures) for (const { at, r } of megaSpheres(m.shape)) assert.ok(bandDistance(at, b) > r, `the ${w.giga.shape.type} cuts ${m.id}`);
    }
  });
}

test('a galaxy holds about two megastructures, and now and then a gigastructure', () => {
  let megas = 0;
  let gigas = 0;
  const n = 60;
  for (let seed = 1; seed <= n; seed++) {
    const w = generateWorld(seed);
    megas += w.megastructures.length;
    if (w.giga) gigas++;
  }
  const expected = SYSTEM_SITES * MEGA_CHANCE;
  assert.ok(Math.abs(megas / n - expected) < 0.7, `${(megas / n).toFixed(2)} per galaxy, expected ${expected}`);
  const gigaShare = 1 - (1 - GIGA_CHANCE) ** SYSTEM_SITES;
  assert.ok(Math.abs(gigas / n - gigaShare) < 0.2, `${gigas} of ${n} galaxies, expected ${(gigaShare * n).toFixed(0)}`);
  assert.equal(generateWorld(5, { megaChance: 0, gigaChance: 0 }).megastructures.length, 0);
  assert.equal(generateWorld(5, { gigaChance: 0 }).giga, null);
});

test('the structures move nothing else, whatever their chances', () => {
  const plain = generateWorld(42, { megaChance: 0, gigaChance: 0 });
  const full = generateWorld(42, { megaChance: 1, gigaChance: 1 });
  const strip = (w: ReturnType<typeof generateWorld>) => ({ ...w, megastructures: [], giga: null });
  assert.deepEqual(strip(full), strip(plain));
  assert.deepEqual(generateWorld(42), generateWorld(42), 'deterministic');
});
