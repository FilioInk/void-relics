import { t } from '../text.ts';
import { STICK, ThrustLatch, TouchRouter, knobOffset, restingStick, stickAim, type Control, type Vec } from '../game/touch.ts';
import { createWriter, h, icon } from './dom.ts';

/**
 * On-screen controls for phones and tablets. The left half of the screen is a floating stick:
 * a thumb lands anywhere there and the stick centres under it. On the right sit THRUST (pressed
 * again, it brakes: see `ThrustLatch`), BOOST and FIRE, and in the top-right corner the map and
 * pause. Every finger is tracked by its pointer, so steering, thrust and fire work at once. Shown only on touch-first devices
 * (`body.touch`), and only while flying or looking at the map.
 */

export type TouchMode = 'off' | 'flight' | 'map';
export type TouchControls = ReturnType<typeof createTouchControls>;

const ICON_MAP = '<path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>';
const ICON_CLOSE = '<path d="M6 6l12 12M18 6 6 18"/>';
const ICON_PAUSE = '<path d="M9 5v14M15 5v14"/>';

/** The stick's ring is a little wider than the knob's travel. */
const BASE_R = STICK.radius + 10;

export function createTouchControls(actions: { onMap(): void; onPause(): void }) {
  const router = new TouchRouter();
  const latch = new ThrustLatch();
  const w = createWriter();

  const zone = h('div', { class: 't-zone', 'data-control': 'stick' });
  const knob = h('div', { class: 't-knob' });
  const base = h('div', { class: 't-stick passive' }, knob);
  const button = (control: Exclude<Control, 'stick'>, label: HTMLElement) =>
    h('button', { class: `t-btn t-${control}`, type: 'button', 'data-control': control, tabindex: -1 }, label);
  const thrustLabel = h('span', { text: t('touchThrust') });
  const buttons = {
    thrust: button('thrust', thrustLabel),
    boost: button('boost', h('span', { text: t('touchBoost') })),
    fire: button('fire', h('span', { text: t('touchFire') })),
  };
  const pad = h('div', { class: 't-pad' }, zone, base, buttons.thrust, buttons.boost, buttons.fire);
  const controls: HTMLElement[] = [zone, buttons.thrust, buttons.boost, buttons.fire];

  const mapBtn = h('button', { class: 't-top', type: 'button', onclick: () => actions.onMap() });
  const pauseBtn = h('button', { class: 't-top', type: 'button', 'aria-label': t('touchPause'), title: t('touchPause'), onclick: () => actions.onPause() });
  pauseBtn.innerHTML = icon(ICON_PAUSE, 20);
  const bar = h('div', { class: 't-bar' }, mapBtn, pauseBtn);
  const el = h('div', { class: 'touch', hidden: true }, pad, bar);

  let mode: TouchMode = 'off';
  let mapOpen: boolean | null = null;
  const origin: Vec = { x: 0, y: 0 };
  const finger: Vec = { x: 0, y: 0 };

  const drawStick = () => {
    const held = router.held('stick');
    if (!held) {
      const rest = restingStick(window.innerWidth, window.innerHeight);
      origin.x = finger.x = rest.x;
      origin.y = finger.y = rest.y;
    }
    const k = knobOffset(finger.x - origin.x, finger.y - origin.y, STICK.radius);
    w.style(base, 'transform', `translate(${(origin.x - BASE_R).toFixed(1)}px, ${(origin.y - BASE_R).toFixed(1)}px)`);
    w.style(knob, 'transform', `translate(${k.x.toFixed(1)}px, ${k.y.toFixed(1)}px)`);
    base.classList.toggle('on', held);
  };

  const drawButtons = () => {
    const held = router.held('thrust');
    const braking = latch.brake(held);
    buttons.thrust.classList.toggle('on', latch.on(held) || braking);
    buttons.thrust.classList.toggle('latched', latch.latched);
    buttons.thrust.classList.toggle('braking', braking);
    w.text(thrustLabel, t(braking ? 'touchBrake' : 'touchThrust'));
    buttons.boost.classList.toggle('on', router.held('boost'));
    buttons.fire.classList.toggle('on', router.held('fire'));
  };

  const drawMapButton = (open: boolean) => {
    if (open === mapOpen) return;
    mapOpen = open;
    const label = t(open ? 'touchCloseMap' : 'touchMap');
    mapBtn.innerHTML = icon(open ? ICON_CLOSE : ICON_MAP, 20);
    mapBtn.title = label;
    mapBtn.setAttribute('aria-label', label);
  };

  el.addEventListener('pointerdown', (e) => {
    const target = (e.target as Element).closest<HTMLElement>('[data-control]');
    if (!target) return;
    // No page scroll, zoom, focus or compatibility mouse events (which would fire the guns).
    e.preventDefault();
    const control = target.dataset['control'] as Control;
    if (!router.press(e.pointerId, control)) return;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; its pointerup or pointercancel still arrives.
    }
    if (control === 'stick') {
      origin.x = finger.x = e.clientX;
      origin.y = finger.y = e.clientY;
      drawStick();
    } else {
      if (control === 'thrust') latch.down(e.timeStamp);
      drawButtons();
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (router.controlOf(e.pointerId) !== 'stick') return;
    finger.x = e.clientX;
    finger.y = e.clientY;
    drawStick();
  });
  const lift = (e: PointerEvent) => {
    const control = router.release(e.pointerId);
    if (control === null) return;
    if (control === 'stick') drawStick();
    else {
      if (control === 'thrust' && !router.held('thrust')) latch.up(e.timeStamp);
      drawButtons();
    }
  };
  el.addEventListener('pointerup', lift);
  el.addEventListener('pointercancel', lift);
  el.addEventListener('lostpointercapture', lift);
  // A long press would open the browser's menu over the game.
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', () => {
    if (!router.held('stick')) drawStick();
  });

  /** Every finger lets go and the engine stops: pause, map, death, a hidden tab. */
  const reset = () => {
    for (const id of router.clear()) {
      for (const c of controls) {
        try {
          if (c.hasPointerCapture(id)) c.releasePointerCapture(id);
        } catch {
          // Nothing to release.
        }
      }
    }
    latch.cancel();
    drawStick();
    drawButtons();
  };

  drawStick();
  drawButtons();
  drawMapButton(false);

  return {
    el,
    reset,
    /** Called every frame: what the game is doing decides what is on screen. */
    setMode(next: TouchMode) {
      if (next === mode) return;
      if (mode === 'flight') reset();
      mode = next;
      w.hidden(el, next === 'off');
      w.hidden(pad, next !== 'flight');
      drawMapButton(next === 'map');
      if (next === 'flight') drawStick();
    },
    /** Steering from the stick, each axis in [-1, 1]; zero while no thumb is on it. */
    aim(sensitivity: number): Vec {
      if (!router.held('stick')) return ZERO;
      return stickAim(finger.x - origin.x, finger.y - origin.y, STICK.radius, sensitivity);
    },
    get thrust() {
      return latch.on(router.held('thrust'));
    },
    get brake() {
      return latch.brake(router.held('thrust'));
    },
    get boost() {
      return router.held('boost');
    },
    get fire() {
      return router.held('fire');
    },
  };
}

const ZERO: Readonly<Vec> = Object.freeze({ x: 0, y: 0 });
