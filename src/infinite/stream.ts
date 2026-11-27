import * as THREE from 'three';
import type { Target } from '../game/targets.ts';
import { createAsteroids, type AsteroidView } from '../render/asteroids.ts';
import { createDebris } from '../render/debris.ts';
import { createMegastructure } from '../render/megastructures.ts';
import { createNebulae } from '../render/nebula.ts';
import { createPlanet } from '../render/planets.ts';
import { createSun } from '../render/sun.ts';
import { createWrecks } from '../render/wrecks.ts';
import type { Asteroid, Vec3 } from '../world/generate.ts';
import { fieldRocks, type Path, type Segment, type Thing } from './director.ts';

/**
 * Turns a segment of the infinite flight into scene objects, one thing at a time, using the
 * same builders as the star system. Everything is built around its own centre and then moved
 * into place relative to the current origin, so vertex and instance data stay small numbers
 * however far the flight goes; `rebase` moves it all when the origin jumps.
 */

/** A star the camera might look at: for exposure, mood and the key light. */
export type StarRef = { position: THREE.Vector3; radius: number };
/** A nebula the ship might fly through: for fog and tint. Centre in absolute coordinates. */
export type NebulaRef = { center: Vec3; radius: number; colors: [number, number] };

export type Chunk = {
  segment: Segment;
  /** One job per thing; run them a few per frame. */
  jobs: Array<() => void>;
  objects: THREE.Object3D[];
  updaters: Array<(dt: number, t: number, camera: THREE.Camera) => void>;
  /** Breakable rocks, positions absolute, and how to make one disappear. */
  targets: Target[];
  hide: Map<Target, () => void>;
  stars: StarRef[];
  nebulae: NebulaRef[];
  /** World-space vectors baked into shaders (sun and ring centres), moved on a rebase. */
  vectors: Set<THREE.Vector3>;
};

export type StreamContext = {
  scene: THREE.Scene;
  path: Path;
  envMap: THREE.Texture | null;
  seed: number;
  /** The current origin: absolute minus origin is scene coordinates. */
  origin: THREE.Vector3;
  /** Called for each new object, e.g. to compile its shaders before it shows. */
  added(object: THREE.Object3D): void;
};

const local = (p: Vec3, origin: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(p[0] - origin.x, p[1] - origin.y, p[2] - origin.z);

export function planChunk(segment: Segment, ctx: StreamContext): Chunk {
  const chunk: Chunk = { segment, jobs: [], objects: [], updaters: [], targets: [], hide: new Map(), stars: [], nebulae: [], vectors: new Set() };
  const put = (o: THREE.Object3D, at: Vec3) => {
    o.position.copy(local(at, ctx.origin));
    ctx.scene.add(o);
    chunk.objects.push(o);
    ctx.added(o);
  };
  for (const thing of segment.things) chunk.jobs.push(() => build(thing, segment, chunk, ctx, put));
  return chunk;
}

function build(thing: Thing, segment: Segment, chunk: Chunk, ctx: StreamContext, put: (o: THREE.Object3D, at: Vec3) => void): void {
  switch (thing.type) {
    case 'rocks': {
      const rocks = fieldRocks(thing, ctx.path, segment.index);
      const c = thing.center;
      const localRocks: Asteroid[] = rocks.map((r) => ({ ...r, position: [r.position[0] - c[0], r.position[1] - c[1], r.position[2] - c[2]] }));
      const view: AsteroidView = createAsteroids(localRocks, ctx.seed);
      put(view.group, c);
      rocks.forEach((r, i) => {
        const t: Target = { position: r.position, radius: r.radius * 0.92, kind: 'rock', ref: i };
        chunk.targets.push(t);
        chunk.hide.set(t, () => view.hide(i));
      });
      break;
    }
    case 'nebula': {
      const view = createNebulae([{ id: 'n', name: '', center: [0, 0, 0], radius: thing.radius, colors: thing.colors, puffs: thing.puffs, seed: thing.seed }], ctx.seed);
      put(view.group, thing.center);
      chunk.updaters.push((dt, t) => view.update(t, dt));
      chunk.nebulae.push({ center: thing.center, radius: thing.radius, colors: thing.colors });
      break;
    }
    case 'planet': {
      const sun = local(thing.sun, ctx.origin);
      const view = createPlanet({ ...thing.planet, position: [0, 0, 0] }, sun);
      // createPlanet places the group at the planet and keeps the sun and ring centre as
      // world-space uniforms; both have to follow the planet into scene coordinates.
      put(view.group, thing.planet.position);
      chunk.vectors.add(sun);
      view.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        const center = m?.uniforms?.['uCenter']?.value as THREE.Vector3 | undefined;
        if (center && !chunk.vectors.has(center)) {
          center.copy(view.group.position);
          chunk.vectors.add(center);
        }
      });
      chunk.updaters.push((_dt, t) => view.update(t));
      break;
    }
    case 'star': {
      const view = createSun({ position: [0, 0, 0], radius: thing.radius, heatRadius: thing.radius, warnRadius: thing.radius, color: thing.color, name: thing.name });
      // One key light for the whole flight instead: a light per star would recompile every material.
      view.group.remove(view.light);
      put(view.group, thing.position);
      chunk.updaters.push((_dt, t, camera) => view.update(t, camera));
      chunk.stars.push({ position: view.group.position, radius: thing.radius });
      break;
    }
    case 'wreck': {
      const view = createWrecks([{ id: 'w', name: '', position: [0, 0, 0], size: thing.size, pieces: thing.pieces, seed: thing.seed }]);
      put(view.group, thing.position);
      chunk.updaters.push((_dt, t) => view.update(t));
      break;
    }
    case 'gate':
    case 'habitat':
    case 'lattice': {
      const view = createMegastructure(thing, ctx.envMap);
      put(view.group, thing.center);
      chunk.updaters.push((dt, t) => view.update(t, dt));
      break;
    }
    case 'station':
    case 'graveyard': {
      const view =
        thing.type === 'station'
          ? createDebris([{ id: 's', name: '', kind: thing.kind, position: [0, 0, 0], size: thing.size, pieces: thing.pieces, seed: thing.seed }], [], [], ctx.envMap, thing.seed)
          : createDebris([], [{ id: 'g', name: '', center: [0, 0, 0], radius: thing.radius, satellites: thing.satellites, seed: thing.seed }], [], ctx.envMap, thing.seed);
      put(view.group, thing.type === 'station' ? thing.position : thing.center);
      chunk.updaters.push((dt, t) => view.update(t, dt));
      break;
    }
  }
}

/** Moves everything a chunk drew by -shift (the origin moved by +shift). */
export function rebaseChunk(chunk: Chunk, shift: THREE.Vector3): void {
  for (const o of chunk.objects) o.position.sub(shift);
  // Star positions are the group positions themselves, already moved above.
  for (const v of chunk.vectors) v.sub(shift);
}

/** Frees the GPU memory of a chunk's objects, sparing textures shared with the rest of the game. */
export function disposeChunk(chunk: Chunk, scene: THREE.Scene): void {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  for (const root of chunk.objects) {
    scene.remove(root);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const m of mats) {
        materials.add(m);
        for (const value of Object.values(m as unknown as Record<string, unknown>)) if (value instanceof THREE.Texture) textures.add(value);
        const uniforms = (m as THREE.ShaderMaterial).uniforms;
        if (uniforms) for (const u of Object.values(uniforms)) if (u.value instanceof THREE.Texture) textures.add(u.value);
      }
    });
  }
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const t of textures) if (!t.userData['shared']) t.dispose();
  chunk.objects.length = 0;
}
