import { createRng, type Rng } from '../core/rng.ts';
import {
  GIGA_CHANCE,
  GIGA_KINDS,
  MEGA_CHANCE,
  MEGA_KINDS,
  SYSTEM_SITES,
  bandDistance,
  chance,
  gigaBands,
  megaBound,
  megaSpheres,
  type Band,
  type Gigastructure,
  type Megastructure,
  type StructureChances,
} from './megastructures.ts';
import { makeName, roman } from './names.ts';
import { GOLDEN_SUN, gameRadius, sampleSystemStar, type Star } from './stars.ts';

/**
 * The star system as plain data. Everything the renderer draws and the game collides with is
 * decided here from one seed, so the same seed is the same system on every machine, and the
 * whole layout can be tested without a GPU.
 */

export type Vec3 = [number, number, number];

export type PlanetKind = 'lava' | 'desert' | 'rocky' | 'terran' | 'gas' | 'ice';

export type Ring = { inner: number; outer: number; tilt: number; color: number };

export type Planet = {
  id: string;
  name: string;
  kind: PlanetKind;
  position: Vec3;
  radius: number;
  orbitRadius: number;
  /** Three colours the planet shader blends between. */
  palette: [number, number, number];
  atmosphere: number;
  clouds: boolean;
  ring: Ring | null;
  axialTilt: number;
  spin: number;
  seed: number;
};

export type Sun = {
  position: Vec3;
  radius: number;
  /** Inside this distance from the centre the hull takes heat damage. */
  heatRadius: number;
  /** Inside this distance the HUD warns that the temperature is rising. */
  warnRadius: number;
  name: string;
  /** What kind of star it is: its class, temperature, radius and luminosity. */
  star: Star;
};

export type AsteroidCluster = { id: string; name: string; center: Vec3; radius: number; count: number; seed: number };

export type Belt = { name: string; inner: number; outer: number; thickness: number; count: number; seed: number };

export type Nebula = {
  id: string;
  name: string;
  center: Vec3;
  radius: number;
  colors: [number, number];
  puffs: number;
  seed: number;
};

export type Wreck = { id: string; name: string; position: Vec3; size: number; pieces: number; seed: number };

export type ArtifactContext = 'field' | 'belt' | 'nebula' | 'wreck' | 'planet' | 'deep' | 'sun';

export type Artifact = {
  id: string;
  index: number;
  name: string;
  position: Vec3;
  context: ArtifactContext;
  /** A circle on the map that contains the artifact somewhere inside it. */
  hint: { center: Vec3; radius: number };
  hue: number;
};

export type Asteroid = { position: Vec3; radius: number; variant: number; rotation: Vec3; shade: number };

/** A broken orbital station: a truss spine with modules and solar wings, or a torn wheel. */
export type Station = { id: string; name: string; kind: 'spine' | 'ring'; position: Vec3; size: number; pieces: number; seed: number };

/** A cluster of dead satellites drifting together, with loose panels around them. */
export type Graveyard = { id: string; name: string; center: Vec3; radius: number; satellites: number; seed: number };

/** A ring of orbital junk around the Earth-like world: panels, truss, tanks, foil. */
export type JunkRing = { id: string; planetId: string; center: Vec3; inner: number; outer: number; tilt: number; yaw: number; count: number; seed: number };

/** One loose bit of junk, for the renderer and the collision grid alike. */
export type Junk = { position: Vec3; size: number; variant: number; rotation: Vec3; shade: number };

/** A megastructure parked in the system: a ring gate, a habitat or a patch of Dyson lattice. */
export type SystemMega = { id: string; name: string; shape: Megastructure };
/** The system's gigastructure: Dyson rings around its star, or a ringworld around all of it. */
export type SystemGiga = { id: string; name: string; shape: Gigastructure };

export type World = {
  seed: number;
  radius: number;
  sun: Sun;
  planets: Planet[];
  belt: Belt;
  clusters: AsteroidCluster[];
  nebulae: Nebula[];
  wrecks: Wreck[];
  artifacts: Artifact[];
  spawn: { position: Vec3; lookAt: Vec3 };
  stations: Station[];
  graveyards: Graveyard[];
  junk: JunkRing | null;
  megastructures: SystemMega[];
  giga: SystemGiga | null;
};

