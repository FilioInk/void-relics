import { t, type Key } from '../text.ts';
import type { Settings } from '../game/settings.ts';
import { h } from './dom.ts';
import type { InstallPath } from './install.ts';

/** Menu, pause, death and victory overlays. They rebuild themselves when a setting changes. */

export type ScreenName = 'loading' | 'menu' | 'pause' | 'dead' | 'victory' | 'none';

export type ScreenHandlers = {
  onLaunch(): void;
  onNewGalaxy(): void;
  onInfinite(): void;
  onResume(): void;
  /** From the pause card back to the start menu, keeping the hunt where it is. */
  onMenu(): void;
  onKeepFlying(): void;
  onSettings(next: Settings): void;
  /** "Install app": the browser's dialog where it has one, else which steps to show. */
  onInstall(): Promise<'accepted' | 'dismissed' | InstallSteps>;
};

/** The browsers whose install the menu explains in steps. */
export type InstallSteps = Exclude<InstallPath, 'prompt'>;

/**
 * `touch`: a touch-first device, played with the on-screen controls. `installable`: a browser
 * tab, where the menu offers to install the game as an app.
 */
export type ScreenState = { seed: number; found: number; settings: Settings; victoryTime: string; touch: boolean; installable: boolean };

const KEYBOARD_CONTROLS = ['ctlMouse', 'ctlThrust', 'ctlBrake', 'ctlBoost', 'ctlFire', 'ctlStrafe', 'ctlRoll', 'ctlMap', 'ctlPause', 'ctlInfinite'] as const;
const TOUCH_CONTROLS = ['ctlTouchStick', 'ctlTouchThrust', 'ctlTouchBrake', 'ctlTouchBoost', 'ctlTouchFire', 'ctlTouchBar', 'ctlTouchInfinite'] as const;

/** The controls list in the settings and pause cards: the keys, or on a touch device the on-screen controls. */
export function controlKeys(touch: boolean): readonly Key[] {
  return touch ? TOUCH_CONTROLS : KEYBOARD_CONTROLS;
}

/** The pause card's buttons, first one primary: carry on, or leave the hunt for the start menu. */
export function pauseButtons(touch: boolean): readonly { label: Key; action: 'resume' | 'menu' }[] {
  return [
    { label: touch ? 'tapToResume' : 'clickToResume', action: 'resume' },
    { label: 'mainMenu', action: 'menu' },
  ];
}

/** The main game's button: the hunt, with the score once it has started. */
export function playLabel(found: number): string {
  return found > 0 ? t('collectRelicsProgress', { found }) : t('collectRelics');
}

const INSTALL_STEPS: Record<InstallSteps, readonly Key[]> = {
  ios: ['installIos1', 'installIos2'],
  'mac-safari': ['installMacSafari'],
  manual: ['installManual1', 'installManual2'],
};

/** The install card's steps for a browser without an install dialog. */
export function installSteps(path: InstallSteps): readonly Key[] {
  return INSTALL_STEPS[path];
}

/**
 * The menu title's viewBox. At 150 units Exo 2 Thin sets the name well under 1000 units wide;
 * letter spacing stretches it to the full 1000. Capitals stand 0.71 em tall, so a baseline at 110
 * leaves them a few units below the top edge.
 */
const TITLE_W = 1000;
const TITLE_H = 114;
const TITLE_SIZE = 150;
const TITLE_BASELINE = 110;

const escapeXml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The game's name across the whole width of the screen in thin capitals. SVG with `textLength`
 * spreads the letters to fill the line exactly, whatever font has loaded, and scales with the
 * window without any measuring.
 */
function menuTitle(): HTMLElement {
  const el = h('h1', { class: 'menu-title', 'aria-label': t('title') });
  el.innerHTML =
    `<svg viewBox="0 0 ${TITLE_W} ${TITLE_H}" aria-hidden="true">` +
    `<text x="${TITLE_W / 2}" y="${TITLE_BASELINE}" font-size="${TITLE_SIZE}" text-anchor="middle" textLength="${TITLE_W}" lengthAdjust="spacing">${escapeXml(t('title'))}</text>` +
    `</svg>`;
  return el;
}

