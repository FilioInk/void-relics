import { ARTIFACT_COUNT } from '../world/generate.ts';

/** Which relics have been found in this system, and how long the hunt has taken so far. */
export type Progress = { seed: number; found: string[]; elapsed: number; finishedAt: number | null };

export const PICKUP_RADIUS = 70;

export function createProgress(seed: number): Progress {
  return { seed, found: [], elapsed: 0, finishedAt: null };
}

/** Marks an artifact found. Returns true only the first time, so nothing is counted twice. */
export function collect(p: Progress, id: string): boolean {
  if (p.found.includes(id)) return false;
  p.found.push(id);
  if (p.found.length >= ARTIFACT_COUNT && p.finishedAt === null) p.finishedAt = p.elapsed;
  return true;
}

export const isComplete = (p: Progress): boolean => p.found.length >= ARTIFACT_COUNT;

export function storageKey(seed: number): string {
  return `void-relics:v1:${seed}`;
}

/** Reads saved progress back, rejecting anything that does not look like ours. */
export function parseProgress(raw: string | null, seed: number, validIds: ReadonlySet<string>): Progress {
  const fresh = createProgress(seed);
  if (!raw) return fresh;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return fresh;
    const d = data as Record<string, unknown>;
    if (d['seed'] !== seed || !Array.isArray(d['found'])) return fresh;
    const found = [...new Set(d['found'].filter((x): x is string => typeof x === 'string' && validIds.has(x)))];
    const elapsed = typeof d['elapsed'] === 'number' && Number.isFinite(d['elapsed']) && d['elapsed'] >= 0 ? d['elapsed'] : 0;
    const finishedAt = typeof d['finishedAt'] === 'number' && Number.isFinite(d['finishedAt']) ? d['finishedAt'] : null;
    return { seed, found, elapsed, finishedAt: found.length >= ARTIFACT_COUNT ? (finishedAt ?? elapsed) : null };
  } catch {
    return fresh;
  }
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