/** The galaxy of the title screen and of a first launch (no ?seed= in the address). */
export const DEFAULT_SEED = 1337;
export const WORLD_RADIUS = 60000;
export const ARTIFACT_COUNT = 20;
export const ASTEROID_VARIANTS = 6;
export const HINT_RADIUS = 4500;
export const MIN_ARTIFACT_SPACING = 2500;
export const JUNK_VARIANTS = 4;

export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

const PLANET_PLAN: ReadonlyArray<{ orbit: number; kinds: PlanetKind[] }> = [
  { orbit: 11000, kinds: ['lava'] },
  { orbit: 17000, kinds: ['desert', 'rocky'] },
  { orbit: 23000, kinds: ['terran'] },
  { orbit: 35000, kinds: ['gas'] },
  { orbit: 44000, kinds: ['ice', 'gas'] },
  { orbit: 53000, kinds: ['ice', 'rocky'] },
];

export const PALETTES: Record<PlanetKind, Array<[number, number, number]>> = {
  lava: [[0x1a0d0a, 0x3a1a10, 0xff5a1a], [0x140c0c, 0x402018, 0xffa020]],
  desert: [[0x8a5a32, 0xc8955a, 0xe9cf9a], [0x7a3e22, 0xb8683c, 0xe6b57e]],
  rocky: [[0x3c3a38, 0x6e6660, 0xa8a098], [0x4a3c34, 0x7c6a5a, 0xb0a08c]],
  terran: [[0x0c2a5a, 0x2f6a34, 0xd8d0b0], [0x0a3050, 0x55703a, 0xe0d8c0]],
  gas: [[0x8a5c3a, 0xd8b080, 0xf2e2c4], [0x3a5a8a, 0x8ab0d8, 0xdfe8f4], [0x6a3a6a, 0xc07aa0, 0xf0d0e0]],
  ice: [[0x6a8aa8, 0xb8d4e8, 0xf4fbff], [0x5a7a9a, 0xa0c8d8, 0xeaf6fa]],
};

export const ATMOSPHERE: Record<PlanetKind, number> = {
  lava: 0xff6a2a,
  desert: 0xffc890,
  rocky: 0x9aa4b0,
  terran: 0x6aa8ff,
  gas: 0xf0d8b0,
  ice: 0xa8e0ff,
};

export const RADIUS_RANGE: Record<PlanetKind, [number, number]> = {
  lava: [500, 800],
  desert: [700, 1000],
  rocky: [600, 950],
  terran: [950, 1300],
  gas: [1900, 2700],
  ice: [900, 1400],
};

export const NEBULA_COLORS: Array<[number, number]> = [
  [0xd03cff, 0x5a2cff],
  [0x18d0c8, 0x2a6cff],
  [0xff7a2a, 0xd0204a],
  [0x40ff90, 0x14a0c0],
  [0xffc040, 0xff4a8a],
];

/** A point on a ring around the sun, with a vertical spread. */
function onOrbit(rng: Rng, radius: number, ySpread: number): Vec3 {
  const a = rng.range(0, Math.PI * 2);
  return [Math.cos(a) * radius, rng.gauss() * ySpread, Math.sin(a) * radius];
}

function insideAnyPlanet(p: Vec3, planets: Planet[], margin: number): boolean {
  return planets.some((pl) => dist(p, pl.position) < pl.radius * (pl.ring ? 2.4 : 1) + margin);
}

