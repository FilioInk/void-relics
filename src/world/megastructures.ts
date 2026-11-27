import { createRng } from '../core/rng.ts';
import type { Vec3 } from './generate.ts';

/**
 * Megastructures and gigastructures, as plain data.
 *
 * Megastructures are kilometres across: a ring gate, an O'Neill habitat cylinder, a torn patch
 * of a Dyson lattice. Gigastructures are hundreds of kilometres across and rarer: a ringworld
 * (a habitable band around its own star) and Dyson rings (tilted rings of collectors wrapped
 * around a star).
 *
 * The proportions here are shared by the placement code (the infinite-flight director and the
 * star system, which keep them clear of everything through `megaSpheres` / `gigaSpheres` and
 * `bandDistance`), by the collisions (`megaColliders`, `gigaBands`) and by the builders in
 * `src/render/megastructures.ts`, so what is checked is what is drawn.
 */

/**
 * The share of places that hold a megastructure: each infinite-flight stretch and each site of
 * a star system rolls for it on its own. `?mega=<percent>` in the URL overrides it.
 */
export const MEGA_CHANCE = 0.1;
/**
 * The same for gigastructures: far rarer. A place may hold both (a gigastructure stands tens of
 * kilometres off). `?giga=<percent>` in the URL overrides it.
 */
export const GIGA_CHANCE = 0.02;
/** A star system has this many sites, each rolling like a stretch of infinite flight. */
export const SYSTEM_SITES = 20;

/** Chances that override the defaults (from the URL), each 0..1. */
export type StructureChances = { megaChance?: number; gigaChance?: number };

/** A chance clamped to 0..1, or the fallback when it is missing or not a number. */
export function chance(p: number | undefined, fallback: number): number {
  return p === undefined || !Number.isFinite(p) ? fallback : Math.min(1, Math.max(0, p));
}

export type MegaKind = 'gate' | 'habitat' | 'lattice';
export const MEGA_KINDS: readonly MegaKind[] = ['gate', 'habitat', 'lattice'];

/** A ring of blocks around the path, its axis along the path; it turns slowly about it. */
export type Gate = { type: 'gate'; center: Vec3; axis: Vec3; up: Vec3; radius: number; seed: number };
/** A spinning cylinder beside the path, axis along it; `up` points from the path to it. */
export type Habitat = { type: 'habitat'; center: Vec3; axis: Vec3; up: Vec3; radius: number; length: number; seed: number };
/**
 * A patch of a sphere of radius `curve`, hollow side to the path: `facing` points from the
 * patch toward the path, `along` runs with the path. `width` and `height` are half-extents.
 */
export type Lattice = { type: 'lattice'; center: Vec3; facing: Vec3; along: Vec3; curve: number; width: number; height: number; cell: number; seed: number };
export type Megastructure = Gate | Habitat | Lattice;

/** Ring gate proportions, as fractions of its radius. Fins and pylon tops only reach outward. */
export const GATE = { blocks: 48, thick: 0.11, depth: 0.24, fin: 0.2, pylon: 2.2 } as const;
/**
 * Habitat proportions: mirrors hinged at one end and opened by `mirrorTilt` radians,
 * `mirrorLength` of the cylinder long; end caps `cap` radii deep with a spindle `spindle`
 * radii beyond; at the other end an agricultural ring `crown` radii out, its tube `tube` thick.
 * The hull and mirrors stand still (so the collisions match); only the crown turns.
 */
export const HABITAT = { mirrorTilt: 0.3, mirrorLength: 0.75, cap: 0.3, spindle: 0.3, crown: 1.5, tube: 0.07 } as const;
/** The crown's distance from the far (-z) end of the habitat, in radii. */
export const CROWN_INSET = 0.15;
/** Where the habitat's mirrors hang: over the window strips, sixths 1, 3 and 5 of the hull. */
export const habitatMirrorAngles = (): number[] => [1, 3, 5].map((s) => (s * Math.PI) / 3 + Math.PI / 6 - Math.PI / 2);

// --- vectors -------------------------------------------------------------------------------

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The right-handed frame a gate or habitat is built in: z along the axis, y toward `up`.
 * The builders orient their groups with the same three vectors.
 */
export function megaFrame(axis: Vec3, up: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const z = norm(axis);
  const x = norm(cross(up, z));
  return { x, y: cross(z, x), z };
}

/** How far a habitat reaches from its axis: the mirrors' far corners, or the crown ring if wider. */
export function habitatReach(radius: number, length: number): number {
  // A mirror is one window strip wide (a radius) and hinged just outside the hull.
  const mirror = Math.hypot(radius * 1.05 + Math.sin(HABITAT.mirrorTilt) * HABITAT.mirrorLength * length, radius * 0.5);
  return Math.max(mirror, radius * (HABITAT.crown + HABITAT.tube)) + 20;
}

