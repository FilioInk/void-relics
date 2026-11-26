import type { Rng } from '../core/rng.ts';

const ONSETS = ['k', 'v', 't', 's', 'r', 'l', 'm', 'n', 'd', 'z', 'th', 'kh', 'sh', 'dr', 'vr', 'x', 'or', 'el', 'ae', 'ir'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ei'];
const CODAS = ['', '', '', 'n', 'r', 's', 'th', 'x', 'l', 'k'];

const capitalise = (s: string): string => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));

/** A generated proper name of 2–3 syllables. `alien` inserts an apostrophe after the first. */
export function makeName(rng: Rng, alien = false): string {
  const count = rng.chance(0.35) ? 3 : 2;
  let name = '';
  for (let i = 0; i < count; i++) {
    if (alien && i === 1) name += "'";
    name += rng.pick(ONSETS) + rng.pick(VOWELS) + rng.pick(CODAS);
  }
  return capitalise(name);
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function roman(n: number): string {
  return ROMAN[n - 1] ?? String(n);
}
