import type { Vector3 } from 'three';
import type { Sun } from '../world/generate.ts';

/** Heat from the star: none outside heatRadius, rising steeply toward the surface. */
export const SUN_MAX_DPS = 75;

export type Heat = {
  /** Hull damage per second at this distance. */
  dps: number;
  /** 0 outside the warning radius, 1 at the surface: drives the screen glow and the alarm. */
  level: number;
  /** Touching the photosphere is instant death. */
  lethal: boolean;
};

export function sunHeat(distance: number, sun: Pick<Sun, 'radius' | 'heatRadius' | 'warnRadius'>): Heat {
  if (distance <= sun.radius) return { dps: Infinity, level: 1, lethal: true };
  const level = Math.max(0, Math.min(1, (sun.warnRadius - distance) / (sun.warnRadius - sun.radius)));
  if (distance >= sun.heatRadius) return { dps: 0, level, lethal: false };
  const t = (sun.heatRadius - distance) / (sun.heatRadius - sun.radius);
  return { dps: SUN_MAX_DPS * t * t, level, lethal: false };
}

/** Hull state with a short grace period before self-repair kicks in. */
export type Hull = { hp: number; max: number; sinceDamage: number; destroyed: boolean };

export const HULL_MAX = 100;
export const REPAIR_DELAY = 6;
export const REPAIR_RATE = 3;

export function createHull(): Hull {
  return { hp: HULL_MAX, max: HULL_MAX, sinceDamage: REPAIR_DELAY, destroyed: false };
}

export function damageHull(h: Hull, amount: number): void {
  if (h.destroyed || !(amount > 0)) return;
  h.hp = Math.max(0, h.hp - amount);
  h.sinceDamage = 0;
  if (h.hp <= 0) h.destroyed = true;
}

export function tickHull(h: Hull, dt: number): void {
  if (h.destroyed) return;
  h.sinceDamage += dt;
  if (h.sinceDamage >= REPAIR_DELAY) h.hp = Math.min(h.max, h.hp + REPAIR_RATE * dt);
}

export function repairHull(h: Hull): void {
  h.hp = h.max;
  h.destroyed = false;
  h.sinceDamage = REPAIR_DELAY;
}

/**
 * Pushes the ship out of a solid sphere and bounces it off. Returns the impact speed along
 * the contact normal (0 when there was no contact), which the caller turns into damage.
 */
export function collideSphere(position: Vector3, velocity: Vector3, shipRadius: number, center: Vector3, radius: number, restitution = 0.35): number {
  const dx = position.x - center.x;
  const dy = position.y - center.y;
  const dz = position.z - center.z;
  const d = Math.hypot(dx, dy, dz);
  const minD = radius + shipRadius;
  if (d >= minD) return 0;
  const nx = d > 1e-6 ? dx / d : 0;
  const ny = d > 1e-6 ? dy / d : 1;
  const nz = d > 1e-6 ? dz / d : 0;
  position.set(center.x + nx * minD, center.y + ny * minD, center.z + nz * minD);
  const vn = velocity.x * nx + velocity.y * ny + velocity.z * nz;
  if (vn >= 0) return 0;
  const j = -(1 + restitution) * vn;
  velocity.x += j * nx;
  velocity.y += j * ny;
  velocity.z += j * nz;
  return -vn;
}

/** Damage from hitting something at a given speed: scrapes are free, ramming at boost is not. */
export function impactDamage(speed: number): number {
  const free = 40;
  if (speed <= free) return 0;
  return Math.min(120, (speed - free) * 0.11);
}

type V3 = { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown };

/** Bounces velocity off a surface with unit normal n (pointing to where the ship belongs). */
function bounce(velocity: V3, nx: number, ny: number, nz: number, restitution: number): number {
  const vn = velocity.x * nx + velocity.y * ny + velocity.z * nz;
  if (vn >= 0) return 0;
  const j = -(1 + restitution) * vn;
  velocity.set(velocity.x + j * nx, velocity.y + j * ny, velocity.z + j * nz);
  return -vn;
}