/** `opts` overrides the shares of sites with a mega- or gigastructure (the URL's ?mega= / ?giga=). */
export function generateWorld(seed: number, opts: StructureChances = {}): World {
  const root = createRng(seed);
  const nameRng = root.fork('names');

  // The star's class comes from its own stream: a white dwarf or a red dwarf in place of the old
  // yellow sun moves nothing else that does not depend on the star's size. The default galaxy,
  // the one on the title screen, keeps its golden sun.
  const star = seed === DEFAULT_SEED ? GOLDEN_SUN : sampleSystemStar(root.fork('star-class'));
  const sunRadius = gameRadius(star);
  const sun: Sun = {
    position: [0, 0, 0],
    radius: sunRadius,
    heatRadius: sunRadius * 1.9,
    warnRadius: sunRadius * 2.6,
    name: makeName(nameRng),
    star,
  };

  // --- planets ---------------------------------------------------------------------------
  const prng = root.fork('planets');
  const planets: Planet[] = PLANET_PLAN.map((plan, i) => {
    const kind = prng.pick(plan.kinds);
    const [rMin, rMax] = RADIUS_RANGE[kind];
    const radius = prng.range(rMin, rMax);
    const orbitRadius = plan.orbit + prng.range(-1200, 1200);
    const position = onOrbit(prng, orbitRadius, 500);
    const ring: Ring | null =
      kind === 'gas' && prng.chance(0.75)
        ? { inner: radius * 1.35, outer: radius * prng.range(2.0, 2.4), tilt: prng.range(0.15, 0.5), color: prng.pick([0xd8c4a0, 0xb0b8c8, 0xc8a890]) }
        : null;
    return {
      id: `planet-${i}`,
      name: `${sun.name} ${roman(i + 1)}`,
      kind,
      position,
      radius,
      orbitRadius,
      palette: prng.pick(PALETTES[kind]),
      atmosphere: ATMOSPHERE[kind],
      clouds: kind === 'terran' || (kind === 'ice' && prng.chance(0.4)),
      ring,
      axialTilt: prng.range(-0.4, 0.4),
      spin: prng.range(0.004, 0.012) * (prng.chance(0.15) ? -1 : 1),
      seed: prng.int(1, 1e9),
    };
  });

  // --- asteroid belt between the terran world and the gas giant ---------------------------
  const belt: Belt = { name: makeName(nameRng), inner: 27500, outer: 30500, thickness: 700, count: 2400, seed: root.fork('belt').int(1, 1e9) };

  // --- free-floating asteroid clusters ---------------------------------------------------
  const crng = root.fork('clusters');
  const clusters: AsteroidCluster[] = [];
  for (let i = 0; clusters.length < 4 && i < 400; i++) {
    const radius = crng.range(2600, 4000);
    const center = onOrbit(crng, crng.range(14000, 50000), 1500);
    const r = Math.hypot(center[0], center[2]);
    const clearOfBelt = r + radius < belt.inner - 500 || r - radius > belt.outer + 500;
    const clearOfOthers = clusters.every((c) => dist(c.center, center) > c.radius + radius + 3000);
    if (!clearOfBelt || !clearOfOthers || insideAnyPlanet(center, planets, radius + 800)) continue;
    clusters.push({ id: `cluster-${clusters.length}`, name: makeName(nameRng), center, radius, count: crng.int(380, 560), seed: crng.int(1, 1e9) });
  }

  // --- nebulae ---------------------------------------------------------------------------
  const nrng = root.fork('nebulae');
  const colors = [...NEBULA_COLORS];
  const nebulae: Nebula[] = [];
  for (let i = 0; nebulae.length < 4 && i < 400; i++) {
    const radius = nrng.range(5200, 8000);
    const center = onOrbit(nrng, nrng.range(15000, 52000), 2500);
    if (dist(center, sun.position) < sun.warnRadius + radius) continue;
    if (nebulae.some((n) => dist(n.center, center) < n.radius + radius + 4000)) continue;
    if (insideAnyPlanet(center, planets, radius * 0.6)) continue;
    const ci = nrng.int(0, colors.length - 1);
    const pair = colors.splice(ci, 1)[0] as [number, number];
    nebulae.push({ id: `nebula-${nebulae.length}`, name: makeName(nameRng), center, radius, colors: pair, puffs: nrng.int(70, 110), seed: nrng.int(1, 1e9) });
  }

  // --- wrecks: some inside clusters and nebulae, the rest in open space or high orbit -------
  const wrng = root.fork('wrecks');
  const wrecks: Wreck[] = [];
  const wreckAnchors: Vec3[] = [
    ...clusters.slice(0, 2).map((c) => add(c.center, scale(wrng.inSphere(), c.radius * 0.6))),
    ...nebulae.slice(0, 2).map((n) => add(n.center, scale(wrng.inSphere(), n.radius * 0.5))),
    ...planets.filter((p) => p.kind !== 'gas').slice(0, 2).map((p) => add(p.position, scale(wrng.onSphere(), p.radius * 2.2 + 900))),
  ];
  while (wreckAnchors.length < 8) wreckAnchors.push(onOrbit(wrng, wrng.range(13000, 55000), 2500));
  for (const anchor of wreckAnchors) {
    if (insideAnyPlanet(anchor, planets, 300) || dist(anchor, sun.position) < sun.warnRadius) continue;
    wrecks.push({ id: `wreck-${wrecks.length}`, name: makeName(nameRng), position: anchor, size: wrng.range(60, 140), pieces: wrng.int(3, 7), seed: wrng.int(1, 1e9) });
  }

  // --- artifacts -------------------------------------------------------------------------
  const arng = root.fork('artifacts');
  const placed: Artifact[] = [];
  const ok = (p: Vec3): boolean =>
    dist(p, sun.position) > sun.radius * 1.6 &&
    Math.hypot(p[0], p[1], p[2]) < WORLD_RADIUS * 0.98 &&
    !insideAnyPlanet(p, planets, 400) &&
    placed.every((a) => dist(a.position, p) > MIN_ARTIFACT_SPACING);

  const place = (context: ArtifactContext, candidate: () => Vec3): void => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const p = candidate();
      if (!ok(p)) continue;
      const offset = scale(arng.inSphere(), HINT_RADIUS * 0.6);
      offset[1] *= 0.3;
      placed.push({
        id: `relic-${placed.length}`,
        index: placed.length,
        name: makeName(nameRng, true),
        position: p,
        context,
        hint: { center: add(p, offset), radius: HINT_RADIUS },
        hue: arng.range(0, 1),
      });
      return;
    }
  };

  const plan: Array<[ArtifactContext, number]> = [
    ['field', 4], ['belt', 2], ['nebula', 4], ['wreck', 4], ['planet', 3], ['deep', 2], ['sun', 1],
  ];
  for (const [context, count] of plan) {
    for (let k = 0; k < count; k++) {
      switch (context) {
        case 'field': {
          const c = clusters[k % Math.max(1, clusters.length)];
          place(context, () => (c ? add(c.center, scale(arng.inSphere(), c.radius * 0.8)) : onOrbit(arng, arng.range(15000, 50000), 1500)));
          break;
        }
        case 'belt':
          place(context, () => onOrbit(arng, arng.range(belt.inner + 300, belt.outer - 300), belt.thickness * 0.3));
          break;
        case 'nebula': {
          const n = nebulae[k % Math.max(1, nebulae.length)];
          place(context, () => (n ? add(n.center, scale(arng.inSphere(), n.radius * 0.55)) : onOrbit(arng, arng.range(15000, 50000), 2000)));
          break;
        }
        case 'wreck': {
          const w = wrecks[k % Math.max(1, wrecks.length)];
          place(context, () => (w ? add(w.position, scale(arng.onSphere(), w.size * arng.range(2.5, 5))) : onOrbit(arng, arng.range(15000, 50000), 1500)));
          break;
        }
        case 'planet': {
          const pl = planets[(k * 2 + 1) % planets.length] as Planet;
          place(context, () => add(pl.position, scale(arng.onSphere(), pl.radius * (pl.ring ? 2.8 : 1.8) + arng.range(400, 1200))));
          break;
        }
        case 'deep':
          place(context, () => onOrbit(arng, arng.range(46000, 57000), 3500));
          break;
        case 'sun':
          // A dare: close enough to the star that the hull starts to cook on the way in.
          place(context, () => scale(arng.onSphere(), sun.heatRadius * arng.range(0.86, 0.93)));
          break;
      }
    }
  }
  // Fallback so there are always exactly ARTIFACT_COUNT, even for an unlucky seed.
  while (placed.length < ARTIFACT_COUNT) place('deep', () => onOrbit(arng, arng.range(12000, 57000), 4000));

  // --- spawn: out past the terran world, looking toward the star -------------------------
  let spawn: Vec3 = [0, 600, 38500];
  const srng = root.fork('spawn');
  for (let i = 0; i < 100; i++) {
    const clear =
      !insideAnyPlanet(spawn, planets, 2500) &&
      clusters.every((c) => dist(c.center, spawn) > c.radius + 800) &&
      dist(spawn, [0, 0, 0]) > belt.outer + 1500;
    if (clear) break;
    spawn = onOrbit(srng, srng.range(36000, 42000), 300);
  }

  const base = { seed, radius: WORLD_RADIUS, sun, planets, belt, clusters, nebulae, wrecks, artifacts: placed, spawn: { position: spawn, lookAt: [0, 0, 0] as Vec3 } };
  // Debris, then the mega- and gigastructures, come last and each from its own stream, so
  // adding them moved nothing that was already there.
  const withDebris = { ...base, ...placeDebris(base, root.fork('debris'), nameRng) };
  return { ...withDebris, ...placeStructures(withDebris, root.fork('structures'), nameRng, opts) };
}

