import { createRng } from '../core/rng.ts';
import type { Vec3 } from './generate.ts';

/**
 * Megastructures, as plain data: a ring gate the flight path threads, an O'Neill habitat
 * cylinder turning beside it, and a torn patch of a Dyson lattice curving overhead.
 *
 * The proportions here are shared by the director (which keeps every part of them out of the
 * flight corridor, through `megaSpheres`) and by the builders in `src/render/megastructures.ts`
 * (which draw exactly these shapes), so what is checked is what is drawn.
 */

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
 */
export const HABITAT = { mirrorTilt: 0.3, mirrorLength: 0.75, cap: 0.3, spindle: 0.3, crown: 1.5, tube: 0.07 } as const;

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
 * `?mega=<percent>` from the URL: the share of infinite-flight stretches that hold a
 * megastructure, 0 to 100. Anything else (or nothing) keeps the default.
 */
export function parseMegaPercent(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return n / 100;
}
