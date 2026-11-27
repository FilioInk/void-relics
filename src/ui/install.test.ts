import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureInstallPrompt, createInstallOffer, installPath, installVisible, isIosDevice, isMacSafari, type InstallPromptEvent, type InstallScope } from './install.ts';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
};

/** A window that can fire the browser's install events on demand. */
function fakeScope(nav: InstallScope['navigator'] = {}, modes: string[] = []) {
  const listeners = new Map<string, Array<(e: never) => void>>();
  const scope: InstallScope = {
    navigator: nav,
    matchMedia: (q) => ({ matches: modes.some((m) => q === `(display-mode: ${m})`) }),
    addEventListener(type, l) {
      listeners.set(type, [...(listeners.get(type) ?? []), l]);
    },
  };
  const fire = (type: string, event: unknown = {}) => {
    for (const l of listeners.get(type) ?? []) l(event as never);
  };
  return { scope, fire };
}

function promptEvent(outcome: 'accepted' | 'dismissed') {
  const calls: string[] = [];
  const event: InstallPromptEvent = {
    preventDefault: () => calls.push('preventDefault'),
    prompt: async () => void calls.push('prompt'),
    userChoice: Promise.resolve({ outcome }),
  };
  return { event, calls };
}

test('iPhones and iPads that call themselves a Mac take the Share menu; a real Mac does not', () => {
  assert.equal(isIosDevice({ userAgent: UA.iphone }), true);
  assert.equal(isIosDevice({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIosDevice({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 }), false);
});

test('only Safari itself on a Mac gets the Add to Dock steps', () => {
  assert.equal(isMacSafari({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 }), true);
  assert.equal(isMacSafari({ userAgent: UA.macChrome, platform: 'MacIntel' }), false);
  assert.equal(isMacSafari({ userAgent: UA.macFirefox, platform: 'MacIntel' }), false);
  assert.equal(isMacSafari({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 5 }), false);
});

test('a tap takes the browser dialog when there is one, otherwise the steps for this browser', () => {
  assert.equal(installPath({ hasPrompt: true, nav: { userAgent: UA.android } }), 'prompt');
  assert.equal(installPath({ hasPrompt: false, nav: { userAgent: UA.iphone } }), 'ios');
  assert.equal(installPath({ hasPrompt: false, nav: { userAgent: UA.macSafari, platform: 'MacIntel' } }), 'mac-safari');
  assert.equal(installPath({ hasPrompt: false, nav: { userAgent: UA.macFirefox } }), 'manual');
});

test('the menu item is for a browser tab only', () => {
  assert.equal(installVisible({ installedDisplay: false, installed: false }), true);
  assert.equal(installVisible({ installedDisplay: true, installed: false }), false);
  assert.equal(installVisible({ installedDisplay: false, installed: true }), false);
  assert.equal(createInstallOffer(fakeScope({}, ['standalone']).scope).visible(), false);
  assert.equal(createInstallOffer(fakeScope({}, ['fullscreen']).scope).visible(), false);
  assert.equal(createInstallOffer(fakeScope({ standalone: true }).scope).visible(), false);
});

test('the browser event is kept, its install bar held back, and its dialog opened by the tap', async () => {
  const { scope, fire } = fakeScope({ userAgent: UA.android });
  captureInstallPrompt(scope);
  const { event, calls } = promptEvent('accepted');
  fire('beforeinstallprompt', event);
  assert.deepEqual(calls, ['preventDefault']);
  const offer = createInstallOffer(scope);
  assert.equal(offer.path(), 'prompt');
  assert.equal(await offer.install(), 'accepted');
  assert.deepEqual(calls, ['preventDefault', 'prompt']);
  // Used once: the next tap shows the steps until the browser offers again.
  assert.equal(offer.path(), 'manual');
  assert.equal(await offer.install(), 'manual');
});

test('a dismissed dialog is reported as such', async () => {
  const { scope, fire } = fakeScope({ userAgent: UA.android });
  const offer = createInstallOffer(scope);
  fire('beforeinstallprompt', promptEvent('dismissed').event);
  assert.equal(await offer.install(), 'dismissed');
});

test('without the browser event the tap resolves the steps to show', async () => {
  assert.equal(await createInstallOffer(fakeScope({ userAgent: UA.iphone }).scope).install(), 'ios');
  assert.equal(await createInstallOffer(fakeScope({ userAgent: UA.macSafari, platform: 'MacIntel' }).scope).install(), 'mac-safari');
});

test('installing hides the menu item and tells the menu', () => {
  const { scope, fire } = fakeScope({ userAgent: UA.macChrome });
  const offer = createInstallOffer(scope);
  let told = 0;
  const stop = offer.subscribe(() => told++);
  fire('beforeinstallprompt', promptEvent('accepted').event);
  assert.equal(told, 1);
  assert.equal(offer.visible(), true);
  fire('appinstalled');
  assert.equal(told, 2);
  assert.equal(offer.visible(), false);
  assert.equal(offer.path(), 'manual');
  stop();
  fire('appinstalled');
  assert.equal(told, 2);
});
