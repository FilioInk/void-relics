import { isFullscreen, type FullscreenDoc } from './fullscreen.ts';

/**
 * Keeps the screen on while the game is full screen, so a phone left to infinite flight does not
 * dim and lock. "Full screen" is the Fullscreen API, or the installed app (display mode
 * fullscreen or standalone), which on a phone fills the screen by itself.
 *
 * Through the Screen Wake Lock API. The browser drops the lock whenever the page is hidden (a
 * switch of app, the screen turned off), so it is asked for again when the page comes back.
 * Where the API is missing (Firefox before 126, iOS before 16.4) the screen dims as before.
 * Takes the window's parts as a parameter so the logic runs under Node's test runner.
 */

export type WakeLockSentinelLike = {
  released?: boolean;
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
};

export type WakeLockScope = {
  document: FullscreenDoc & {
    visibilityState?: string;
    addEventListener(type: string, listener: () => void): void;
  };
  /** `standalone`: iOS's own flag for a page opened from the Home Screen. */
  navigator: { standalone?: boolean; wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
  matchMedia?(query: string): { matches: boolean; addEventListener?(type: 'change', listener: () => void): void };
};

/** The installed app: launched from the home screen or the desktop, outside a browser tab. */
export function installedDisplay(scope: Pick<WakeLockScope, 'navigator' | 'matchMedia'>): boolean {
  if (scope.navigator.standalone === true) return true;
  try {
    return ['fullscreen', 'standalone'].some((mode) => scope.matchMedia?.(`(display-mode: ${mode})`).matches === true);
  } catch {
    return false;
  }
}

/** Whether the screen should stay on: the page is in view and fills the screen. */
export function wantWakeLock(input: { fullscreen: boolean; installed: boolean; visible: boolean }): boolean {
  return input.visible && (input.fullscreen || input.installed);
}

export type WakeLock = {
  /** Asks for the lock or lets it go, to match the page's state now. Never throws. */
  sync(): Promise<void>;
  /** Whether the screen is being kept on now. */
  held(): boolean;
};

/** Watches full screen, the display mode and the page's visibility, and holds the lock to match. */
export function createWakeLock(scope: WakeLockScope = globalThis as unknown as WakeLockScope): WakeLock {
  let sentinel: WakeLockSentinelLike | null = null;
  // One request at a time: a second sync while the first waits only re-checks when it lands.
  let pending: Promise<void> | null = null;
  let again = false;

  const want = () =>
    wantWakeLock({
      fullscreen: isFullscreen(scope.document),
      installed: installedDisplay(scope),
      visible: (scope.document.visibilityState ?? 'visible') === 'visible',
    });

  const step = async (): Promise<void> => {
    const api = scope.navigator.wakeLock;
    if (!api) return;
    if (sentinel?.released) sentinel = null;
    if (want()) {
      if (sentinel) return;
      try {
        const got = await api.request('screen');
        // Full screen may have ended while the browser was answering.
        if (!want()) {
          await got.release().catch(() => undefined);
          return;
        }
        sentinel = got;
        got.addEventListener?.('release', () => {
          if (sentinel === got) sentinel = null;
        });
      } catch {
        // Refused (battery saver, a hidden page, a permissions policy): the screen dims as usual.
      }
    } else if (sentinel) {
      const held = sentinel;
      sentinel = null;
      await held.release().catch(() => undefined);
    }
  };

  const sync = async (): Promise<void> => {
    if (pending) {
      again = true;
      return pending;
    }
    pending = (async () => {
      do {
        again = false;
        await step();
      } while (again);
    })();
    try {
      await pending;
    } finally {
      pending = null;
    }
  };

  const onChange = () => void sync();
  scope.document.addEventListener('fullscreenchange', onChange);
  scope.document.addEventListener('webkitfullscreenchange', onChange);
  scope.document.addEventListener('visibilitychange', onChange);
  for (const mode of ['fullscreen', 'standalone']) {
    try {
      scope.matchMedia?.(`(display-mode: ${mode})`).addEventListener?.('change', onChange);
    } catch {
      // An old browser without change events on media queries: the other events still sync.
    }
  }
  void sync();

  return { sync, held: () => sentinel !== null && sentinel.released !== true };
}
