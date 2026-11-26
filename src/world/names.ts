import type { Rng } from '../core/rng.ts';

/** A generated proper name in Latin and Cyrillic spelling, so the Russian UI reads naturally. */
export type ProperName = { latin: string; cyrillic: string };

// Syllables as [latin, cyrillic] pairs, so both spellings come from the same draw.
const ONSETS: ReadonlyArray<readonly [string, string]> = [
  ['k', 'к'], ['v', 'в'], ['t', 'т'], ['s', 'с'], ['r', 'р'], ['l', 'л'], ['m', 'м'], ['n', 'н'],
  ['d', 'д'], ['z', 'з'], ['th', 'т'], ['kh', 'х'], ['sh', 'ш'], ['dr', 'др'], ['vr', 'вр'],
  ['x', 'кс'], ['or', 'ор'], ['el', 'эл'], ['ae', 'э'], ['ir', 'ир'],
];
const VOWELS: ReadonlyArray<readonly [string, string]> = [
  ['a', 'а'], ['e', 'е'], ['i', 'и'], ['o', 'о'], ['u', 'у'], ['ae', 'э'], ['ia', 'ия'], ['ei', 'ей'],
];
const CODAS: ReadonlyArray<readonly [string, string]> = [
  ['', ''], ['', ''], ['', ''], ['n', 'н'], ['r', 'р'], ['s', 'с'], ['th', 'т'], ['x', 'кс'], ['l', 'л'], ['k', 'к'],
];

function syllable(rng: Rng): [string, string] {
  const o = rng.pick(ONSETS);
  const v = rng.pick(VOWELS);
  const c = rng.pick(CODAS);
  return [o[0] + v[0] + c[0], o[1] + v[1] + c[1]];
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** A name of 2–3 syllables. `alien` inserts an apostrophe after the first syllable. */
export function makeName(rng: Rng, alien = false): ProperName {
  const count = rng.chance(0.35) ? 3 : 2;
  let latin = '';
  let cyrillic = '';
  for (let i = 0; i < count; i++) {
    const [l, c] = syllable(rng);
    if (alien && i === 1) {
      latin += "'";
      cyrillic += "'";
    }
    latin += l;
    cyrillic += c;
  }
  return { latin: capitalise(latin), cyrillic: capitalise(cyrillic) };
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function roman(n: number): string {
  return ROMAN[n - 1] ?? String(n);
}
