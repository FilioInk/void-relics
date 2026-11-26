import { t } from '../text.ts';
import { ARTIFACT_COUNT } from '../world/generate.ts';
import { h } from './dom.ts';

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
  const ring = h('div', { class: 'steer-ring' });
  const line = h('div', { class: 'steer-line' });
  const cursor = h('div', { class: 'cursor' });
  const markers = h('div');
  const hint = h('div', { class: 'hud-hint' });
  const topRight = h('div', { class: 'hud-top-right' });

  const el = h('div', { class: 'hud passive', hidden: true }, nebulaTint, heatTint, vignette, markers, ring, line, reticle, cursor, relics, region, topRight, warn, toasts, flight, hint, flash);

  const markerPool: HTMLElement[] = [];
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
      topRight.textContent = text;
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
    setRegion(name: string, sub: string) {
      regionName.textContent = name;
      regionSub.textContent = sub;
      region.classList.remove('show');
      void region.offsetWidth;
      region.classList.add('show');
      window.setTimeout(() => region.classList.remove('show'), 5000);
    },
    setFlight(speed: number, throttle: number, hull: number, boosting: boolean) {
      speedVal.textContent = `${Math.round(speed)} ${t('unitSpeed')}`;
      const tb = throttleBar.firstElementChild as HTMLElement;
      tb.style.width = `${Math.abs(throttle) * 100}%`;
      throttleBar.classList.toggle('rev', throttle < -0.02);
      hullVal.textContent = `${Math.ceil(hull * 100)}%`;
      (hullBar.firstElementChild as HTMLElement).style.width = `${hull * 100}%`;
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
      cursor.style.transform = `translate(${cx + x}px, ${cy + y}px)`;
      cursor.hidden = !visible;
      ring.style.width = ring.style.height = `${radius * 2}px`;
      ring.style.margin = `${-radius}px 0 0 ${-radius}px`;
      const len = Math.hypot(x, y);
      line.style.width = `${len}px`;
      line.style.transform = `rotate(${Math.atan2(y, x)}rad)`;
      line.hidden = !visible || len < 8;
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
          m.hidden = true;
          return;
        }
        m.hidden = false;
        m.classList.toggle('edge', d.edge);
        m.style.transform = `translate(${d.x}px, ${d.y}px)`;
        const arrow = m.children[1] as HTMLElement;
        arrow.style.transform = `rotate(${d.angle + Math.PI / 2}rad)`;
        (m.children[2] as HTMLElement).textContent = `${t('signal')} · ${formatDistance(d.distance)}`;
      });
    },
    /** nebula: css colour and 0..1; heat 0..1; damage pulses the screen red. */
    setTint(nebulaColor: string, nebula: number, heat: number) {
      nebulaTint.style.background = `radial-gradient(ellipse at center, ${nebulaColor} 0%, transparent 140%)`;
      nebulaTint.style.opacity = String(nebula * 0.35);
      heatTint.style.background = `radial-gradient(ellipse at center, transparent 30%, rgba(255,110,30,0.9) 130%)`;
      heatTint.style.opacity = String(Math.min(1, heat * 1.2));
    },
    flash(color: string, strength: number) {
      flash.style.background = color;
      flashLevel = Math.max(flashLevel, strength);
    },
    tick(dt: number) {
      flashLevel = Math.max(0, flashLevel - dt * 2.5);
      flash.style.opacity = String(flashLevel);
    },
    show(v: boolean) {
      el.hidden = !v;
    },
  };
}
