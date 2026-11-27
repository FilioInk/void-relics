import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPON, createWeapon, stepWeapon } from './weapons.ts';

/** Holds or releases the trigger for `seconds` at 60 fps; returns the barrels fired. */
function hold(s: ReturnType<typeof createWeapon>, trigger: boolean, seconds: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) out.push(...stepWeapon(s, trigger, 1 / 60));
  return out;
}

test('a held trigger fires at the set rate, alternating barrels', () => {
  const s = createWeapon();
  const shots = hold(s, true, 1);
  assert.ok(Math.abs(shots.length - WEAPON.rate) <= 1, `${shots.length} shots in a second`);
  for (let i = 1; i < shots.length; i++) assert.notEqual(shots[i], shots[i - 1]);
});

test('the first shot leaves the moment the trigger is pulled', () => {
  const s = createWeapon();
  assert.deepEqual(stepWeapon(s, true, 1 / 60), [0]);
});

test('a long burst overheats the guns, which lock until they cool down far enough', () => {
  const s = createWeapon();
  let held = 0;
  while (!s.overheated && held < 20) {
    stepWeapon(s, true, 1 / 60);
    held += 1 / 60;
  }
  assert.ok(held > 3 && held < 7, `overheats after ${held.toFixed(1)} s of fire`);
  assert.deepEqual(hold(s, true, 1), [], 'locked guns do not fire, trigger or not');
  assert.equal(s.overheated, true);
  const lock = (1 - WEAPON.recoverAt) / WEAPON.coolRate;
  hold(s, true, lock - 1 + 0.1);
  assert.equal(s.overheated, false, 'unlocked once cooled to the recovery point');
  assert.ok(hold(s, true, 0.5).length > 0, 'and firing again');
});

test('short bursts with pauses never overheat', () => {
  const s = createWeapon();
  for (let i = 0; i < 20; i++) {
    hold(s, true, 0.5);
    hold(s, false, 0.6);
  }
  assert.equal(s.overheated, false);
});

test('a released trigger does not bank shots, and bad time steps change nothing', () => {
  const s = createWeapon();
  hold(s, false, 3);
  assert.equal(stepWeapon(s, true, 1 / 60).length, 1);
  const before = { ...s };
  assert.deepEqual(stepWeapon(s, true, NaN), []);
  assert.deepEqual(stepWeapon(s, true, -1), []);
  assert.deepEqual(s, before);
  // A long stall fires a few shots to catch up, never a flood.
  assert.ok(stepWeapon(s, true, 1).length <= WEAPON.rate + 1);
});
