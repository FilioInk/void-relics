import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onSoundGesture, SOUND_GESTURES } from './gesture.ts';

test('every gesture a browser may accept for sound starts it', () => {
  const target = new EventTarget();
  let starts = 0;
  onSoundGesture(target, () => starts++);
  for (const type of SOUND_GESTURES) target.dispatchEvent(new Event(type));
  assert.equal(starts, SOUND_GESTURES.length);
});

test('a key and a tap both count: desktop and phones start sound differently', () => {
  assert.ok(SOUND_GESTURES.includes('keydown'));
  assert.ok(SOUND_GESTURES.includes('touchend'));
  assert.ok(SOUND_GESTURES.includes('click'));
});

test('moving the mouse or letting a key go does not start sound', () => {
  const target = new EventTarget();
  let starts = 0;
  onSoundGesture(target, () => starts++);
  for (const type of ['mousemove', 'pointermove', 'keyup', 'wheel', 'scroll']) target.dispatchEvent(new Event(type));
  assert.equal(starts, 0);
});

test('listens in the capture phase, so a control that stops the click still starts sound', () => {
  // Node's EventTarget has no tree to propagate through, so the flag is read off the registration.
  const seen: Array<boolean | undefined> = [];
  const target = new EventTarget();
  const add = target.addEventListener.bind(target);
  target.addEventListener = (type, listener, options) => {
    seen.push(typeof options === 'object' ? options.capture : options);
    add(type, listener, options);
  };
  onSoundGesture(target, () => undefined);
  assert.deepEqual(seen, SOUND_GESTURES.map(() => true));
});

test('after stopping, gestures no longer start sound', () => {
  const target = new EventTarget();
  let starts = 0;
  const stop = onSoundGesture(target, () => starts++);
  target.dispatchEvent(new Event('click'));
  stop();
  for (const type of SOUND_GESTURES) target.dispatchEvent(new Event(type));
  assert.equal(starts, 1);
});
