/**
 * Which camera infinite flight shows, and for how long. Pure, so the rotation is tested.
 *
 * Every camera here rides with the ship: a chase view, a slow orbit around it, a wide shot
 * from far behind, and the cockpit. None stands still in space for the ship to sweep past —
 * a fly-by came round every second or two and broke the sense of one long journey.
 */

export type CameraMode = 'chase' | 'orbit' | 'wide' | 'cockpit';

export const CAMERA_ORDER: readonly CameraMode[] = ['chase', 'orbit', 'chase', 'wide', 'cockpit'];

/** The camera after `index` in the rotation, wrapping round. */
export function nextCameraIndex(index: number): number {
  return (index + 1) % CAMERA_ORDER.length;
}

/** Seconds the autopilot holds a camera before it cuts: 18 to 32. `roll` is 0..1. */
export function autoHold(roll: number): number {
  return 18 + roll * 14;
}

/** Seconds a camera the player picked (C, or the camera button) stays before the autopilot cuts. */
export const CHOSEN_HOLD = 45;

/** The first camera's hold, before the autopilot's first cut. */
export const FIRST_HOLD = 22;
