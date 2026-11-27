import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWakeLock, installedDisplay, wantWakeLock, type WakeLockScope, type WakeLockSentinelLike } from './wakeLock.ts';

/** A window whose wake lock, full screen, visibility and display mode are set by hand. */
function fakeScope(opts: { api?: boolean; refuse?: boolean; modes?: string[] } = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const log: string[] = [];
  const sentinels: Array<WakeLockSentinelLike & { fire(): void }> = [];
  const modes = new Set(opts.modes ?? []);
  const scope: WakeLockScope = {
    document: {
      documentElement: {},
      fullscreenElement: null,
      visibilityState: 'visible',
      addEventListener(type, listener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
    },
    navigator: {},
    matchMedia: (query) => ({ matches: [...modes].some((m) => query === `(display-mode: ${m})`) }),
  };
  if (opts.api !== false)
    scope.navigator.wakeLock = {
      async request() {
        log.push('request');
        if (opts.refuse) throw new Error('NotAllowedError');
        let onRelease: (() => void) | null = null;
        const s = {
          released: false,
          async release() {
            log.push('release');
            s.released = true;
          },
          addEventListener(_type: 'release', listener: () => void) {
            onRelease = listener;
          },
          /** The browser letting go by itself, as it does when the page is hidden. */
          fire() {
            s.released = true;
            onRelease?.();
          },
        };
        sentinels.push(s);
        return s;
      },
    };
  const emit = (type: string) => {
    for (const l of listeners.get(type) ?? []) l();
  };
  return { scope, log, sentinels, emit };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('the screen stays on only while the page is in view and fills the screen', () => {
  assert.equal(wantWakeLock({ fullscreen: true, installed: false, visible: true }), true);
  assert.equal(wantWakeLock({ fullscreen: false, installed: true, visible: true }), true);
  assert.equal(wantWakeLock({ fullscreen: false, installed: false, visible: true }), false);
  assert.equal(wantWakeLock({ fullscreen: true, installed: true, visible: false }), false);
});

test('the installed app is the standalone or fullscreen display mode, or iOS Home Screen flag', () => {
  assert.equal(installedDisplay(fakeScope({ modes: ['fullscreen'] }).scope), true);
  assert.equal(installedDisplay(fakeScope({ modes: ['standalone'] }).scope), true);
  assert.equal(installedDisplay(fakeScope({ modes: ['browser'] }).scope), false);
  assert.equal(installedDisplay({ navigator: { standalone: true } }), true);
  assert.equal(installedDisplay({ navigator: {} }), false);
});

test('entering full screen takes the lock and leaving it lets go', async () => {
  const { scope, log, emit } = fakeScope();
  const lock = createWakeLock(scope);
  await settle();
  assert.deepEqual(log, []);
  scope.document.fullscreenElement = scope.document.documentElement;
  emit('fullscreenchange');
  await settle();
  assert.deepEqual(log, ['request']);
  assert.equal(lock.held(), true);
  scope.document.fullscreenElement = null;
  emit('fullscreenchange');
  await settle();
  assert.deepEqual(log, ['request', 'release']);
  assert.equal(lock.held(), false);
});

test('the installed app holds the lock from the start', async () => {
  const { scope, log } = fakeScope({ modes: ['standalone'] });
  const lock = createWakeLock(scope);
  await settle();
  assert.deepEqual(log, ['request']);
  assert.equal(lock.held(), true);
});

test('a lock the browser dropped while the page was hidden is taken again on return', async () => {
  const { scope, log, sentinels, emit } = fakeScope();
  scope.document.fullscreenElement = scope.document.documentElement;
  const lock = createWakeLock(scope);
  await settle();
  // The phone's screen goes off: the page is hidden and the browser releases the lock.
  scope.document.visibilityState = 'hidden';
  sentinels[0]!.fire();
  emit('visibilitychange');
  await settle();
  assert.equal(lock.held(), false);
  assert.deepEqual(log, ['request']);
  scope.document.visibilityState = 'visible';
  emit('visibilitychange');
  await settle();
  assert.deepEqual(log, ['request', 'request']);
  assert.equal(lock.held(), true);
});

test('changes that land together ask for one lock, not two', async () => {
  const { scope, log, emit } = fakeScope();
  createWakeLock(scope);
  scope.document.fullscreenElement = scope.document.documentElement;
  emit('fullscreenchange');
  emit('webkitfullscreenchange');
  emit('visibilitychange');
  await settle();
  await settle();
  assert.deepEqual(log, ['request']);
});

test('a refusal or a browser without the API leaves the game running', async () => {
  const refused = fakeScope({ refuse: true });
  refused.scope.document.fullscreenElement = refused.scope.document.documentElement;
  const a = createWakeLock(refused.scope);
  await a.sync();
  assert.equal(a.held(), false);

  const missing = fakeScope({ api: false });
  missing.scope.document.fullscreenElement = missing.scope.document.documentElement;
  const b = createWakeLock(missing.scope);
  await b.sync();
  assert.equal(b.held(), false);
});
