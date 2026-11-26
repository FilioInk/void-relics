/**
 * The steering cursor. With pointer lock, mouse motion moves a virtual cursor that is held
 * inside a circle around the screen centre; without it, the real cursor position is used.
 * Either way the result is an aim vector with each axis in [-1, 1].
 */
export type Cursor = { x: number; y: number };

/** Moves the virtual cursor by a mouse delta and keeps it inside the circle. */
export function moveCursor(c: Cursor, dx: number, dy: number, radius: number, sensitivity: number): Cursor {
  let x = c.x + dx * sensitivity;
  let y = c.y + dy * sensitivity;
  const r = Math.hypot(x, y);
  if (r > radius && r > 0) {
    x = (x / r) * radius;
    y = (y / r) * radius;
  }
  return { x, y };
}

/** Cursor offset in pixels → aim in [-1, 1] per axis (screen y grows downward). */
export function aimOf(c: Cursor, radius: number, invertY: boolean): { x: number; y: number } {
  // A hidden or minimised window has no steering circle; 0/0 would feed NaN to the ship.
  if (!(radius > 0)) return { x: 0, y: 0 };
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  const x = clamp(c.x / radius);
  const y = clamp(c.y / radius);
  return { x, y: invertY ? -y : y };
}

/** The steering circle: a bit under half the shorter side of the screen. */
export const steerRadius = (width: number, height: number): number => Math.min(width, height) * 0.42;
