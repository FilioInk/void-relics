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