/** Half the habitat's length, caps and spindles included. */
export function habitatHalfLength(radius: number, length: number): number {
  return length / 2 + radius * (HABITAT.cap + HABITAT.spindle);
}

/** A point of the lattice's sphere, `u` metres along the path and `v` across it from the centre. */
export function latticePoint(t: Lattice, u: number, v: number): Vec3 {
  const up = norm(cross(t.facing, t.along));
  const pole = add(t.center, scale(t.facing, t.curve));
  const a = u / t.curve;
  const b = v / t.curve;
  const dir = add(add(scale(t.facing, -Math.cos(a) * Math.cos(b)), scale(t.along, Math.sin(a) * Math.cos(b))), scale(up, Math.sin(b)));
  return add(pole, scale(dir, t.curve));
}

/**
 * Spheres that together hold every solid part of a megastructure: the director keeps each of
 * them clear of the corridor. Generous on purpose — they cover the shape, not trace it.
 */
export function megaSpheres(t: Megastructure): Array<{ at: Vec3; r: number }> {
  switch (t.type) {
    case 'gate': {
      // Each block, its inner light strip and the inward half of a pylon fit in a quarter radius.
      const { x, y } = megaFrame(t.axis, t.up);
      const r = t.radius * 0.26;
      return Array.from({ length: GATE.blocks }, (_, k) => {
        const a = ((k + 0.5) / GATE.blocks) * Math.PI * 2;
        return { at: add(t.center, add(scale(x, Math.cos(a) * t.radius), scale(y, Math.sin(a) * t.radius))), r };
      });
    }
    case 'habitat': {
      const { z } = megaFrame(t.axis, t.up);
      const reach = habitatReach(t.radius, t.length);
      const half = habitatHalfLength(t.radius, t.length);
      const n = Math.ceil((2 * half) / (reach * 0.5)) + 1;
      return Array.from({ length: n }, (_, k) => ({ at: add(t.center, scale(z, -half + (2 * half * k) / (n - 1))), r: reach }));
    }
    case 'lattice': {
      // A grid two cells apart over the whole ellipse (and a little past it, for the edge panels).
      const out: Array<{ at: Vec3; r: number }> = [];
      const step = t.cell * 2;
      for (let v = -t.height - step; v <= t.height + step; v += step)
        for (let u = -t.width - step; u <= t.width + step; u += step)
          if (Math.hypot(u / t.width, v / t.height) <= 1.2) out.push({ at: latticePoint(t, u, v), r: t.cell * 2.1 });
      return out;
    }
  }
}

export type LatticePanel = {
  /** Absolute position of the panel's centre. */
  at: Vec3;
  /** Unit normal, toward the hollow side (the path). */
  normal: Vec3;
  /** Grid cell: column i, row j. Odd rows sit half a cell along. */
  i: number;
  j: number;
  /** 0..1 shade of the collector. */
  tone: number;
  /** Still lit. */
  glow: boolean;
};

/**
 * The hexagonal panels of a lattice, flat sides along the path. The outline is torn (a wavy
 * ellipse), panels thin out toward it, and one breach is punched through somewhere inside.
 */
export function latticePanels(t: Lattice): LatticePanel[] {
  const rng = createRng(t.seed).fork('panels');
  const pole = add(t.center, scale(t.facing, t.curve));
  const p1 = rng.range(0, Math.PI * 2);
  const p2 = rng.range(0, Math.PI * 2);
  const breach = { u: rng.range(-0.5, 0.5) * t.width, v: rng.range(-0.5, 0.5) * t.height, r: rng.range(0.12, 0.22) * Math.min(t.width, t.height) };
  const row = (t.cell * Math.sqrt(3)) / 2;
  const jMax = Math.ceil(t.height / row);
  const iMax = Math.ceil(t.width / t.cell) + 1;
  const out: LatticePanel[] = [];
  for (let j = -jMax; j <= jMax; j++)
    for (let i = -iMax; i <= iMax; i++) {
      const u = (i + (j & 1 ? 0.5 : 0)) * t.cell;
      const v = j * row;
      const e = Math.hypot(u / t.width, v / t.height);
      const angle = Math.atan2(v / t.height, u / t.width);
      const edge = 0.8 + 0.2 * (0.6 * Math.sin(3 * angle + p1) + 0.4 * Math.sin(7 * angle + p2));
      // Every candidate draws the same numbers, so one panel's fate never shifts another's.
      const gone = rng.next();
      const tone = rng.range(0.55, 1);
      const glow = rng.chance(0.07);
      if (e > edge) continue;
      const fray = Math.max(0, (e - edge * 0.7) / (edge * 0.3));
      if (gone < 0.03 + 0.45 * fray) continue;
      if (Math.hypot(u - breach.u, v - breach.v) < breach.r) continue;
      const at = latticePoint(t, u, v);
      out.push({ at, normal: norm(sub(pole, at)), i, j, tone, glow });
    }
  return out;
}

