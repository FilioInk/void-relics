import { createRng, type Rng } from '../core/rng.ts';
import { makeName } from '../world/names.ts';
import { ATMOSPHERE, NEBULA_COLORS, PALETTES, RADIUS_RANGE, type Asteroid, type Planet, type PlanetKind, type Vec3 } from '../world/generate.ts';
import {
  GIGA_CHANCE,
  GIGA_KINDS,
  MEGA_CHANCE,
  MEGA_KINDS,
  chance,
  gigaSpheres,
  habitatReach,
  megaSpheres,
  type Gigastructure,
  type Habitat,
  type Lattice,
  type Megastructure,
  type StructureChances,
} from '../world/megastructures.ts';
import { gameRadius, sampleStar, type Star, type StarFamily } from '../world/stars.ts';

/**
 * Infinite flight, as plain data: an endless gently curving path, and for every stretch of it a
 * scene — an asteroid field to thread, a nebula to cross, a planet or a star to pass, ruins to
 * drift by, open space to breathe, now and then a megastructure, and rarely a gigastructure
 * hanging over all of it. Everything is placed
 * outside a corridor around the path (a ring gate's path runs through its middle), so the
 * autopilot never has to dodge, and the whole thing is a pure function of the seed.
 */

/** Length of one stretch of path, in metres. */
export const SEGMENT = 6000;
/** Nothing solid comes closer to the path than this plus its own radius. */
export const CORRIDOR = 140;

export type SceneKind = 'drift' | 'field' | 'nebula' | 'planet' | 'star' | 'ruins' | 'mega';

// The shares of stretches with a megastructure and a gigastructure live with the shapes, in
// src/world/megastructures.ts, because the star system rolls its sites with the same numbers.
export { GIGA_CHANCE, MEGA_CHANCE };
/** The first stretches stay calm: no megastructure before this one, no gigastructure before the next. */
export const MEGA_FROM = 3;
export const GIGA_FROM = 4;
/**
 * A gigastructure is hundreds of kilometres across: its stretch is loaded this many stretches
 * early (it fades in) and kept this many after.
 */
export const GIGA_AHEAD = 8;
export const GIGA_BEHIND = 3;
/**
 * No part of a gigastructure comes closer to the path than this while it is loaded. The small
 * scenery keeps within about 15 km of the path, so it can never touch one; stars and planets,
 * which can stand far off (a giant star a hundred kilometres away), are checked one by one.
 */
export const GIGA_CLEAR = 20000;
/**
 * A ringworld circles a sun-like star; Dyson rings a bright one that still fits inside them
 * (against a dim red dwarf their dark collectors vanish).
 */
const GIGA_STARS: Record<'ringworld' | 'armillary', StarFamily[]> = { ringworld: ['F', 'G', 'K'], armillary: ['A', 'F', 'G'] };

export type DirectorOptions = StructureChances;

/** A thing that is a gigastructure. */
export const isGiga = (t: Thing): t is Gigastructure => t.type === 'ringworld' || t.type === 'armillary';
/** A gigastructure as made: its shape, its star, and the spheres that hold the two. */
type Giga = { shape: Gigastructure; star: Extract<Thing, { type: 'star' }>; spheres: Array<{ at: Vec3; r: number }> };

/** How far round a star nothing may come, in its radii: the disc and the brightest glow. */
const STAR_BODY = 1.3;

/** The stars and planets among some things, as spheres: what a gigastructure must miss. */
function bodies(things: readonly Thing[]): Array<{ at: Vec3; r: number }> {
  const out: Array<{ at: Vec3; r: number }> = [];
  for (const t of things) {
    if (t.type === 'star') out.push({ at: t.position, r: t.radius * STAR_BODY });
    else if (t.type === 'planet') out.push({ at: t.planet.position, r: t.planet.radius * (t.planet.ring ? 2.4 : 1.1) });
  }
  return out;
}

/** A thing that is a megastructure. */
export const isMega = (t: Thing): t is Megastructure => t.type === 'gate' || t.type === 'habitat' || t.type === 'lattice';

