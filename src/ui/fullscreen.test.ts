import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullscreenSupported, isFullscreen, toggleFullscreen, type FullscreenDoc } from './fullscreen.ts';

/** A document whose full-screen calls are recorded instead of performed. */
function fakeDoc(kind: 'standard' | 'webkit' | 'none', opts: { refuse?: boolean } = {}) {
  const calls: string[] = [];
  const doc: FullscreenDoc = { documentElement: {} };
  if (kind === 'standard') {
    doc.fullscreenEnabled = true;
    doc.fullscreenElement = null;
    doc.documentElement.requestFullscreen = async () => {
      calls.push('request');
      if (opts.refuse) throw new TypeError('Permissions check failed');
      doc.fullscreenElement = doc.documentElement;
    };
    doc.exitFullscreen = async () => {
      calls.push('exit');
      doc.fullscreenElement = null;
    };
  } else if (kind === 'webkit') {
    doc.webkitFullscreenEnabled = true;
    doc.webkitFullscreenElement = null;
    doc.documentElement.webkitRequestFullscreen = () => {
      calls.push('webkitRequest');
      doc.webkitFullscreenElement = doc.documentElement;
    };
    doc.webkitExitFullscreen = () => {
      calls.push('webkitExit');
      doc.webkitFullscreenElement = null;
    };
  }
  return { doc, calls };
}

test('full screen is supported through the standard API or the Safari prefix, not without either', () => {
  assert.equal(fullscreenSupported(fakeDoc('standard').doc), true);
  assert.equal(fullscreenSupported(fakeDoc('webkit').doc), true);
  assert.equal(fullscreenSupported(fakeDoc('none').doc), false);
  // An iframe without allow="fullscreen" has the method but reports it disabled.
  const { doc } = fakeDoc('standard');
  doc.fullscreenEnabled = false;
  assert.equal(fullscreenSupported(doc), false);
});

test('toggling enters full screen, and toggling again leaves it', async () => {
  const { doc, calls } = fakeDoc('standard');
  await toggleFullscreen(doc);
  assert.equal(isFullscreen(doc), true);
  await toggleFullscreen(doc);
  assert.equal(isFullscreen(doc), false);
  assert.deepEqual(calls, ['request', 'exit']);
});

test('Safari without the standard API goes through the prefixed calls', async () => {
  const { doc, calls } = fakeDoc('webkit');
  await toggleFullscreen(doc);
  assert.equal(isFullscreen(doc), true);
  await toggleFullscreen(doc);
  assert.equal(isFullscreen(doc), false);
  assert.deepEqual(calls, ['webkitRequest', 'webkitExit']);
});

test('a refused request leaves the page as it was instead of throwing', async () => {
  const { doc, calls } = fakeDoc('standard', { refuse: true });
  await toggleFullscreen(doc);
  assert.equal(isFullscreen(doc), false);
  assert.deepEqual(calls, ['request']);
});

test('without any full-screen API toggling does nothing', async () => {
  const { doc } = fakeDoc('none');
  await toggleFullscreen(doc);
  assert.equal(isFullscreen(doc), false);
});
