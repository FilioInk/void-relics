import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlKeys, installSteps, pauseButtons, playLabel } from './screens.ts';
import { t } from '../text.ts';

test('the main game button names the hunt, and shows the score once relics are found', () => {
  assert.equal(playLabel(0), 'Collect relics');
  assert.equal(playLabel(7), 'Collect relics — 7/20');
});

test('a touch device lists the on-screen controls, not the keys', () => {
  const touch = controlKeys(true).map((k) => t(k));
  const keys = controlKeys(false).map((k) => t(k));
  assert.ok(keys.some((s) => s.includes('Mouse')));
  assert.ok(!touch.some((s) => /mouse|keyboard|\bEsc\b|\bW —/i.test(s)), touch.join('\n'));
  for (const name of ['Thrust', 'Boost', 'Fire', 'steer', 'map', 'pause', 'Infinite flight']) {
    assert.ok(touch.some((s) => s.includes(name)), `no line mentions ${name}`);
  }
  // There is no BRAKE button: THRUST pressed again brakes, and its line says so.
  assert.ok(!touch.some((s) => s.startsWith('Brake')), touch.join('\n'));
  assert.match(touch.find((s) => s.startsWith('Thrust')) ?? '', /again to brake/);
});

test('both control lists tell how to switch the music in infinite flight', () => {
  assert.match(t('ctlInfinite'), /M — music/);
  assert.match(t('ctlTouchInfinite'), /music/);
});

test('both control lists tell that a drag looks around the ship in infinite flight', () => {
  assert.match(t('ctlInfinite'), /drag — look around/);
  assert.match(t('ctlTouchInfinite'), /drag to look around/);
});

test('every browser without an install dialog gets at least one step', () => {
  assert.match(installSteps('ios').map((k) => t(k)).join(' '), /Share.*Add to Home Screen/);
  assert.match(installSteps('mac-safari').map((k) => t(k)).join(' '), /Add to Dock/);
  assert.match(installSteps('manual').map((k) => t(k)).join(' '), /Install app/);
});

test('the pause card leads back to the main menu, on a keyboard and on a touch screen', () => {
  for (const touch of [false, true]) {
    const buttons = pauseButtons(touch);
    assert.equal(buttons[0]?.action, 'resume', 'carrying on stays the primary button');
    assert.deepEqual(
      buttons.filter((b) => b.action === 'menu').map((b) => t(b.label)),
      ['Main menu'],
    );
  }
  assert.equal(t(pauseButtons(true)[0]!.label), 'Tap to continue');
  assert.equal(t(pauseButtons(false)[0]!.label), 'Click to continue');
});