export function createScreens(handlers: ScreenHandlers, state: () => ScreenState) {
  const root = h('div');
  let current: ScreenName = 'loading';
  /**
   * The start menu is three views: the title with its buttons, and behind them the settings and
   * the install steps (for a browser that has no install dialog of its own).
   */
  let menuView: 'main' | 'settings' | 'install' = 'main';
  let steps: InstallSteps = 'manual';
  const openMenuView = (view: 'main' | 'settings' | 'install') => {
    menuView = view;
    render();
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && current === 'menu' && menuView !== 'main') openMenuView('main');
  });
  const install = async () => {
    const result = await handlers.onInstall();
    if (result === 'accepted' || result === 'dismissed') return;
    steps = result;
    if (current === 'menu') openMenuView('install');
  };

  /** A card behind the start menu, with a Back button and a click outside it to leave. */
  const menuCard = (title: string, ...body: HTMLElement[]) =>
    h(
      'div',
      { class: 'overlay', onclick: (e: Event) => { if (e.target === e.currentTarget) openMenuView('main'); } },
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', { text: title }), h('button', { class: 'btn ghost small', text: t('back'), onclick: () => openMenuView('main') })),
        ...body,
      ),
    );

  const settingsPanel = (): HTMLElement => {
    const s = state().settings;
    const change = (patch: Partial<Settings>) => handlers.onSettings({ ...state().settings, ...patch });
    const toggle = (on: boolean, flip: () => void) =>
      h('button', { class: `toggle ${on ? 'on' : ''}`, text: on ? t('on') : t('off'), onclick: () => flip() });
    const sens = h('input', { type: 'range', min: 0.3, max: 2.5, step: 0.05, value: s.sensitivity });
    sens.addEventListener('change', () => change({ sensitivity: Number(sens.value) }));
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.musicVolume });
    vol.addEventListener('change', () => change({ musicVolume: Number(vol.value) }));
    return h(
      'div',
      { class: 'settings' },
      h('label', { text: t('music') }), toggle(s.music, () => change({ music: !s.music })),
      h('label', { text: t('musicVolume') }), vol,
      h('label', { text: t('sound') }), toggle(s.sound, () => change({ sound: !s.sound })),
      h('label', { text: t(state().touch ? 'sensitivityTouch' : 'sensitivity') }), sens,
      h('label', { text: t('invertY') }), toggle(s.invertY, () => change({ invertY: !s.invertY })),
    );
  };

  const controls = () => h('ul', { class: 'controls' }, ...controlKeys(state().touch).map((k) => h('li', { text: t(k) })));

  const build = (name: ScreenName): HTMLElement | null => {
    const st = state();
    switch (name) {
      case 'loading':
        return h('div', { class: 'loading', text: t('loading') });
      case 'menu':
        if (menuView === 'settings')
          return menuCard(
            t('settings'),
            h(
              'div',
              { class: 'galaxy-row' },
              h('div', { class: 'seed', text: t('galaxy', { seed: st.seed }) }),
              h('button', { class: 'btn ghost small', text: t('newGalaxy'), onclick: () => handlers.onNewGalaxy() }),
            ),
            h('div', { class: 'section-title', text: t('controlsTitle') }),
            controls(),
            settingsPanel(),
          );
        if (menuView === 'install')
          return menuCard(
            t('installTitle'),
            h('p', { text: t('installLead') }),
            h('ol', { class: 'install-steps' }, ...installSteps(steps).map((k) => h('li', { text: t(k) }))),
          );
        return h(
          'div',
          { class: 'overlay menu' },
          // Name above, buttons below: the ship the menu camera circles stays in view between them.
          h('div', { class: 'menu-group' }, menuTitle(), h('p', { class: 'menu-tagline', text: t('tagline') })),
          h(
            'div',
            { class: 'menu-group' },
            h(
              'div',
              { class: 'menu-buttons' },
              h('button', { class: 'btn', text: playLabel(st.found), onclick: () => handlers.onLaunch() }),
              h('button', { class: 'btn ghost', text: t('infinite'), onclick: () => handlers.onInfinite() }),
            ),
            h(
              'div',
              { class: 'menu-links' },
              h('button', { class: 'menu-link', text: t('settings'), onclick: () => openMenuView('settings') }),
              st.installable ? h('button', { class: 'menu-link', text: t('install'), onclick: () => void install() }) : null,
            ),
          ),
        );
      case 'pause':
        return h(
          'div',
          { class: 'overlay', onclick: (e: Event) => { if (e.target === e.currentTarget) handlers.onResume(); } },
          h(
            'div',
            { class: 'card' },
            h('h2', { text: t('paused') }),
            h(
              'div',
              { class: 'buttons' },
              ...pauseButtons(st.touch).map((b, i) =>
                h('button', { class: i === 0 ? 'btn' : 'btn ghost', text: t(b.label), onclick: () => (b.action === 'menu' ? handlers.onMenu() : handlers.onResume()) }),
              ),
            ),
            h('div', { class: 'section-title', text: t('controlsTitle') }),
            controls(),
            settingsPanel(),
          ),
        );
      case 'dead':
        return h('div', { class: 'overlay clear passive' }, h('div', { class: 'big-center dead' }, h('h2', { text: t('destroyed') }), h('p', { text: t('respawning') })));
      case 'victory':
        return h(
          'div',
          { class: 'overlay' },
          h(
            'div',
            { class: 'card big-center' },
            h('h1', { text: t('victory') }),
            h('p', { text: t('victoryTime', { time: st.victoryTime }) }),
            h(
              'div',
              { class: 'buttons', style: 'justify-content:center' },
              h('button', { class: 'btn', text: t('keepFlying'), onclick: () => handlers.onKeepFlying() }),
              h('button', { class: 'btn ghost', text: t('newGalaxy'), onclick: () => handlers.onNewGalaxy() }),
            ),
          ),
        );
      default:
        return null;
    }
  };

  const render = () => {
    const el = build(current);
    root.replaceChildren(...(el ? [el] : []));
  };

  return {
    el: root,
    show(name: ScreenName) {
      current = name;
      if (name === 'menu') menuView = 'main';
      render();
    },
    get current() {
      return current;
    },
    /** Re-render in place, e.g. after a settings change. */
    refresh() {
      render();
    },
  };
}
