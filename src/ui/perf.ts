import { formatReport, type PerfReport } from './perfStats.ts';
import { h } from './dom.ts';

/** ?perf=1: a small corner readout of frame timing and renderer counters, refreshed 4×/s. */
export type PerfOverlay = { el: HTMLElement; update(report: () => PerfReport, dt: number): void };

export function createPerfOverlay(): PerfOverlay {
  const lines = Array.from({ length: 4 }, () => h('div'));
  const el = h('div', { class: 'perf-overlay passive' }, ...lines);
  let wait = 0;
  return {
    el,
    update(report, dt) {
      wait -= dt;
      if (wait > 0) return;
      wait = 0.25;
      formatReport(report()).forEach((text, i) => {
        const line = lines[i];
        if (line && line.textContent !== text) line.textContent = text;
      });
    },
  };
}
