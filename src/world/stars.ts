import type { Rng } from '../core/rng.ts';

/**
 * Stars as astronomers tabulate them, scaled down for the game. A star is drawn as a family
 * (main sequence O–M, red giant, red supergiant, blue supergiant, white dwarf), then its
 * temperature and radius come from published ranges for that family and its luminosity from
 * the Stefan–Boltzmann law, L = R² (T / T☉)⁴ in solar units, so the three always agree.
 *
 * Sources:
 * - Main sequence: E. Mamajek, "A Modern Mean Dwarf Stellar Color and Effective Temperature
 *   Sequence" (Pecaut & Mamajek 2013, ApJS 208, 9), table version 2022.04.16 —
 *   https://www.pas.rochester.edu/~emamajek/EEM_dwarf_UBVIJHK_colors_Teff.txt
 * - Red supergiants: Teff 3450–4100 K and the spectral-type scale of Levesque et al. 2005
 *   (ApJ 628, 973); radii of several hundred to ~1500 R☉ and 10⁴–3·10⁵ L☉ (Wikipedia,
 *   "Red supergiant").
 * - Red giants: K–M giants of 3300–5000 K, tens to ~150 R☉, up to ~3000 L☉ on the red-giant
 *   branch (Wikipedia, "Red giant").
 * - Blue supergiants: 10 000–50 000 K and 10⁴–10⁶ L☉ (Wikipedia, "Blue supergiant").
 * - White dwarfs: 0.8–2 % of the Sun's radius, 4000–40 000 K, 10⁻⁴–10⁻² L☉ for most of them
 *   (Wikipedia, "White dwarf"); the DA temperature index is 50 400 K / Teff (Sion et al. 1983).
 * - Colour: Planck's law through the CIE 1931 2° observer (the multi-lobe fit of Wyman, Sloan
 *   & Shirley 2013) into linear sRGB.
 */

export type StarFamily = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'redGiant' | 'redSupergiant' | 'blueSupergiant' | 'whiteDwarf';

export type Star = {
  family: StarFamily;
  /** Morgan–Keenan spectral type, e.g. "G2 V", "M2 I", "DA4". */
  spectral: string;
  /** Effective temperature, kelvin. */
  teff: number;
  /** Radius in solar radii. */
  radius: number;
  /** Luminosity in solar luminosities. */
  luminosity: number;
};

export type Rgb = [number, number, number];

/** The Sun's effective temperature (IAU 2015 nominal value), K. */
export const T_SUN = 5772;

/** Stefan–Boltzmann in solar units: R in R☉, T in K, result in L☉. */
export const luminosityOf = (radius: number, teff: number): number => radius * radius * (teff / T_SUN) ** 4;

// --- the main sequence -----------------------------------------------------------------------

/**
 * Mamajek's dwarf sequence, a row every few subtypes: spectral code (O0 = 0, B0 = 10, …, M0 = 60,
 * plus the subtype), Teff in K, radius in R☉. Luminosity follows from the two.
 */
export const MAIN_SEQUENCE: ReadonlyArray<readonly [code: number, teff: number, radius: number]> = [
  [3, 44900, 13.43], // O3V
  [5, 41400, 11.45], // O5V
  [7, 37100, 9.42], // O7V
  [9, 33300, 7.72], // O9V
  [10, 31400, 7.16], // B0V
  [12, 20600, 4.06], // B2V
  [15, 15700, 3.36], // B5V
  [18, 12300, 2.86], // B8V
  [20, 9700, 2.193], // A0V
  [22, 8800, 2.117], // A2V
  [25, 8100, 1.785], // A5V
  [28, 7590, 1.747], // A8V
  [30, 7220, 1.728], // F0V
  [32, 6820, 1.622], // F2V
  [35, 6550, 1.473], // F5V
  [38, 6180, 1.221], // F8V
  [40, 5930, 1.1], // G0V
  [42, 5770, 1.012], // G2V
  [45, 5660, 0.977], // G5V
  [48, 5480, 0.914], // G8V
  [50, 5270, 0.813], // K0V
  [52, 5100, 0.783], // K2V
  [55, 4440, 0.701], // K5V
  [57, 4100, 0.63], // K7V
  [60, 3850, 0.588], // M0V
  [62, 3560, 0.446], // M2V
  [64, 3210, 0.274], // M4V
  [65, 3060, 0.196], // M5V
  [66, 2810, 0.137], // M6V
  [68, 2570, 0.114], // M8V
  [69, 2380, 0.102], // M9V
];

