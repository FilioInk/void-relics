import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.ts';
import { normalsFromHeight, panelLayout } from './plating.ts';

test('panels tile the whole area exactly, row by row, none too narrow', () => {
  for (const seed of [1, 2, 3, 99]) {
    const panels = panelLayout(512, 256, 6, 5, createRng(seed), 20);
    let area = 0;
    for (const p of panels) {
      assert.ok(p.w >= 20 && p.h > 0, `panel ${JSON.stringify(p)}`);
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= 512 && p.y + p.h <= 256);
      area += p.w * p.h;
    }
    assert.equal(area, 512 * 256);
    // Every row starts at 0 and ends at the right edge.
    const rows = new Map<number, number[]>();
    for (const p of panels) rows.set(p.y, [...(rows.get(p.y) ?? []), p.x, p.x + p.w]);
    for (const xs of rows.values()) {
      assert.equal(Math.min(...xs), 0);
      assert.equal(Math.max(...xs), 512);
    }
    assert.equal(rows.size, 6);
  }
});

test('seams move between seeds: the plating is not a grid', () => {
  const a = panelLayout(512, 256, 4, 4, createRng(1)).map((p) => p.x).join();
  const b = panelLayout(512, 256, 4, 4, createRng(2)).map((p) => p.x).join();
  assert.notEqual(a, b);
});

function field(w: number, h: number, f: (x: number, y: number) => number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.fill(f(x, y), (y * w + x) * 4, (y * w + x) * 4 + 4);
  return d;
}

test('a flat height field gives straight-up normals', () => {
  const n = normalsFromHeight(field(8, 8, () => 128), 8, 8, 2);
  for (let i = 0; i < n.length; i += 4) assert.deepEqual([...n.slice(i, i + 4)], [128, 128, 255, 255]);
});

test('a slope rising to the right tilts normals to the left; a groove has walls facing in', () => {
  const ramp = normalsFromHeight(field(16, 16, (x) => x * 8), 16, 16, 2);
  const mid = (8 * 16 + 8) * 4;
  assert.ok(ramp[mid]! < 128, 'x component negative on a rising slope');
  assert.ok(Math.abs(ramp[mid + 1]! - 128) <= 1, 'no y tilt');
  const groove = normalsFromHeight(field(16, 16, (x) => (x === 8 ? 0 : 200)), 16, 16, 2);
  const left = (4 * 16 + 7) * 4;
  const right = (4 * 16 + 9) * 4;
  assert.ok(groove[left]! > 128 && groove[right]! < 128, 'the two walls face into the groove');
});