export type Thing =
  | { type: 'rocks'; center: Vec3; radius: number; count: number; seed: number }
  | { type: 'nebula'; center: Vec3; radius: number; colors: [number, number]; puffs: number; seed: number }
  | { type: 'planet'; planet: Planet; sun: Vec3 }
  /** A star of a real class (`star`), `radius` metres in radius in the game. */
  | { type: 'star'; position: Vec3; radius: number; name: string; star: Star }
  | { type: 'wreck'; position: Vec3; size: number; pieces: number; seed: number }
  | { type: 'station'; position: Vec3; size: number; kind: 'spine' | 'ring'; pieces: number; seed: number }
  | { type: 'graveyard'; center: Vec3; radius: number; satellites: number; seed: number }
  | Megastructure
  | Gigastructure;

export type Segment = {
  index: number;
  kind: SceneKind;
  /** A generated name for the place, for the caption. */
  name: string;
  things: Thing[];
  /** Where the light falls from in this stretch: the star nearest in the story. */
  light: Vec3;
  /** That star, for the colour and strength of its light; null before the first one. */
  lightStar: Star | null;
};

// --- vectors -------------------------------------------------------------------------------

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const distance = (a: Vec3, b: Vec3): number => len(sub(a, b));

// --- the path ------------------------------------------------------------------------------

/**
 * Control points one SEGMENT apart, each heading turned a little from the last: a random walk
 * in yaw and a pitch that keeps pulling back toward level flight. A Catmull-Rom spline runs
 * through them.
 */
export class Path {
  private readonly rng: Rng;
  private readonly points: Vec3[] = [];
  private yaw = 0;
  private pitch = 0;

  constructor(seed: number) {
    this.rng = createRng(seed).fork('path');
    this.points.push([0, 0, 0]);
  }

  private heading(): Vec3 {
    return [Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)];
  }

  /** Control point i (negative ones extend the first heading backward). */
  point(i: number): Vec3 {
    if (i < 0) return [0, 0, SEGMENT * -i];
    while (this.points.length <= i) {
      const last = this.points[this.points.length - 1]!;
      // The first stretches fly straight so the start is calm.
      if (this.points.length > 2) {
        this.yaw += this.rng.range(-0.2, 0.2);
        this.pitch = Math.max(-0.22, Math.min(0.22, this.pitch * 0.55 + this.rng.range(-0.1, 0.1)));
      }
      this.points.push(add(last, scale(this.heading(), SEGMENT)));
    }
    return this.points[i]!;
  }

  /** Position on the spline at distance s along it (s ≥ 0). */
  at(s: number): Vec3 {
    const { i, u } = split(s);
    return catmull(this.point(i - 1), this.point(i), this.point(i + 1), this.point(i + 2), u);
  }

  /** Unit direction of travel at distance s. */
  tangent(s: number): Vec3 {
    const { i, u } = split(s);
    return norm(catmullDerivative(this.point(i - 1), this.point(i), this.point(i + 1), this.point(i + 2), u));
  }

  /** A right/up frame around the path at s, with up kept as close to world up as it can be. */
  frame(s: number): { position: Vec3; forward: Vec3; right: Vec3; up: Vec3 } {
    const forward = this.tangent(s);
    const right = norm(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    return { position: this.at(s), forward, right, up };
  }

  /** Shortest distance from p to the path between distances s0 and s1, sampled every `step` metres. */
  clearance(p: Vec3, s0: number, s1: number, step = 40): number {
    let best = Infinity;
    for (let s = Math.max(0, s0); s <= s1; s += step) best = Math.min(best, distance(p, this.at(s)));
    return best;
  }
}

function split(s: number): { i: number; u: number } {
  const x = Math.max(0, s) / SEGMENT;
  const i = Math.floor(x);
  return { i, u: x - i };
}

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const u2 = u * u;
  const u3 = u2 * u;
  const f = (k: 0 | 1 | 2) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
  return [f(0), f(1), f(2)];
}