const LETTERS = ['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const;
type Letter = (typeof LETTERS)[number];

/** Where each main-sequence class runs in spectral code. */
export const CLASS_CODES: Record<Letter, [number, number]> = { O: [3, 10], B: [10, 20], A: [20, 30], F: [30, 40], G: [40, 50], K: [50, 60], M: [60, 69] };

/** Teff and radius at a spectral code, interpolated in log space between Mamajek's rows. */
export function mainSequenceAt(code: number): { teff: number; radius: number } {
  const rows = MAIN_SEQUENCE;
  const c = Math.min(rows[rows.length - 1]![0], Math.max(rows[0]![0], code));
  let k = 0;
  while (k < rows.length - 2 && rows[k + 1]![0] <= c) k++;
  const [c0, t0, r0] = rows[k]!;
  const [c1, t1, r1] = rows[k + 1]!;
  const u = (c - c0) / (c1 - c0);
  return { teff: Math.exp(Math.log(t0) + (Math.log(t1) - Math.log(t0)) * u), radius: Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * u) };
}

// --- evolved stars -------------------------------------------------------------------------

type Ranges = { teff: [number, number]; radius: [number, number]; luminosity: [number, number] };

/** Published ranges per evolved family; a draw keeps only radius–temperature pairs whose luminosity also fits. */
export const EVOLVED: Record<'redGiant' | 'redSupergiant' | 'blueSupergiant' | 'whiteDwarf', Ranges> = {
  redGiant: { teff: [3300, 5000], radius: [10, 150], luminosity: [40, 3000] },
  redSupergiant: { teff: [3450, 4100], radius: [200, 1500], luminosity: [1e4, 3e5] },
  blueSupergiant: { teff: [10000, 32000], radius: [15, 120], luminosity: [1e4, 1e6] },
  whiteDwarf: { teff: [6000, 30000], radius: [0.008, 0.02], luminosity: [1e-4, 0.1] },
};

/** Levesque et al. 2005: red supergiant Teff by spectral type, hot to cool. */
const RSG_SCALE: ReadonlyArray<readonly [teff: number, type: string]> = [
  [4100, 'K1'],
  [4015, 'K3'],
  [3840, 'K5'],
  [3790, 'M0'],
  [3745, 'M1'],
  [3710, 'M1.5'],
  [3660, 'M2'],
  [3615, 'M2.5'],
  [3605, 'M3'],
  [3550, 'M3.5'],
  [3535, 'M4'],
  [3450, 'M5'],
];

/** Spectral class by temperature, on the main-sequence boundaries (Wikipedia, "Stellar classification"). */
export function letterOf(teff: number): Letter {
  if (teff >= 33000) return 'O';
  if (teff >= 10000) return 'B';
  if (teff >= 7300) return 'A';
  if (teff >= 6000) return 'F';
  if (teff >= 5300) return 'G';
  if (teff >= 3900) return 'K';
  return 'M';
}

function spectralOf(family: StarFamily, teff: number, code: number): string {
  switch (family) {
    case 'redGiant':
      return `${letterOf(teff)} III`;
    case 'blueSupergiant':
      return `${letterOf(teff)} I`;
    case 'redSupergiant': {
      let best = RSG_SCALE[0]!;
      for (const row of RSG_SCALE) if (Math.abs(row[0] - teff) < Math.abs(best[0] - teff)) best = row;
      return `${best[1]} I`;
    }
    case 'whiteDwarf':
      return `DA${Math.min(9, Math.max(1, Math.round(50400 / teff)))}`;
    default:
      return `${LETTERS[Math.floor(code / 10)]}${Math.floor(code % 10)} V`;
  }
}

// --- drawing a star ------------------------------------------------------------------------

/**
 * How often each family turns up. Real counts would make nearly every star a red dwarf (76 % of
 * the main sequence is M, 12 % K, 7.6 % G, 3 % F, 0.6 % A, 0.12 % B, 0.00003 % O; giants and
 * supergiants rarer still), so the odds are flattened until a long flight shows all of them.
 */
export const FAMILY_WEIGHTS: Record<StarFamily, number> = {
  M: 0.16,
  K: 0.13,
  G: 0.13,
  F: 0.08,
  A: 0.07,
  B: 0.06,
  O: 0.03,
  redGiant: 0.1,
  redSupergiant: 0.08,
  blueSupergiant: 0.07,
  whiteDwarf: 0.09,
};

