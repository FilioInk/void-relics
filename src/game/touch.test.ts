import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STICK, TAP_MS, ThrustLatch, TouchRouter, cursorOf, isTouchFirst, knobOffset, restingStick, stickAim } from './touch.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const R = STICK.radius;

test('touch-first means a coarse primary pointer', () => {
  assert.equal(isTouchFirst((q) => q === '(pointer: coarse)'), true);
  assert.equal(isTouchFirst((q) => q === '(pointer: fine)' || q === '(any-pointer: coarse)'), false);
});

test('a thumb resting inside the dead zone steers nothing', () => {
  assert.deepEqual(stickAim(0, 0, R), { x: 0, y: 0 });
  const edge = R * STICK.deadZone * 0.99;
  assert.deepEqual(stickAim(edge, 0, R), { x: 0, y: 0 });
  assert.deepEqual(stickAim(0, -edge, R), { x: 0, y: 0 });
  assert.ok(stickAim(R * STICK.deadZone * 1.2, 0, R).x > 0);
});

test('the rim is a full turn, and dragging past it adds nothing', () => {
  close(stickAim(R, 0, R).x, 1);
  close(stickAim(-R, 0, R).x, -1);
  close(stickAim(0, R, R).y, 1);
  const far = stickAim(R * 3, 0, R);
  close(far.x, 1);
  close(far.y, 0);
});

test('a diagonal push stays inside the unit circle, pointing the way the thumb went', () => {
  const a = stickAim(R * 2, -R * 2, R);
  close(Math.hypot(a.x, a.y), 1);
  close(a.x, Math.SQRT1_2);
  close(a.y, -Math.SQRT1_2);
  const b = stickAim(R * 0.4, R * 0.3, R);
  assert.ok(Math.hypot(b.x, b.y) < 1);
  close(Math.atan2(b.y, b.x), Math.atan2(0.3, 0.4));
});

test('steering rises with the push, from the dead zone to the rim', () => {
  let last = 0;
  for (let d = R * STICK.deadZone + 1; d <= R; d += 3) {
    const x = stickAim(d, 0, R).x;
    assert.ok(x > last, `not rising at ${d}`);
    last = x;
  }
});

test('higher sensitivity turns harder for the same push, never past full', () => {
  const half = R * 0.5;
  const low = stickAim(half, 0, R, 0.3).x;
  const mid = stickAim(half, 0, R, 1).x;
  const high = stickAim(half, 0, R, 2.5).x;
  assert.ok(low < mid && mid < high, `${low} ${mid} ${high}`);
  for (const s of [0.3, 1, 2.5]) close(stickAim(R, 0, R, s).x, 1);
});

test('bad numbers read as a centred stick', () => {
  assert.deepEqual(stickAim(NaN, 4, R), { x: 0, y: 0 });
  assert.deepEqual(stickAim(4, Infinity, R), { x: 0, y: 0 });
  assert.deepEqual(stickAim(10, 10, 0), { x: 0, y: 0 });
  const a = stickAim(R, 0, R, NaN);
  close(a.x, 1);
});

test('the knob follows the finger and stops at the rim', () => {
  assert.deepEqual(knobOffset(10, -5, R), { x: 10, y: -5 });
  const k = knobOffset(R * 4, 0, R);
  close(k.x, R);
  close(k.y, 0);
  const d = knobOffset(-R, -R, R);
  close(Math.hypot(d.x, d.y), R);
  assert.deepEqual(knobOffset(NaN, 1, R), { x: 0, y: 0 });
});

test('the resting stick sits low on the left, fully on screen, higher in portrait', () => {
  const land = restingStick(812, 375);
  const port = restingStick(375, 812);
  for (const [p, w, h] of [[land, 812, 375], [port, 375, 812]] as const) {
    assert.ok(p.x - R > 0 && p.x + R < w / 2, `x ${p.x}`);
    assert.ok(p.y - R > h / 2 && p.y + R < h, `y ${p.y}`);
  }
  assert.ok(812 - port.y > 375 - land.y, 'portrait leaves room for the flight panel under it');
});

test('the stick drives the same cursor the mouse would', () => {
  assert.deepEqual(cursorOf({ x: 0.5, y: -1 }, 200), { x: 100, y: -200 });
  assert.deepEqual(cursorOf({ x: 1, y: 1 }, NaN), { x: 0, y: 0 });
  const out = { x: 9, y: 9 };
  assert.equal(cursorOf({ x: 0, y: 0 }, 100, out), out);
  assert.deepEqual(out, { x: 0, y: 0 });
});

