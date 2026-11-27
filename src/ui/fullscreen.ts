import { t } from '../text.ts';
import { h } from './dom.ts';

/**
 * Full screen through the standard API, with Safari's prefixed one as a fallback. iPhone Safari
 * has neither (only video goes full screen there), so the button hides itself when unsupported.
 * Takes the document as a parameter so the logic runs under Node's test runner.
 */
export type FullscreenDoc = {
  documentElement: { requestFullscreen?: () => Promise<void>; webkitRequestFullscreen?: () => void };
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
};

export function fullscreenSupported(doc: FullscreenDoc): boolean {
  const el = doc.documentElement;
  if (doc.fullscreenEnabled && typeof el.requestFullscreen === 'function') return true;
  return !!doc.webkitFullscreenEnabled && typeof el.webkitRequestFullscreen === 'function';
}

export function isFullscreen(doc: FullscreenDoc): boolean {
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/**
 * Enters full screen, or leaves it if already there. Must run inside a click or key press: the
 * browser refuses otherwise, and that refusal is swallowed (the page just stays as it was).
 */
export async function toggleFullscreen(doc: FullscreenDoc): Promise<void> {
  try {
    if (isFullscreen(doc)) {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    } else {
      const el = doc.documentElement;
      if (doc.fullscreenEnabled && el.requestFullscreen) await el.requestFullscreen();
      else el.webkitRequestFullscreen?.();
    }
  } catch {
    // Refused (no user gesture, a permissions policy in an iframe): nothing to undo.
  }
}

const EXPAND = '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>';
const COLLAPSE = '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>';
const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export type FullscreenButton = { el: HTMLButtonElement; dispose(): void };

/** A small corner button whose icon follows the real state, also when Esc leaves full screen. */
export function createFullscreenButton(className: string): FullscreenButton {
  const doc = document as FullscreenDoc;
  const el = h('button', { class: className, type: 'button', onclick: () => void toggleFullscreen(doc) });
  el.hidden = !fullscreenSupported(doc);
  const sync = () => {
    const on = isFullscreen(doc);
    const label = t(on ? 'exitFullscreen' : 'fullscreen');
    el.innerHTML = icon(on ? COLLAPSE : EXPAND);
    el.title = label;
    el.setAttribute('aria-label', label);
  };
  sync();
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  return {
    el,
    dispose() {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      el.remove();
    },
  };
}
