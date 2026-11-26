import { dist, type Nebula, type Vec3, type World } from './generate.ts';
import type { ProperName } from './names.ts';

/** Where the ship is, for the location banner and the music. */
export type RegionKind = 'star' | 'wreck' | 'nebula' | 'field' | 'belt' | 'planet' | 'deep';
export type Region = { kind: RegionKind; id: string; name: ProperName | null };

export function regionAt(p: Vec3, world: World): Region {
  const { sun } = world;
  if (dist(p, sun.position) < sun.warnRadius * 1.25) return { kind: 'star', id: 'star', name: sun.name };
  for (const w of world.wrecks) if (dist(p, w.position) < w.size * 8) return { kind: 'wreck', id: w.id, name: w.name };
  for (const n of world.nebulae) if (dist(p, n.center) < n.radius * 0.8) return { kind: 'nebula', id: n.id, name: n.name };
  for (const c of world.clusters) if (dist(p, c.center) < c.radius * 1.05) return { kind: 'field', id: c.id, name: c.name };
  const r = Math.hypot(p[0], p[2]);
  if (r > world.belt.inner - 300 && r < world.belt.outer + 300 && Math.abs(p[1]) < world.belt.thickness * 2.5)
    return { kind: 'belt', id: 'belt', name: world.belt.name };
  for (const pl of world.planets) if (dist(p, pl.position) < pl.radius * 4) return { kind: 'planet', id: pl.id, name: pl.name };
  return { kind: 'deep', id: 'deep', name: null };
}

/** 0 outside every nebula, rising to 1 deep inside one; also which one, for the tint. */
export function nebulaDensityAt(p: Vec3, nebulae: readonly Nebula[]): { density: number; nebula: Nebula | null } {
  let best = 0;
  let which: Nebula | null = null;
  for (const n of nebulae) {
    const k = Math.max(0, Math.min(1, (n.radius * 0.9 - dist(p, n.center)) / (n.radius * 0.6)));
    if (k > best) {
      best = k;
      which = n;
    }
  }
  return { density: best, nebula: which };
}

/** The scanner sees relics this far away; nebula gas cuts the range in half at the core. */
export const SCAN_RANGE = 6500;
export const scanRange = (nebulaDensity: number): number => SCAN_RANGE * (1 - 0.5 * nebulaDensity);