/**
 * `?mega=<percent>` or `?giga=<percent>` from the URL: a share of places, 0 to 100, as 0..1.
 * Anything else (or nothing) keeps the default.
 */
export function parsePercent(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return n / 100;
}

// --- colliders for the star system -----------------------------------------------------------

/** A solid sphere, or with `normal` a thin disc of that radius and `thick` thickness. */
export type Collider = { position: Vec3; radius: number; normal?: Vec3; thick?: number };

/** Local frame coordinates (x, y, z) of a gate or habitat, to world. */
const toWorld = (center: Vec3, f: { x: Vec3; y: Vec3; z: Vec3 }, x: number, y: number, z: number): Vec3 =>
  add(center, add(add(scale(f.x, x), scale(f.y, y)), scale(f.z, z)));

/**
 * What the ship bumps into and the lasers hit: tighter than `megaSpheres` (which only have to
 * hold the shape), so the ship meets the hull where it is drawn.
 */
export function megaColliders(m: Megastructure): Collider[] {
  const out: Collider[] = [];
  switch (m.type) {
    case 'gate': {
      const f = megaFrame(m.axis, m.up);
      const R = m.radius;
      for (let k = 0; k < GATE.blocks; k++) {
        const a = ((k + 0.5) / GATE.blocks) * Math.PI * 2;
        out.push({ position: toWorld(m.center, f, Math.cos(a) * R, Math.sin(a) * R, 0), radius: R * 0.13 });
        if (k % (GATE.blocks / 4) === 0) out.push({ position: toWorld(m.center, f, Math.cos(a) * R * 1.07, Math.sin(a) * R * 1.07, 0), radius: R * 0.17 });
      }
      return out;
    }
    case 'habitat': {
      const f = megaFrame(m.axis, m.up);
      const R = m.radius;
      const L = m.length;
      // The hull: spheres of the hull's radius along the axis, close enough that it stays smooth.
      const end = L / 2 - R * 0.3;
      const n = Math.ceil((2 * end) / (R * 0.4));
      for (let k = 0; k <= n; k++) out.push({ position: toWorld(m.center, f, 0, 0, -end + (2 * end * k) / n), radius: R });
      for (const side of [1, -1]) {
        out.push({ position: toWorld(m.center, f, 0, 0, side * (L / 2 + R * 0.05)), radius: R * 0.5 });
        out.push({ position: toWorld(m.center, f, 0, 0, side * (L / 2 + R * (HABITAT.cap + HABITAT.spindle / 2))), radius: R * 0.2 });
      }
      // The crown ring.
      const crownZ = -L / 2 + R * CROWN_INSET;
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        out.push({ position: toWorld(m.center, f, Math.cos(a) * R * HABITAT.crown, Math.sin(a) * R * HABITAT.crown, crownZ), radius: R * HABITAT.tube * 1.15 });
      }
      // The mirrors: a row of discs down each one.
      const span = HABITAT.mirrorLength * L;
      for (const phi of habitatMirrorAngles()) {
        const radial: Vec3 = [Math.cos(phi), Math.sin(phi), 0];
        const tangent: Vec3 = [-Math.sin(phi), Math.cos(phi), 0];
        const d: Vec3 = add(scale([0, 0, 1], -Math.cos(HABITAT.mirrorTilt)), scale(radial, Math.sin(HABITAT.mirrorTilt)));
        const n = norm(cross(tangent, d));
        const hinge = scale(radial, R * 1.04);
        for (let s = R * 0.25; s < span; s += R * 0.5) {
          const local = add(add(hinge, [0, 0, L / 2]), scale(d, s));
          out.push({ position: toWorld(m.center, f, ...local), radius: R * 0.5, normal: toWorld([0, 0, 0], f, ...n), thick: 8 });
        }
      }
      return out;
    }
    case 'lattice':
      return latticePanels(m).map((p) => ({ position: p.at, radius: m.cell / Math.sqrt(3), normal: p.normal, thick: 6 }));
  }
}

