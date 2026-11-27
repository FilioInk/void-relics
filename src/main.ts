import './style.css';
import { Game } from './game/game.ts';
import { DEFAULT_SEED } from './world/generate.ts';
import { SETTINGS_KEY, defaultSettings, parseSettings, readStore } from './game/settings.ts';
import { t } from './text.ts';
import { captureInstallPrompt, registerServiceWorker } from './ui/install.ts';
import { createWakeLock } from './ui/wakeLock.ts';
import { parsePercent } from './world/megastructures.ts';

// The browser offers installing once, soon after load; keep that offer for the menu's "Install app".
captureInstallPrompt();
// Full screen (and the installed app) keeps the phone's screen on.
createWakeLock();
if (import.meta.env.PROD) registerServiceWorker(window);

function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n < 2 ** 32 ? n : DEFAULT_SEED;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

const settings = parseSettings(readStore(SETTINGS_KEY), defaultSettings());
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

if (!webglAvailable()) {
  ui.innerHTML = `<div class="loading">${t('noWebgl')}</div>`;
} else {
  const params = new URLSearchParams(window.location.search);
  const game = new Game(canvas, ui, seedFromUrl(), settings, params.has('debug'), params.has('perf'), {
    megaChance: parsePercent(params.get('mega')),
    gigaChance: parsePercent(params.get('giga')),
  });
  game.build().catch((err: unknown) => {
    console.error(err);
    ui.innerHTML = `<div class="loading">${t('noWebgl')}</div>`;
  });
}