type BaseWorld = Omit<World, 'stations' | 'graveyards' | 'junk' | 'megastructures' | 'giga'>;
type DebrisWorld = Omit<World, 'megastructures' | 'giga'>;

/** Outside every asteroid field and the belt, where no rock can be. */
function clearOfRocks(p: Vec3, margin: number, w: BaseWorld): boolean {
  if (w.clusters.some((c) => dist(p, c.center) < c.radius + margin)) return false;
  const r = Math.hypot(p[0], p[2]);
  const inBeltRing = r > w.belt.inner - margin && r < w.belt.outer + margin;
  return !(inBeltRing && Math.abs(p[1]) < w.belt.thickness * 2 + margin);
}

function placeDebris(w: BaseWorld, rng: Rng, nameRng: Rng): Pick<World, 'stations' | 'graveyards' | 'junk'> {
  const { sun, planets } = w;
  const taken: Array<{ p: Vec3; r: number }> = [];
  const clear = (p: Vec3, r: number): boolean =>
    dist(p, sun.position) > sun.warnRadius + r + 1500 &&
    Math.hypot(p[0], p[2]) < WORLD_RADIUS * 0.95 &&
    !insideAnyPlanet(p, planets, r + 600) &&
    clearOfRocks(p, r + 400, w) &&
    w.wrecks.every((x) => dist(p, x.position) > x.size * 3 + r + 800) &&
    w.artifacts.every((a) => dist(p, a.position) > r + 400) &&
    dist(p, w.spawn.position) > r + 3000 &&
    taken.every((t) => dist(p, t.p) > t.r + r + 1500);

  // Stations: one parked by a gas giant, one by a rocky world, the rest in open space.
  const stations: Station[] = [];
  const want = rng.int(3, 4);
  const gas = planets.filter((p) => p.kind === 'gas');
  const solid = planets.filter((p) => p.kind !== 'gas' && p.kind !== 'terran');
  for (let i = 0; stations.length < want && i < 300; i++) {
    const size = rng.range(150, 280);
    const host = stations.length === 0 ? gas[0] : stations.length === 1 ? solid[solid.length - 1] : undefined;
    const p: Vec3 = host
      ? add(host.position, scale(rng.onSphere(), host.radius * (host.ring ? 2.8 : 1.8) + rng.range(900, 2200)))
      : onOrbit(rng, rng.range(13000, 55000), 2500);
    if (!clear(p, size)) continue;
    taken.push({ p, r: size });
    stations.push({ id: `station-${stations.length}`, name: makeName(nameRng), kind: rng.chance(0.45) ? 'ring' : 'spine', position: p, size, pieces: rng.int(3, 6), seed: rng.int(1, 1e9) });
  }

  // Satellite graveyards: half in high orbits, half adrift.
  const graveyards: Graveyard[] = [];
  const wantG = rng.int(10, 14);
  for (let i = 0; graveyards.length < wantG && i < 600; i++) {
    const radius = rng.range(220, 500);
    const host = rng.chance(0.5) ? rng.pick(planets) : undefined;
    const p: Vec3 = host
      ? add(host.position, scale(rng.onSphere(), host.radius * (host.ring ? 2.9 : 2.2) + rng.range(600, 2500)))
      : onOrbit(rng, rng.range(12000, 56000), 3000);
    if (!clear(p, radius)) continue;
    taken.push({ p, r: radius });
    graveyards.push({ id: `graveyard-${graveyards.length}`, name: makeName(nameRng), center: p, radius, satellites: rng.int(5, 11), seed: rng.int(1, 1e9) });
  }

  // A ring of junk around the Earth-like world, tilted off its equator.
  const home = planets.find((p) => p.kind === 'terran');
  const junk: JunkRing | null = home
    ? { id: 'junk', planetId: home.id, center: home.position, inner: home.radius * 1.55, outer: home.radius * 2.25, tilt: rng.range(0.12, 0.45), yaw: rng.range(0, Math.PI * 2), count: rng.int(900, 1200), seed: rng.int(1, 1e9) }
    : null;

  return { stations, graveyards, junk };
}

