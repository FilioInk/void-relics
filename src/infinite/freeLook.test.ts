import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOOK, createLook, dragLook, grabLook, lookBusy, releaseLook, resetLook, stepLook, wrapAngle } from './freeLook.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** Runs `seconds` of frames at 60 fps. */
function run(look: ReturnType<typeof createLook>, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepLook(look, 1 / 60);
}

test('a drag across the full screen height turns the view half a turn', () => {
  const look = createLook();
  grabLook(look);
  dragLook(look, -800, 0, 800);
  close(look.yaw, Math.PI);
});

test('the ship turns with the finger: right and down give negative yaw and pitch', () => {
  const look = createLook();
  grabLook(look);
  dragLook(look, 100, 50, 1000);
  assert.ok(look.yaw < 0);
  assert.ok(look.pitch < 0);
});

test('only a held view moves', () => {
  const look = createLook();
  dragLook(look, 300, 300, 800);
  assert.equal(look.yaw, 0);
  assert.equal(look.pitch, 0);
  assert.equal(lookBusy(look), false);
});

test('the view never swings past straight up or down', () => {
  const look = createLook();
  grabLook(look);
  dragLook(look, 0, 5000, 800);
  assert.equal(look.pitch, -LOOK.maxPitch);
  dragLook(look, 0, -50000, 800);
  assert.equal(look.pitch, LOOK.maxPitch);
});

test('nonsense input leaves the view alone', () => {
  const look = createLook();
  grabLook(look);
  dragLook(look, Number.NaN, 10, 800);
  dragLook(look, 10, Number.POSITIVE_INFINITY, 800);
  dragLook(look, 10, 10, 0);
  assert.equal(look.yaw, 0);
  assert.equal(look.pitch, 0);
  stepLook(look, Number.NaN);
  assert.equal(look.held, true);
});

test('while held, the view stays where the player put it', () => {
  const look = createLook();
  grabLook(look);
  dragLook(look, 200, 100, 800);
  const { yaw, pitch } = look;
  run(look, 10);
  assert.equal(look.yaw, yaw);
  assert.equal(look.pitch, pitch);
  assert.equal(lookBusy(look), true);
});

test('a released view holds a moment, then eases back home and frees the autopilot', () => {
  const look = createLook();
  grabLook(look);
  dragLook(look, 300, 100, 800);
  releaseLook(look);
  const { yaw, pitch } = look;
  run(look, LOOK.hold - 0.1);
  assert.equal(look.yaw, yaw);
  assert.equal(look.pitch, pitch);
  run(look, 1);
  assert.ok(Math.abs(look.yaw) < Math.abs(yaw), 'started easing back');
  assert.ok(lookBusy(look));
  run(look, 10);
  assert.equal(look.yaw, 0);
  assert.equal(look.pitch, 0);
  assert.equal(lookBusy(look), false);
});

test('the ease back is soft: no jump in the first frame after the hold', () => {
  const look = createLook();
  grabLook(look);
  dragLook(look, -400, 0, 800);
  releaseLook(look);
  run(look, LOOK.hold);
  const before = look.yaw;
  stepLook(look, 1 / 60);
  assert.ok(Math.abs(before - look.yaw) < Math.abs(before) * 0.05);
});

test('several turns round the ship come back the short way', () => {
  const look = createLook();
  grabLook(look);
  dragLook(look, -800 * 4.5, 0, 800);
  releaseLook(look);
  assert.ok(Math.abs(look.yaw) <= Math.PI + 1e-9);
});

test('a new camera starts from the autopilot framing', () => {
  const look = createLook();
  grabLook(look);
  dragLook(look, 300, 100, 800);
  releaseLook(look);
  resetLook(look);
  assert.equal(lookBusy(look), false);
});

test('angles fold into -π..π', () => {
  close(wrapAngle(0), 0);
  close(wrapAngle(Math.PI * 2 + 0.5), 0.5);
  close(wrapAngle(-Math.PI * 2 - 0.5), -0.5);
  close(wrapAngle(Math.PI * 3), -Math.PI);
  assert.equal(wrapAngle(Number.NaN), 0);
});
