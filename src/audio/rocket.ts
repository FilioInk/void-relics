/**
 * The maths behind the rocket engine, kept free of Web Audio so it can be tested on Node.
 *
 * A rocket has no pitch: it is broadband noise. What makes it read as a rocket rather than wind
 * is a low rumble, a wide roar, the crackle of shock-laden exhaust (sparse, sharp impulses), a
 * fast uneven flutter from the combustion, and a little saturation. `engine.ts` builds that out
 * of buffers made here, and drives it with `rocketMix()`.
 */

export type Rand = () => number;

/** Pink noise (≈ −3 dB/octave), Paul Kellet's filter, normalised to a peak of 1. */
export function pinkNoise(length: number, rand: Rand): Float32Array {
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return normalise(out);
}

/** Brown noise (≈ −6 dB/octave): a leaky random walk, normalised to a peak of 1. */
export function brownNoise(length: number, rand: Rand): Float32Array {
  const out = new Float32Array(length);
  let last = 0;
  for (let i = 0; i < length; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    out[i] = last;
  }
  return normalise(out);
}

/**
 * Exhaust crackle: `perSecond` short bursts at random times, each a few milliseconds of
 * decaying noise with a random level, on silence. Looped and sped up, it thickens with thrust.
 */
export function crackle(length: number, sampleRate: number, perSecond: number, rand: Rand): Float32Array {
  const out = new Float32Array(length);
  const count = Math.round((length / sampleRate) * perSecond);
  for (let k = 0; k < count; k++) {
    const start = Math.floor(rand() * length);
    // Mostly small ticks, now and then a loud pop.
    const level = 0.25 + 0.75 * Math.pow(rand(), 3);
    const len = Math.floor(sampleRate * (0.0015 + rand() * 0.006));
    for (let j = 0; j < len; j++) {
      const i = (start + j) % length;
      const env = Math.exp((-j / len) * 5);
      out[i] = (out[i] as number) + (rand() * 2 - 1) * level * env;
    }
  }
  return normalise(out);
}

/**
 * A soft-clip curve for a WaveShaper over x in [-1, 1]: tanh(drive·x)/drive. Unity gain for quiet
 * signals, so the level does not jump; loud pops get squashed into grit. `drive` 0 is a line.
 */
export function softClip(points: number, drive: number): Float32Array {
  const out = new Float32Array(points);
  const k = Number.isFinite(drive) ? Math.max(0, drive) : 0;
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    out[i] = k > 1e-6 ? Math.tanh(k * x) / k : x;
  }
  return out;
}

function normalise(a: Float32Array): Float32Array {
  let peak = 0;
  for (const v of a) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < a.length; i++) a[i] = (a[i] as number) / peak;
  return a;
}

/** Everything the engine graph needs for one moment of thrust and boost. */
export type RocketMix = {
  /** Brown-noise rumble through a low-pass. */
  rumbleGain: number;
  rumbleCutoff: number;
  /** Pink-noise roar through a band-pass. */
  roarGain: number;
  roarFreq: number;
  /** Crackle level and how fast the crackle loop plays (faster = denser and brighter). */
  crackleGain: number;
  crackleRate: number;
  /** High hiss of the boost. */
  hissGain: number;
  hissFreq: number;
  /** Depth of the combustion flutter (0 = steady). */
  flutter: number;
};

const finite01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * thrust 0..1 (the absolute throttle, reverse burns too), boost 0..1. At idle only a faint
 * rumble is left, like a pilot flame; full boost is a wall of roar and crackle.
 */
export function rocketMix(thrust: number, boost: number): RocketMix {
  const t = finite01(thrust);
  const b = finite01(boost);
  // Perceived loudness follows a curve, not a line: the first bit of throttle is the big change.
  const tc = Math.sqrt(t);
  return {
    rumbleGain: 0.05 + tc * 0.2 + b * 0.12,
    rumbleCutoff: 110 + tc * 120 + b * 160,
    roarGain: tc * 0.11 + b * 0.13,
    roarFreq: 420 + tc * 380 + b * 900,
    crackleGain: t * t * 0.035 + b * 0.1,
    crackleRate: 0.75 + t * 0.35 + b * 0.6,
    hissGain: b * b * 0.045,
    hissFreq: 3200 + b * 2600,
    flutter: 0.06 + tc * 0.12 + b * 0.1,
  };
}

/** Transient sounds: the burn lighting up, the boost kicking in, the burn cutting off. */
export type RocketEvent = 'ignite' | 'afterburner' | 'cutoff';

export type IgnitionState = { burning: boolean; boosting: boolean; since: number };

export function createIgnition(): IgnitionState {
  return { burning: false, boosting: false, since: -Infinity };
}

const LIGHT = 0.2;
const OUT = 0.08;
const BOOST_ON = 0.25;
const BOOST_OFF = 0.1;
/** A burn shorter than this cuts off without a sound, so tapping W does not chatter. */
const MIN_BURN = 0.5;

/**
 * Hysteresis on the throttle and the boost turns a smooth control signal into a few discrete
 * events. `time` is in seconds and only needs to grow.
 */
export function stepIgnition(s: IgnitionState, thrust: number, boost: number, time: number): RocketEvent | null {
  const t = finite01(thrust);
  const b = finite01(boost);
  if (!s.boosting && b > BOOST_ON) {
    s.boosting = true;
    if (!s.burning) {
      s.burning = true;
      s.since = time;
    }
    return 'afterburner';
  }
  if (s.boosting && b < BOOST_OFF) s.boosting = false;
  if (!s.burning && t > LIGHT) {
    s.burning = true;
    s.since = time;
    return 'ignite';
  }
  if (s.burning && !s.boosting && t < OUT) {
    s.burning = false;
    return time - s.since >= MIN_BURN ? 'cutoff' : null;
  }
  return null;
}
