import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, type Rng } from '../core/rng.ts';
import type { Wreck } from '../world/generate.ts';

/**
 * A derelict: a ship hull assembled from boxes and cylinders along its spine, then broken
 * into drifting pieces with exposed ribs, dead windows that still flicker, and a debris cloud.
 */

export type Collider = { position: [number, number, number]; radius: number };

type Part = { geo: THREE.BufferGeometry; z: number };

export function painted(geo: THREE.BufferGeometry, color: THREE.Color, rng: Rng): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  // Per-face soot and scorch.
  for (let i = 0; i < n; i += 3) {
    const burn = rng.chance(0.18) ? rng.range(0.15, 0.45) : rng.range(0.75, 1.05);
    for (let k = 0; k < 3; k++) colors.set([color.r * burn, color.g * burn, color.b * burn], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

function buildHull(rng: Rng, length: number): { hull: Part[]; windows: Part[] } {
  const hull: Part[] = [];
  const windows: Part[] = [];
  const base = new THREE.Color().setHSL(rng.range(0, 1), rng.range(0.05, 0.2), rng.range(0.32, 0.48));
  const accent = new THREE.Color().setHSL(rng.pick([0.02, 0.08, 0.55, 0.6]), 0.55, 0.38);
  const segments = rng.int(4, 6);
  const segLen = length / segments;
  let width = length * rng.range(0.12, 0.18);
  for (let i = 0; i < segments; i++) {
    const z = -length / 2 + (i + 0.5) * segLen;
    const w = width * rng.range(0.8, 1.25);
    const h = w * rng.range(0.55, 0.9);
    const box = new THREE.BoxGeometry(w, h, segLen * 0.96);
    box.translate(0, 0, z);
    hull.push({ geo: painted(box, rng.chance(0.25) ? accent : base, rng), z });
    // Ribs around the segment.
    const rib = new THREE.BoxGeometry(w * 1.12, h * 1.12, segLen * 0.08);
    rib.translate(0, 0, z + segLen * 0.45);
    hull.push({ geo: painted(rib, base.clone().multiplyScalar(0.7), rng), z });
    // A row of windows on each flank.
    if (rng.chance(0.7)) {
      for (const side of [-1, 1]) {
        const win = new THREE.BoxGeometry(0.4, h * 0.08, segLen * 0.7);
        win.translate(side * (w / 2 + 0.1), h * 0.15, z);
        windows.push({ geo: win, z });
      }
    }
    // Side pods and antennae.
    if (rng.chance(0.4)) {
      const pod = new THREE.CylinderGeometry(w * 0.18, w * 0.18, segLen * 0.8, 10);
      pod.rotateX(Math.PI / 2);
      pod.translate(rng.pick([-1, 1]) * (w * 0.62), -h * 0.2, z);
      hull.push({ geo: painted(pod, accent, rng), z });
    }
    width *= rng.range(0.9, 1.08);
  }
  // Bridge tower near the front.
  const tw = width * 0.45;
  const tower = new THREE.BoxGeometry(tw, tw * 0.8, segLen * 0.9);
  tower.translate(0, width * 0.55, -length * 0.3);
  hull.push({ geo: painted(tower, base, rng), z: -length * 0.3 });
  const bridgeWin = new THREE.BoxGeometry(tw * 0.9, tw * 0.12, 0.5);
  bridgeWin.translate(0, width * 0.62, -length * 0.3 - segLen * 0.46);
  windows.push({ geo: bridgeWin, z: -length * 0.3 });
  // Engines at the back.
  const engines = rng.int(2, 4);
  for (let i = 0; i < engines; i++) {
    const r = width * rng.range(0.14, 0.22);
    const eng = new THREE.CylinderGeometry(r, r * 1.25, segLen * 0.9, 14, 1, true);
    eng.rotateX(Math.PI / 2);
    const ang = (i / engines) * Math.PI * 2 + 0.4;
    eng.translate(Math.cos(ang) * width * 0.35, Math.sin(ang) * width * 0.25, length / 2 + segLen * 0.3);
    hull.push({ geo: painted(eng, base.clone().multiplyScalar(0.6), rng), z: length / 2 });
  }
  return { hull, windows };
}

export type WreckView = { group: THREE.Group; colliders: Collider[]; update(t: number): void };

export function createWrecks(wrecks: Wreck[]): WreckView {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.55, flatShading: true, side: THREE.DoubleSide });
  const windowMats: THREE.MeshStandardMaterial[] = [];
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x666a70, metalness: 0.6, roughness: 0.5, flatShading: true });
  const sparks: Array<{ mat: THREE.SpriteMaterial; phase: number }> = [];
  const sparkTex = makeSparkTexture();

  for (const w of wrecks) {
    const rng = createRng(w.seed);
    const site = new THREE.Group();
    site.position.set(...w.position);
    site.rotation.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
    const { hull, windows } = buildHull(rng, w.size);

    // Slice the hull into pieces along its spine.
    const cuts = Array.from({ length: w.pieces - 1 }, () => rng.range(-w.size * 0.4, w.size * 0.4)).sort((a, b) => a - b);
    const pieceOf = (z: number) => cuts.filter((c) => z > c).length;
    const winMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color().setHSL(rng.pick([0.05, 0.1, 0.55]), 0.9, 0.55), emissiveIntensity: 2 });
    windowMats.push(winMat);

    for (let k = 0; k < w.pieces; k++) {
      const parts = hull.filter((p) => pieceOf(p.z) === k).map((p) => p.geo);
      const wins = windows.filter((p) => pieceOf(p.z) === k).map((p) => p.geo);
      if (parts.length === 0) continue;
      const piece = new THREE.Group();
      const merged = mergeGeometries(parts, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const center = merged.boundingSphere!.center.clone();
      merged.translate(-center.x, -center.y, -center.z);
      piece.add(new THREE.Mesh(merged, hullMat));
      if (wins.length > 0) {
        const wm = mergeGeometries(wins, false);
        if (wm) {
          wm.translate(-center.x, -center.y, -center.z);
          piece.add(new THREE.Mesh(wm, winMat));
        }
      }
      // Drift the piece away from the break and give it a tumble.
      const drift = new THREE.Vector3(...rng.onSphere()).multiplyScalar(w.size * rng.range(0.15, 0.6));
      piece.position.copy(center).add(drift);
      piece.rotation.set(rng.range(-0.6, 0.6), rng.range(-0.6, 0.6), rng.range(-0.6, 0.6));
      site.add(piece);
      // A spark where the metal tore.
      if (rng.chance(0.6)) {
        const mat = new THREE.SpriteMaterial({ map: sparkTex, color: new THREE.Color(1.0, 0.7, 0.4).multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        const s = new THREE.Sprite(mat);
        s.scale.setScalar(w.size * 0.12);
        s.position.set(rng.range(-1, 1) * w.size * 0.05, rng.range(-1, 1) * w.size * 0.05, rng.pick([-1, 1]) * w.size * 0.12);
        piece.add(s);
        sparks.push({ mat, phase: rng.range(0, 10) });
      }
      site.updateMatrixWorld(true);
      const wp = piece.getWorldPosition(new THREE.Vector3());
      colliders.push({ position: [wp.x, wp.y, wp.z], radius: merged.boundingSphere!.radius * 0.55 });
    }

    // Debris cloud.
    const debrisCount = rng.int(40, 80);
    const debrisGeo = new THREE.TetrahedronGeometry(1, 0);
    const debris = new THREE.InstancedMesh(debrisGeo, debrisMat, debrisCount);
    const m = new THREE.Matrix4();
    for (let i = 0; i < debrisCount; i++) {
      const [x, y, z] = rng.inSphere();
      const s = rng.range(0.4, 3.5) * (w.size / 100);
      m.compose(
        new THREE.Vector3(x * w.size * 1.4, y * w.size * 0.8, z * w.size * 1.4),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6))),
        new THREE.Vector3(s, s * rng.range(0.2, 1), s * rng.range(0.5, 2)),
      );
      debris.setMatrixAt(i, m);
    }
    debris.computeBoundingSphere();
    site.add(debris);
    group.add(site);
  }

  return {
    group,
    colliders,
    update(t) {
      windowMats.forEach((m, i) => {
        // Dying power: mostly steady, with sudden brownouts.
        const f = Math.sin(t * 2.1 + i * 1.7) * Math.sin(t * 5.3 + i);
        m.emissiveIntensity = f > 0.85 ? 0.2 : 1.6 + 0.4 * Math.sin(t * 13 + i);
      });
      for (const s of sparks) {
        const k = Math.sin(t * 9 + s.phase) * Math.sin(t * 23 + s.phase * 2);
        s.mat.opacity = k > 0.5 ? 1 : 0.05;
      }
    },
  };
}

function makeSparkTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,200,120,0.8)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
