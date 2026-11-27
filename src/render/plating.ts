import { createRng, type Rng } from '../core/rng.ts';

/**
 * Hull plating, painted at start-up: panels of slightly different tone with recessed seams,
 * rivets along the seams, scratches and grime. Three layers come out of the same layout — the
 * colour, a height map (seams low, rivets high) for a normal map, and a roughness map — so the
 * light picks out exactly the seams you see. No image files: it is all drawn on canvases.
 */

export type PanelRect = { x: number; y: number; w: number; h: number };

/**
 * Splits a w×h area into rows of panels with staggered seams, like plating on a real hull.
 * Pure, so it is tested: panels tile the area exactly, none smaller than `min`.
 */
export function panelLayout(w: number, h: number, rows: number, perRow: number, rng: Rng, min = 8): PanelRect[] {
  const out: PanelRect[] = [];
  const rowH = h / rows;
  for (let r = 0; r < rows; r++) {
    const cuts: number[] = [];
    for (let k = 1; k < perRow; k++) cuts.push(((k + rng.range(-0.3, 0.3)) / perRow) * w);
    // Keep only cuts that leave both neighbours at least `min` wide.
    const merged: number[] = [0];
    for (const c of cuts.sort((a, b) => a - b)) {
      const x = Math.round(c);
      if (x - merged[merged.length - 1]! >= min && w - x >= min) merged.push(x);
    }
    merged.push(w);
    for (let k = 0; k + 1 < merged.length; k++) out.push({ x: merged[k]!, y: Math.round(r * rowH), w: merged[k + 1]! - merged[k]!, h: Math.round((r + 1) * rowH) - Math.round(r * rowH) });
  }
  return out;
}

/**
 * Turns a height field into a tangent-space normal map (RGBA bytes) with a Sobel filter,
 * wrapping at the edges so a tiling texture stays seamless. Pure, so it is tested.
 */
export function normalsFromHeight(height: Uint8ClampedArray, w: number, h: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const at = (x: number, y: number) => height[(((y + h) % h) * w + ((x + w) % w)) * 4]! / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = -dx * strength;
      // Canvas rows run down, texture v runs up: flip the y slope.
      let ny = dy * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  return out;
}

export type PlatingCanvases = { color: HTMLCanvasElement; height: HTMLCanvasElement; rough: HTMLCanvasElement; normal: HTMLCanvasElement };

export type PlatingStyle = {
  base: [number, number, number];
  rows: number;
  perRow: number;
  grime: number;
  /** Extra paint on top of the panels: stripes, numbers, soot. Drawn on the colour layer. */
  decorate?: (g: CanvasRenderingContext2D, w: number, h: number) => void;
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function paintPlating(w: number, h: number, seed: number, style: PlatingStyle): PlatingCanvases {
  const rng = createRng(seed);
  const [color, gc] = canvas(w, h);
  const [height, gh] = canvas(w, h);
  const [rough, gr] = canvas(w, h);
  const [b0, b1, b2] = style.base;
  gh.fillStyle = 'rgb(150,150,150)';
  gh.fillRect(0, 0, w, h);
  gr.fillStyle = 'rgb(95,95,95)';
  gr.fillRect(0, 0, w, h);

  const panels = panelLayout(w, h, style.rows, style.perRow, rng);
  for (const p of panels) {
    const k = rng.range(0.9, 1.06);
    gc.fillStyle = `rgb(${Math.round(b0 * k)},${Math.round(b1 * k)},${Math.round(b2 * k)})`;
    gc.fillRect(p.x, p.y, p.w, p.h);
    // A few panels sit a hair proud or are a different, rougher finish.
    const hv = Math.round(rng.range(140, 165));
    gh.fillStyle = `rgb(${hv},${hv},${hv})`;
    gh.fillRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);
    const r = Math.round(rng.range(80, 120));
    gr.fillStyle = `rgb(${r},${r},${r})`;
    gr.fillRect(p.x, p.y, p.w, p.h);
  }
  // Seams: dark in colour, low in height. Rivets along them: dots that catch the light.
  for (const p of panels) {
    gc.strokeStyle = 'rgba(20,24,30,0.55)';
    gc.lineWidth = 1.5;
    gc.strokeRect(p.x + 0.75, p.y + 0.75, p.w - 1.5, p.h - 1.5);
    gh.strokeStyle = 'rgb(40,40,40)';
    gh.lineWidth = 2;
    gh.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    if (rng.chance(0.6)) {
      const step = 9;
      const dots: Array<[number, number]> = [];
      for (let x = p.x + 6; x < p.x + p.w - 4; x += step) dots.push([x, p.y + 4], [x, p.y + p.h - 4]);
      for (const [x, y] of dots) {
        gc.fillStyle = 'rgba(30,34,40,0.5)';
        gc.fillRect(x - 1, y - 1, 2, 2);
        gh.fillStyle = 'rgb(205,205,205)';
        gh.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }
  // Wear: soft grime, streaks and scratches.
  for (let i = 0; i < Math.round(40 * style.grime); i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const rad = rng.range(10, 60);
    const grad = gc.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(25,22,20,${rng.range(0.05, 0.16)})`);
    grad.addColorStop(1, 'rgba(25,22,20,0)');
    gc.fillStyle = grad;
    gc.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    gr.fillStyle = 'rgba(200,200,200,0.12)';
    gr.beginPath();
    gr.arc(x, y, rad * 0.7, 0, Math.PI * 2);
    gr.fill();
  }
  for (let i = 0; i < 60; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const a = rng.range(0, Math.PI * 2);
    const len = rng.range(4, 26);
    gc.strokeStyle = `rgba(235,240,245,${rng.range(0.08, 0.22)})`;
    gc.lineWidth = 0.7;
    gc.beginPath();
    gc.moveTo(x, y);
    gc.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    gc.stroke();
  }
  style.decorate?.(gc, w, h);

  const hd = gh.getImageData(0, 0, w, h);
  const [normal, gn] = canvas(w, h);
  gn.putImageData(new ImageData(normalsFromHeight(hd.data, w, h, 2.2) as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return { color, height, rough, normal };
}