// --- mega- and gigastructures ---------------------------------------------------------------

/**
 * The system has SYSTEM_SITES sites, and each rolls like a stretch of infinite flight: a
 * megastructure with the mega chance, a gigastructure with the giga chance (one at most: a
 * star wears only one). Each roll comes from its own stream, so a higher chance only adds.
 */
function placeStructures(w: DebrisWorld, rng: Rng, nameRng: Rng, opts: StructureChances): Pick<World, 'megastructures' | 'giga'> {
  const megaChance = chance(opts.megaChance, MEGA_CHANCE);
  const gigaChance = chance(opts.gigaChance, GIGA_CHANCE);
  const sites = Array.from({ length: SYSTEM_SITES }, (_, k) => k);
  const gigaShape = sites.some((k) => rng.fork(`giga-${k}`).next() < gigaChance) ? systemGiga(w, rng.fork('giga-shape')) : null;
  const giga: SystemGiga | null = gigaShape ? { id: 'giga', name: makeName(nameRng), shape: gigaShape } : null;
  const bands = gigaShape ? gigaBands(gigaShape) : [];
  const megastructures: SystemMega[] = [];
  for (const k of sites) {
    if (rng.fork(`mega-${k}`).next() >= megaChance) continue;
    const shape = systemMega(w, rng.fork(`mega-place-${k}`), megastructures, bands);
    if (shape) megastructures.push({ id: `mega-${megastructures.length}`, name: makeName(nameRng), shape });
  }
  return { megastructures, giga };
}

