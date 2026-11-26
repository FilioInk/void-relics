import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FLIGHT, aimCurve, createFlightState, forwardOf, stepFlight, type FlightInput } from './flight.ts';

const idle: FlightInput = { aimX: 0, aimY: 0, thrust: false, brake: false, boost: false, strafe: 0, roll: 0 };

function run(input: FlightInput, seconds: number, s = createFlightState(new Vector3(), new Vector3(0, 0, -1))) {
  for (let t = 0; t < seconds; t += 1 / 60) stepFlight(s, input, 1 / 60);
  return s;
}

test('holding thrust brings the ship up to cruise speed, along its nose', () => {
  const s = run({ ...idle, thrust: true }, 8);
  assert.ok(Math.abs(s.velocity.length() - FLIGHT.cruiseSpeed) < 5, `speed ${s.velocity.length()}`);
  assert.ok(s.velocity.clone().normalize().dot(forwardOf(s.orientation)) > 0.999);
});

test('letting go of thrust makes the ship coast to a stop', () => {
  const s = run({ ...idle, thrust: true }, 6);
  run(idle, 10, s);
  assert.ok(s.velocity.length() < 1, `still moving at ${s.velocity.length()}`);
});

test('boost takes the ship far past cruise speed, and it falls back when released', () => {
  const s = run({ ...idle, thrust: true, boost: true }, 10);
  assert.ok(s.velocity.length() > FLIGHT.boostSpeed * 0.95);
  run({ ...idle, thrust: true }, 8, s);
  assert.ok(Math.abs(s.velocity.length() - FLIGHT.cruiseSpeed) < 10);
});

test('boost works without holding thrust', () => {
  const s = run({ ...idle, boost: true }, 10);
  assert.ok(s.velocity.length() > FLIGHT.boostSpeed * 0.9);
});

test('cursor to the right turns the nose right, cursor up pitches it up', () => {
  const right = run({ ...idle, aimX: 0.8 }, 0.5);
  assert.ok(forwardOf(right.orientation).x > 0.2);
  const up = run({ ...idle, aimY: -0.8 }, 0.5);
  assert.ok(forwardOf(up.orientation).y > 0.2);
});

test('a centred cursor inside the dead zone does not turn the ship', () => {
  const s = run({ ...idle, aimX: 0.02, aimY: -0.03 }, 3);
  assert.ok(forwardOf(s.orientation).z < -0.9999);
});

test('aim curve: zero in the dead zone, signed, capped at one', () => {
  assert.equal(aimCurve(0.01), 0);
  assert.ok(aimCurve(0.5) > 0 && aimCurve(-0.5) < 0);
  assert.equal(aimCurve(5), 1);
});

test('a zero or broken time step changes nothing', () => {
  const s = createFlightState(new Vector3(1, 2, 3), new Vector3(0, 0, 0));
  stepFlight(s, { ...idle, thrust: true }, 0);
  stepFlight(s, { ...idle, thrust: true }, Number.NaN);
  assert.deepEqual(s.position.toArray(), [1, 2, 3]);
});

test('the ship starts facing the point it was told to look at', () => {
  const s = createFlightState(new Vector3(0, 0, 100), new Vector3(0, 0, 0));
  assert.ok(forwardOf(s.orientation).z < -0.999);
});
