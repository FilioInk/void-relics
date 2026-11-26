import { brownNoise, crackle, pinkNoise, rocketMix, softClip, type Rand } from './rocket.ts';

/**
 * The ship's rocket engine on Web Audio. No oscillators carry it: three noise layers feed one
 * body that flutters and saturates, and a boost hiss sits on top.
 *
 *   brown ─ low-pass ─ rumble ─┐
 *   pink ── band-pass ─ roar ──┼─ flutter (AM) ─ soft clip ─ tone ─┬─ out
 *   crackle ─ high-pass ───────┘                                    │
 *   white ─ band-pass ─ hiss ───────────────────────────────────────┘
 *
 * Every buffer is stereo with independent channels, so the burn sounds wide, not centred.
 * Works on any BaseAudioContext, so the same voice renders offline for a listening demo.
 */
export class RocketVoice {
  private readonly ctx: BaseAudioContext;
  private readonly brown: AudioBuffer;
  private readonly pink: AudioBuffer;
  private readonly crackleBuf: AudioBuffer;
  private readonly body: GainNode;
  private readonly rumbleFilter: BiquadFilterNode;
  private readonly rumbleGain: GainNode;
  private readonly roarFilter: BiquadFilterNode;
  private readonly roarGain: GainNode;
  private readonly crackleSrc: AudioBufferSourceNode;
  private readonly crackleGain: GainNode;
  private readonly hissFilter: BiquadFilterNode;
  private readonly hissGain: GainNode;
  private readonly flutterDepth: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(ctx: BaseAudioContext, destination: AudioNode, rand: Rand) {
    this.ctx = ctx;
    const rate = ctx.sampleRate;
    // Trim so a full burn sits about where the old engine did against the music.
    const out = ctx.createGain();
    out.gain.value = 0.8;
    out.connect(destination);
    this.brown = stereo(ctx, (n) => brownNoise(n, rand), rate * 3);
    this.pink = stereo(ctx, (n) => pinkNoise(n, rand), rate * 3);
    this.crackleBuf = stereo(ctx, (n) => crackle(n, rate, 70, rand), rate * 3);
    const white = stereo(ctx, (n) => new Float32Array(n).map(() => rand() * 2 - 1), rate * 2);

    // Body: flutter → saturation → a gentle top cut.
    this.body = ctx.createGain();
    const flutter = ctx.createGain();
    flutter.gain.value = 1;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(1024, 2.5) as Float32Array<ArrayBuffer>;
    shaper.oversample = '2x';
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 7000;
    tone.Q.value = 0.5;
    this.body.connect(flutter).connect(shaper).connect(tone).connect(out);

    // Combustion flutter: two unrelated fast LFOs and a slow one, summed into the body's gain.
    this.flutterDepth = ctx.createGain();
    this.flutterDepth.gain.value = 0;
    this.flutterDepth.connect(flutter.gain);
    for (const [freq, level] of [[9.3, 0.5], [13.7, 0.35], [2.1, 0.25]] as const) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      lfo.connect(g).connect(this.flutterDepth);
      this.sources.push(lfo);
    }

    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.Q.value = 0.9;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.loop(this.brown).connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.body);

    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.Q.value = 0.7;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    this.loop(this.pink).connect(this.roarFilter).connect(this.roarGain).connect(this.body);

    const crackleHp = ctx.createBiquadFilter();
    crackleHp.type = 'highpass';
    crackleHp.frequency.value = 600;
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.crackleSrc = this.loop(this.crackleBuf);
    this.crackleSrc.connect(crackleHp).connect(this.crackleGain).connect(this.body);

    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.Q.value = 0.9;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.loop(white).connect(this.hissFilter).connect(this.hissGain).connect(out);

    this.set(0, 0, 0, 0);
  }

  private loop(buffer: AudioBuffer): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.sources.push(src);
    return src;
  }

  start(at = this.ctx.currentTime): void {
    for (const s of this.sources) s.start(at);
  }

  /** thrust 0..1, boost 0..1; `tau` is the smoothing time constant in seconds. */
  set(thrust: number, boost: number, at = this.ctx.currentTime, tau = 0.12): void {
    const m = rocketMix(thrust, boost);
    const to = (p: AudioParam, v: number) => (tau > 0 ? p.setTargetAtTime(v, at, tau) : p.setValueAtTime(v, at));
    to(this.rumbleGain.gain, m.rumbleGain);
    to(this.rumbleFilter.frequency, m.rumbleCutoff);
    to(this.roarGain.gain, m.roarGain);
    to(this.roarFilter.frequency, m.roarFreq);
    to(this.crackleGain.gain, m.crackleGain);
    to(this.crackleSrc.playbackRate, m.crackleRate);
    to(this.hissGain.gain, m.hissGain);
    to(this.hissFilter.frequency, m.hissFreq);
    to(this.flutterDepth.gain, m.flutter);
  }

  /** The burn lighting up: a low whump of flame. `strength` 1 for the main engine, more for boost. */
  ignite(at = this.ctx.currentTime, strength = 1): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(140, at);
    lp.frequency.exponentialRampToValueAtTime(700 + 500 * (strength - 1), at + 0.12);
    lp.frequency.exponentialRampToValueAtTime(180, at + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.3 * strength, at + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.0);
    src.connect(lp).connect(g).connect(this.body);
    src.start(at, Math.random() * 2);
    src.stop(at + 1.05);

    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(75, at);
    thump.frequency.exponentialRampToValueAtTime(32, at + 0.45);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, at);
    tg.gain.exponentialRampToValueAtTime(0.22 * strength, at + 0.02);
    tg.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    thump.connect(tg).connect(this.body);
    thump.start(at);
    thump.stop(at + 0.55);

    if (strength > 1) this.pops(at + 0.05, 0.7, 0.18 * strength, 1.8);
  }

  /** The burn going out: a short chuff and a few last pops. */
  cutoff(at = this.ctx.currentTime): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1100, at);
    lp.frequency.exponentialRampToValueAtTime(120, at + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.1, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    src.connect(lp).connect(g).connect(this.body);
    src.start(at, Math.random() * 2);
    src.stop(at + 0.5);
    this.pops(at + 0.08, 0.35, 0.09, 1.1);
  }

  /** A slice of the crackle loop, for the bursts of pops on ignition and cut-off. */
  private pops(at: number, length: number, level: number, rate: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.crackleBuf;
    src.playbackRate.value = rate;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.connect(hp).connect(g).connect(this.body);
    src.start(at, Math.random() * 2);
    src.stop(at + length + 0.05);
  }
}

function stereo(ctx: BaseAudioContext, make: (n: number) => Float32Array, length: number): AudioBuffer {
  const n = Math.floor(length);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  buf.copyToChannel(make(n) as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(make(n) as Float32Array<ArrayBuffer>, 1);
  return buf;
}