/** Clear of every solid thing in the system by `margin` beyond its own reach. */
function clearOfSystem(p: Vec3, margin: number, w: DebrisWorld): boolean {
  return (
    !insideAnyPlanet(p, w.planets, margin + 600) &&
    w.wrecks.every((x) => dist(p, x.position) > x.size * 3 + margin + 300) &&
    w.artifacts.every((a) => dist(p, a.position) > margin + 500) &&
    w.stations.every((s) => dist(p, s.position) > s.size + margin + 500) &&
    w.graveyards.every((g) => dist(p, g.center) > g.radius * 1.3 + margin + 500) &&
    w.clusters.every((c) => dist(p, c.center) > c.radius + margin + 400) &&
    dist(p, w.spawn.position) > margin + 3000
  );
}

/**
 * Dyson rings around the star, between its heat and the first planet, tilted until they miss
 * everything near it; or (if they cannot, or by the roll) a ringworld around the whole system,
 * past its edge, tilted so it climbs across the sky.
 */
function systemGiga(w: DebrisWorld, rng: Rng): Gigastructure {
  const sun = w.sun.position;
  const kind = rng.pick(GIGA_KINDS);
  if (kind === 'armillary') {
    for (let attempt = 0; attempt < 24; attempt++) {
      const shape: Gigastructure = { type: 'armillary', center: sun, inner: rng.range(5300, 5600), outer: rng.range(6300, 6700), rings: rng.int(3, 5), seed: rng.int(1, 1e9) };
      const bands = gigaBands(shape);
      const near = [...w.artifacts.map((a) => ({ p: a.position, r: 500 })), ...w.wrecks.map((x) => ({ p: x.position, r: x.size * 3 + 300 })), ...w.stations.map((s) => ({ p: s.position, r: s.size + 500 })), ...w.graveyards.map((g) => ({ p: g.center, r: g.radius * 1.3 + 500 })), ...w.planets.map((p) => ({ p: p.position, r: p.radius * (p.ring ? 2.4 : 1) + 600 }))];
      if (bands.every((b) => near.every((x) => bandDistance(x.p, b) > x.r + b.width / 2))) return shape;
    }
  }
  const tilt = rng.range(0.3, 0.6);
  const yaw = rng.range(0, Math.PI * 2);
  const axis: Vec3 = [Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw)];
  const up = normalize(cross(axis, [Math.cos(yaw + Math.PI / 2), 0, Math.sin(yaw + Math.PI / 2)]));
  return { type: 'ringworld', center: sun, axis, up, radius: rng.range(72000, 84000), width: rng.range(5000, 7500), seed: rng.int(1, 1e9) };
}