/**
 * Pushes the ship off a thin disc (a lattice panel, a stretch of mirror): out of a slab
 * `thick` thick within `radius` of the centre. Inside the slab it goes back to the side it came
 * from (against its velocity), so one fast sub-step never pops it through to the other side.
 * Returns the impact speed, like `collideSphere`.
 */
export function collideDisc(
  position: V3,
  velocity: V3,
  shipRadius: number,
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
  radius: number,
  thick: number,
  restitution = 0.35,
): number {
  const dx = position.x - center[0];
  const dy = position.y - center[1];
  const dz = position.z - center[2];
  const d = dx * normal[0] + dy * normal[1] + dz * normal[2];
  const minD = thick / 2 + shipRadius;
  if (Math.abs(d) >= minD) return 0;
  if (dx * dx + dy * dy + dz * dz - d * d > radius * radius) return 0;
  const vn = velocity.x * normal[0] + velocity.y * normal[1] + velocity.z * normal[2];
  const side = Math.abs(vn) > 1e-6 ? -Math.sign(vn) : d >= 0 ? 1 : -1;
  const shift = side * minD - d;
  position.set(position.x + normal[0] * shift, position.y + normal[1] * shift, position.z + normal[2] * shift);
  return bounce(velocity, normal[0] * side, normal[1] * side, normal[2] * side, restitution);
}

export type BandShape = {
  center: readonly [number, number, number];
  axis: readonly [number, number, number];
  radius: number;
  width: number;
  thickness: number;
  wall: number;
};

/**
 * Pushes the ship off a band (a ringworld's floor and rim walls, a ring of Dyson collectors):
 * radially off the strip, along the axis off a wall, back to the side it came from.
 */
export function collideBand(position: V3, velocity: V3, shipRadius: number, b: BandShape, restitution = 0.25): number {
  const [ax, ay, az] = b.axis;
  const dx = position.x - b.center[0];
  const dy = position.y - b.center[1];
  const dz = position.z - b.center[2];
  const z = dx * ax + dy * ay + dz * az;
  const qx = dx - z * ax;
  const qy = dy - z * ay;
  const qz = dz - z * az;
  const rho = Math.hypot(qx, qy, qz);
  if (rho < 1e-6) return 0;
  const ux = qx / rho;
  const uy = qy / rho;
  const uz = qz / rho;
  const half = b.width / 2;
  let hardest = 0;
  // The strip.
  const reach = b.thickness / 2 + shipRadius;
  if (Math.abs(z) < half && Math.abs(rho - b.radius) < reach) {
    const vu = velocity.x * ux + velocity.y * uy + velocity.z * uz;
    const side = Math.abs(vu) > 1e-6 ? -Math.sign(vu) : rho >= b.radius ? 1 : -1;
    const shift = b.radius + side * reach - rho;
    position.set(position.x + ux * shift, position.y + uy * shift, position.z + uz * shift);
    hardest = Math.max(hardest, bounce(velocity, ux * side, uy * side, uz * side, restitution));
  }
  // The walls, standing inward from each edge.
  if (b.wall > 0 && rho > b.radius - b.wall && rho < b.radius + b.thickness / 2) {
    for (const edge of [half, -half]) {
      if (Math.abs(z - edge) >= reach) continue;
      const va = velocity.x * ax + velocity.y * ay + velocity.z * az;
      const side = Math.abs(va) > 1e-6 ? -Math.sign(va) : z >= edge ? 1 : -1;
      const shift = edge + side * reach - z;
      position.set(position.x + ax * shift, position.y + ay * shift, position.z + az * shift);
      hardest = Math.max(hardest, bounce(velocity, ax * side, ay * side, az * side, restitution));
    }
  }
  return hardest;
}