test('two thumbs: one steers while the other fires, each tracked by its pointer', () => {
  const r = new TouchRouter();
  assert.ok(r.press(1, 'stick'));
  assert.ok(r.press(2, 'fire'));
  assert.equal(r.controlOf(1), 'stick');
  assert.equal(r.controlOf(2), 'fire');
  assert.ok(r.held('stick') && r.held('fire'));
  assert.equal(r.release(2), 'fire');
  assert.ok(r.held('stick'));
  assert.ok(!r.held('fire'));
  assert.equal(r.release(1), 'stick');
  assert.equal(r.size, 0);
});

test('the stick takes one finger; a second is turned away until the first lifts', () => {
  const r = new TouchRouter();
  assert.ok(r.press(1, 'stick'));
  assert.equal(r.press(2, 'stick'), false);
  assert.equal(r.controlOf(2), null);
  assert.equal(r.ownerOf('stick'), 1);
  // The rejected finger lifting changes nothing.
  assert.equal(r.release(2), null);
  assert.equal(r.ownerOf('stick'), 1);
  r.release(1);
  assert.ok(r.press(2, 'stick'));
  assert.equal(r.ownerOf('stick'), 2);
});

test('a button held by two fingers lets go only when the last one lifts', () => {
  const r = new TouchRouter();
  r.press(3, 'thrust');
  r.press(4, 'thrust');
  r.release(3);
  assert.ok(r.held('thrust'));
  r.release(4);
  assert.ok(!r.held('thrust'));
});

test('a finger already down cannot grab a second control', () => {
  const r = new TouchRouter();
  assert.ok(r.press(1, 'fire'));
  assert.equal(r.press(1, 'boost'), false);
  assert.equal(r.controlOf(1), 'fire');
  assert.ok(!r.held('boost'));
});

test('clear lets go of everything and names the fingers that were down', () => {
  const r = new TouchRouter();
  r.press(1, 'stick');
  r.press(7, 'boost');
  assert.deepEqual(r.clear().sort(), [1, 7]);
  assert.equal(r.size, 0);
  assert.ok(!r.held('stick') && !r.held('boost'));
  assert.deepEqual(r.clear(), []);
});

test('thrust held burns only while held', () => {
  const l = new ThrustLatch();
  l.down(0);
  assert.ok(l.on(true));
  l.up(TAP_MS + 200);
  assert.ok(!l.latched);
  assert.ok(!l.on(false));
});

test('a tap on thrust latches it on; the next press lets it go and brakes while held', () => {
  const l = new ThrustLatch();
  l.down(1000);
  l.up(1000 + TAP_MS - 50);
  assert.ok(l.latched);
  assert.ok(l.on(false));
  assert.ok(!l.brake(false));
  // Pressed again: the engine stops at once and the ship brakes while the finger stays down.
  l.down(5000);
  assert.ok(!l.latched);
  assert.ok(!l.on(true));
  assert.ok(l.brake(true));
  // Let go: neither thrust nor brake, and a long hold did not latch anything.
  l.up(5000 + TAP_MS * 4);
  assert.ok(!l.latched && !l.braking);
  assert.ok(!l.on(false) && !l.brake(false));
});

test('a quick second tap stops the latch; the press after that is thrust again', () => {
  const l = new ThrustLatch();
  l.down(0);
  l.up(50);
  l.down(400);
  l.up(450);
  assert.ok(!l.latched && !l.braking);
  l.down(1000);
  assert.ok(l.on(true) && !l.brake(true));
  l.up(1000 + TAP_MS + 100);
  assert.ok(!l.latched);
});

test('from a standstill, a tap and then a hold brakes', () => {
  const l = new ThrustLatch();
  l.down(0);
  l.up(80);
  l.down(200);
  assert.ok(l.brake(true));
  assert.ok(!l.on(true));
});

test('a second finger on thrust while braking keeps braking', () => {
  const l = new ThrustLatch();
  l.down(0);
  l.up(50);
  l.down(1000);
  l.down(1100);
  assert.ok(l.brake(true));
  l.up(3000);
  assert.ok(!l.braking && !l.latched);
});

test('a pause drops the latch and the brake', () => {
  const l = new ThrustLatch();
  l.down(0);
  l.up(50);
  assert.ok(l.latched);
  l.cancel();
  assert.ok(!l.on(false));
  // A lift after the cancel, from a finger that was still down, does not latch it back.
  l.down(100);
  l.cancel();
  l.up(120);
  assert.ok(!l.latched);
  // Nor does a brake survive one.
  l.down(200);
  l.up(220);
  l.down(300);
  assert.ok(l.braking);
  l.cancel();
  assert.ok(!l.brake(true) && !l.on(false));
});
