/** Small seeded PRNG (mulberry32): the whole world is rebuilt from one number. */
export type Rng = {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Approximately normal (mean 0, sd 1). */
  gauss(): number;
  /** Uniform point inside the unit sphere. */
  inSphere(): [number, number, number];
  /** Uniform unit vector. */
  onSphere(): [number, number, number];
  /** A child generator whose stream does not depend on how much the parent is used later. */
  fork(label: string): Rng;
};

export function hashString(text: string): number {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error('pick() from an empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    chance: (p) => next() < p,
    gauss: () => {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    inSphere: () => {
      for (;;) {
        const x = next() * 2 - 1;
        const y = next() * 2 - 1;
        const z = next() * 2 - 1;
        if (x * x + y * y + z * z <= 1) return [x, y, z];
      }
    },
    onSphere: () => {
      const z = next() * 2 - 1;
      const t = next() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      return [r * Math.cos(t), r * Math.sin(t), z];
    },
    fork: (label) => createRng((seed ^ hashString(label)) >>> 0),
  };
  return rng;
}
