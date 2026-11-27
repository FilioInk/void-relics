/**
 * Rolling frame statistics for the ?perf=1 overlay and the benchmark helper in ?debug=1.
 * A fixed-size ring per metric, so a long session costs no memory and nothing is allocated
 * per frame; percentiles are only computed when a summary is read.
 */

export class Rolling {
  private readonly values: Float64Array;
  private count = 0;
  private next = 0;

  constructor(size: number) {
    this.values = new Float64Array(Math.max(1, Math.floor(size)));
  }

  /** Non-finite or negative samples (a hidden tab, a clock hiccup) are dropped. */
  push(v: number): void {
    if (!Number.isFinite(v) || v < 0) return;
    this.values[this.next] = v;
    this.next = (this.next + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }

  clear(): void {
    this.count = 0;
    this.next = 0;
  }

  get size(): number {
    return this.count;
  }

  summary(): Summary {
    if (this.count === 0) return { avg: NaN, p95: NaN, max: NaN, n: 0 };
    const v = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
    let sum = 0;
    for (const x of v) sum += x;
    return { avg: sum / v.length, p95: percentile(v, 0.95), max: v[v.length - 1]!, n: v.length };
  }
}

export type Summary = { avg: number; p95: number; max: number; n: number };

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil(Math.min(1, Math.max(0, q)) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

export type PerfReport = {
  fps: number;
  frameMs: Summary;
  cpuMs: Summary;
  /** Null when the browser has no GPU timer queries. */
  gpuMs: Summary | null;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
};

export type RendererCounts = Pick<PerfReport, 'calls' | 'triangles' | 'programs' | 'geometries' | 'textures' | 'pixelRatio'>;

export class PerfStats {
  readonly frame: Rolling;
  readonly cpu: Rolling;
  readonly gpu: Rolling;
  gpuSupported = false;
  counts: RendererCounts = { calls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, pixelRatio: 1 };

  constructor(size = 240) {
    this.frame = new Rolling(size);
    this.cpu = new Rolling(size);
    this.gpu = new Rolling(size);
  }

  reset(): void {
    this.frame.clear();
    this.cpu.clear();
    this.gpu.clear();
  }

  report(): PerfReport {
    const frameMs = this.frame.summary();
    return {
      fps: frameMs.n > 0 && frameMs.avg > 0 ? 1000 / frameMs.avg : NaN,
      frameMs,
      cpuMs: this.cpu.summary(),
      gpuMs: this.gpuSupported ? this.gpu.summary() : null,
      ...this.counts,
    };
  }
}

const fixed = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '–');

/** 5 520 000 → "5.52M", 41 200 → "41.2k". */
export function compactCount(n: number): string {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** The overlay's text: developer-facing, so it stays out of the game's string table. */
export function formatReport(r: PerfReport): string[] {
  const gpu = r.gpuMs ? `GPU ${fixed(r.gpuMs.avg, 2)} ms (p95 ${fixed(r.gpuMs.p95, 2)})` : 'GPU n/a';
  return [
    `FPS ${fixed(r.fps)}  frame ${fixed(r.frameMs.avg, 2)} ms (p95 ${fixed(r.frameMs.p95, 2)})`,
    `CPU ${fixed(r.cpuMs.avg, 2)} ms (p95 ${fixed(r.cpuMs.p95, 2)})  ${gpu}`,
    `calls ${r.calls}  tris ${compactCount(r.triangles)}  programs ${r.programs}`,
    `geo ${r.geometries}  tex ${r.textures}  dpr ${fixed(r.pixelRatio, 2)}`,
  ];
}
