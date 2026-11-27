import * as THREE from 'three';
import { createRng } from '../core/rng.ts';
import type { Bolt, LootKind } from '../game/targets.ts';
import { WEAPON } from '../game/weapons.ts';
import { FRAG_HEAD, FRAG_TAIL, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/**
 * Everything the lasers draw: the bolts themselves, sparks where they hit, rock fragments and
 * dust when something breaks, muzzle flashes, salvage drifting free, and the stone shells
 * that seal some relics. All pooled: nothing is allocated per shot.
 */

const BOLT_POOL = 128;
const SPARK_POOL = 600;
const FRAGMENT_POOL = 220;
const PUFF_POOL = 40;
const BOLT_LENGTH = 24;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const MUZZLE_COLOR = new THREE.Color(2, 0.35, 0.22);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const BOLT_SCALE = new THREE.Vector3();
const HALO_SCALE = new THREE.Vector3();

function softTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

type Fragment = { p: THREE.Vector3; v: THREE.Vector3; axis: THREE.Vector3; spin: number; size: number; life: number; max: number; color: THREE.Color };
type Puff = { sprite: THREE.Sprite; life: number; max: number; from: number; to: number; alpha: number };
type LootItem = { kind: LootKind; root: THREE.Group; v: THREE.Vector3; age: number };

export type CombatFx = {
  group: THREE.Group;
  /** Draws the bolts in flight. */
  setBolts(bolts: readonly Bolt[]): void;
  sparks(at: THREE.Vector3, normal: THREE.Vector3, count: number, color: THREE.Color): void;
  /** A breaking rock or piece of debris: tumbling fragments and a dust cloud. */
  shatter(at: THREE.Vector3, radius: number, color: THREE.Color): void;
  muzzle(at: THREE.Vector3): void;
  /** Salvage floating free at a point; returns a handle the game moves and collects. */
  spawnLoot(kind: LootKind, at: THREE.Vector3, drift: THREE.Vector3): LootItem;
  removeLoot(item: LootItem): void;
  /** Shells around sealed relics; hide one when it breaks. */
  addShell(ref: number, at: THREE.Vector3, radius: number, hue: number): void;
  hideShell(ref: number): void;
  update(dt: number, time: number): void;
};

export type { LootItem };

export function createCombatFx(): CombatFx {
  const group = new THREE.Group();
  const soft = softTexture();

  // --- bolts: long glowing rods, red like a blaster's --------------------------------------
  const boltGeo = new THREE.CylinderGeometry(0.32, 0.32, 1, 6, 1);
  boltGeo.rotateX(Math.PI / 2);
  const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.55, 0.35), toneMapped: true });
  const boltMesh = new THREE.InstancedMesh(boltGeo, boltMat, BOLT_POOL);
  boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  boltMesh.frustumCulled = false;
  boltMesh.count = 0;
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.12, 0.08), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const haloGeo = new THREE.CylinderGeometry(0.9, 0.9, 1, 6, 1);
  haloGeo.rotateX(Math.PI / 2);
  const haloMesh = new THREE.InstancedMesh(haloGeo, haloMat, BOLT_POOL);
  haloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  haloMesh.frustumCulled = false;
  haloMesh.count = 0;
  group.add(boltMesh, haloMesh);

  // --- sparks: points with their own velocity and life ------------------------------------
  const sparkPos = new Float32Array(SPARK_POOL * 3);
  const sparkCol = new Float32Array(SPARK_POOL * 3);
  const sparkAlpha = new Float32Array(SPARK_POOL);
  const sparkVel = new Float32Array(SPARK_POOL * 3);
  const sparkLife = new Float32Array(SPARK_POOL);
  const sparkMax = new Float32Array(SPARK_POOL).fill(1);
  let sparkNext = 0;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('sparkColor', new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('alpha', new THREE.BufferAttribute(sparkAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const sparkMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${VERT_HEAD}
      attribute vec3 sparkColor;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = sparkColor;
        vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = alpha > 0.0 ? clamp(900.0 / -mv.z, 1.5, 7.0) : 0.0;
        ${VERT_TAIL}
      }`,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float a = exp(-dot(q, q) * 3.0) * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor * a, a);
        ${FRAG_TAIL}
      }`,
  });
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  sparkPoints.frustumCulled = false;
  group.add(sparkPoints);

  // --- fragments: crumpled stones that tumble away and shrink ------------------------------
  const fragGeo = new THREE.IcosahedronGeometry(1, 0);
  {
    const rng = createRng(0xf2a6);
    const pos = fragGeo.getAttribute('position') as THREE.BufferAttribute;
    const seen = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let s = seen.get(k);
      if (s === undefined) {
        s = rng.range(0.6, 1.25);
        seen.set(k, s);
      }
      pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.8, pos.getZ(i) * s);
    }
    fragGeo.computeVertexNormals();
  }
  const fragMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.1, flatShading: true });
  const fragMesh = new THREE.InstancedMesh(fragGeo, fragMat, FRAGMENT_POOL);
  fragMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fragMesh.frustumCulled = false;
  for (let i = 0; i < FRAGMENT_POOL; i++) {
    fragMesh.setMatrixAt(i, HIDDEN);
    fragMesh.setColorAt(i, new THREE.Color(0.5, 0.5, 0.5));
  }
  group.add(fragMesh);
  const fragments: Array<Fragment | null> = Array.from({ length: FRAGMENT_POOL }, () => null);
  let fragNext = 0;

  // --- puffs: dust clouds and muzzle flashes ------------------------------------------------
  const puffs: Puff[] = Array.from({ length: PUFF_POOL }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, transparent: true, depthWrite: false, opacity: 0 }));
    sprite.visible = false;
    group.add(sprite);
    return { sprite, life: 0, max: 1, from: 1, to: 1, alpha: 0 };
  });
  let puffNext = 0;
  const puff = (at: THREE.Vector3, color: THREE.Color, from: number, to: number, life: number, alpha: number, additive: boolean) => {
    const p = puffs[puffNext]!;
    puffNext = (puffNext + 1) % PUFF_POOL;
    const m = p.sprite.material;
    m.color.copy(color);
    m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.needsUpdate = true;
    p.sprite.position.copy(at);
    p.sprite.visible = true;
    Object.assign(p, { life: life, max: life, from, to, alpha });
  };

  // --- loot and shells ------------------------------------------------------------------------
  const loot = new Set<LootItem>();
  const crystalGeo = new THREE.OctahedronGeometry(2.2, 0);
  crystalGeo.scale(0.7, 1.4, 0.7);
  const coreGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
  const lootMats: Record<LootKind, THREE.MeshStandardMaterial> = {
    crystal: new THREE.MeshStandardMaterial({ color: 0x0b2a2a, emissive: new THREE.Color(0.3, 1.6, 1.4), metalness: 0.4, roughness: 0.2, flatShading: true }),
    core: new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: new THREE.Color(1.8, 0.9, 0.2), metalness: 0.7, roughness: 0.3 }),
  };
  const lootGlow: Record<LootKind, THREE.SpriteMaterial> = {
    crystal: new THREE.SpriteMaterial({ map: soft, color: new THREE.Color(0.3, 1.5, 1.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    core: new THREE.SpriteMaterial({ map: soft, color: new THREE.Color(1.6, 0.8, 0.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  };

  const shells = new Map<number, THREE.Mesh>();
  const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05, flatShading: true, side: THREE.DoubleSide });

  const emitSparks = (at: THREE.Vector3, normal: THREE.Vector3, count: number, color: THREE.Color): void => {
    for (let k = 0; k < count; k++) {
      const i = sparkNext;
      sparkNext = (sparkNext + 1) % SPARK_POOL;
      sparkPos.set([at.x, at.y, at.z], i * 3);
      // A cone of sparks thrown back off the surface.
      const r = tmpV.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.8).add(normal).normalize();
      const speed = 40 + Math.random() * 160;
      sparkVel.set([r.x * speed, r.y * speed, r.z * speed], i * 3);
      const life = 0.25 + Math.random() * 0.5;
      sparkLife[i] = life;
      sparkMax[i] = life;
      const w = 0.7 + Math.random() * 0.6;
      sparkCol.set([color.r * w, color.g * w, color.b * w], i * 3);
    }
  };

  return {
    group,
    setBolts(bolts) {
      const n = Math.min(BOLT_POOL, bolts.length);
      for (let i = 0; i < n; i++) {
        const b = bolts[i]!;
        tmpV.set(b.vx, b.vy, b.vz);
        const speed = tmpV.length();
        tmpV.divideScalar(speed || 1);
        tmpQ.setFromUnitVectors(Z, tmpV);
        // The rod trails behind the bolt's head, but never further back than the muzzle:
        // a fresh bolt grows out of the barrel instead of poking back at the camera.
        const len = Math.max(0.5, Math.min(BOLT_LENGTH, (WEAPON.boltLife - b.life) * speed));
        const p = tmpS.set(b.x, b.y, b.z).addScaledVector(tmpV, -len / 2);
        tmpM.compose(p, tmpQ, BOLT_SCALE.set(1, 1, len));
        boltMesh.setMatrixAt(i, tmpM);
        tmpM.compose(p, tmpQ, HALO_SCALE.set(1, 1, len * 1.1));
        haloMesh.setMatrixAt(i, tmpM);
      }
      boltMesh.count = haloMesh.count = n;
      boltMesh.instanceMatrix.needsUpdate = haloMesh.instanceMatrix.needsUpdate = true;
    },
    sparks: (at, normal, count, color) => emitSparks(at, normal, count, color),
    shatter(at, radius, color) {
      const count = Math.max(4, Math.min(14, Math.round(radius / 6)));
      for (let k = 0; k < count; k++) {
        const i = fragNext;
        fragNext = (fragNext + 1) % FRAGMENT_POOL;
        const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        const life = 3 + Math.random() * 2.5;
        fragments[i] = {
          p: at.clone().addScaledVector(dir, radius * 0.4 * Math.random()),
          v: dir.multiplyScalar(12 + Math.random() * 45 + radius * 0.2),
          axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
          spin: 0.5 + Math.random() * 3,
          size: radius * (0.18 + Math.random() * 0.25),
          life,
          max: life,
          color: color.clone().multiplyScalar(0.7 + Math.random() * 0.5),
        };
        fragMesh.setColorAt(i, fragments[i]!.color);
      }
      if (fragMesh.instanceColor) fragMesh.instanceColor.needsUpdate = true;
      puff(at, new THREE.Color(0.55, 0.52, 0.5), radius * 1.5, radius * 5, 2.6, 0.45, false);
      puff(at, new THREE.Color(2.2, 1.2, 0.6), radius * 0.6, radius * 2.4, 0.35, 0.9, true);
      emitSparks(at, new THREE.Vector3(0, 0, 0), Math.min(60, 16 + radius), new THREE.Color(2.5, 1.4, 0.6));
    },
    muzzle(at) {
      puff(at, MUZZLE_COLOR, 1, 2.2, 0.06, 0.6, true);
    },
    spawnLoot(kind, at, drift) {
      const root = new THREE.Group();
      root.position.copy(at);
      root.add(new THREE.Mesh(kind === 'crystal' ? crystalGeo : coreGeo, lootMats[kind]));
      const glow = new THREE.Sprite(lootGlow[kind]);
      glow.scale.setScalar(14);
      root.add(glow);
      group.add(root);
      const item: LootItem = { kind, root, v: drift.clone(), age: 0 };
      loot.add(item);
      return item;
    },
    removeLoot(item) {
      loot.delete(item);
      group.remove(item.root);
    },
    addShell(ref, at, radius, hue) {
      // A hollow ball of dark stone with holes in it, so the relic's light leaks out.
      const rng = createRng(ref * 7919 + 13);
      const geo = new THREE.IcosahedronGeometry(radius, 2).toNonIndexed();
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const seen = new Map<string, number>();
      for (let i = 0; i < pos.count; i++) {
        const k = `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
        let s = seen.get(k);
        if (s === undefined) {
          s = rng.range(0.85, 1.12);
          seen.set(k, s);
        }
        pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s);
      }
      const keep: number[] = [];
      const tris = pos.count / 3;
      for (let t = 0; t < tris; t++) if (!rng.chance(0.14)) keep.push(t);
      const out = new Float32Array(keep.length * 9);
      const col = new Float32Array(keep.length * 9);
      const vein = new THREE.Color().setHSL(0.45 + hue * 0.4, 0.9, 0.6).multiplyScalar(1.4);
      keep.forEach((t, j) => {
        for (let v = 0; v < 3; v++) {
          out.set([pos.getX(t * 3 + v), pos.getY(t * 3 + v), pos.getZ(t * 3 + v)], (j * 3 + v) * 3);
        }
        // Most faces are stone; a few glow with the relic's colour, like veins.
        const c = rng.chance(0.12) ? vein : new THREE.Color().setScalar(rng.range(0.16, 0.26));
        for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], (j * 3 + v) * 3);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(out, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, shellMat);
      mesh.position.copy(at);
      mesh.rotation.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
      shells.set(ref, mesh);
      group.add(mesh);
    },
    hideShell(ref) {
      const m = shells.get(ref);
      if (m) {
        group.remove(m);
        shells.delete(ref);
      }
    },
    update(dt, time) {
      // Sparks.
      for (let i = 0; i < SPARK_POOL; i++) {
        if (sparkLife[i]! <= 0) {
          sparkAlpha[i] = 0;
          continue;
        }
        sparkLife[i]! -= dt;
        const k = Math.max(0, sparkLife[i]! / sparkMax[i]!);
        sparkAlpha[i] = k;
        sparkPos[i * 3] = sparkPos[i * 3]! + sparkVel[i * 3]! * dt;
        sparkPos[i * 3 + 1] = sparkPos[i * 3 + 1]! + sparkVel[i * 3 + 1]! * dt;
        sparkPos[i * 3 + 2] = sparkPos[i * 3 + 2]! + sparkVel[i * 3 + 2]! * dt;
      }
      for (const name of ['position', 'sparkColor', 'alpha']) sparkGeo.getAttribute(name).needsUpdate = true;

      // Fragments.
      for (let i = 0; i < FRAGMENT_POOL; i++) {
        const f = fragments[i];
        if (!f) continue;
        f.life -= dt;
        if (f.life <= 0) {
          fragments[i] = null;
          fragMesh.setMatrixAt(i, HIDDEN);
          continue;
        }
        f.p.addScaledVector(f.v, dt);
        const shrink = Math.min(1, f.life / 1.2);
        tmpQ.setFromAxisAngle(f.axis, f.spin * (f.max - f.life));
        tmpM.compose(f.p, tmpQ, tmpS.setScalar(f.size * shrink));
        fragMesh.setMatrixAt(i, tmpM);
      }
      fragMesh.instanceMatrix.needsUpdate = true;

      // Puffs.
      for (const p of puffs) {
        if (!p.sprite.visible) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.sprite.visible = false;
          continue;
        }
        const k = 1 - p.life / p.max;
        p.sprite.scale.setScalar(p.from + (p.to - p.from) * (1 - (1 - k) * (1 - k)));
        p.sprite.material.opacity = p.alpha * (1 - k);
      }

      // Loot bobs and spins; the game moves it.
      for (const it of loot) {
        it.age += dt;
        it.root.position.addScaledVector(it.v, dt);
        const mesh = it.root.children[0]!;
        mesh.rotation.y = time * 1.4;
        mesh.rotation.x = Math.sin(time * 0.9 + it.age) * 0.4;
        (it.root.children[1] as THREE.Sprite).scale.setScalar(12 + 3 * Math.sin(time * 4 + it.age * 2));
      }
    },
  };
}
