#!/usr/bin/env node
// Draws the app icons for the installable game into public/icons/: the favicon's mark (a cyan
// diamond with an amber core on the game's night blue) at the sizes the browsers ask for.
//
//   node scripts/icons.mjs
//
// The game ships no hand-made images, and these are no exception: the mark is drawn here from
// three shapes, 4×4 samples a pixel, and written as PNG with Node's own zlib. Run it again after
// changing the mark (and change the favicon in index.html to match).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [0x04, 0x06, 0x0c];
const ACCENT = [0x5f, 0xf5, 0xe0];
const CORE = [0xff, 0xd2, 0x7a];

/** Distance from a point to a segment. */
function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const DIAMOND = [[32, 8], [50, 32], [32, 56], [14, 32]];

/** The distance from the diamond's outline, in the 64-unit grid of the favicon. */
function diamond(x, y) {
  let d = Infinity;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = DIAMOND[i];
    const [bx, by] = DIAMOND[(i + 1) % 4];
    d = Math.min(d, segment(x, y, ax, ay, bx, by));
  }
  return d;
}

/** Inside a rounded square of side 64 and corner radius r. */
function inRounded(x, y, r) {
  const cx = Math.max(r, Math.min(64 - r, x));
  const cy = Math.max(r, Math.min(64 - r, y));
  return Math.hypot(x - cx, y - cy) <= r;
}

/**
 * One sample of the icon at (x, y) in the 64-unit grid. `corner`: the background's corner radius
 * (0 for a full square). `scale`: how large the mark is, around the centre (a maskable icon keeps
 * it inside the middle 80%).
 */
function sample(x, y, corner, scale) {
  if (x < 0 || y < 0 || x > 64 || y > 64 || !inRounded(x, y, corner)) return [0, 0, 0, 0];
  const mx = 32 + (x - 32) / scale;
  const my = 32 + (y - 32) / scale;
  let c = BG;
  // A faint glow around the outline, then the outline, then the core with its own glow.
  const d = diamond(mx, my);
  const glow = 0.28 * Math.exp(-((Math.max(0, d - 2) / 5) ** 2));
  c = mix(c, ACCENT, glow);
  if (d <= 2) c = ACCENT;
  const r = Math.hypot(mx - 32, my - 32);
  c = mix(c, CORE, 0.35 * Math.exp(-((Math.max(0, r - 6) / 6) ** 2)));
  if (r <= 6) c = CORE;
  return [c[0], c[1], c[2], 255];
}

const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

function render(size, corner, scale) {
  const N = 4;
  const px = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      // Premultiplied while averaging, so the antialiased corners do not darken.
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++)
        for (let sx = 0; sx < N; sx++) {
          const s = sample(((i + (sx + 0.5) / N) / size) * 64, ((j + (sy + 0.5) / N) / size) * 64, corner, scale);
          const w = s[3] / 255;
          r += s[0] * w;
          g += s[1] * w;
          b += s[2] * w;
          a += w;
        }
      const o = (j * size + i) * 4;
      px[o] = a ? Math.round(r / a) : 0;
      px[o + 1] = a ? Math.round(g / a) : 0;
      px[o + 2] = a ? Math.round(b / a) : 0;
      px[o + 3] = Math.round((a / (N * N)) * 255);
    }
  return png(size, px);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const ICONS = [
  // The browser's install dialog, the desktop and Android's launcher: the favicon's rounded square.
  { name: 'icon-192.png', size: 192, corner: 14, scale: 1 },
  { name: 'icon-512.png', size: 512, corner: 14, scale: 1 },
  // Android crops a maskable icon to its own shape: a full square, the mark inside the middle 80%.
  { name: 'icon-maskable-512.png', size: 512, corner: 0, scale: 0.78 },
  // iOS rounds the corners itself and fills transparency with black.
  { name: 'apple-touch-icon.png', size: 180, corner: 0, scale: 0.86 },
];

mkdirSync(OUT, { recursive: true });
for (const icon of ICONS) {
  writeFileSync(join(OUT, icon.name), render(icon.size, icon.corner, icon.scale));
  console.log(`public/icons/${icon.name}`);
}
