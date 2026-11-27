import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.ts';
import {
  CLASS_CODES,
  EVOLVED,
  FAMILY_WEIGHTS,
  GOLDEN_SUN,
  MAIN_SEQUENCE,
  SUN_RADIUS_M,
  SYSTEM_FAMILIES,
  SYSTEM_STAR_MAX_M,
  T_SUN,
  blackbody,
  cssColor,
  formatQuantity,
  gameRadius,
  luminosityOf,
  mainSequenceAt,
  pickFamily,
  sampleStar,
  sampleSystemStar,
  starLook,
  type StarFamily,
} from './stars.ts';

const close = (a: number, b: number, rel: number, what: string) => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, `${what}: ${a} vs ${b}`);

test('Stefan–Boltzmann in solar units gives the Sun one solar luminosity', () => {
  assert.equal(luminosityOf(1, T_SUN), 1);
  assert.equal(luminosityOf(2, T_SUN), 4);
  assert.equal(luminosityOf(1, T_SUN * 2), 16);
});

test("the main-sequence table reproduces Mamajek's luminosities", () => {
  // logL column of the 2022.04.16 table, for a few rows across the sequence.
  const logL: Record<number, number> = { 3: 5.82, 10: 4.65, 20: 1.58, 30: 0.86, 42: 0.01, 50: -0.34, 60: -1.16, 65: -2.52 };
  for (const [code, expected] of Object.entries(logL)) {
    const row = MAIN_SEQUENCE.find((r) => r[0] === Number(code))!;
    const l = Math.log10(luminosityOf(row[2], row[1]));
    assert.ok(Math.abs(l - expected) < 0.03, `code ${code}: log L ${l.toFixed(3)} vs ${expected}`);
  }
});

test('the main sequence is interpolated through its rows and gets cooler and smaller down the classes', () => {
  for (const [code, teff, radius] of MAIN_SEQUENCE) {
    const at = mainSequenceAt(code);
    close(at.teff, teff, 1e-9, `Teff at ${code}`);
    close(at.radius, radius, 1e-9, `R at ${code}`);
  }
  let last = mainSequenceAt(3);
  for (let c = 3.5; c <= 69; c += 0.5) {
    const at = mainSequenceAt(c);
    assert.ok(at.teff < last.teff, `cooler at ${c}`);
    assert.ok(at.radius <= last.radius + 1e-9, `no larger at ${c}`);
    last = at;
  }
});

test('every family stays inside its published ranges, and L, R and T agree', () => {
  const families = Object.keys(FAMILY_WEIGHTS) as StarFamily[];
  for (const family of families) {
    const rng = createRng(17).fork(family);
    for (let k = 0; k < 2000; k++) {
      const s = sampleStar(rng, family);
      assert.equal(s.family, family);
      close(s.luminosity, luminosityOf(s.radius, s.teff), 1e-9, `${family} Stefan–Boltzmann`);
      const ranges = EVOLVED[family as keyof typeof EVOLVED];
      if (ranges) {
        assert.ok(s.teff >= ranges.teff[0] && s.teff <= ranges.teff[1], `${family} Teff ${s.teff}`);
        assert.ok(s.radius >= ranges.radius[0] && s.radius <= ranges.radius[1], `${family} R ${s.radius}`);
        assert.ok(s.luminosity >= ranges.luminosity[0] && s.luminosity <= ranges.luminosity[1], `${family} L ${s.luminosity}`);
      } else {
        const [c0, c1] = CLASS_CODES[family as keyof typeof CLASS_CODES];
        assert.ok(s.teff <= mainSequenceAt(c0).teff && s.teff >= mainSequenceAt(c1).teff, `${family}: Teff ${s.teff.toFixed(0)} K within its class`);
        assert.match(s.spectral, new RegExp(`^${family}\\d V$`));
      }
    }
  }
});

test('the families sit where the textbooks put them', () => {
  const rng = createRng(5);
  const mean = (family: StarFamily, key: 'teff' | 'radius' | 'luminosity') => {
    let sum = 0;
    for (let k = 0; k < 400; k++) sum += Math.log10(sampleStar(rng, family)[key]);
    return 10 ** (sum / 400);
  };
  assert.ok(mean('redSupergiant', 'radius') > 300, 'red supergiants are hundreds of solar radii');
  assert.ok(mean('redGiant', 'radius') > 10 && mean('redGiant', 'radius') < 100, 'red giants are tens');
  assert.ok(mean('whiteDwarf', 'radius') < 0.02, 'white dwarfs are about Earth-sized');
  assert.ok(mean('blueSupergiant', 'luminosity') > 1e4, 'blue supergiants outshine the Sun ten thousand times');
  assert.ok(mean('O', 'teff') > 33000 && mean('M', 'teff') < 3900, 'O is hot, M is cool');
  assert.ok(mean('G', 'luminosity') > 0.6 && mean('G', 'luminosity') < 1.5, 'G dwarfs are Sun-like');
});

test('spectral types read the way catalogues write them', () => {
  const rng = createRng(9);
  assert.match(sampleStar(rng, 'redGiant').spectral, /^[KMG] III$/);
  assert.match(sampleStar(rng, 'redSupergiant').spectral, /^[KM][\d.]+ I$/);
  assert.match(sampleStar(rng, 'blueSupergiant').spectral, /^[OB] I$/);
  assert.match(sampleStar(rng, 'whiteDwarf').spectral, /^DA[1-9]$/);
});

