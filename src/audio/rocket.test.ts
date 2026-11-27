import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.ts';
import { brownNoise, crackle, createIgnition, pinkNoise, rocketMix, softClip, stepIgnition, type RocketEvent } from './rocket.ts';

const rand = () => {
  const r = createRng(7);
  return () => r.next();
};

/** Mean absolute step between samples: small for noise whose energy sits low, ~0.67 for white. */
function roughness(a: Float32Array): number {
  let sum = 0;
  for (let i = 1; i < a.length; i++) sum += Math.abs((a[i] as number) - (a[i - 1] as number));
  return sum / (a.length - 1);
}

function peak(a: Float32Array): number {
  let p = 0;
  for (const v of a) p = Math.max(p, Math.abs(v));
  return p;
}

test('pink and brown noise are normalised and darker than white noise, brown the darkest', () => {
  const n = 44100;
  const white = new Float32Array(n).map(() => Math.random() * 2 - 1);
  const pink = pinkNoise(n, rand());
  const brown = brownNoise(n, rand());
  assert.ok(Math.abs(peak(pink) - 1) < 1e-6);
  assert.ok(Math.abs(peak(brown) - 1) < 1e-6);
  assert.ok(roughness(pink) < roughness(white) * 0.6, 'pink is smoother than white');
  assert.ok(roughness(brown) < roughness(pink) * 0.5, 'brown is smoother than pink');
});

test('noise buffers are reproducible from a seeded source', () => {
  assert.deepEqual(pinkNoise(512, rand()), pinkNoise(512, rand()));
  assert.deepEqual(brownNoise(512, rand()), brownNoise(512, rand()));
});

test('crackle is mostly silence with sparse bursts, more of them at a higher density', () => {
  const rate = 22050;
  const len = rate * 2;
  const busy = (a: Float32Array) => a.filter((v) => Math.abs(v) > 0.01).length / a.length;
  const sparse = crackle(len, rate, 20, rand());
  const dense = crackle(len, rate, 120, rand());
  assert.ok(busy(sparse) < 0.2, `sparse crackle is mostly silence (${busy(sparse)})`);
  assert.ok(busy(dense) > busy(sparse) * 2, 'denser crackle fills more of the buffer');
  assert.ok(peak(dense) <= 1 + 1e-6);
});

test('the soft-clip curve is odd and monotonic, never louder than its input, unity near zero', () => {
  const n = 257;
  const c = softClip(n, 2.5);
  const x = (i: number) => (i / (n - 1)) * 2 - 1;
  assert.ok(Math.abs(c[128] as number) < 1e-6);
  for (let i = 1; i < n; i++) assert.ok((c[i] as number) > (c[i - 1] as number), 'monotonic');
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs((c[i] as number) + (c[n - 1 - i] as number)) < 1e-6, 'odd');
    assert.ok(Math.abs(c[i] as number) <= Math.abs(x(i)) + 1e-6, 'never louder');
  }
  const slope = ((c[129] as number) - (c[127] as number)) / (x(129) - x(127));
  assert.ok(Math.abs(slope - 1) < 0.01, `unity near zero (${slope})`);
  assert.ok((c[n - 1] as number) < 0.5, 'loud peaks are squashed');
  assert.deepEqual([...softClip(5, 0)], [-1, -0.5, 0, 0.5, 1]);
  assert.deepEqual([...softClip(5, NaN)], [-1, -0.5, 0, 0.5, 1]);
});

test('the mix grows with thrust and grows again with boost, and idle is a faint rumble', () => {
  const idle = rocketMix(0, 0);
  const half = rocketMix(0.5, 0);
  const full = rocketMix(1, 0);
  const boost = rocketMix(1, 1);
  assert.ok(idle.rumbleGain > 0 && idle.rumbleGain < 0.1);
  assert.equal(idle.roarGain, 0);
  assert.equal(idle.crackleGain, 0);
  assert.equal(idle.hissGain, 0);
  for (const k of ['rumbleGain', 'roarGain', 'crackleGain', 'flutter', 'roarFreq'] as const) {
    assert.ok(half[k] > idle[k] && full[k] > half[k], `${k} rises with thrust`);
    assert.ok(boost[k] > full[k], `${k} rises with boost`);
  }
  assert.ok(boost.hissGain > 0 && boost.crackleRate > full.crackleRate);
});

test('out-of-range and non-finite input is clamped to idle or full', () => {
  assert.deepEqual(rocketMix(5, 5), rocketMix(1, 1));
  assert.deepEqual(rocketMix(-3, -1), rocketMix(0, 0));
  assert.deepEqual(rocketMix(NaN, 0), rocketMix(0, 0));
  assert.deepEqual(rocketMix(1, Infinity), rocketMix(1, 0));
  for (const v of Object.values(rocketMix(1, 1))) assert.ok(Number.isFinite(v) && v >= 0);
});

/** Feeds a throttle/boost timeline at 60 fps and collects the events. */
function run(timeline: Array<[seconds: number, thrust: number, boost: number]>): RocketEvent[] {
  const s = createIgnition();
  const out: RocketEvent[] = [];
  let time = 0;
  for (const [seconds, thrust, boost] of timeline) {
    for (let i = 0; i < seconds * 60; i++) {
      time += 1 / 60;
      const e = stepIgnition(s, thrust, boost, time);
      if (e) out.push(e);
    }
  }
  return out;
}

test('a burn lights once, holds without repeating, and cuts off once', () => {
  assert.deepEqual(run([[0.5, 0, 0], [2, 1, 0], [0.5, 0, 0]]), ['ignite', 'cutoff']);
});

test('a jittery throttle around the threshold does not chatter', () => {
  const jitter: Array<[number, number, number]> = [];
  for (let i = 0; i < 20; i++) jitter.push([0.05, i % 2 ? 0.17 : 0.22, 0]);
  assert.deepEqual(run([[0.2, 0, 0], ...jitter, [1, 1, 0], [0.5, 0, 0]]), ['ignite', 'cutoff']);
});

test('a tap shorter than half a second lights but cuts off silently', () => {
  assert.deepEqual(run([[0.2, 0, 0], [0.2, 1, 0], [0.5, 0, 0]]), ['ignite']);
});

test('boost kicks the afterburner, even from a standstill, and the burn outlasts it', () => {
  assert.deepEqual(run([[0.5, 1, 0], [1, 1, 1], [1, 1, 0], [0.5, 0, 0]]), ['ignite', 'afterburner', 'cutoff']);
  assert.deepEqual(run([[0.2, 0, 0], [1, 0, 1], [1, 0, 0]]), ['afterburner', 'cutoff']);
});

test('NaN input reads as an idle engine', () => {
  assert.deepEqual(run([[0.5, NaN, NaN]]), []);
});