/** A megastructure somewhere in open space, clear of everything, or null if none fits. */
function systemMega(w: DebrisWorld, rng: Rng, placed: readonly SystemMega[], bands: readonly Band[]): Megastructure | null {
  const sun = w.sun.position;
  const kind = rng.pick(MEGA_KINDS);
  const seed = rng.int(1, 1e9);
  for (let attempt = 0; attempt < 80; attempt++) {
    const p = onOrbit(rng, rng.range(13000, 55000), 3000);
    let shape: Megastructure;
    if (kind === 'gate') {
      const a = rng.range(0, Math.PI * 2);
      shape = { type: 'gate', center: p, axis: [Math.cos(a), rng.range(-0.15, 0.15), Math.sin(a)], up: [0, 1, 0], radius: rng.range(650, 1000), seed };
    } else if (kind === 'habitat') {
      const axis = normalize([rng.range(-1, 1), rng.range(-0.4, 0.4), rng.range(-1, 1)]);
      const up = normalize(cross(cross(axis, [0, 1, 0]), axis));
      shape = { type: 'habitat', center: p, axis, up: Number.isFinite(up[0]) ? up : [1, 0, 0], radius: rng.range(450, 650), length: rng.range(2200, 2800), seed };
    } else {
      // A patch of a Dyson swarm: a piece of a sphere around the star, collectors to the light.
      const facing = normalize([sun[0] - p[0], sun[1] - p[1], sun[2] - p[2]]);
      const along = normalize(cross([0, 1, 0], facing));
      shape = { type: 'lattice', center: p, facing, along, curve: dist(p, sun), width: rng.range(1300, 1750), height: rng.range(800, 1200), cell: rng.range(95, 125), seed };
    }
    const bound = megaBound(shape);
    if (placed.some((m) => dist(m.shape.center, p) < megaBound(m.shape) + bound + 1000)) continue;
    const ok = megaSpheres(shape).every(
      ({ at, r }) =>
        dist(at, sun) > w.sun.warnRadius + r + 1500 &&
        Math.hypot(at[0], at[2]) < WORLD_RADIUS * 0.97 &&
        clearOfRocks(at, r + 400, w) &&
        clearOfSystem(at, r, w) &&
        (!w.junk || dist(at, w.junk.center) > w.junk.outer + r + 300) &&
        bands.every((b) => bandDistance(at, b) > r + 1500),
    );
    if (ok) return shape;
  }
  return null;
}

/** The plane of the junk ring: unit normal, from its tilt and yaw. */
export function junkNormal(ring: JunkRing): Vec3 {
  return [Math.sin(ring.tilt) * Math.cos(ring.yaw), Math.cos(ring.tilt), Math.sin(ring.tilt) * Math.sin(ring.yaw)];
}