export function pickFamily(rng: Rng): StarFamily {
  const families = Object.keys(FAMILY_WEIGHTS) as StarFamily[];
  const total = families.reduce((s, f) => s + FAMILY_WEIGHTS[f], 0);
  let r = rng.next() * total;
  for (const f of families) {
    r -= FAMILY_WEIGHTS[f];
    if (r <= 0) return f;
  }
  return families[families.length - 1]!;
}

const logRange = (rng: Rng, [a, b]: [number, number]): number => Math.exp(rng.range(Math.log(a), Math.log(b)));

/** One star, of the given family or one picked by FAMILY_WEIGHTS. */
export function sampleStar(rng: Rng, family: StarFamily = pickFamily(rng)): Star {
  if (family in EVOLVED) {
    const ranges = EVOLVED[family as keyof typeof EVOLVED];
    let teff = 0;
    let radius = 0;
    let luminosity = 0;
    for (let k = 0; k < 64; k++) {
      teff = rng.range(ranges.teff[0], ranges.teff[1]);
      radius = logRange(rng, ranges.radius);
      luminosity = luminosityOf(radius, teff);
      if (luminosity >= ranges.luminosity[0] && luminosity <= ranges.luminosity[1]) break;
    }
    // Practically never needed: pull the luminosity into range and let the radius follow.
    if (luminosity < ranges.luminosity[0] || luminosity > ranges.luminosity[1]) {
      luminosity = Math.min(ranges.luminosity[1], Math.max(ranges.luminosity[0], luminosity));
      radius = Math.sqrt(luminosity) / (teff / T_SUN) ** 2;
    }
    return { family, spectral: spectralOf(family, teff, 0), teff, radius, luminosity };
  }
  const [c0, c1] = CLASS_CODES[family as Letter];
  const code = rng.range(c0, c1);
  const { teff, radius } = mainSequenceAt(code);
  return { family, spectral: spectralOf(family, teff, code), teff, radius, luminosity: luminosityOf(radius, teff) };
}

// --- colour --------------------------------------------------------------------------------

const lobe = (l: number, mu: number, s1: number, s2: number): number => {
  const x = (l - mu) / (l < mu ? s1 : s2);
  return Math.exp(-0.5 * x * x);
};

/** The colour of a black body at T kelvin, linear sRGB, brightest channel 1. */
export function blackbody(teff: number): Rgb {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const p = l ** -5 / (Math.exp(1.4388e7 / (l * teff)) - 1);
    x += p * (1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2));
    y += p * (0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1));
    z += p * (1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8));
  }
  const rgb: Rgb = [
    Math.max(0, 3.2406 * x - 1.5372 * y - 0.4986 * z),
    Math.max(0, -0.9689 * x + 1.8758 * y + 0.0415 * z),
    Math.max(0, 0.0557 * x - 0.204 * y + 1.057 * z),
  ];
  const m = Math.max(...rgb) || 1;
  return [rgb[0] / m, rgb[1] / m, rgb[2] / m];
}

/** Deepens a colour (each channel to a power, brightest back to 1): real star colours are pale. */
function saturate(c: Rgb, power: number): Rgb {
  const p: Rgb = [c[0] ** power, c[1] ** power, c[2] ** power];
  const m = Math.max(...p) || 1;
  return [p[0] / m, p[1] / m, p[2] / m];
}

const mix = (a: Rgb, b: Rgb, u: number): Rgb => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const WHITE: Rgb = [1, 1, 1];

// --- the star in the game ------------------------------------------------------------------

/** What the renderer needs to draw a star and light the scene with it. All colours linear RGB. */
export type StarLook = {
  /** Radius in metres. */
  radius: number;
  /** Granule tops, the mid surface and the dark lanes and spots. */
  hot: Rgb;
  mid: Rgb;
  deep: Rgb;
  corona: Rgb;
  /** HDR multiplier of the surface: hotter surfaces shine brighter per square metre. */
  gain: number;
  /** How far the corona reaches, in star radii. */
  reach: number;
  /** Granulation frequency on the unit sphere: dwarfs boil finely, supergiants in a few huge cells. */
  cells: number;
  /** Colour and intensity of the key light the star casts. */
  light: Rgb;
  lightIntensity: number;
};

