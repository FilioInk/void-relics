import * as THREE from 'three';
import { createNoise3, fbm3 } from '../core/noise.ts';
import { createRng } from '../core/rng.ts';
import { ASTEROID_VARIANTS, type Asteroid } from '../world/generate.ts';

/**
 * A handful of lumpy rock shapes made by pushing an icosphere around with noise, drawn as
 * instanced meshes. Rocks are bucketed into spatial chunks so whole chunks behind the camera
 * are culled.
 */

function rockGeometry(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const noise = createNoise3(seed);
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const stretch = new THREE.Vector3(rng.range(0.9, 1.35), rng.range(0.6, 0.95), rng.range(0.75, 1.1));
  const freq = rng.range(1.1, 1.8);
  const craterDirs = Array.from({ length: rng.int(3, 7) }, () => new THREE.Vector3(...rng.onSphere()));
  const craterSize = craterDirs.map(() => rng.range(0.15, 0.4));
  const v = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1 + 0.38 * fbm3(noise, v.x * freq, v.y * freq, v.z * freq, 4) + 0.06 * fbm3(noise, v.x * 6, v.y * 6, v.z * 6, 2);
    craterDirs.forEach((d, k) => {
      const ang = v.angleTo(d);
      const s = craterSize[k] as number;
      if (ang < s) {
        const t = ang / s;
        r -= 0.12 * (1 - t * t) - (t > 0.8 ? 0.05 * (t - 0.8) * 5 : 0);
      }
    });
    v.multiplyScalar(r).multiply(stretch);
    pos.setXYZ(i, v.x, v.y, v.z);
    const shade = 0.72 + 0.28 * fbm3(noise, v.x * 3 + 9, v.y * 3, v.z * 3, 3) + 0.15 * (r - 1);
    colors.set([shade, shade * 0.97, shade * 0.93], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export type AsteroidView = { group: THREE.Group; dispose(): void };

const CHUNK = 9000;

export function createAsteroids(rocks: Asteroid[], seed: number): AsteroidView {
  const group = new THREE.Group();
  const geos = Array.from({ length: ASTEROID_VARIANTS }, (_, i) => rockGeometry(seed * 31 + i * 977));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.04, flatShading: true });

  // chunk key → variant → rocks
  const buckets = new Map<string, Asteroid[][]>();
  for (const r of rocks) {
    const key = `${Math.floor(r.position[0] / CHUNK)},${Math.floor(r.position[1] / CHUNK)},${Math.floor(r.position[2] / CHUNK)}`;
    let b = buckets.get(key);
    if (!b) {
      b = Array.from({ length: ASTEROID_VARIANTS }, () => []);
      buckets.set(key, b);
    }
    b[r.variant]!.push(r);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const rng = createRng(seed ^ 0xa57);
  const tints = [0x9a9188, 0x8a7d70, 0x7d8088, 0xa08a74, 0x6e6a66];
  for (const variants of buckets.values()) {
    variants.forEach((list, variant) => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(geos[variant]!, material, list.length);
      list.forEach((r, i) => {
        e.set(...r.rotation);
        q.setFromEuler(e);
        s.setScalar(r.radius);
        p.set(...r.position);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        c.set(rng.pick(tints)).multiplyScalar(r.shade);
        mesh.setColorAt(i, c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    });
  }

  return {
    group,
    dispose() {
      geos.forEach((g) => g.dispose());
      material.dispose();
    },
  };
}