/** Every piece of loose junk: the planet's ring and the panels drifting around each graveyard. */
export function generateJunk(world: World): Junk[] {
  const out: Junk[] = [];
  const keep = (p: Vec3, size: number): boolean =>
    clearOfRocks(p, size + 50, world) &&
    world.artifacts.every((a) => dist(a.position, p) > size + 150) &&
    world.planets.every((pl) => dist(pl.position, p) > pl.radius * 1.05 + size);
  const ring = world.junk;
  if (ring) {
    const rng = createRng(ring.seed);
    const n = junkNormal(ring);
    // Two axes in the ring plane.
    const u = normalize(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const v = cross(n, u);
    for (let i = 0; i < ring.count; i++) {
      const a = rng.range(0, Math.PI * 2);
      // Denser in the middle of the band.
      const t = (rng.next() + rng.next()) / 2;
      const r = ring.inner + (ring.outer - ring.inner) * t;
      const h = rng.gauss() * (ring.outer - ring.inner) * 0.05;
      const p: Vec3 = [
        ring.center[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r + n[0] * h,
        ring.center[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r + n[1] * h,
        ring.center[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r + n[2] * h,
      ];
      const size = 1.5 + 14 * Math.pow(rng.next(), 2.5);
      const piece: Junk = { position: p, size, variant: rng.int(0, JUNK_VARIANTS - 1), rotation: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)], shade: rng.range(0.6, 1) };
      if (keep(p, size)) out.push(piece);
    }
  }
  for (const g of world.graveyards) {
    const rng = createRng(g.seed ^ 0x7a11);
    const count = rng.int(20, 40);
    for (let i = 0; i < count; i++) {
      const p = add(g.center, scale(rng.inSphere(), g.radius * 1.3));
      const size = 1.5 + 9 * Math.pow(rng.next(), 2);
      const piece: Junk = { position: p, size, variant: rng.int(0, JUNK_VARIANTS - 1), rotation: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)], shade: rng.range(0.6, 1) };
      if (keep(p, size)) out.push(piece);
    }
  }
  return out;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** Power-law asteroid size: lots of pebbles, a few mountains. */
function asteroidRadius(rng: Rng, min: number, max: number): number {
  const t = Math.pow(rng.next(), 3.2);
  return min + (max - min) * t;
}

/** Keep the asteroids clear of artifacts, wrecks and planets so nothing spawns inside a rock. */
function clearOf(p: Vec3, r: number, world: World): boolean {
  if (world.artifacts.some((a) => dist(a.position, p) < r + 120)) return false;
  if (world.wrecks.some((w) => dist(w.position, p) < r + w.size * 2)) return false;
  if (world.planets.some((pl) => dist(pl.position, p) < r + pl.radius * 1.15)) return false;
  return dist(world.spawn.position, p) > r + 400;
}

/** Every asteroid in the system, for the renderer and the collision grid alike. */
export function generateAsteroids(world: World): Asteroid[] {
  const out: Asteroid[] = [];
  const brng = createRng(world.belt.seed);
  for (let i = 0; i < world.belt.count; i++) {
    const a = brng.range(0, Math.PI * 2);
    const r = brng.range(world.belt.inner, world.belt.outer);
    const position: Vec3 = [Math.cos(a) * r, brng.gauss() * world.belt.thickness * 0.4, Math.sin(a) * r];
    const radius = asteroidRadius(brng, 12, 260);
    if (!clearOf(position, radius, world)) continue;
    out.push({ position, radius, variant: brng.int(0, ASTEROID_VARIANTS - 1), rotation: [brng.range(0, 6.28), brng.range(0, 6.28), brng.range(0, 6.28)], shade: brng.range(0.55, 1) });
  }
  for (const c of world.clusters) {
    const crng = createRng(c.seed);
    for (let i = 0; i < c.count; i++) {
      const u = crng.inSphere();
      // Denser toward the middle of the cluster.
      const k = 0.35 + 0.65 * Math.hypot(u[0], u[1], u[2]);
      const position = add(c.center, [u[0] * c.radius * k, u[1] * c.radius * k * 0.55, u[2] * c.radius * k]);
      const radius = asteroidRadius(crng, 10, 320);
      if (!clearOf(position, radius, world)) continue;
      out.push({ position, radius, variant: crng.int(0, ASTEROID_VARIANTS - 1), rotation: [crng.range(0, 6.28), crng.range(0, 6.28), crng.range(0, 6.28)], shade: crng.range(0.5, 1) });
    }
  }
  return out;
}
