import type { Vec3, World } from '../world/generate.ts';

/**
 * Four fixed places to measure frame time at, derived from the world so every seed has them:
 * the spawn point, the heart of the first nebula, the inner edge of the belt looking along it,
 * and a hair outside the star's heat zone looking at the star. `__vr.spot(name)` in ?debug=1
 * flies there.
 */
export type BenchSpotName = 'spawn' | 'nebula' | 'belt' | 'star';
export type BenchSpot = { name: BenchSpotName; position: Vec3; lookAt: Vec3 };

export const BENCH_SPOTS: readonly BenchSpotName[] = ['spawn', 'nebula', 'belt', 'star'];

export function benchSpot(world: World, name: BenchSpotName): BenchSpot {
  switch (name) {
    case 'spawn':
      return { name, position: [...world.spawn.position], lookAt: [...world.spawn.lookAt] };
    case 'nebula': {
      const n = world.nebulae[0];
      if (!n) return benchSpot(world, 'spawn');
      // A third of the way in from the edge the gas is at full density, looking at the core.
      const position: Vec3 = [n.center[0], n.center[1], n.center[2] + n.radius * 0.3];
      return { name, position, lookAt: [...n.center] };
    }
    case 'belt': {
      // Just inside the inner edge, looking a quarter radian along the arc: the belt fills the view.
      const { belt } = world;
      const a = Math.atan2(world.spawn.position[2], world.spawn.position[0]);
      const r = belt.inner - 600;
      const mid = (belt.inner + belt.outer) / 2;
      return {
        name,
        position: [Math.cos(a) * r, 0, Math.sin(a) * r],
        lookAt: [Math.cos(a + 0.25) * mid, 0, Math.sin(a + 0.25) * mid],
      };
    }
    case 'star': {
      // On the spawn side, 1.15× the heat radius out: the disc fills most of the view, no damage.
      const { sun } = world;
      const s = world.spawn.position;
      const d: Vec3 = [s[0] - sun.position[0], s[1] - sun.position[1], s[2] - sun.position[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const k = (sun.heatRadius * 1.15) / len;
      return {
        name,
        position: [sun.position[0] + d[0] * k, sun.position[1] + d[1] * k, sun.position[2] + d[2] * k],
        lookAt: [...sun.position],
      };
    }
  }
}
