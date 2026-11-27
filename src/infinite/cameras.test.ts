import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMERA_ORDER, autoHold, nextCameraIndex } from './cameras.ts';

test('no camera in the rotation stands still for the ship to fly past', () => {
  assert.ok(!(CAMERA_ORDER as readonly string[]).includes('flyby'));
});

test('the rotation keeps the chase view, the orbit, the wide shot and the cockpit', () => {
  for (const mode of ['chase', 'orbit', 'wide', 'cockpit'] as const) assert.ok(CAMERA_ORDER.includes(mode), mode);
});

test('a cut always changes the picture, including the wrap back to the start', () => {
  for (let i = 0; i < CAMERA_ORDER.length; i++) {
    assert.notEqual(CAMERA_ORDER[nextCameraIndex(i)], CAMERA_ORDER[i], `after ${CAMERA_ORDER[i]} at ${i}`);
  }
});

test('stepping through the rotation visits every camera and comes back to the first', () => {
  let i = 0;
  const seen = new Set<number>();
  for (let n = 0; n < CAMERA_ORDER.length; n++) {
    seen.add(i);
    i = nextCameraIndex(i);
  }
  assert.equal(i, 0);
  assert.equal(seen.size, CAMERA_ORDER.length);
});

test('the autopilot holds a camera 18 to 32 seconds', () => {
  assert.equal(autoHold(0), 18);
  assert.equal(autoHold(1), 32);
});
