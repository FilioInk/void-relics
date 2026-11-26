import './style.css';
import { Game } from './game/game.ts';
import { SETTINGS_KEY, defaultSettings, parseSettings, readStore } from './game/settings.ts';
import { DICTS, detectLang } from './i18n/strings.ts';

const DEFAULT_SEED = 1337;

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

const settings = parseSettings(readStore(SETTINGS_KEY), defaultSettings(detectLang(navigator.languages ?? [navigator.language])));
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

if (!webglAvailable()) {
  ui.innerHTML = `<div class="loading">${DICTS[settings.lang].noWebgl}</div>`;
} else {
  const debug = new URLSearchParams(window.location.search).has('debug');
  const game = new Game(canvas, ui, seedFromUrl(), settings, debug);
  game.build().catch((err: unknown) => {
    console.error(err);
    ui.innerHTML = `<div class="loading">${DICTS[settings.lang].noWebgl}</div>`;
  });
}