function catmullDerivative(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const u2 = u * u;
  const f = (k: 0 | 1 | 2) => 0.5 * ((-p0[k] + p2[k]) + 2 * (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u + 3 * (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u2);
  return [f(0), f(1), f(2)];
}

// --- the director --------------------------------------------------------------------------

const WEIGHTS: Record<Exclude<SceneKind, 'mega'>, number> = { drift: 0.14, field: 0.26, nebula: 0.16, planet: 0.2, star: 0.08, ruins: 0.16 };
/** A star at most this often, a planet not back to back. */
const STAR_GAP = 6;

/**
 * Hands out segments in order, remembering enough of the past to pace them: no star too soon
 * after the last, never two nebulae or planets back to back, no three fields in a row. A
 * megastructure or a gigastructure has the sky to itself: no planet or star in its stretch or
 * either side of it. Beyond that, a gigastructure and any star, planet or other gigastructure
 * loaded alongside it keep apart: whichever comes later gives way.
 */
export class Director {
  readonly path: Path;
  /** The share of stretches with a megastructure, 0..1. */
  readonly megaChance: number;
  /** The share of stretches with a gigastructure, 0..1. */
  readonly gigaChance: number;
  private readonly seed: number;
  private readonly segments: Segment[] = [];
  private lastStar = -Infinity;
  private light: Vec3 = [60000, 30000, -90000];
  private lightStar: Star | null = null;
  /** The gigastructures made so far, by stretch, with the spheres that hold them. */
  private readonly gigas = new Map<number, Giga>();

  constructor(seed: number, opts: DirectorOptions = {}) {
    this.seed = seed;
    this.path = new Path(seed);
    this.megaChance = chance(opts.megaChance, MEGA_CHANCE);
    this.gigaChance = chance(opts.gigaChance, GIGA_CHANCE);
  }

  /**
   * Whether stretch i holds a megastructure: its own roll from the seed, independent of every
   * other stretch, so the share matches `megaChance` and a higher chance only adds more.
   */
  hasMega(i: number): boolean {
    return i >= MEGA_FROM && createRng(this.seed).fork(`mega-${i}`).next() < this.megaChance;
  }

  /** Whether stretch i holds a gigastructure: a roll of its own, like `hasMega`. */
  hasGiga(i: number): boolean {
    return i >= GIGA_FROM && createRng(this.seed).fork(`giga-${i}`).next() < this.gigaChance;
  }

  /**
   * The gigastructures already made that are in memory at some point together with stretch i.
   * Stretch i is loaded while the ship is in i-3..i+1 and gigastructure k while it is in
   * k-GIGA_AHEAD..k+GIGA_BEHIND, so they overlap for k in i-GIGA_BEHIND-3 .. i+GIGA_AHEAD+1.
   */
  private gigasAlongside(i: number): Giga[] {
    const out: Giga[] = [];
    for (let k = i - GIGA_BEHIND - 3; k <= i + GIGA_AHEAD + 1; k++) {
      const g = this.gigas.get(k);
      if (g) out.push(g);
    }
    return out;
  }

  segment(i: number): Segment {
    while (this.segments.length <= i) this.segments.push(this.make(this.segments.length));
    return this.segments[i]!;
  }

  private pickKind(i: number, rng: Rng): keyof typeof WEIGHTS {
    if (i === 0) return 'drift';
    if (i === 1) return 'field';
    const prev = this.segments[i - 1]!.kind;
    const prev2 = this.segments[i - 2]?.kind;
    const nearMega = this.hasMega(i - 1) || this.hasMega(i + 1) || this.hasGiga(i - 1) || this.hasGiga(i) || this.hasGiga(i + 1);
    const allowed = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).filter((k) => {
      if (k === 'star' && i - this.lastStar < STAR_GAP) return false;
      if ((k === 'planet' || k === 'star') && nearMega) return false;
      if ((k === 'nebula' || k === 'planet' || k === 'star' || k === 'drift') && k === prev) return false;
      if (k === 'field' && prev === 'field' && prev2 === 'field') return false;
      return true;
    });
    const total = allowed.reduce((s, k) => s + WEIGHTS[k], 0);
    let r = rng.next() * total;
    for (const k of allowed) {
      r -= WEIGHTS[k];
      if (r <= 0) return k;
    }
    return allowed[allowed.length - 1]!;
  }

  private make(i: number): Segment {
    const rng = createRng(this.seed).fork(`segment-${i}`);
    let kind: SceneKind = this.hasMega(i) ? 'mega' : this.pickKind(i, rng);
    const things: Thing[] = [];
    // A gigastructure comes from its own stream and lights the stretch with its star.
    const giga = this.hasGiga(i) ? this.gigastructure(i) : null;
    if (giga) {
      this.gigas.set(i, giga);
      this.light = giga.star.position;
      this.lightStar = giga.star.star;
    }
    // A star or planet that would touch a gigastructure loaded alongside gives way to it.
    const alongside = this.gigasAlongside(i);
    const clashes = (p: Vec3, r: number) => alongside.some((g) => g.spheres.some((x) => distance(x.at, p) < x.r + r));
    const path = this.path;
    const s0 = i * SEGMENT;
    const s1 = s0 + SEGMENT;
    const name = makeName(rng);
    // Everything solid keeps clear of the path a stretch either side of its own.
    const clear = (p: Vec3, r: number) => path.clearance(p, s0 - SEGMENT, s1 + SEGMENT, 60) > CORRIDOR + r;
    /** A point off to one side of the path, `d` metres out, somewhere along this stretch. */
    const aside = (u: number, d: number, angle = rng.range(0, Math.PI * 2)): Vec3 => {
      const f = path.frame(s0 + u * SEGMENT);
      return add(f.position, add(scale(f.right, Math.cos(angle) * d), scale(f.up, Math.sin(angle) * d)));
    };
    /** Tries to place something of radius r at distance d from the path, pushing it out until clear. */
    const place = (u: number, d: number, r: number, angle?: number): Vec3 => {
      let p = aside(u, d, angle);
      for (let k = 0; k < 12 && !clear(p, r); k++) p = aside(u, d * (1.2 + k * 0.15), angle);
      return p;
    };

    switch (kind) {
      case 'field': {
        const c = aside(rng.range(0.35, 0.65), rng.range(0, 150));
        things.push({ type: 'rocks', center: c, radius: rng.range(1300, 2100), count: rng.int(380, 620), seed: rng.int(1, 1e9) });
        if (rng.chance(0.5)) {
          const r = rng.range(700, 1200);
          things.push({ type: 'rocks', center: place(rng.range(0.1, 0.9), r + rng.range(500, 1200), r), radius: r, count: rng.int(120, 220), seed: rng.int(1, 1e9) });
        }
        break;
      }
      case 'nebula': {
        const colors = rng.pick(NEBULA_COLORS);
        things.push({ type: 'nebula', center: aside(0.5, rng.range(0, 1500)), radius: rng.range(3500, 5500), colors, puffs: rng.int(70, 100), seed: rng.int(1, 1e9) });
        if (rng.chance(0.4)) things.push({ type: 'rocks', center: aside(rng.range(0.3, 0.7), rng.range(0, 300)), radius: rng.range(900, 1400), count: rng.int(60, 140), seed: rng.int(1, 1e9) });
        break;
      }
      case 'planet': {
        // A planet close enough to fill the view as it slides past, lit by a distant sun; a
        // giant sun stands further off, so that it never closes in on the path.
        const star = this.star(i);
        const radius = gameRadius(star);
        this.light = add(path.at(s0), scale(norm([rng.range(-1, 1), rng.range(-0.3, 0.6), rng.range(-1, 0.2)]), Math.max(90000, radius * 5 + 40000)));
        this.lightStar = star;
        const planet = this.planet(rng, i, 0);
        planet.position = place(rng.range(0.45, 0.7), CORRIDOR + planet.radius * rng.range(1.6, 2.4) + 400, planet.radius * (planet.ring ? 2.4 : 1.1));
        things.push({ type: 'planet', planet, sun: this.light });
        // The light still falls from where the sun is, even if a gigastructure hides its disc.
        if (!clashes(this.light, radius * STAR_BODY)) things.push({ type: 'star', position: this.light, radius, name, star });
        if (rng.chance(0.35)) {
          const moon = this.planet(rng, i, 1, ['rocky', 'ice', 'desert', 'lava']);
          moon.radius *= 0.45;
          moon.position = place(rng.range(0.15, 0.4), CORRIDOR + moon.radius * 3 + 600, moon.radius * 1.1);
          things.push({ type: 'planet', planet: moon, sun: this.light });
        }
        break;
      }
      case 'star': {
        // Passed at three to five of its own radii: a white dwarf a few kilometres off, a red
        // supergiant a wall of fire more than a hundred kilometres away.
        const star = this.star(i);
        const radius = gameRadius(star);
        const at = place(0.6, radius * rng.range(3.2, 4.6) + 1500, radius * 2.6, rng.range(-0.6, 0.6) + (rng.chance(0.5) ? 0 : Math.PI));
        // Where a gigastructure stands the star would touch, the stretch is open space instead.
        if (clashes(at, radius * STAR_BODY)) {
          kind = 'drift';
          break;
        }
        this.lastStar = i;
        this.light = at;
        this.lightStar = star;
        things.push({ type: 'star', position: at, radius, name, star });
        if (rng.chance(0.6)) {
          const planet = this.planet(rng, i, 0);
          planet.position = place(rng.range(0.15, 0.35), CORRIDOR + planet.radius * 2 + 500, planet.radius * (planet.ring ? 2.4 : 1.1));
          things.push({ type: 'planet', planet, sun: at });
        }
        break;
      }
      case 'ruins': {
        const size = rng.range(150, 260);
        if (rng.chance(0.55)) things.push({ type: 'station', position: place(0.5, CORRIDOR + size * 1.6 + rng.range(80, 400), size), size, kind: rng.chance(0.5) ? 'ring' : 'spine', pieces: rng.int(3, 6), seed: rng.int(1, 1e9) });
        else {
          const w = rng.range(70, 140);
          things.push({ type: 'wreck', position: place(0.5, CORRIDOR + w * 2 + rng.range(60, 300), w * 1.6), size: w, pieces: rng.int(3, 6), seed: rng.int(1, 1e9) });
        }
        for (let k = 0; k < rng.int(1, 2); k++) {
          const r = rng.range(200, 380);
          things.push({ type: 'graveyard', center: place(rng.range(0.15, 0.85), CORRIDOR + r * 1.4 + rng.range(50, 300), r * 1.3), radius: r, satellites: rng.int(5, 10), seed: rng.int(1, 1e9) });
        }
        break;
      }
      case 'mega':
        things.push(this.megastructure(rng, s0));
        break;
      case 'drift':
        // Open space, now and then a far planet on the horizon (not where a gigastructure stands).
        if (rng.chance(0.4)) {
          const planet = this.planet(rng, i, 0);
          planet.position = place(0.7, rng.range(14000, 22000), planet.radius * 1.2);
          if (!clashes(planet.position, planet.radius * (planet.ring ? 2.4 : 1.1))) things.push({ type: 'planet', planet, sun: this.light });
        }
        break;
    }
    if (giga) things.push(giga.shape, giga.star);
    return { index: i, kind, name, things, light: this.light, lightStar: this.lightStar };
  }

  /** The star of segment i, from its own stream so that the class never moves the rest. */
  private star(i: number): Star {
    return sampleStar(createRng(this.seed).fork(`star-${i}`));
  }

  /**
   * A gigastructure for stretch i, with its star, or null if none fits. A ringworld stands
   * across the path, its band arching overhead some 25 km up and its star far below; Dyson rings
   * circle a star some 35 km off to a side or overhead. Each try is pushed further out until no
   * part of it comes within GIGA_CLEAR of the path anywhere it is loaded; it is kept if it also
   * misses every star and planet already made alongside it and every other gigastructure.
   */
  private gigastructure(i: number): Giga | null {
    const rng = createRng(this.seed).fork(`giga-shape-${i}`);
    const path = this.path;
    const mid = path.frame(i * SEGMENT + SEGMENT / 2);
    const name = makeName(rng);
    const samples: Vec3[] = [];
    for (let s = Math.max(0, (i - GIGA_AHEAD - 1) * SEGMENT); s <= (i + GIGA_BEHIND + 4) * SEGMENT; s += 300) samples.push(path.at(s));
    const clear = (g: Gigastructure) => gigaSpheres(g).every(({ at, r }) => samples.every((q) => distance(at, q) > GIGA_CLEAR + r));
    const settle = (make: (d: number) => Gigastructure, d0: number): Gigastructure => {
      let g = make(d0);
      for (let k = 0; k < 12 && !clear(g); k++) g = make(d0 * (1.2 + k * 0.15));
      return g;
    };
    // What is already there: stars and planets of the stretches made so far that load with it,
    // and the gigastructures that share any of its time in memory (and their stars).
    const obstacles: Array<{ at: Vec3; r: number }> = [];
    for (let k = Math.max(0, i - GIGA_AHEAD - 1); k < i; k++) obstacles.push(...bodies(this.segments[k]!.things));
    for (let k = i - GIGA_AHEAD - GIGA_BEHIND - 4; k < i; k++) obstacles.push(...(this.gigas.get(k)?.spheres ?? []));
    for (let attempt = 0; attempt < 6; attempt++) {
      const kind = rng.pick(GIGA_KINDS);
      const seed = rng.int(1, 1e9);
      const starRng = createRng(this.seed).fork(`giga-star-${i}-${attempt}`);
      const star = sampleStar(starRng, starRng.pick(GIGA_STARS[kind]));
      let shape: Gigastructure;
      if (kind === 'ringworld') {
        const radius = rng.range(110000, 150000);
        const width = rng.range(6000, 9000);
        // The ring's plane holds "up"; it crosses the path square on or a little skewed.
        const yaw = rng.range(-0.35, 0.35);
        const axis = norm(add(scale(mid.forward, Math.cos(yaw)), scale(mid.right, Math.sin(yaw))));
        const h0 = rng.range(24000, 30000);
        shape = settle((h) => ({ type: 'ringworld', center: add(mid.position, scale(mid.up, -(radius - h))), axis, up: mid.up, radius, width, seed }), h0);
      } else {
        const inner = rng.range(6000, 8000);
        const outer = rng.range(10500, 13000);
        const rings = rng.int(3, 5);
        const angle = rng.range(0.15, Math.PI - 0.15);
        const dir = add(scale(mid.right, Math.cos(angle)), scale(mid.up, Math.sin(angle)));
        const d0 = rng.range(32000, 38000);
        shape = settle((d) => ({ type: 'armillary', center: add(mid.position, scale(dir, d)), inner, outer, rings, seed }), d0);
      }
      const radius = gameRadius(star);
      const spheres = [...gigaSpheres(shape), { at: shape.center, r: radius * STAR_BODY }];
      if (!clear(shape) || spheres.some((x) => obstacles.some((o) => distance(x.at, o.at) < x.r + o.r))) continue;
      return { shape, star: { type: 'star', position: shape.center, radius, name, star }, spheres };
    }
    return null;
  }

  /**
   * One megastructure in the middle of the stretch (it keeps to the middle three fifths, so
   * the neighbours' fields and ruins never reach it). A gate straddles the path; a habitat or a
   * lattice starts a set distance out and is pushed further until every part clears the corridor.
   */
  private megastructure(rng: Rng, s0: number): Megastructure {
    const path = this.path;
    const mid = path.frame(s0 + SEGMENT / 2);
    const kind = rng.pick(MEGA_KINDS);
    const seed = rng.int(1, 1e9);
    const out = (angle: number): Vec3 => add(scale(mid.right, Math.cos(angle)), scale(mid.up, Math.sin(angle)));
    // The path samples once, then every sphere checks against them.
    const samples: Vec3[] = [];
    for (let s = Math.max(0, s0 - SEGMENT); s <= s0 + 2 * SEGMENT; s += 60) samples.push(path.at(s));
    const clear = (m: Megastructure) => megaSpheres(m).every(({ at, r }) => samples.every((q) => distance(at, q) > CORRIDOR + r));
    const settle = (make: (d: number) => Megastructure, d0: number): Megastructure => {
      let m = make(d0);
      for (let k = 0; k < 12 && !clear(m); k++) m = make(d0 * (1.2 + k * 0.15));
      return m;
    };
    switch (kind) {
      case 'gate':
        return { type: 'gate', center: mid.position, axis: mid.forward, up: mid.up, radius: rng.range(650, 1000), seed };
      case 'habitat': {
        const radius = rng.range(450, 650);
        const length = rng.range(2200, 2800);
        const dir = out(rng.range(-0.8, 0.8) + (rng.chance(0.5) ? 0 : Math.PI));
        const make = (d: number): Habitat => ({ type: 'habitat', center: add(mid.position, scale(dir, d)), axis: mid.forward, up: dir, radius, length, seed });
        return settle(make, CORRIDOR + habitatReach(radius, length) + rng.range(150, 450));
      }
      case 'lattice': {
        // Off to a side or overhead, hollow side to the path.
        const dir = out(rng.range(0.25, Math.PI - 0.25));
        const curve = rng.range(9000, 14000);
        const width = rng.range(1300, 1750);
        const height = rng.range(800, 1200);
        const cell = rng.range(95, 125);
        const make = (d: number): Lattice => ({ type: 'lattice', center: add(mid.position, scale(dir, d)), facing: scale(dir, -1), along: mid.forward, curve, width, height, cell, seed });
        return settle(make, CORRIDOR + rng.range(800, 1400));
      }
    }
  }

  private planet(rng: Rng, i: number, k: number, kinds: PlanetKind[] = ['lava', 'desert', 'rocky', 'terran', 'gas', 'gas', 'ice']): Planet {
    const kind = rng.pick(kinds);
    const [rMin, rMax] = RADIUS_RANGE[kind];
    const radius = rng.range(rMin, rMax) * rng.range(0.8, 1.15);
    const ring = kind === 'gas' && rng.chance(0.7);
    return {
      id: `inf-planet-${i}-${k}`,
      name: makeName(rng),
      kind,
      position: [0, 0, 0],
      radius,
      orbitRadius: 0,
      palette: rng.pick(PALETTES[kind]),
      atmosphere: ATMOSPHERE[kind],
      clouds: kind === 'terran' || (kind === 'ice' && rng.chance(0.4)),
      ring: ring ? { inner: radius * 1.35, outer: radius * rng.range(2, 2.4), tilt: rng.range(0.15, 0.5), color: rng.pick([0xd8c4a0, 0xb0b8c8, 0xc8a890]) } : null,
      axialTilt: rng.range(-0.4, 0.4),
      spin: rng.range(0.004, 0.012),
      seed: rng.int(1, 1e9),
    };
  }
}

/** The rocks of a field, kept out of the corridor; positions are absolute. */
export function fieldRocks(thing: Extract<Thing, { type: 'rocks' }>, path: Path, segment: number): Asteroid[] {
  const rng = createRng(thing.seed);
  const out: Asteroid[] = [];
  const s0 = (segment - 1) * SEGMENT;
  const s1 = (segment + 2) * SEGMENT;
  // Coarse samples of the path near the field, enough to keep the corridor clear.
  const samples: Vec3[] = [];
  for (let s = Math.max(0, s0); s <= s1; s += 30) {
    const p = path.at(s);
    if (distance(p, thing.center) < thing.radius + 400) samples.push(p);
  }
  for (let k = 0; k < thing.count; k++) {
    const u = rng.inSphere();
    const spread = 0.35 + 0.65 * Math.hypot(u[0], u[1], u[2]);
    const p: Vec3 = add(thing.center, [u[0] * thing.radius * spread, u[1] * thing.radius * spread * 0.7, u[2] * thing.radius * spread]);
    const radius = 8 + 170 * Math.pow(rng.next(), 3.4);
    const rotation: Vec3 = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
    const variant = rng.int(0, 5);
    const shade = rng.range(0.5, 1);
    if (samples.some((q) => distance(p, q) < CORRIDOR + radius)) continue;
    out.push({ position: p, radius, variant, rotation, shade });
  }
  return out;
}

/** How far along the path a star takes to fade in after its segment loads, and out before it goes. */
export const STAR_FADE = 3000;

/**
 * How much of segment i's star shows when the ship is at s: it fades in after the segment
 * loads (three ahead) and out before it is freed (one behind), so a giant never pops. A
 * gigastructure's star keeps the gigastructure's longer window.
 */
export function starPresence(i: number, s: number, giga = false): number {
  const load = (i - (giga ? GIGA_AHEAD : 3)) * SEGMENT;
  const free = (i + (giga ? GIGA_BEHIND + 1 : 2)) * SEGMENT;
  const smooth = (a: number, b: number, x: number) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  if (!Number.isFinite(s)) return 1;
  return smooth(load + 200, load + 200 + STAR_FADE, s) * (1 - smooth(free - STAR_FADE, free - 100, s));
}

/**
 * Which segments should be in memory when the ship is at distance s: one behind, three ahead,
 * and any with a gigastructure from GIGA_AHEAD before it until GIGA_BEHIND after.
 */
export function wantedSegments(s: number, hasGiga: (i: number) => boolean = () => false): number[] {
  const i = Math.floor(Math.max(0, s) / SEGMENT);
  const out: number[] = [];
  for (let k = Math.max(0, i - GIGA_BEHIND); k <= i + GIGA_AHEAD; k++) if ((k >= i - 1 && k <= i + 3) || hasGiga(k)) out.push(k);
  return out;
}

/** Cruise speed for a kind of scene: slow through fields, ruins and megastructures, fast across open space. */
export function cruiseSpeed(kind: SceneKind): number {
  switch (kind) {
    case 'field':
      return 240;
    case 'ruins':
      return 220;
    case 'mega':
      return 320;
    case 'nebula':
      return 380;
    case 'planet':
      return 480;
    case 'star':
      return 520;
    default:
      return 1100;
  }
}
