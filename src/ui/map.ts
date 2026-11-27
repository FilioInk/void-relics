import { createRng } from '../core/rng.ts';
import { starKind, t } from '../text.ts';
import { WORLD_RADIUS, junkNormal, type Asteroid, type World } from '../world/generate.ts';
import { gigaBands } from '../world/megastructures.ts';
import { cssColor, starLook } from '../world/stars.ts';
import { h } from './dom.ts';

/**
 * The system map, top-down. It shows the landmarks, the relics already found, and for each
 * relic still missing only a circle somewhere inside which it lies.
 */

const hex = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

export type MapView = {
  el: HTMLElement;
  draw(player: { x: number; z: number; headingX: number; headingZ: number }, found: readonly string[], time: number): void;
};

export function createMap(world: World, rocks: Asteroid[]): MapView {
  const canvas = h('canvas');
  const title = h('div', { class: 'map-title' });
  const close = h('div', { class: 'map-close' });
  const legend = h('div', { class: 'legend' });
  const el = h('div', { class: 'map', hidden: true }, canvas, title, close, legend);
  const ctx = canvas.getContext('2d')!;

  // A sample of rocks is enough to draw the belt and fields.
  const rng = createRng(world.seed ^ 0x3a9);
  const starColors = starLook(world.sun.star);
  const dots = rocks.filter(() => rng.chance(0.35));

  {
    title.textContent = t('mapTitle');
    close.textContent = t('mapClose');
    legend.replaceChildren();
    const item = (style: string, text: string) => legend.append(h('i', { style }), h('span', { text }));
    item(`background:${cssColor(starColors.hot)};border-radius:50%;box-shadow:0 0 8px ${cssColor(starColors.mid)}`, t('legendStar'));
    item('background:#7aa8d8;border-radius:50%', t('legendPlanet'));
    item('background:rgba(180,170,160,0.55);border-radius:50%;transform:scale(0.5)', t('legendField'));
    item('background:radial-gradient(#d03cff,transparent 70%)', t('legendNebula'));
    item('border:1px solid #9aa4b0;transform:rotate(45deg) scale(0.7)', t('legendWreck'));
    item('border:1px solid #c8d4e0;transform:scale(0.75)', t('legendStation'));
    item('background:radial-gradient(circle,#c8d4e0 0 1.5px,transparent 2px) 0 0/6px 6px;transform:scale(0.8)', t('legendGraveyard'));
    item('border:2px dotted rgba(190,200,215,0.7);border-radius:50%;transform:scale(0.8)', t('legendJunk'));
    if (world.megastructures.length > 0) item('border:1.5px solid #8fe3ff;border-radius:30%;transform:rotate(30deg) scale(0.8)', t('legendMega'));
    if (world.giga) item('border:2px solid rgba(255,214,140,0.8);border-radius:50%;transform:scaleY(0.5)', t('legendGiga'));
    item('background:#5ff5e0;transform:rotate(45deg) scale(0.8);box-shadow:0 0 6px #5ff5e0', t('legendFound'));
    item('border:1px dashed #ffb547;border-radius:50%', t('legendSignal'));
    item('width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid #fff', t('legendYou'));
  }

  return {
    el,
    draw(player, found, time) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = el.clientWidth;
      const hgt = el.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(hgt * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hgt);
      const cx = w / 2;
      const cy = hgt / 2;
      const s = (Math.min(w, hgt) * 0.46) / WORLD_RADIUS;
      const X = (x: number) => cx + x * s;
      const Y = (z: number) => cy + z * s;

      // Range rings.
      ctx.strokeStyle = 'rgba(160,190,220,0.07)';
      ctx.lineWidth = 1;
      for (let r = 10000; r <= WORLD_RADIUS; r += 10000) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * s, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Nebulae.
      for (const n of world.nebulae) {
        const g = ctx.createRadialGradient(X(n.center[0]), Y(n.center[2]), 0, X(n.center[0]), Y(n.center[2]), n.radius * s);
        g.addColorStop(0, hex(n.colors[0], 0.5));
        g.addColorStop(0.6, hex(n.colors[1], 0.18));
        g.addColorStop(1, hex(n.colors[1], 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(X(n.center[0]), Y(n.center[2]), n.radius * s, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rocks.
      ctx.fillStyle = 'rgba(180,170,160,0.45)';
      for (const r of dots) ctx.fillRect(X(r.position[0]) - 0.6, Y(r.position[2]) - 0.6, 1.2, 1.2);

      // Orbits and planets.
      for (const p of world.planets) {
        ctx.strokeStyle = 'rgba(160,190,220,0.12)';
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.arc(cx, cy, p.orbitRadius * s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const px = X(p.position[0]);
        const py = Y(p.position[2]);
        const pr = 3 + p.radius * s * 0.9;
        if (p.ring) {
          ctx.strokeStyle = hex(p.ring.color, 0.6);
          ctx.beginPath();
          ctx.ellipse(px, py, pr * 2, pr * 0.7, -0.4, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = hex(p.palette[1]);
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(223,232,244,0.75)';
        ctx.font = '11px "Exo 2", system-ui, sans-serif';
        ctx.fillText(p.name, px + pr + 5, py + 4);
      }

      // Star and its heat zone, in the star's own colours.
      const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, world.sun.warnRadius * s * 1.6);
      sg.addColorStop(0, cssColor(starColors.hot));
      sg.addColorStop(0.25, `${cssColor(starColors.mid)}cc`);
      sg.addColorStop(1, `${cssColor(starColors.corona)}00`);
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(cx, cy, world.sun.warnRadius * s * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,77,77,0.6)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, world.sun.heatRadius * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(223,232,244,0.75)';
      ctx.font = '11px "Exo 2", system-ui, sans-serif';
      ctx.fillText(`${world.sun.name} · ${starKind(world.sun.star)} ${world.sun.star.spectral}`, cx + world.sun.heatRadius * s + 6, cy + 4);

      // The junk ring, seen from above: an ellipse squashed by its tilt.
      if (world.junk) {
        const ring = world.junk;
        const n = junkNormal(ring);
        const mid = ((ring.inner + ring.outer) / 2) * s;
        ctx.strokeStyle = 'rgba(190,200,215,0.45)';
        ctx.lineWidth = Math.max(1.5, (ring.outer - ring.inner) * s);
        ctx.setLineDash([1.5, 3]);
        ctx.beginPath();
        ctx.ellipse(X(ring.center[0]), Y(ring.center[2]), mid, mid * Math.abs(n[1]), Math.atan2(n[2], n[0]), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }

      // The gigastructure's bands seen from above (a tilted circle is an ellipse squashed along
      // its tilt), and each megastructure as a small hexagon.
      if (world.giga) {
        ctx.strokeStyle = 'rgba(255,214,140,0.55)';
        for (const b of gigaBands(world.giga.shape)) {
          const n = b.axis;
          ctx.lineWidth = Math.max(1.5, b.width * s);
          ctx.beginPath();
          ctx.ellipse(X(b.center[0]), Y(b.center[2]), b.radius * s * Math.abs(n[1]), b.radius * s, Math.atan2(n[2], n[0]), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }
      ctx.strokeStyle = 'rgba(143,227,255,0.95)';
      for (const m of world.megastructures) {
        const x = X(m.shape.center[0]);
        const y = Y(m.shape.center[2]);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) ctx.lineTo(x + Math.cos((k * Math.PI) / 3) * 5, y + Math.sin((k * Math.PI) / 3) * 5);
        ctx.closePath();
        ctx.stroke();
      }

      // Stations as squares, satellite graveyards as a scatter of dots.
      ctx.strokeStyle = 'rgba(200,212,224,0.9)';
      for (const st of world.stations) ctx.strokeRect(X(st.position[0]) - 4, Y(st.position[2]) - 4, 8, 8);
      ctx.fillStyle = 'rgba(200,212,224,0.85)';
      for (const g of world.graveyards) {
        const x = X(g.center[0]);
        const y = Y(g.center[2]);
        for (const [dx, dy] of [[-2.5, 1.5], [2.5, 1.5], [0, -2.5]] as const) ctx.fillRect(x + dx - 0.8, y + dy - 0.8, 1.6, 1.6);
      }

      // Wrecks.
      ctx.strokeStyle = 'rgba(154,164,176,0.9)';
      for (const wr of world.wrecks) {
        const x = X(wr.position[0]);
        const y = Y(wr.position[2]);
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x + 4, y);
        ctx.lineTo(x, y + 4);
        ctx.lineTo(x - 4, y);
        ctx.closePath();
        ctx.stroke();
      }

      // Relics: found ones exactly, missing ones as a pulsing signal zone.
      const pulse = 0.35 + 0.25 * Math.sin(time * 2.2);
      for (const a of world.artifacts) {
        if (found.includes(a.id)) {
          const x = X(a.position[0]);
          const y = Y(a.position[2]);
          ctx.fillStyle = '#5ff5e0';
          ctx.shadowColor = '#5ff5e0';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(x, y - 5);
          ctx.lineTo(x + 5, y);
          ctx.lineTo(x, y + 5);
          ctx.lineTo(x - 5, y);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.strokeStyle = `rgba(255,181,71,${pulse})`;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(X(a.hint.center[0]), Y(a.hint.center[2]), a.hint.radius * s, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // The player.
      const px = X(player.x);
      const py = Y(player.z);
      const ang = Math.atan2(player.headingZ, player.headingX);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#5ff5e0';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(6, 7);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}
