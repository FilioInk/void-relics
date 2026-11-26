import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_EXPOSURE, stepExposure, targetExposure } from './exposure.ts';

const view = { starRadius: 2600, distance: 40000, offAxis: 0, fov: 68, aspect: 16 / 9 };

test('full exposure when the star is behind the camera', () => {
  assert.equal(targetExposure({ ...view, offAxis: Math.PI }), 1);
});

test('exposure drops the more of the view the star fills', () => {
  const far = targetExposure(view);
  const near = targetExposure({ ...view, distance: 3000 });
  assert.ok(far < 1 && far > near, `far ${far}, near ${near}`);
  assert.ok(Math.abs(near - MIN_EXPOSURE) < 1e-9);
});

test('a zero-size window (aspect 0/0) still gives a usable exposure', () => {
  assert.ok(Number.isFinite(targetExposure({ ...view, aspect: Number.NaN })));
  assert.ok(Number.isFinite(targetExposure({ ...view, aspect: Infinity })));
});

test('one bad frame does not leave the screen black for good', () => {
  // Regression: a NaN exposure used to stick forever after the window was resized to zero.
  let e = stepExposure(1, Number.NaN, 0.016);
  assert.ok(Number.isFinite(e));
  e = Number.NaN;
  for (let i = 0; i < 300; i++) e = stepExposure(e, 1, 0.016);
  assert.ok(Math.abs(e - 1) < 1e-6, `exposure ${e}`);
});

test('exposure eases toward the target rather than jumping', () => {
  const e = stepExposure(1, MIN_EXPOSURE, 0.016);
  assert.ok(e < 1 && e > 0.9);
});
