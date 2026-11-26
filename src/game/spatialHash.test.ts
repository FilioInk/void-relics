import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialHash } from './spatialHash.ts';

type Rock = { id: number; position: [number, number, number]; radius: number };

test('finds exactly the items a brute-force scan finds', () => {
  const rocks: Rock[] = [];
  let s = 1;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) rocks.push({ id: i, position: [r() * 20000 - 10000, r() * 2000 - 1000, r() * 20000 - 10000], radius: 10 + r() * 300 });
  const grid = new SpatialHash(800, rocks);
  for (let q = 0; q < 50; q++) {
    const x = r() * 20000 - 10000;
    const y = r() * 2000 - 1000;
    const z = r() * 20000 - 10000;
    const got = grid.query(x, y, z, 150).map((it) => it.id).sort((a, b) => a - b);
    const want = rocks.filter((it) => Math.hypot(it.position[0] - x, it.position[1] - y, it.position[2] - z) <= 150 + it.radius).map((it) => it.id).sort((a, b) => a - b);
    assert.deepEqual(got, want);
  }
});

test('a rock larger than a cell is found from any cell it covers, once', () => {
  const big: Rock = { id: 1, position: [0, 0, 0], radius: 2000 };
  const grid = new SpatialHash(500, [big]);
  assert.equal(grid.query(1900, 0, 0, 10).length, 1);
  assert.equal(grid.query(0, 0, 0, 3000).length, 1);
  assert.equal(grid.query(5000, 0, 0, 10).length, 0);
});
