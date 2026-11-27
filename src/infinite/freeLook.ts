import { approach } from '../game/flight.ts';

/**
 * Free look in infinite flight: drag with the mouse or a finger to swing the camera around the
 * ship (in the cockpit, to turn your head). Let go and the view stays a moment, then eases back
 * to the autopilot's framing. Pure, so it is tested; `flight.ts` turns the angles into a camera.
 *
 * The angles are in the camera's own frame: yaw about its up axis, pitch about its right axis,
 * signed so that the ship turns with the finger (drag right and the camera swings left round it).
 */

export type FreeLook = {
  yaw: number;
  pitch: number;
  /** A finger or the mouse button is down. */
  held: boolean;
  /** Seconds left before a released view starts to ease back. */
  rest: number;
};

export const LOOK = {
  /** Radians for a drag across the full height of the screen. */
  perScreen: Math.PI,
  /** How far up or down the view may swing, radians (about 75°). */
  maxPitch: 1.3,
  /** Seconds a released view holds before it eases back. */
  hold: 2.5,
  /** Rate of the ease back, per second. */
  ease: 1.6,
  /** Below this the view counts as back home. */
  settled: 1e-3,
} as const;

export function createLook(): FreeLook {
  return { yaw: 0, pitch: 0, held: false, rest: 0 };
}

export function grabLook(look: FreeLook): void {
  look.held = true;
}

/** A drag of `dx`, `dy` pixels on a screen `viewHeight` pixels tall. Ignores nonsense input. */
export function dragLook(look: FreeLook, dx: number, dy: number, viewHeight: number): void {
  if (!look.held || !Number.isFinite(dx) || !Number.isFinite(dy) || !(viewHeight > 0)) return;
  const k = LOOK.perScreen / viewHeight;
  look.yaw -= dx * k;
  look.pitch = Math.max(-LOOK.maxPitch, Math.min(LOOK.maxPitch, look.pitch - dy * k));
}

export function releaseLook(look: FreeLook): void {
  if (!look.held) return;
  look.held = false;
  look.rest = LOOK.hold;
  // Several turns round the ship ease back the short way.
  look.yaw = wrapAngle(look.yaw);
}

/** Advances the hold and the ease back. */
export function stepLook(look: FreeLook, dt: number): void {
  if (look.held || !(dt > 0)) return;
  if (look.rest > 0) {
    look.rest = Math.max(0, look.rest - dt);
    return;
  }
  const k = approach(LOOK.ease, dt);
  look.yaw -= look.yaw * k;
  look.pitch -= look.pitch * k;
  if (Math.abs(look.yaw) < LOOK.settled && Math.abs(look.pitch) < LOOK.settled) {
    look.yaw = 0;
    look.pitch = 0;
  }
}

/** The player is looking around: the autopilot holds its camera until the view is back. */
export function lookBusy(look: FreeLook): boolean {
  return look.held || look.yaw !== 0 || look.pitch !== 0;
}

/** Straight back to the autopilot's framing, for a new camera. Keeps a drag in progress going. */
export function resetLook(look: FreeLook): void {
  look.yaw = 0;
  look.pitch = 0;
  look.rest = 0;
}

/** An angle folded into -π..π. */
export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  const r = (((a + Math.PI) % t) + t) % t - Math.PI;
  return Number.isFinite(r) ? r : 0;
}
