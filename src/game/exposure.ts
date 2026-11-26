import { approach } from './flight.ts';

/**
 * Eye adaptation: the more of the view the star fills, the lower the exposure, so its surface
 * reads instead of blowing out to white. Pure maths, kept apart from the renderer so a bad
 * frame (a window resized to zero, say) can be tested and cannot poison the value for good.
 */

export const MIN_EXPOSURE = 0.28;

export type StarInView = {
  starRadius: number;
  /** Camera to star centre. */
  distance: number;
  /** Angle between where the camera looks and the direction to the star, radians. */
  offAxis: number;
  /** Vertical field of view, degrees. */
  fov: number;
  aspect: number;
};

export function targetExposure(v: StarInView): number {
  const aspect = Number.isFinite(v.aspect) && v.aspect > 0 ? v.aspect : 1;
  const d = Math.max(v.distance, v.starRadius * 1.001);
  const angular = Math.asin(Math.min(1, v.starRadius / d));
  const halfFov = ((v.fov / 2) * Math.PI) / 180 * Math.max(1, aspect);
  const inView = Math.min(1, Math.max(0, 1 - (v.offAxis - angular) / halfFov));
  const size = Math.min(1, Math.max(0, angular / 0.35));
  const coverage = inView * (0.25 + 0.75 * size);
  const target = 1 - (1 - MIN_EXPOSURE) * coverage;
  return Number.isFinite(target) ? target : 1;
}

/** Eases toward the target; a non-finite value on either side never sticks. */
export function stepExposure(current: number, target: number, dt: number): number {
  const from = Number.isFinite(current) ? current : 1;
  if (!Number.isFinite(target)) return from;
  return from + (target - from) * approach(2.5, Math.max(0, dt));
}