/** The Sun's radius in the game, metres; the system star of the relic hunt is about this size. */
export const SUN_RADIUS_M = 2700;
/**
 * Real radii span five orders of magnitude (a white dwarf to a red supergiant). Drawn to scale,
 * either the dwarf would be invisible or the supergiant would swallow the whole flight, so the
 * game radius goes as R^0.4: the order of sizes stays, the extremes come closer.
 */
export const RADIUS_POWER = 0.4;

export const gameRadius = (star: Star): number => SUN_RADIUS_M * star.radius ** RADIUS_POWER;

export function starLook(star: Star): StarLook {
  const t = star.teff;
  // Real star colours are pale; deepen them so a red star reads red. Hot stars would turn flat
  // blue under the same treatment, so they get less of it.
  const power = t <= 4000 ? 2.8 : t <= 6500 ? 2.8 - (0.6 * (t - 4000)) / 2500 : t >= 12000 ? 1.3 : 2.2 - (0.9 * (t - 6500)) / 5500;
  const whiten = 0.15 * Math.min(1, Math.max(0, (t - 4500) / 2000));
  const hot = mix(saturate(blackbody(t), power), WHITE, whiten);
  const mid = saturate(blackbody(t * 0.78), power);
  const deepBase = saturate(blackbody(t * 0.58), power);
  const deep: Rgb = [deepBase[0] * 0.8, deepBase[1] * 0.8, deepBase[2] * 0.8];
  const surface = Math.sqrt(t / T_SUN);
  // Surface brightness really goes as T⁴; past a modest range the tone mapping only turns
  // everything white, so the colour has to carry the heat.
  const shine = Math.min(1.15, Math.max(0.75, (t / T_SUN) ** 0.25));
  return {
    radius: gameRadius(star),
    hot,
    mid,
    deep,
    corona: mix(mid, hot, 0.5),
    gain: 1.9 * shine,
    reach: Math.min(16, Math.max(3.5, 3 + (3.8 * surface) / star.radius ** 0.15)),
    cells: Math.min(22, Math.max(5, 18 / star.radius ** 0.2)),
    light: mix(saturate(blackbody(t), 1.5), WHITE, 0.35),
    lightIntensity: 2.6 * Math.min(1.35, Math.max(0.7, 1 + 0.06 * Math.log10(star.luminosity))),
  };
}

// --- the relic hunt's star ----------------------------------------------------------------

/**
 * The star at the centre of the relic hunt. Its planets are fixed (the innermost orbits at about
 * 11 km), so only stars small enough to keep that world outside their warning zone (2.6 radii)
 * qualify: main-sequence M to cooler A stars, and white dwarfs. Giants would swallow the system.
 */
export const SYSTEM_FAMILIES: ReadonlyArray<StarFamily> = ['M', 'K', 'G', 'F', 'A', 'whiteDwarf'];
/** The largest the relic hunt's star may be drawn, metres (A5 V, 1.8 R☉). */
export const SYSTEM_STAR_MAX_M = 3400;

export function sampleSystemStar(rng: Rng): Star {
  const total = SYSTEM_FAMILIES.reduce((sum, f) => sum + FAMILY_WEIGHTS[f], 0);
  let r = rng.next() * total;
  let family = SYSTEM_FAMILIES[SYSTEM_FAMILIES.length - 1]!;
  for (const f of SYSTEM_FAMILIES) {
    r -= FAMILY_WEIGHTS[f];
    if (r <= 0) {
      family = f;
      break;
    }
  }
  // Early A stars are too big for the system; draw again within the class until one fits.
  for (let k = 0; k < 32; k++) {
    const star = sampleStar(rng, family);
    if (gameRadius(star) <= SYSTEM_STAR_MAX_M) return star;
  }
  return sampleStar(rng, 'G');
}

/** A linear colour as a CSS hex string (sRGB-encoded), for the map. */
export function cssColor(c: Rgb): string {
  const encode = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    const e = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(e * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${encode(c[0])}${encode(c[1])}${encode(c[2])}`;
}

/** A number for a caption: two significant figures below ten, whole numbers above, grouped. */
export function formatQuantity(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x >= 10) {
    const digits = Math.floor(Math.log10(x)) + 1;
    const step = digits > 3 ? 10 ** (digits - 3) : 1;
    return (Math.round(x / step) * step).toLocaleString('en-US');
  }
  return x.toPrecision(2);
}
