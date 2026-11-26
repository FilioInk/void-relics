import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aimOf, moveCursor, steerRadius } from './aim.ts';

test('the virtual cursor follows the mouse and stops at the edge of the circle', () => {
  let c = { x: 0, y: 0 };
  c = moveCursor(c, 30, -40, 100, 1);
  assert.deepEqual(c, { x: 30, y: -40 });
  c = moveCursor(c, 1000, 0, 100, 1);
  assert.ok(Math.abs(Math.hypot(c.x, c.y) - 100) < 1e-9);
});

test('sensitivity scales mouse motion', () => {
  assert.deepEqual(moveCursor({ x: 0, y: 0 }, 10, 10, 100, 2), { x: 20, y: 20 });
});

test('aim maps the circle to [-1, 1], with optional inverted Y', () => {
  assert.deepEqual(aimOf({ x: 50, y: -100 }, 100, false), { x: 0.5, y: -1 });
  assert.deepEqual(aimOf({ x: 50, y: -100 }, 100, true), { x: 0.5, y: 1 });
  assert.deepEqual(aimOf({ x: 500, y: 0 }, 100, false), { x: 1, y: 0 });
});

test('steering circle fits the shorter screen side', () => {
  assert.equal(steerRadius(1920, 1000), 420);
});

test('a zero-size window gives no steering instead of NaN', () => {
  // Regression: steerRadius(0, 0) is 0, and 0/0 used to put NaN into the flight model.
  assert.deepEqual(aimOf({ x: 0, y: 0 }, steerRadius(0, 0), false), { x: 0, y: 0 });
  assert.deepEqual(aimOf({ x: 40, y: -10 }, 0, true), { x: 0, y: 0 });
});
