import { hashString } from '../core/rng.ts';
import type { ArtifactContext } from '../world/generate.ts';

/**
 * What lasers can hit and what is inside. Every solid thing in the collision grid is a Target;
 * the ones with a `kind` can be broken, and some of those hold salvage. Which ones is decided by
 * a hash of the seed and the object, so the same rock always holds the same thing.
 */

export type TargetKind = 'rock' | 'satellite' | 'junk' | 'shell';

export type Target = {
  position: [number, number, number];
  radius: number;
  /** Absent for things too big to break: wrecks, station hulls. */
  kind?: TargetKind;
  /** Index into the list the kind comes from (rocks, satellites, junk, relics). */
  ref?: number;
  /** A thin disc rather than a sphere: its unit normal and its thickness (megastructure panels). */
  normal?: [number, number, number];
  thick?: number;
};

export type LootKind = 'crystal' | 'core';

/** Rocks bigger than this shrug off laser fire. */
export const MAX_BREAKABLE_ROCK = 140;

/** Relics found in these places sit sealed inside a shell of rock you have to shoot open. */
export const SEALED_CONTEXTS: ReadonlySet<ArtifactContext> = new Set<ArtifactContext>(['field', 'wreck']);
export const SHELL_RADIUS = 30;

/** Hits a target takes before it breaks; Infinity for the unbreakable. */
export function targetHp(t: Pick<Target, 'kind' | 'radius'>): number {
  switch (t.kind) {
    case 'rock':
      return t.radius > MAX_BREAKABLE_ROCK ? Infinity : Math.max(1, Math.ceil(t.radius / 14));
    case 'satellite':
      return 4;
    case 'junk':
      return 1;
    case 'shell':
      return 14;
    default:
      return Infinity;
  }
}

export const targetId = (kind: TargetKind, ref: number): string => `${kind}:${ref}`;

const LOOT_CHANCE: Record<TargetKind, number> = { rock: 0.06, satellite: 0.45, junk: 0.05, shell: 0 };

/** The salvage inside a target, if any: same seed and object, same answer, every time. */
export function lootOf(seed: number, kind: TargetKind, ref: number, radius = 0): LootKind | null {
  if (kind === 'rock' && radius > MAX_BREAKABLE_ROCK) return null;
  const roll = hashString(`${seed}:${kind}:${ref}`) / 0x100000000;
  if (roll >= LOOT_CHANCE[kind]) return null;
  return kind === 'satellite' ? 'core' : 'crystal';
}

/**
 * Where the segment a→b first enters the sphere, as a fraction 0..1 along it, or null.
 * A segment that starts inside the sphere hits at 0.
 */
export function segmentSphere(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  r: number,
): number | null {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const fx = ax - cx;
  const fy = ay - cy;
  const fz = az - cz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** A bolt in flight: position, velocity, seconds left. */
export type Bolt = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number };

export type BoltHit<T> = { target: T | null; x: number; y: number; z: number; dirX: number; dirY: number; dirZ: number };

/**
 * Moves every bolt by dt, asking `firstHit` what its path crosses. Bolts that hit something or
 * run out of life are removed in place; the hits come back for damage and sparks.
 */
export function stepBolts<T>(
  bolts: Bolt[],
  dt: number,
  firstHit: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => { t: number; target: T | null } | null,
): BoltHit<T>[] {
  const hits: BoltHit<T>[] = [];
  if (!(dt > 0) || !Number.isFinite(dt)) return hits;
  let keep = 0;
  for (const b of bolts) {
    const nx = b.x + b.vx * dt;
    const ny = b.y + b.vy * dt;
    const nz = b.z + b.vz * dt;
    const hit = firstHit(b.x, b.y, b.z, nx, ny, nz);
    if (hit) {
      const len = Math.hypot(b.vx, b.vy, b.vz) || 1;
      hits.push({
        target: hit.target,
        x: b.x + (nx - b.x) * hit.t,
        y: b.y + (ny - b.y) * hit.t,
        z: b.z + (nz - b.z) * hit.t,
        dirX: b.vx / len,
        dirY: b.vy / len,
        dirZ: b.vz / len,
      });
      continue;
    }
    b.x = nx;
    b.y = ny;
    b.z = nz;
    b.life -= dt;
    if (b.life > 0) bolts[keep++] = b;
  }
  bolts.length = keep;
  return hits;
}

/**
 * Where the segment a→b crosses a thin disc (centre c, unit normal n, radius r), as a fraction
 * 0..1 along it, or null. The bolt's own radius widens the disc.
 */
export function segmentDisc(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  n: readonly [number, number, number],
  r: number,
): number | null {
  const da = (a[0] - c[0]) * n[0] + (a[1] - c[1]) * n[1] + (a[2] - c[2]) * n[2];
  const db = (b[0] - c[0]) * n[0] + (b[1] - c[1]) * n[1] + (b[2] - c[2]) * n[2];
  if (da === db || (da > 0 && db > 0) || (da < 0 && db < 0)) return null;
  const t = da / (da - db);
  const px = a[0] + (b[0] - a[0]) * t - c[0];
  const py = a[1] + (b[1] - a[1]) * t - c[1];
  const pz = a[2] + (b[2] - a[2]) * t - c[2];
  return px * px + py * py + pz * pz <= r * r ? t : null;
}

/**
 * Where the segment a→b first meets a band (the strip of a cylinder of radius r around `axis`
 * through c, `width` wide along it), as a fraction 0..1, or null.
 */
export function segmentBand(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  axis: readonly [number, number, number],
  r: number,
  width: number,
): number | null {
  const rel = (p: readonly [number, number, number]) => {
    const d: [number, number, number] = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const z = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
    return { z, q: [d[0] - z * axis[0], d[1] - z * axis[1], d[2] - z * axis[2]] as const };
  };
  const pa = rel(a);
  const pb = rel(b);
  const dq = [pb.q[0] - pa.q[0], pb.q[1] - pa.q[1], pb.q[2] - pa.q[2]];
  const A = dq[0] * dq[0] + dq[1] * dq[1] + dq[2] * dq[2];
  const B = 2 * (pa.q[0] * dq[0] + pa.q[1] * dq[1] + pa.q[2] * dq[2]);
  const C = pa.q[0] * pa.q[0] + pa.q[1] * pa.q[1] + pa.q[2] * pa.q[2] - r * r;
  if (A < 1e-12) return null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t < 0 || t > 1) continue;
    if (Math.abs(pa.z + (pb.z - pa.z) * t) <= width / 2) return t;
  }
  return null;
}
