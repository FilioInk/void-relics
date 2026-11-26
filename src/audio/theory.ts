import type { Rng } from '../core/rng.ts';

/** The little music theory the generative soundtrack needs: modes, chords and progressions. */

export const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const;

export type ModeName = keyof typeof MODES;

export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** The MIDI note of a scale degree (any integer, wraps into higher/lower octaves). */
export function degreeToMidi(root: number, mode: ModeName, degree: number): number {
  const steps = MODES[mode];
  const n = steps.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + octave * 12 + (steps[idx] as number);
}

/** A chord stacked in thirds on a scale degree, e.g. a seventh chord for voices = 4. */
export function chord(root: number, mode: ModeName, degree: number, voices = 4): number[] {
  return Array.from({ length: voices }, (_, i) => degreeToMidi(root, mode, degree + i * 2));
}

// Degrees that sound good moving to each other in a slow ambient progression.
const MOVES: Record<number, number[]> = {
  0: [5, 3, 6, 2],
  2: [5, 0, 3],
  3: [0, 6, 4, 5],
  4: [0, 5, 3],
  5: [3, 6, 0, 2],
  6: [0, 5, 3],
};

/** A progression that starts on the tonic and never repeats a chord back-to-back. */
export function progression(rng: Rng, length: number): number[] {
  const out = [0];
  while (out.length < length) {
    const prev = out[out.length - 1] as number;
    const choices = (MOVES[prev] ?? [0]).filter((d) => d !== prev);
    out.push(rng.pick(choices));
  }
  return out;
}

/** Notes for the sparse bell melody: the chord's tones and its ninth, an octave or two up. */
export function melodyPool(root: number, mode: ModeName, degree: number): number[] {
  const tones = [0, 2, 4, 8].map((d) => degreeToMidi(root, mode, degree + d));
  return [...tones.map((m) => m + 24), ...tones.map((m) => m + 36)];
}

export function inScale(midi: number, root: number, mode: ModeName): boolean {
  const pc = (((midi - root) % 12) + 12) % 12;
  return (MODES[mode] as readonly number[]).includes(pc);
}
