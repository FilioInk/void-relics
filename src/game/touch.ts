/**
 * Touch controls without the DOM: the stick's maths, which finger holds which control, and the
 * thrust button's latch. `src/ui/touchControls.ts` draws the controls and feeds this module.
 */

export type Vec = { x: number; y: number };

export const STICK = {
  /** How far the knob travels from the centre, in CSS pixels. */
  radius: 52,
  /** Share of the radius that steers nothing, so a resting thumb holds the nose still. */
  deadZone: 0.14,
} as const;

/** A press shorter than this on THRUST latches it on; a longer one is a plain hold. */
export const TAP_MS = 240;

/** Touch-first: the primary pointer is a finger. A tablet with a trackpad reports `fine`. */
export function isTouchFirst(matches: (query: string) => boolean): boolean {
  return matches('(pointer: coarse)');
}

/**
 * A finger's offset from the stick's centre → steering, each axis in [-1, 1] and the vector no
 * longer than 1. Inside the dead zone it is zero; from there to the rim it rises to full. The
 * sensitivity bends that rise: above 1 a small push already turns hard, below 1 the middle of
 * the throw is gentler. Full deflection always means a full turn.
 */
export function stickAim(dx: number, dy: number, radius: number, sensitivity = 1, deadZone: number = STICK.deadZone): Vec {
  if (!(radius > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy);
  const m = Math.min(1, len / radius);
  if (m <= deadZone || len === 0) return { x: 0, y: 0 };
  const sens = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1;
  const k = Math.pow((m - deadZone) / (1 - deadZone), 1 / sens);
  return { x: (dx / len) * k, y: (dy / len) * k };
}

/** Where the knob is drawn: under the finger, held to the rim. */
export function knobOffset(dx: number, dy: number, radius: number): Vec {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy);
  if (len <= radius || len === 0) return { x: dx, y: dy };
  return { x: (dx / len) * radius, y: (dy / len) * radius };
}

/**
 * Where the stick rests until a thumb lands: low in the left corner, clear of the screen's edge
 * and in portrait above the flight panel, which sits at the bottom there.
 */
export function restingStick(width: number, height: number, radius: number = STICK.radius): Vec {
  const portrait = height > width;
  return { x: 34 + radius, y: height - (portrait ? 92 : 34) - radius };
}

/** The steering cursor the mouse would have put there: aim × the steering circle's radius. */
export function cursorOf(aim: Vec, steerRadius: number, out: Vec = { x: 0, y: 0 }): Vec {
  const r = steerRadius > 0 ? steerRadius : 0;
  out.x = aim.x * r;
  out.y = aim.y * r;
  return out;
}

export type Control = 'stick' | 'thrust' | 'brake' | 'boost' | 'fire';

/**
 * Which finger holds which control. Every finger is tracked by its `pointerId`, so one thumb
 * can steer while the other fires. The stick takes one finger at a time and turns a second one
 * away; a button may be held by several (it lets go when the last one lifts).
 */
export class TouchRouter {
  private readonly owners = new Map<number, Control>();

  /** A finger lands on a control. False when it is turned away. */
  press(pointerId: number, control: Control): boolean {
    if (this.owners.has(pointerId)) return false;
    if (control === 'stick' && this.ownerOf('stick') !== null) return false;
    this.owners.set(pointerId, control);
    return true;
  }

  /** A finger lifts (or the browser cancels it). Returns what it was holding. */
  release(pointerId: number): Control | null {
    const c = this.owners.get(pointerId) ?? null;
    this.owners.delete(pointerId);
    return c;
  }

  controlOf(pointerId: number): Control | null {
    return this.owners.get(pointerId) ?? null;
  }

  ownerOf(control: Control): number | null {
    for (const [id, c] of this.owners) if (c === control) return id;
    return null;
  }

  held(control: Control): boolean {
    return this.ownerOf(control) !== null;
  }

  /** Lets go of everything, e.g. when the game pauses. Returns the fingers that were down. */
  clear(): number[] {
    const ids = [...this.owners.keys()];
    this.owners.clear();
    return ids;
  }

  get size(): number {
    return this.owners.size;
  }
}

/**
 * THRUST. Held, the ship flies while it is held, as with W. Tapped, it latches on, so one thumb
 * is free to fire while the other steers; the next press of THRUST, or BRAKE, lets it go.
 */
export class ThrustLatch {
  latched = false;
  private downAt = NaN;
  private wasLatched = false;

  down(now: number): void {
    this.downAt = now;
    this.wasLatched = this.latched;
  }

  up(now: number): void {
    if (Number.isNaN(this.downAt)) return;
    const tap = now - this.downAt < TAP_MS;
    this.latched = this.wasLatched ? false : tap;
    this.downAt = NaN;
  }

  /** BRAKE, a pause or a death: the engine stops. */
  cancel(): void {
    this.latched = false;
    this.downAt = NaN;
    this.wasLatched = false;
  }

  /** Whether the engine burns, given whether a finger is on THRUST right now. */
  on(held: boolean): boolean {
    return held || this.latched;
  }
}