test('every family turns up in a long flight', () => {
  const rng = createRng(3);
  const seen = new Map<StarFamily, number>();
  for (let k = 0; k < 2000; k++) {
    const f = pickFamily(rng);
    seen.set(f, (seen.get(f) ?? 0) + 1);
  }
  for (const [family, w] of Object.entries(FAMILY_WEIGHTS)) {
    const n = seen.get(family as StarFamily) ?? 0;
    assert.ok(Math.abs(n / 2000 - w) < 0.03, `${family}: ${n} of 2000 for weight ${w}`);
  }
});

test('black-body colours go from red through white to blue', () => {
  const red = blackbody(2500);
  const sun = blackbody(5772);
  const white = blackbody(6500);
  const blue = blackbody(30000);
  assert.ok(red[0] === 1 && red[2] < 0.15, `2500 K is red: ${red}`);
  assert.ok(sun[0] === 1 && sun[1] > 0.8 && sun[2] > 0.7, `the Sun is a warm white: ${sun}`);
  assert.ok(white.every((c) => c > 0.9), `6500 K is the sRGB white point: ${white}`);
  assert.ok(blue[2] === 1 && blue[0] < 0.5, `30 000 K is blue: ${blue}`);
});

test("the game keeps the order of sizes but squeezes the extremes", () => {
  const rng = createRng(11);
  assert.equal(gameRadius({ family: 'G', spectral: 'G2 V', teff: T_SUN, radius: 1, luminosity: 1 }), SUN_RADIUS_M);
  const dwarf = gameRadius(sampleStar(rng, 'whiteDwarf'));
  const red = gameRadius(sampleStar(rng, 'M'));
  const giant = gameRadius(sampleStar(rng, 'redGiant'));
  const supergiant = gameRadius(sampleStar(rng, 'redSupergiant'));
  assert.ok(dwarf < red && red < SUN_RADIUS_M && giant > SUN_RADIUS_M * 2 && supergiant > giant, `${dwarf} ${red} ${giant} ${supergiant}`);
  assert.ok(dwarf > 250, 'a white dwarf can still be seen');
  assert.ok(supergiant < 60000, 'a supergiant still fits the view');
});

test('hot stars shine brighter, with wider coronae, and light the scene in their own colour', () => {
  const rng = createRng(2);
  const m = starLook(sampleStar(rng, 'M'));
  const g = starLook(sampleStar(rng, 'G'));
  const o = starLook(sampleStar(rng, 'O'));
  const wd = starLook(sampleStar(rng, 'whiteDwarf'));
  assert.ok(m.gain < g.gain && g.gain < o.gain);
  assert.ok(m.light[2] < g.light[2] && o.light[0] < g.light[0], 'red light from a red dwarf, blue from an O star');
  assert.ok(wd.reach > g.reach, 'a white dwarf glares far beyond its tiny disc');
  const rsg = starLook(sampleStar(rng, 'redSupergiant'));
  assert.ok(rsg.cells < g.cells / 2, 'a supergiant boils in a few huge cells');
  assert.ok(rsg.hot[1] < 0.5 && rsg.hot[2] < 0.2, `a red supergiant reads red: ${rsg.hot}`);
  assert.ok(o.lightIntensity > g.lightIntensity && g.lightIntensity > m.lightIntensity);
  for (const look of [m, g, o, wd]) {
    for (const c of [look.hot, look.mid, look.deep, look.corona, look.light]) assert.ok(c.every((x) => Number.isFinite(x) && x >= 0 && x <= 1), `colour ${c}`);
    assert.ok(look.reach >= 3.5 && look.reach <= 16);
  }
});

test('caption numbers are short and grouped', () => {
  assert.equal(formatQuantity(0.0123), '0.012');
  assert.equal(formatQuantity(1.012), '1.0');
  assert.equal(formatQuantity(13.43), '13');
  assert.equal(formatQuantity(870.4), '870');
  assert.equal(formatQuantity(1234), '1,230');
  assert.equal(formatQuantity(44900), '44,900');
  assert.equal(formatQuantity(Number.NaN), '—');
});

test("the relic hunt's star is a dwarf small enough for its planets", () => {
  const rng = createRng(8);
  const seen = new Set<StarFamily>();
  for (let k = 0; k < 600; k++) {
    const s = sampleSystemStar(rng);
    seen.add(s.family);
    assert.ok(SYSTEM_FAMILIES.includes(s.family), s.family);
    assert.ok(gameRadius(s) <= SYSTEM_STAR_MAX_M, `${s.spectral}: ${gameRadius(s).toFixed(0)} m`);
  }
  assert.equal(seen.size, SYSTEM_FAMILIES.length);
});

test('map colours are sRGB hex', () => {
  assert.equal(cssColor([1, 1, 1]), '#ffffff');
  assert.equal(cssColor([0, 0, 0]), '#000000');
  assert.equal(cssColor([0.2159, 0.2159, 0.2159]), '#808080');
  assert.equal(cssColor([2, -1, 0.5]), '#ff00bc');
});

test("the golden sun keeps the original sun's hand-tuned look", () => {
  const look = starLook(GOLDEN_SUN);
  assert.ok(Math.abs(look.radius - 2600) < 1e-6);
  assert.deepEqual([look.hot, look.deep, look.gain, look.reach, look.cells], [[1, 0.82, 0.5], [0.8, 0.14, 0.01], 1.9, 6.8, 18]);
  // A real G8 V of the same numbers is paler: the golden look is the exception, not the rule.
  const plain = starLook({ ...GOLDEN_SUN, golden: undefined });
  assert.notDeepEqual(plain.hot, look.hot);
});
