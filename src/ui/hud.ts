import { t } from '../text.ts';
import { ARTIFACT_COUNT } from '../world/generate.ts';
import { createWriter, h, opacity, percent } from './dom.ts';

export type Warning = 'none' | 'heatRising' | 'heatCritical' | 'hullCritical';
export type Marker = { x: number; y: number; distance: number; edge: boolean; angle: number };

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} ${t('unitKm')}` : `${Math.round(m)} ${t('unitM')}`;
}

export type Hud = ReturnType<typeof createHud>;

export function createHud() {
  const nebulaTint = h('div', { class: 'tint passive' });
  const heatTint = h('div', { class: 'tint passive' });
  const vignette = h('div', { class: 'vignette passive' });
  const flash = h('div', { class: 'flash passive' });

  const relicLabel = h('div', { class: 'label' });
  const relicCount = h('div', { class: 'count' });
  const pips = h('div', { class: 'pips' });
  const pipEls = Array.from({ length: ARTIFACT_COUNT }, () => h('i', { class: 'pip' }));
  pips.append(...pipEls);
  const relics = h('div', { class: 'hud-relics' }, relicLabel, relicCount, pips);

  const regionName = h('span');
  const regionSub = h('span', { class: 'sub' });
  const region = h('div', { class: 'hud-region' }, regionName, regionSub);

  const speedVal = h('b');
  const speedLabel = h('span');
  const throttleBar = h('div', { class: 'bar throttle' }, h('i'));
  const hullVal = h('b');
  const hullLabel = h('span');
  const hullBar = h('div', { class: 'bar hull' }, h('i'));
  const boostTag = h('div', { class: 'boost-tag' });
  const flight = h(
    'div',
    { class: 'hud-flight' },
    h('div', { class: 'gauge' }, h('div', { class: 'row' }, speedLabel, speedVal), throttleBar),
    boostTag,
    h('div', { class: 'gauge' }, h('div', { class: 'row' }, hullLabel, hullVal), hullBar),
  );

  const warn = h('div', { class: 'hud-warn' });
  const toasts = h('div', { class: 'toasts' });
  const reticle = h('div', { class: 'reticle' });
  const aim = h('div', { class: 'aim', hidden: true });
  const gunHeat = h('div', { class: 'gun-heat' }, h('i'));
  let lastHeat = -1;
  const ring = h('div', { class: 'steer-ring' });
  const line = h('div', { class: 'steer-line' });
  const cursor = h('div', { class: 'cursor' });
  const markers = h('div');
  const hint = h('div', { class: 'hud-hint' });
  const seedLine = h('div');
  const salvage = h('div', { class: 'salvage', hidden: true });
  const topRight = h('div', { class: 'hud-top-right' }, seedLine, salvage);

  const el = h('div', { class: 'hud passive', hidden: true }, nebulaTint, heatTint, vignette, markers, ring, line, reticle, aim, gunHeat, cursor, relics, region, topRight, warn, toasts, flight, hint, flash);

  const markerPool: HTMLElement[] = [];
  // Everything below runs every frame; the writer skips assignments that change nothing.
  const w = createWriter();
  const throttleFill = throttleBar.firstElementChild as HTMLElement;
  const hullFill = hullBar.firstElementChild as HTMLElement;
  let warning: Warning = 'none';
  let lastFound = -1;
  let flashLevel = 0;

  relicLabel.textContent = t('artifacts');
  speedLabel.textContent = t('speed');
  hullLabel.textContent = t('hull');
  boostTag.textContent = t('boost');
  hint.innerHTML = `${t('ctlMap')}<br>${t('ctlPause')}`;

  function setWarning(w: Warning) {
    if (w === warning) return;
    warning = w;
    warn.className = 'hud-warn';
    if (w === 'none') warn.textContent = '';
    else if (w === 'heatRising') {
      warn.textContent = t('heatRising');
      warn.classList.add('soft');
    } else if (w === 'heatCritical') {
      warn.textContent = t('heatCritical');
      warn.classList.add('blink');
    } else {
      warn.textContent = t('hullCritical');
      warn.classList.add('blink');
    }
  }

  return {
    el,
    setWarning,
    setSeedLine(text: string) {
      seedLine.textContent = text;
    },
    setRelics(found: number) {
      relicCount.innerHTML = `${found}<small> / ${ARTIFACT_COUNT}</small>`;
      pipEls.forEach((p, i) => {
        p.classList.toggle('on', i < found);
        if (i === found - 1 && lastFound >= 0 && found > lastFound) {
          p.classList.remove('new');
          void p.offsetWidth;
          p.classList.add('new');
        }
      });
      lastFound = found;
    },
    setSalvage(count: number) {
      salvage.hidden = count <= 0;
      salvage.innerHTML = `${t('salvage')}<b>${count}</b>`;
    },
    /** Where the bolts converge, in screen pixels; hidden when off screen or not flying. */
    setAim(x: number, y: number, visible: boolean) {
      aim.hidden = !visible;
      if (visible) aim.style.transform = `translate(${x}px, ${y}px)`;
    },
    /** Gun heat 0..1; the bar shows only while the guns are warm. */
    setGuns(heat: number, overheated: boolean) {
      const h2 = Math.round(heat * 100);
      if (h2 === lastHeat && gunHeat.classList.contains('over') === overheated) return;
      lastHeat = h2;
      gunHeat.classList.toggle('show', heat > 0.02);
      gunHeat.classList.toggle('over', overheated);
      (gunHeat.firstElementChild as HTMLElement).style.width = `${h2}%`;
    },
    setRegion(name: string, sub: string) {
      regionName.textContent = name;
      regionSub.textContent = sub;
      region.classList.remove('show');
      void region.offsetWidth;
      region.classList.add('show');
      window.setTimeout(() => region.classList.remove('show'), 5000);
    },
    setFlight(speed: number, throttle: number, hull: number, boosting: boolean) {
      w.text(speedVal, `${Math.round(speed)} ${t('unitSpeed')}`);
      w.style(throttleFill, 'width', percent(Math.abs(throttle)));
      throttleBar.classList.toggle('rev', throttle < -0.02);
      w.text(hullVal, `${Math.ceil(hull * 100)}%`);
      w.style(hullFill, 'width', percent(hull));
      boostTag.classList.toggle('on', boosting);
    },
    toast(html: string, kind: 'found' | 'signal') {
      const n = h('div', { class: `toast ${kind === 'signal' ? 'signal' : ''}` });
      n.innerHTML = html;
      toasts.append(n);
      window.setTimeout(() => n.remove(), 4300);
    },
    setCursor(x: number, y: number, radius: number, visible: boolean) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      w.style(cursor, 'transform', `translate(${cx + x}px, ${cy + y}px)`);
      w.hidden(cursor, !visible);
      w.style(ring, 'width', `${radius * 2}px`);
      w.style(ring, 'height', `${radius * 2}px`);
      w.style(ring, 'margin', `${-radius}px 0 0 ${-radius}px`);
      const len = Math.hypot(x, y);
      w.style(line, 'width', `${len}px`);
      w.style(line, 'transform', `rotate(${Math.atan2(y, x)}rad)`);
      w.hidden(line, !visible || len < 8);
    },
    setMarkers(list: Marker[]) {
      while (markerPool.length < list.length) {
        const m = h('div', { class: 'marker' }, h('div', { class: 'box' }), h('div', { class: 'arrow' }), h('div', { class: 'dist' }));
        markers.append(m);
        markerPool.push(m);
      }
      markerPool.forEach((m, i) => {
        const d = list[i];
        if (!d) {
          w.hidden(m, true);
          return;
        }
        w.hidden(m, false);
        m.classList.toggle('edge', d.edge);
        w.style(m, 'transform', `translate(${d.x}px, ${d.y}px)`);
        w.style(m.children[1] as HTMLElement, 'transform', `rotate(${d.angle + Math.PI / 2}rad)`);
        w.text(m.children[2] as HTMLElement, `${t('signal')} · ${formatDistance(d.distance)}`);
      });
    },
    /** nebula: css colour and 0..1; heat 0..1; damage pulses the screen red. */
    setTint(nebulaColor: string, nebula: number, heat: number) {
      w.style(nebulaTint, 'background', `radial-gradient(ellipse at center, ${nebulaColor} 0%, transparent 140%)`);
      w.style(nebulaTint, 'opacity', opacity(nebula * 0.35));
      w.style(heatTint, 'background', `radial-gradient(ellipse at center, transparent 30%, rgba(255,110,30,0.9) 130%)`);
      w.style(heatTint, 'opacity', opacity(heat * 1.2));
    },
    flash(color: string, strength: number) {
      w.style(flash, 'background', color);
      flashLevel = Math.max(flashLevel, strength);
    },
    tick(dt: number) {
      flashLevel = Math.max(0, flashLevel - dt * 2.5);
      w.style(flash, 'opacity', opacity(flashLevel));
    },
    show(v: boolean) {
      el.hidden = !v;
    },
  };
}
