import { createRng, type Rng } from '../core/rng.ts';
import { DEFAULT_MUSIC_VOLUME } from '../game/settings.ts';
import { createIgnition, stepIgnition } from './rocket.ts';
import { RocketVoice } from './rocketVoice.ts';
import { chord, melodyPool, midiToFreq, progression, type ModeName } from './theory.ts';

/** Music bus level at 100% music volume. */
export const MUSIC_LEVEL = 0.55;

/**
 * All sound is synthesised live with Web Audio: no audio files ship with the game.
 *
 *   music bus ─┬─ dry ─────────────┐
 *              └─ reverb (IR made  ├─ master ─ compressor ─ speakers
 *   sfx bus ───── from noise) ─────┘
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly musicBus: GainNode;
  private readonly sfxBus: GainNode;
  private readonly reverbSend: GainNode;
  private readonly delaySend: GainNode;
  /** Music echoes go through here so the music toggle silences them too. */
  private readonly musicEcho: GainNode;
  /** Same for sound effects that ring out into the reverb. */
  private readonly sfxEcho: GainNode;
  private readonly noise: AudioBuffer;
  private readonly rng: Rng;

  private musicOn = true;
  private musicVolume = DEFAULT_MUSIC_VOLUME;
  private soundOn = true;
  private scheduler: number | undefined;
  private nextChordAt = 0;
  private nextBeatAt = 0;
  private chordIndex = 0;
  private prog: number[] = [];
  private root = 45;
  private mode: ModeName = 'aeolian';
  private currentDegree = 0;

  // Continuous voices.
  private rocket: RocketVoice | null = null;
  private readonly ignition = createIgnition();
  private tensionGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private nextAlarmAt = 0;

  constructor(seed: number) {
    this.ctx = new AudioContext();
    this.rng = createRng(seed ^ 0x5eed);
    const ctx = this.ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(6.5, 2.6);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.9;
    reverb.connect(reverbOut).connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.75;
    this.reverbSend.connect(reverb);

    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 2400;
    delay.connect(delayTone).connect(feedback).connect(delay);
    delayTone.connect(this.reverbSend);
    delayTone.connect(this.master);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.5;
    this.delaySend.connect(delay);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = MUSIC_LEVEL * this.musicVolume;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverbSend);

    this.musicEcho = ctx.createGain();
    this.musicEcho.gain.value = 1;
    this.musicEcho.connect(this.delaySend);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);
    this.sfxEcho = ctx.createGain();
    this.sfxEcho.connect(this.reverbSend);
    this.sfxEcho.connect(this.delaySend);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Decaying stereo noise is a decent stand-in for a large hall, or the inside of a nebula. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  start(): void {
    if (this.scheduler !== undefined) return;
    const t = this.ctx.currentTime + 0.1;
    this.nextChordAt = t;
    this.nextBeatAt = t + 2;
    this.startDrone();
    this.startWind();
    this.startEngine();
    this.startTension();
    this.scheduler = window.setInterval(() => this.schedule(), 200);
    this.schedule();
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    this.applyMusicLevel();
  }

  /** 0..1 of the full music level. */
  setMusicVolume(volume: number): void {
    this.musicVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_MUSIC_VOLUME;
    this.applyMusicLevel();
  }

  private applyMusicLevel(): void {
    const on = this.musicOn ? 1 : 0;
    this.musicBus.gain.setTargetAtTime(MUSIC_LEVEL * this.musicVolume * on, this.ctx.currentTime, 0.4);
    // The echo send scales with the bus so echoes stay in proportion to the dry music.
    this.musicEcho.gain.setTargetAtTime(this.musicVolume * on, this.ctx.currentTime, 0.4);
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    this.sfxBus.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.1);
    this.sfxEcho.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.1);
  }

  get music(): boolean {
    return this.musicOn;
  }

  get sound(): boolean {
    return this.soundOn;
  }

  /** Pause everything (the context keeps its clock, so the scheduler picks up where it left). */
  async suspend(): Promise<void> {
    if (this.ctx.state === 'running') await this.ctx.suspend();
  }

  // --- music -----------------------------------------------------------------------------

  private schedule(): void {
    const ahead = this.ctx.currentTime + 1.2;
    while (this.nextChordAt < ahead) {
      this.playChord(this.nextChordAt);
      this.nextChordAt += 16;
    }
    while (this.nextBeatAt < ahead) {
      this.maybeBell(this.nextBeatAt);
      this.nextBeatAt += 1.0;
    }
  }

  private playChord(at: number): void {
    if (this.chordIndex % 8 === 0) {
      // Every eight chords the piece may drift to a new key and colour.
      this.root = this.rng.pick([41, 43, 45, 46, 48]);
      this.mode = this.rng.pick<ModeName>(['aeolian', 'dorian', 'lydian', 'aeolian', 'mixolydian']);
      this.prog = progression(this.rng, 8);
    }
    const degree = this.prog[this.chordIndex % 8] ?? 0;
    this.currentDegree = degree;
    this.chordIndex++;

    const ctx = this.ctx;
    const dur = 16;
    const attack = 5;
    const release = 7;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(300, at);
    filter.frequency.linearRampToValueAtTime(this.rng.range(900, 1700), at + dur * 0.55);
    filter.frequency.linearRampToValueAtTime(350, at + dur + release);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.06, at + attack);
    env.gain.setValueAtTime(0.06, at + dur);
    env.gain.linearRampToValueAtTime(0, at + dur + release);
    filter.connect(env).connect(this.musicBus);

    const notes = chord(this.root + 12, this.mode, degree, 4);
    for (const midi of notes) {
      for (const detune of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToFreq(midi);
        o.detune.value = detune + this.rng.range(-2, 2);
        const pan = ctx.createStereoPanner();
        pan.pan.value = detune < 0 ? -0.35 : 0.35;
        o.connect(pan).connect(filter);
        o.start(at);
        o.stop(at + dur + release + 0.1);
      }
    }
    // A soft sine an octave under the chord root holds the floor.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiToFreq((notes[0] as number) - 12);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0, at);
    subGain.gain.linearRampToValueAtTime(0.09, at + attack);
    subGain.gain.setValueAtTime(0.09, at + dur);
    subGain.gain.linearRampToValueAtTime(0, at + dur + release);
    sub.connect(subGain).connect(this.musicBus);
    sub.start(at);
    sub.stop(at + dur + release + 0.1);
  }

  private maybeBell(at: number): void {
    if (!this.rng.chance(0.3)) return;
    const pool = melodyPool(this.root, this.mode, this.currentDegree);
    const midi = this.rng.pick(pool);
    this.bell(at, midiToFreq(midi), this.rng.range(0.025, 0.05), this.musicBus, this.musicEcho);
    // Now and then a second note answers the first.
    if (this.rng.chance(0.3)) this.bell(at + 0.5, midiToFreq(this.rng.pick(pool)), 0.02, this.musicBus, this.musicEcho);
  }

  /** FM bell: an inharmonic modulator whose depth dies away faster than the tone. */
  private bell(at: number, freq: number, level: number, bus: AudioNode, echo: AudioNode | null): void {
    const ctx = this.ctx;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 2.76;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 1.6, at);
    modGain.gain.exponentialRampToValueAtTime(1, at + 1.4);
    mod.connect(modGain).connect(carrier.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 4.5);
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rng.range(-0.7, 0.7);
    carrier.connect(env).connect(pan).connect(bus);
    if (echo) pan.connect(echo);
    carrier.start(at);
    mod.start(at);
    carrier.stop(at + 4.6);
    mod.stop(at + 4.6);
  }

  private startDrone(): void {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();
    for (const [midi, type] of [[33, 'triangle'], [40, 'sine'], [45, 'triangle']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiToFreq(midi);
      o.detune.value = this.rng.range(-5, 5);
      o.connect(filter);
      o.start();
    }
    filter.connect(gain).connect(this.musicBus);
  }

  private startWind(): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 6;
    this.windFilter.frequency.value = 600;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.031;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 380;
    lfo.connect(lfoGain).connect(this.windFilter.frequency);
    lfo.start();
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(this.windFilter).connect(gain).connect(this.musicBus);
    src.start();
  }

  /** A low, uneasy cluster that swells near the star. */
  private startTension(): void {
    const ctx = this.ctx;
    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    for (const midi of [38, 44, 45]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToFreq(midi);
      o.connect(filter);
      o.start();
    }
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 140;
    rumble.connect(rf).connect(filter);
    rumble.start();
    filter.connect(this.tensionGain).connect(this.musicBus);
  }

  /** danger 0..1 near the star; nebula 0..1 inside a cloud (muffles and widens the wind). */
  setMood(danger: number, nebula: number): void {
    const t = this.ctx.currentTime;
    this.tensionGain?.gain.setTargetAtTime(danger * 0.09, t, 0.8);
    this.windFilter?.Q.setTargetAtTime(6 - nebula * 4.5, t, 1.5);
  }

  // --- ship sounds -----------------------------------------------------------------------

  private startEngine(): void {
    this.rocket = new RocketVoice(this.ctx, this.sfxBus, Math.random);
    this.rocket.start();
  }

  /** throttle -1..1, boost 0..1, heat 0..1 (dps > 0 sounds the alarm). */
  updateShip(throttle: number, boost: number, heatDamage: boolean): void {
    const t = this.ctx.currentTime;
    const thrust = Math.abs(throttle);
    this.rocket?.set(thrust, boost, t);
    const event = stepIgnition(this.ignition, thrust, boost, t);
    if (event === 'ignite') this.rocket?.ignite(t, 1);
    else if (event === 'afterburner') this.rocket?.ignite(t, 1.6);
    else if (event === 'cutoff') this.rocket?.cutoff(t);
    if (heatDamage && t >= this.nextAlarmAt) {
      this.beep(t, 880, 0.12, 0.05);
      this.beep(t + 0.16, 660, 0.12, 0.05);
      this.nextAlarmAt = t + 0.7;
    }
  }

  private beep(at: number, freq: number, len: number, level: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(this.sfxBus);
    o.start(at);
    o.stop(at + len + 0.02);
  }

  /** Rising shimmer of bell tones when a relic is recovered. */
  pickup(): void {
    const t = this.ctx.currentTime;
    const base = this.root + 36;
    [0, 7, 12, 16, 19, 24].forEach((step, i) => this.bell(t + i * 0.09, midiToFreq(base + step), 0.07, this.sfxBus, this.sfxEcho));
    const sweep = this.ctx.createBufferSource();
    sweep.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 8;
    bp.frequency.setValueAtTime(800, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + 1.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    sweep.connect(bp).connect(g).connect(this.sfxBus);
    g.connect(this.sfxEcho);
    sweep.start(t);
    sweep.stop(t + 1.5);
  }

  /** A soft sonar ping when a relic's signal first shows up on the scanner. */
  ping(): void {
    const t = this.ctx.currentTime;
    this.bell(t, midiToFreq(this.root + 31), 0.04, this.sfxBus, this.sfxEcho);
  }

  impact(strength: number): void {
    const t = this.ctx.currentTime;
    const s = Math.min(1, strength);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25 * s + 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(lp).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.7);
    const thud = this.ctx.createOscillator();
    thud.frequency.setValueAtTime(110, t);
    thud.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.3 * s + 0.05, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    thud.connect(tg).connect(this.sfxBus);
    thud.start(t);
    thud.stop(t + 0.5);
  }

  explosion(): void {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    src.connect(lp).connect(g).connect(this.sfxBus);
    g.connect(this.sfxEcho);
    src.start(t);
    src.stop(t + 3.3);
  }

  click(): void {
    const t = this.ctx.currentTime;
    this.bell(t, 1320, 0.03, this.sfxBus, null);
  }

  // --- weapons ---------------------------------------------------------------------------

  /** A blaster shot: a falling, slightly metallic chirp with a click on the front. pan -1..1. */
  laser(pan: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const jitter = 1 + (Math.random() - 0.5) * 0.08;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2300 * jitter, t);
    o.frequency.exponentialRampToValueAtTime(190 * jitter, t + 0.17);
    // A modulator a little off the carrier gives the zing of a struck wire.
    const mod = ctx.createOscillator();
    mod.frequency.setValueAtTime(3100 * jitter, t);
    mod.frequency.exponentialRampToValueAtTime(260 * jitter, t + 0.17);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(1400, t);
    depth.gain.exponentialRampToValueAtTime(40, t + 0.17);
    mod.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(g).connect(p).connect(this.sfxBus);
    o.start(t);
    mod.start(t);
    o.stop(t + 0.22);
    mod.stop(t + 0.22);
    this.noiseBurst(t, 0.025, 4500, 2, 0.05, p);
  }

  /** A bolt striking rock or metal. */
  hit(strength: number): void {
    const t = this.ctx.currentTime;
    const s = Math.max(0.2, Math.min(1, strength));
    this.noiseBurst(t, 0.09, 2600, 1.2, 0.09 * s, this.sfxBus);
    this.noiseBurst(t, 0.05, 700, 1, 0.06 * s, this.sfxBus);
  }

  /** Something breaking apart: a crunch, a few cracks, a low thud. size 0..1. */
  shatter(size: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = Math.max(0.15, Math.min(1, size));
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.5 + s * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32 * s + 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7 + s * 0.8);
    src.connect(lp).connect(g).connect(this.sfxBus);
    g.connect(this.sfxEcho);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 1.6);
    for (let i = 0; i < 3 + Math.round(s * 4); i++) this.noiseBurst(t + Math.random() * 0.35, 0.03, 1800 + Math.random() * 2500, 2, 0.08 * s, this.sfxBus);
    const thud = ctx.createOscillator();
    thud.frequency.setValueAtTime(80, t);
    thud.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.35 * s, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    thud.connect(tg).connect(this.sfxBus);
    thud.start(t);
    thud.stop(t + 0.6);
  }

  /** Salvage picked up: two quick rising notes. */
  salvage(): void {
    const t = this.ctx.currentTime;
    this.bell(t, midiToFreq(this.root + 43), 0.05, this.sfxBus, this.sfxEcho);
    this.bell(t + 0.08, midiToFreq(this.root + 50), 0.05, this.sfxBus, this.sfxEcho);
  }

  /** A short band of noise: clicks, cracks and impact grit. */
  private noiseBurst(at: number, length: number, freq: number, q: number, level: number, out: AudioNode): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.connect(bp).connect(g).connect(out);
    src.start(at, Math.random() * 1.8);
    src.stop(at + length + 0.02);
  }
}