/** The bounding sphere of a megastructure, for keeping two of them apart. */
export function megaBound(m: Megastructure): number {
  switch (m.type) {
    case 'gate':
      return m.radius * 1.35;
    case 'habitat':
      return Math.hypot(habitatHalfLength(m.radius, m.length), habitatReach(m.radius, m.length));
    case 'lattice':
      return Math.hypot(m.width, m.height) * 1.1;
  }
}

// --- gigastructures --------------------------------------------------------------------------

export type GigaKind = 'ringworld' | 'armillary';
export const GIGA_KINDS: readonly GigaKind[] = ['ringworld', 'armillary'];

/**
 * A band around a star (at `center`), its inner face the land, lit by the star: `axis` is the
 * normal of its plane, `width` the band's breadth along it. Rim walls stand on both edges.
 */
export type Ringworld = { type: 'ringworld'; center: Vec3; axis: Vec3; up: Vec3; radius: number; width: number; seed: number };
/** `rings` rings of collectors around a star at `center`, radii from `inner` to `outer`. */
export type Armillary = { type: 'armillary'; center: Vec3; inner: number; outer: number; rings: number; seed: number };
export type Gigastructure = Ringworld | Armillary;

/** Ringworld proportions, as fractions of its width: rim wall height and hull thickness. */
export const RINGWORLD = { wall: 0.1, hull: 0.015 } as const;

/**
 * A band: the strip of a cylinder of `radius` around `axis`, `width` wide along it and
 * `thickness` thick, with walls `wall` high standing inward on both edges (0 for none).
 */
export type Band = { center: Vec3; axis: Vec3; radius: number; width: number; thickness: number; wall: number };

export type ArmillaryRing = { radius: number; width: number; axis: Vec3; up: Vec3; speed: number; phase: number; seed: number };

/** The rings of an armillary, evenly spaced from inner to outer, each tilted its own way. */
export function armillaryRings(a: Armillary): ArmillaryRing[] {
  const rng = createRng(a.seed).fork('rings');
  return Array.from({ length: a.rings }, (_, k) => {
    const radius = a.inner + (a.outer - a.inner) * (a.rings === 1 ? 0 : k / (a.rings - 1));
    const axis = rng.onSphere();
    const up = norm(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    return { radius, width: radius * rng.range(0.035, 0.06), axis, up, speed: rng.range(0.004, 0.012) * (rng.chance(0.5) ? 1 : -1), phase: rng.range(0, Math.PI * 2), seed: rng.int(1, 1e9) };
  });
}

/** Armillary collector thickness, metres. */
export const ARMILLARY_THICK = 30;

/** The solid bands of a gigastructure: the ringworld's, or one per armillary ring. */
export function gigaBands(g: Gigastructure): Band[] {
  if (g.type === 'ringworld')
    return [{ center: g.center, axis: norm(g.axis), radius: g.radius, width: g.width, thickness: g.width * RINGWORLD.hull, wall: g.width * RINGWORLD.wall }];
  return armillaryRings(g).map((r) => ({ center: g.center, axis: r.axis, radius: r.radius, width: r.width, thickness: ARMILLARY_THICK, wall: 0 }));
}

/** Distance from p to a band's surface (its strip and walls), ignoring thickness. */
export function bandDistance(p: Vec3, b: Band): number {
  const d = sub(p, b.center);
  const z = d[0] * b.axis[0] + d[1] * b.axis[1] + d[2] * b.axis[2];
  const rho = Math.hypot(d[0] - z * b.axis[0], d[1] - z * b.axis[1], d[2] - z * b.axis[2]);
  const half = b.width / 2;
  const strip = Math.hypot(rho - b.radius, Math.max(0, Math.abs(z) - half));
  if (b.wall <= 0) return strip;
  const wall = Math.hypot(Math.abs(z) - half, Math.max(0, b.radius - b.wall - rho, rho - b.radius));
  return Math.min(strip, wall);
}

/** Spheres holding a gigastructure's bands, for keeping infinite flight's path clear of them. */
export function gigaSpheres(g: Gigastructure): Array<{ at: Vec3; r: number }> {
  const out: Array<{ at: Vec3; r: number }> = [];
  for (const b of gigaBands(g)) {
    const n = Math.max(48, Math.ceil((Math.PI * 2 * b.radius) / 2500));
    const step = (Math.PI * 2 * b.radius) / n;
    const u = norm(cross(b.axis, Math.abs(b.axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const v = cross(b.axis, u);
    const r = Math.hypot(b.width / 2, b.wall) + step / 2 + b.thickness;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      out.push({ at: add(b.center, add(scale(u, Math.cos(a) * b.radius), scale(v, Math.sin(a) * b.radius))), r });
    }
  }
  return out;
}
