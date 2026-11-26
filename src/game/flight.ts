import { Quaternion, Vector3 } from 'three';

/**
 * Arcade flight in the old space-sim manner: hold thrust and the ship flies, let go and it
 * coasts to a stop. The nose follows the mouse cursor, and the further the cursor is from the
 * centre of the screen, the faster it turns.
 */

export type FlightInput = {
  /** Cursor offset from the screen centre, each axis in [-1, 1]. */
  aimX: number;
  aimY: number;
  thrust: boolean;
  brake: boolean;
  boost: boolean;
  /** -1 left, +1 right. */
  strafe: number;
  /** -1 counter-clockwise, +1 clockwise. */
  roll: number;
};

export type FlightState = {
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
  /** Local angular velocity: x pitch, y yaw, z roll (rad/s). */
  spin: Vector3;
  /** -1..1, eases toward what the keys ask for. */
  throttle: number;
  /** 0..1, how far the boost engines have spooled up. */
  boost: number;
};

export const FLIGHT = {
  cruiseSpeed: 280,
  reverseSpeed: 90,
  boostSpeed: 1600,
  strafeSpeed: 120,
  pitchRate: 1.35,
  yawRate: 1.35,
  rollRate: 2.2,
  /** Turning is slower with the boost lit. */
  boostTurnFactor: 0.5,
  deadZone: 0.04,
  /** How quickly velocity reaches the target while thrusting vs. coasting to a stop. */
  accelRate: 1.3,
  coastRate: 0.85,
  spinRate: 5,
  throttleRate: 3,
  boostSpoolUp: 0.9,
  boostSpoolDown: 2.2,
} as const;

const FORWARD = new Vector3(0, 0, -1);
const RIGHT = new Vector3(1, 0, 0);

export function createFlightState(position: Vector3, lookAt: Vector3): FlightState {
  const dir = lookAt.clone().sub(position).normalize();
  const orientation = new Quaternion().setFromUnitVectors(FORWARD, dir);
  return { position: position.clone(), velocity: new Vector3(), orientation, spin: new Vector3(), throttle: 0, boost: 0 };
}

/** Exponential approach factor for a rate and a time step, frame-rate independent. */
export const approach = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Maps a raw cursor offset to a turn command: a dead zone, then a soft curve. */
export function aimCurve(v: number, deadZone: number = FLIGHT.deadZone): number {
  const a = Math.min(1, Math.abs(v));
  if (a <= deadZone) return 0;
  const t = (a - deadZone) / (1 - deadZone);
  return Math.sign(v) * Math.pow(t, 1.35);
}

export function forwardOf(q: Quaternion, out = new Vector3()): Vector3 {
  return out.copy(FORWARD).applyQuaternion(q);
}

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpDesired = new Vector3();
const tmpAxis = new Vector3();

/** Any non-finite axis reads as centred, so one bad frame cannot poison the state. */
const axis = (v: number): number => (Number.isFinite(v) ? v : 0);

export function stepFlight(s: FlightState, rawInput: FlightInput, dt: number): void {
  if (!(dt > 0)) return;
  const f = FLIGHT;
  const input: FlightInput = { ...rawInput, aimX: axis(rawInput.aimX), aimY: axis(rawInput.aimY), strafe: axis(rawInput.strafe), roll: axis(rawInput.roll) };

  // Boost spools up slowly and dies quickly.
  s.boost += ((input.boost ? 1 : 0) - s.boost) * approach(input.boost ? f.boostSpoolUp : f.boostSpoolDown, dt);
  const turn = 1 - (1 - f.boostTurnFactor) * s.boost;

  // Rotation: the nose chases the cursor.
  const tx = aimCurve(-input.aimY) * f.pitchRate * turn;
  const ty = aimCurve(-input.aimX) * f.yawRate * turn;
  const tz = -input.roll * f.rollRate;
  const k = approach(f.spinRate, dt);
  s.spin.x += (tx - s.spin.x) * k;
  s.spin.y += (ty - s.spin.y) * k;
  s.spin.z += (tz - s.spin.z) * k;
  const angle = s.spin.length() * dt;
  if (angle > 1e-9) {
    tmpAxis.copy(s.spin).normalize();
    tmpQ.setFromAxisAngle(tmpAxis, angle);
    s.orientation.multiply(tmpQ).normalize();
  }

  // Throttle: thrust forward, brake/reverse back, nothing → zero.
  const throttleTarget = input.thrust ? 1 : input.brake ? -1 : 0;
  s.throttle += (throttleTarget - s.throttle) * approach(f.throttleRate, dt);

  const forward = forwardOf(s.orientation, tmpV);
  const forwardSpeed =
    s.throttle >= 0
      ? s.throttle * f.cruiseSpeed * (1 - s.boost) + s.boost * f.boostSpeed
      : s.throttle * f.reverseSpeed * (1 - s.boost) + s.boost * f.boostSpeed;
  tmpDesired.copy(forward).multiplyScalar(forwardSpeed);
  if (input.strafe !== 0) {
    tmpDesired.addScaledVector(RIGHT.clone().applyQuaternion(s.orientation), input.strafe * f.strafeSpeed);
  }

  const engaged = input.thrust || input.brake || input.boost || input.strafe !== 0 || s.boost > 0.05;
  s.velocity.lerp(tmpDesired, approach(engaged ? f.accelRate : f.coastRate, dt));
  s.position.addScaledVector(s.velocity, dt);
}
