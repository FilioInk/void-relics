import { t } from '../text.ts';
import type { Settings } from '../game/settings.ts';
import { h } from './dom.ts';

/** Menu, pause, death and victory overlays. They rebuild themselves when the language changes. */

export type ScreenName = 'loading' | 'menu' | 'pause' | 'dead' | 'victory' | 'none';

export type ScreenHandlers = {
  onLaunch(): void;
  onNewGalaxy(): void;
  onInfinite(): void;
  onResume(): void;
  onKeepFlying(): void;
  onSettings(next: Settings): void;
};

export type ScreenState = { seed: number; found: number; settings: Settings; victoryTime: string; touchOnly: boolean };

export function createScreens(handlers: ScreenHandlers, state: () => ScreenState) {
  const root = h('div');
  let current: ScreenName = 'loading';

  const settingsPanel = (): HTMLElement => {
    const s = state().settings;
    const change = (patch: Partial<Settings>) => handlers.onSettings({ ...state().settings, ...patch });
    const toggle = (on: boolean, flip: () => void) =>
      h('button', { class: `toggle ${on ? 'on' : ''}`, text: on ? t('on') : t('off'), onclick: () => flip() });
    const sens = h('input', { type: 'range', min: 0.3, max: 2.5, step: 0.05, value: s.sensitivity });
    sens.addEventListener('change', () => change({ sensitivity: Number(sens.value) }));
    return h(
      'div',
      { class: 'settings' },
      h('label', { text: t('music') }), toggle(s.music, () => change({ music: !s.music })),
      h('label', { text: t('sound') }), toggle(s.sound, () => change({ sound: !s.sound })),
      h('label', { text: t('sensitivity') }), sens,
      h('label', { text: t('invertY') }), toggle(s.invertY, () => change({ invertY: !s.invertY })),
    );
  };

  const controls = () =>
    h(
      'ul',
      { class: 'controls' },
      ...(['ctlMouse', 'ctlThrust', 'ctlBrake', 'ctlBoost', 'ctlFire', 'ctlStrafe', 'ctlRoll', 'ctlMap', 'ctlPause'] as const).map((k) => h('li', { text: t(k) })),
    );

  const build = (name: ScreenName): HTMLElement | null => {
    const st = state();
    switch (name) {
      case 'loading':
        return h('div', { class: 'loading', text: t('loading') });
      case 'menu':
        return h(
          'div',
          { class: 'overlay' },
          h(
            'div',
            { class: 'card' },
            h('h1', { text: t('title') }),
            h('div', { class: 'seed', text: t('galaxy', { seed: st.seed }) }),
            h('p', { text: t('tagline') }),
            h(
              'div',
              { class: 'buttons' },
              h('button', { class: 'btn', text: st.found > 0 ? t('continue', { found: st.found }) : t('launch'), onclick: () => handlers.onLaunch() }),
              h('button', { class: 'btn ghost', text: t('infinite'), onclick: () => handlers.onInfinite() }),
              h('button', { class: 'btn ghost', text: t('newGalaxy'), onclick: () => handlers.onNewGalaxy() }),
            ),
            h('div', { class: 'section-title', text: t('controlsTitle') }),
            controls(),
            settingsPanel(),
            st.touchOnly ? h('div', { class: 'notice', text: t('needsMouse') }) : null,
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
            h('div', { class: 'buttons' }, h('button', { class: 'btn', text: t('clickToResume'), onclick: () => handlers.onResume() })),
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
