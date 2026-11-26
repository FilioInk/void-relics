import { createRng } from './rng.ts';

/** Seeded 3D gradient noise (Perlin-style), returns roughly [-1, 1]. Used on the CPU for
 *  asteroid shapes and the nebula smoke textures; the GPU shaders carry their own copy. */
export type Noise3 = (x: number, y: number, z: number) => number;

const GRADS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

export function createNoise3(seed: number): Noise3 {
  const rng = createRng(seed);
  const p = new Uint8Array(512);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = perm[i] as number;
    perm[i] = perm[j] as number;
    perm[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255] as number;

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grad = (h: number, x: number, y: number, z: number) => {
    const g = GRADS[h % 12] as readonly [number, number, number];
    return g[0] * x + g[1] * y + g[2] * z;
  };

  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const A = (p[X] as number) + Y;
    const AA = (p[A] as number) + Z;
    const AB = (p[A + 1] as number) + Z;
    const B = (p[X + 1] as number) + Y;
    const BA = (p[B] as number) + Z;
    const BB = (p[B + 1] as number) + Z;
    return lerp(
      lerp(
        lerp(grad(p[AA] as number, xf, yf, zf), grad(p[BA] as number, xf - 1, yf, zf), u),
        lerp(grad(p[AB] as number, xf, yf - 1, zf), grad(p[BB] as number, xf - 1, yf - 1, zf), u),
        v,
      ),
      lerp(
        lerp(grad(p[AA + 1] as number, xf, yf, zf - 1), grad(p[BA + 1] as number, xf - 1, yf, zf - 1), u),
        lerp(grad(p[AB + 1] as number, xf, yf - 1, zf - 1), grad(p[BB + 1] as number, xf - 1, yf - 1, zf - 1), u),
        v,
      ),
      w,
    );
  };
}

/** Fractal sum of octaves, normalised back to roughly [-1, 1]. */
export function fbm3(noise: Noise3, x: number, y: number, z: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
