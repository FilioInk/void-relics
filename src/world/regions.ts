import { dist, junkNormal, type Nebula, type Vec3, type World } from './generate.ts';

/** Where the ship is, for the location banner and the music. */
export type RegionKind = 'star' | 'wreck' | 'station' | 'graveyard' | 'nebula' | 'field' | 'junk' | 'belt' | 'planet' | 'deep';
export type Region = { kind: RegionKind; id: string; name: string | null };

export function regionAt(p: Vec3, world: World): Region {
  const { sun } = world;
  if (dist(p, sun.position) < sun.warnRadius * 1.25) return { kind: 'star', id: 'star', name: sun.name };
  for (const w of world.wrecks) if (dist(p, w.position) < w.size * 8) return { kind: 'wreck', id: w.id, name: w.name };
  for (const s of world.stations) if (dist(p, s.position) < s.size * 6) return { kind: 'station', id: s.id, name: s.name };
  for (const g of world.graveyards) if (dist(p, g.center) < g.radius * 2) return { kind: 'graveyard', id: g.id, name: g.name };
  for (const n of world.nebulae) if (dist(p, n.center) < n.radius * 0.8) return { kind: 'nebula', id: n.id, name: n.name };
  for (const c of world.clusters) if (dist(p, c.center) < c.radius * 1.05) return { kind: 'field', id: c.id, name: c.name };
  const ring = world.junk;
  if (ring) {
    const d = dist(p, ring.center);
    const n = junkNormal(ring);
    const off = Math.abs((p[0] - ring.center[0]) * n[0] + (p[1] - ring.center[1]) * n[1] + (p[2] - ring.center[2]) * n[2]);
    const planet = world.planets.find((x) => x.id === ring.planetId);
    if (planet && d > ring.inner * 0.92 && d < ring.outer * 1.08 && off < (ring.outer - ring.inner) * 0.6)
      return { kind: 'junk', id: ring.id, name: planet.name };
  }
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
