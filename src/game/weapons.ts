/**
 * Twin wing lasers: alternate barrels, a fixed rate of fire, and heat instead of ammunition.
 * Hold the trigger and the guns warm up; past the limit they lock until they have cooled well
 * down. Pure numbers, no rendering, so the rules are tested on their own.
 */

export const WEAPON = {
  /** Shots per second, both barrels together. */
  rate: 8,
  heatPerShot: 0.075,
  /** Heat shed per second, firing or not. */
  coolRate: 0.4,
  /** Overheated guns unlock once heat falls to this. */
  recoverAt: 0.35,
  boltSpeed: 3200,
  boltLife: 1.3,
  /** Both barrels aim at a point this far ahead of the nose. */
  convergence: 700,
  /** A bolt counts as touching anything within this distance of its path: forgiving, arcade-style. */
  hitRadius: 2,
} as const;

export type WeaponState = {
  /** 0..1; at 1 the guns lock. */
  heat: number;
  /** Seconds until the next shot may leave. */
  reload: number;
  overheated: boolean;
  /** Which barrel fires next. */
  side: number;
};

export function createWeapon(): WeaponState {
  return { heat: 0, reload: 0, overheated: false, side: 0 };
}

/** Advances the guns by dt and returns the barrels (0 or 1) that fired, in order. */
export function stepWeapon(s: WeaponState, trigger: boolean, dt: number): number[] {
  const fired: number[] = [];
  if (!(dt > 0) || !Number.isFinite(dt)) return fired;
  const w = WEAPON;
  s.heat = Math.max(0, s.heat - w.coolRate * dt);
  if (s.overheated && s.heat <= w.recoverAt) s.overheated = false;
  s.reload -= dt;
  if (!trigger || s.overheated) {
    // A released trigger is ready again at once, but never banks shots.
    s.reload = Math.max(s.reload, 0);
    return fired;
  }
  while (s.reload <= 0 && !s.overheated) {
    fired.push(s.side);
    s.side = 1 - s.side;
    s.reload += 1 / w.rate;
    s.heat = Math.min(1, s.heat + w.heatPerShot);
    if (s.heat >= 1) s.overheated = true;
  }
  return fired;
}
