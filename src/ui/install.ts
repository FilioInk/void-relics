import { installedDisplay } from './wakeLock.ts';

/**
 * The game as an installable app (a PWA), the way the Pocket games do it: the menu's "Install
 * app" opens the browser's own install dialog where the browser offers one (Chrome, Edge and
 * Samsung Internet, on Android and on a computer), and otherwise a card with the steps for this
 * browser: the Share menu on iPhone and iPad, File → Add to Dock in Safari on a Mac, the
 * browser's menu anywhere else.
 *
 * The menu item is shown only in a browser tab: not in the installed app, and not once the
 * browser says the app has just been installed (`appinstalled`).
 *
 * `beforeinstallprompt` fires once, soon after load, and is lost to a listener that comes later,
 * so `captureInstallPrompt()` is the first thing `main.ts` runs. It also holds back the browser's
 * own install bar: a banner over the game is not wanted, the menu item is the one offer.
 * Everything takes the window as a parameter so the logic runs under Node's test runner.
 */

/** What `beforeinstallprompt` hands the page (Chromium only). */
export type InstallPromptEvent = {
  preventDefault(): void;
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome?: string }>;
};

export type InstallScope = {
  navigator: { standalone?: boolean; userAgent?: string; platform?: string; maxTouchPoints?: number };
  matchMedia?(query: string): { matches: boolean };
  addEventListener?(type: string, listener: (event: never) => void): void;
};

/** What a tap on "Install app" does: the browser's dialog, or the steps for this browser. */
export type InstallPath = 'prompt' | 'ios' | 'mac-safari' | 'manual';

/** An iPhone, iPad or iPod, including an iPad that says it is a Mac. No install API there: the Share menu is the way. */
export function isIosDevice(nav: InstallScope['navigator']): boolean {
  if (/iPhone|iPad|iPod/i.test(nav.userAgent ?? '')) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

/** Safari on a Mac (Sonoma and later put "Add to Dock" in its File menu). Chrome, Edge and Firefox on a Mac say Safari too, and more. */
export function isMacSafari(nav: InstallScope['navigator']): boolean {
  const ua = nav.userAgent ?? '';
  if (!/Macintosh/.test(ua) || isIosDevice(nav)) return false;
  return /Version\/[\d.]+.*Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(ua);
}

export function installPath(input: { hasPrompt: boolean; nav: InstallScope['navigator'] }): InstallPath {
  if (input.hasPrompt) return 'prompt';
  if (isIosDevice(input.nav)) return 'ios';
  if (isMacSafari(input.nav)) return 'mac-safari';
  return 'manual';
}

/** Whether the menu shows "Install app": a browser tab, and the app not installed from it just now. */
export function installVisible(input: { installedDisplay: boolean; installed: boolean }): boolean {
  return !input.installedDisplay && !input.installed;
}

export type InstallOffer = {
  visible(): boolean;
  path(): InstallPath;
  /**
   * A tap on the menu item. With the browser's dialog it opens that and resolves `'accepted'` or
   * `'dismissed'`; otherwise it resolves the steps to show (`'ios'`, `'mac-safari'`, `'manual'`).
   */
  install(): Promise<'accepted' | 'dismissed' | Exclude<InstallPath, 'prompt'>>;
  /** Told when `visible()` or `path()` may answer differently. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
};

type Capture = { event: InstallPromptEvent | undefined; installed: boolean; listeners: Set<() => void> };

const captures = new WeakMap<object, Capture>();

function captureFor(scope: InstallScope): Capture {
  const found = captures.get(scope);
  if (found) return found;
  const state: Capture = { event: undefined, installed: false, listeners: new Set() };
  captures.set(scope, state);
  const tell = () => {
    for (const l of [...state.listeners]) l();
  };
  try {
    scope.addEventListener?.('beforeinstallprompt', ((event: InstallPromptEvent) => {
      event.preventDefault();
      state.event = event;
      tell();
    }) as (event: never) => void);
    scope.addEventListener?.('appinstalled', (() => {
      state.installed = true;
      state.event = undefined;
      tell();
    }) as (event: never) => void);
  } catch {
    // Nothing to listen on: the menu item falls back to the steps.
  }
  return state;
}

/** Starts keeping the browser's install event. Call it first thing; it is idempotent per window. */
export function captureInstallPrompt(scope: InstallScope = globalThis as unknown as InstallScope): void {
  captureFor(scope);
}

export function createInstallOffer(scope: InstallScope = globalThis as unknown as InstallScope): InstallOffer {
  const capture = captureFor(scope);
  const path = () => installPath({ hasPrompt: capture.event !== undefined, nav: scope.navigator });
  return {
    visible: () => installVisible({ installedDisplay: installedDisplay(scope), installed: capture.installed }),
    path,
    async install() {
      const event = capture.event;
      if (!event) return path() as Exclude<InstallPath, 'prompt'>;
      // The event can be used once: after its dialog the browser decides when it offers again.
      capture.event = undefined;
      for (const l of [...capture.listeners]) l();
      try {
        await event.prompt();
        return (await event.userChoice).outcome === 'accepted' ? 'accepted' : 'dismissed';
      } catch {
        return 'dismissed';
      }
    },
    subscribe(listener) {
      capture.listeners.add(listener);
      return () => void capture.listeners.delete(listener);
    },
  };
}

/**
 * The service worker (`public/sw.js`), in the built game only: the dev server's modules change
 * under it. Registered after `load`, so it never competes with building the system.
 */
export function registerServiceWorker(scope: { navigator: { serviceWorker?: { register(url: string): Promise<unknown> } }; addEventListener(type: 'load', l: () => void): void; document: { readyState: string } }): void {
  const sw = scope.navigator.serviceWorker;
  if (!sw) return;
  const register = () => void sw.register('sw.js').catch(() => undefined);
  if (scope.document.readyState === 'complete') register();
  else scope.addEventListener('load', register);
}
