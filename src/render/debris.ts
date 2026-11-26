import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, type Rng } from '../core/rng.ts';
import { JUNK_VARIANTS, type Graveyard, type Junk, type Station } from '../world/generate.ts';
import { FRAG_HEAD, FRAG_TAIL, VERT_HEAD, VERT_TAIL } from './glsl.ts';
import { painted, type Collider } from './wrecks.ts';

/**
 * Orbital debris: broken stations (a truss spine with modules and solar wings, or a torn wheel),
 * graveyards of dead satellites, and loose junk — panel shards, truss, tanks, crumpled foil.
 *
 * Stations are a few merged meshes per drifting piece. Satellites are a handful of seeded
 * templates drawn as instanced meshes, so a hundred of them cost a few draw calls; they tumble
 * by rewriting their instance matrices each frame. Junk is static and instanced.
 */

type Mat = 'hull' | 'panel' | 'foil' | 'glow' | 'beacon';
const MATS: readonly Mat[] = ['hull', 'panel', 'foil', 'glow', 'beacon'];

/** A bit of a station; `key` is where it sits along the spine (or its angle on a wheel). */
type Part = { geo: THREE.BufferGeometry; mat: Mat; key: number };

export type DebrisView = { group: THREE.Group; colliders: Collider[]; update(t: number, dt: number): void };

// --- materials ----------------------------------------------------------------------------

/** Solar cells: dark blue squares with silver bus lines, some cells dead. Tiles by world size. */
function panelTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9aa3ad';
  g.fillRect(0, 0, 256, 256);
  const n = 4;
  const cell = 256 / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dead = rng.chance(0.08);
      const l = dead ? rng.range(6, 10) : rng.range(14, 22);
      const grad = g.createLinearGradient(x * cell, y * cell, (x + 1) * cell, (y + 1) * cell);
      grad.addColorStop(0, `hsl(${rng.range(222, 236)}, 55%, ${l + 6}%)`);
      grad.addColorStop(1, `hsl(${rng.range(222, 236)}, 60%, ${l}%)`);
      g.fillStyle = grad;
      g.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
      // Fine fingers across each cell.
      g.strokeStyle = 'rgba(190,200,215,0.18)';
      g.lineWidth = 1;
      for (let k = 1; k < 8; k++) {
        g.beginPath();
        g.moveTo(x * cell + 2, y * cell + (k * cell) / 8);
        g.lineTo((x + 1) * cell - 2, y * cell + (k * cell) / 8);
        g.stroke();
      }
    }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function materials(envMap: THREE.Texture | null, seed: number): Record<Mat, THREE.Material> {
  return {
    hull: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.55, flatShading: true, envMap, envMapIntensity: 0.7 }),
    panel: new THREE.MeshStandardMaterial({ map: panelTexture(seed), metalness: 0.5, roughness: 0.3, envMap, envMapIntensity: 1.3, side: THREE.DoubleSide }),
    foil: new THREE.MeshStandardMaterial({ color: 0xd9a646, metalness: 1, roughness: 0.3, flatShading: true, envMap, envMapIntensity: 1.4 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.5, 1.5, 1.5) }),
    beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.35, 0.25) }),
  };
}

// --- geometry helpers ---------------------------------------------------------------------

/** Every part of one material must share attributes to merge: non-indexed, and uv only on panels. */
function bare(geo: THREE.BufferGeometry, keepUv = false): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!keepUv) g.deleteAttribute('uv');
  if (g.getAttribute('color')) g.deleteAttribute('color');
  return g;
}

function tinted(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const g = bare(geo);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A flat solar blanket in the XZ plane, its cells sized in metres whatever the panel's size. */
function blanket(span: number, width: number, cell: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(span, width);
  g.rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (span / cell), uv.getY(i) * (width / cell));
  return bare(g, true);
}

/** Crumpled: every vertex nudged by an amount that depends only on where it is, so seams stay shut. */
function crumple(geo: THREE.BufferGeometry, amount: number, rng: Rng): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = seen.get(k);
    if (!d) {
      d = [rng.range(-amount, amount), rng.range(-amount, amount), rng.range(-amount, amount)];
      seen.set(k, d);
    }
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A dish: a lathed paraboloid opening toward +Y. */
function dish(radius: number, depth: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * radius;
    pts.push(new THREE.Vector2(x, (x * x * depth) / (radius * radius)));
  }
  return new THREE.LatheGeometry(pts, 20);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const b = new THREE.BoxGeometry(w, h, d);
  b.translate(x, y, z);
  return b;
}

// --- stations -----------------------------------------------------------------------------

function spineStation(rng: Rng, size: number): Part[] {
  const parts: Part[] = [];
  const half = size / 2;
  const white = new THREE.Color().setHSL(rng.range(0.55, 0.65), rng.range(0.03, 0.1), rng.range(0.6, 0.72));
  const steel = new THREE.Color().setHSL(0.6, 0.06, 0.38);
  const accent = new THREE.Color().setHSL(rng.pick([0.04, 0.08, 0.58]), 0.6, 0.45);
  const windowColor = new THREE.Color().setHSL(rng.pick([0.1, 0.13, 0.55]), 0.7, 0.6);

  // Square truss down the spine, built in bays so the station can break between them.
  const side = size * 0.06;
  const bar = side * 0.1;
  const bay = side * 1.5;
  for (let z = -half; z < half - 1e-6; z += bay) {
    const zc = z + bay / 2;
    const g: THREE.BufferGeometry[] = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) g.push(box(bar, bar, bay, (sx * side) / 2, (sy * side) / 2, zc));
    g.push(box(side, bar, bar, 0, -side / 2, z), box(side, bar, bar, 0, side / 2, z), box(bar, side, bar, -side / 2, 0, z), box(bar, side, bar, side / 2, 0, z));
    const diag = new THREE.BoxGeometry(bar * 0.7, bar * 0.7, Math.hypot(side, bay));
    diag.rotateY(Math.atan2(side, bay) * (rng.chance(0.5) ? 1 : -1));
    diag.translate(0, rng.pick([-1, 1]) * (side / 2), zc);
    g.push(diag);
    parts.push({ geo: painted(mergeGeometries(g.map((x) => x.toNonIndexed()), false)!, steel, rng), mat: 'hull', key: zc });
  }

  // Pressurised modules, on the spine or hung off its side.
  const modules = rng.int(3, 5);
  for (let i = 0; i < modules; i++) {
    const r = size * rng.range(0.045, 0.07);
    const len = size * rng.range(0.13, 0.22);
    const z = -half * 0.75 + ((i + 0.5) / modules) * size * 0.75 + rng.range(-1, 1) * size * 0.04;
    const offAxis = i > 0 && rng.chance(0.5);
    const ox = offAxis ? rng.pick([-1, 1]) * (r + side * 0.6) : 0;
    const body = new THREE.CylinderGeometry(r, r, len, 18, 1, true);
    body.rotateX(Math.PI / 2);
    body.translate(ox, 0, z);
    const capA = new THREE.SphereGeometry(r, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    capA.scale(1, 0.45, 1);
    capA.rotateX(-Math.PI / 2);
    const capB = capA.clone();
    capA.translate(ox, 0, z - len / 2);
    capB.rotateX(Math.PI);
    capB.translate(ox, 0, z + len / 2);
    const band = new THREE.CylinderGeometry(r * 1.04, r * 1.04, len * 0.08, 18, 1, true);
    band.rotateX(Math.PI / 2);
    band.translate(ox, 0, z + len * rng.range(-0.3, 0.3));
    parts.push({ geo: painted(body, white, rng), mat: 'hull', key: z });
    parts.push({ geo: painted(capA, white.clone().multiplyScalar(0.9), rng), mat: 'hull', key: z });
    parts.push({ geo: painted(capB, white.clone().multiplyScalar(0.9), rng), mat: 'hull', key: z });
    parts.push({ geo: painted(band, accent, rng), mat: 'hull', key: z });
    // A row of lit portholes on the flank that still has power.
    if (rng.chance(0.65)) {
      const win: THREE.BufferGeometry[] = [];
      const count = Math.max(3, Math.floor(len / (r * 0.6)));
      for (let k = 0; k < count; k++) win.push(box(r * 0.12, r * 0.14, r * 0.2, ox + r * 0.99, r * 0.15, z - len * 0.4 + (k / (count - 1)) * len * 0.8));
      parts.push({ geo: tinted(mergeGeometries(win.map((x) => x.toNonIndexed()), false)!, windowColor), mat: 'glow', key: z });
    }
  }

  // Solar wings: a mast out to each side, two blankets on it. Some torn off, some bent.
  const wings = rng.int(2, 3);
  for (let i = 0; i < wings; i++) {
    const z = -half * 0.85 + ((i + 0.5) / wings) * size * 0.85 * 1.1;
    const span = size * rng.range(0.18, 0.28);
    const width = size * rng.range(0.05, 0.08);
    for (const sx of [-1, 1]) {
      if (rng.chance(0.25)) continue;
      const mast = box(span + side, bar * 1.4, bar * 1.4, sx * ((span + side) / 2 + side / 2), 0, z);
      parts.push({ geo: painted(mast, steel, rng), mat: 'hull', key: z });
      const bend = rng.chance(0.35) ? rng.range(0.25, 1.1) : 0;
      for (const dz of [-1, 1]) {
        const p = blanket(span, width, 4);
        p.translate(sx * (side + span / 2 + bar), 0, dz * (width / 2 + bar * 2));
        // A bent wing folds about its mast, which runs along X through the origin here.
        if (bend) p.rotateX(bend * dz * rng.range(0.6, 1));
        p.translate(0, 0, z);
        parts.push({ geo: p, mat: 'panel', key: z });
      }
      parts.push({ geo: bare(new THREE.SphereGeometry(bar * 2, 6, 4).translate(sx * (side + span + bar * 2), 0, z)), mat: 'beacon', key: z });
    }
  }

  // Radiators: pale fins standing off the spine.
  for (let i = 0; i < rng.int(1, 2); i++) {
    const z = rng.range(-half * 0.6, half * 0.6);
    for (const sy of [-1, 1]) {
      const fin = box(bar * 0.5, size * 0.1, size * 0.07, 0, sy * (side / 2 + size * 0.05), z);
      parts.push({ geo: painted(fin, white.clone().multiplyScalar(1.1), rng), mat: 'hull', key: z });
    }
  }

  // A dish on a boom near one end, and docking collars at both.
  const dz = half * rng.range(0.6, 0.9) * rng.pick([-1, 1]);
  const d = dish(size * 0.05, size * 0.02);
  d.rotateZ(Math.PI / 2 + rng.range(-0.5, 0.5));
  d.translate(-side / 2 - size * 0.06, size * 0.03, dz);
  parts.push({ geo: painted(d, white, rng), mat: 'hull', key: dz });
  for (const end of [-1, 1]) {
    const collar = new THREE.TorusGeometry(side * 0.55, bar * 1.5, 6, 16);
    collar.translate(0, 0, end * half);
    parts.push({ geo: painted(collar, accent, rng), mat: 'hull', key: end * half * 0.98 });
    parts.push({ geo: bare(new THREE.SphereGeometry(bar * 2.2, 6, 4).translate(0, side * 0.6, end * half)), mat: 'beacon', key: end * half * 0.98 });
  }
  return parts;
}

/** A wheel station: a torn ring of habitat, spokes to a hub with a solar mast. Keys are angles; the hub is -1. */
function ringStation(rng: Rng, size: number): Part[] {
  const parts: Part[] = [];
  const R = size * 0.42;
  const tube = size * 0.04;
  const white = new THREE.Color().setHSL(rng.range(0.55, 0.65), rng.range(0.03, 0.1), rng.range(0.58, 0.7));
  const steel = new THREE.Color().setHSL(0.6, 0.06, 0.38);
  const accent = new THREE.Color().setHSL(rng.pick([0.04, 0.08, 0.58]), 0.6, 0.45);
  const windowColor = new THREE.Color().setHSL(rng.pick([0.1, 0.13, 0.55]), 0.7, 0.6);
  const arcs = rng.int(12, 16);
  const step = (Math.PI * 2) / arcs;
  const missing = new Set(Array.from({ length: rng.int(1, 3) }, () => rng.int(0, arcs - 1)));
  for (let i = 0; i < arcs; i++) {
    if (missing.has(i)) continue;
    const a0 = i * step;
    const arc = new THREE.TorusGeometry(R, tube, 10, 8, step * 0.97);
    arc.rotateZ(a0);
    parts.push({ geo: painted(arc, rng.chance(0.15) ? accent : white, rng), mat: 'hull', key: a0 + step / 2 });
    const rib = new THREE.TorusGeometry(R, tube * 1.15, 10, 1, step * 0.06);
    rib.rotateZ(a0);
    parts.push({ geo: painted(rib, steel, rng), mat: 'hull', key: a0 + step / 2 });
    if (rng.chance(0.6)) {
      const win: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 4; k++) {
        const a = a0 + ((k + 0.5) / 4) * step * 0.9;
        const w = new THREE.BoxGeometry(tube * 0.18, tube * 0.2, tube * 0.3);
        w.rotateZ(a);
        w.translate(Math.cos(a) * (R + tube * 0.95), Math.sin(a) * (R + tube * 0.95), 0);
        win.push(w.toNonIndexed());
      }
      parts.push({ geo: tinted(mergeGeometries(win, false)!, windowColor), mat: 'glow', key: a0 + step / 2 });
    }
  }
  // Hub along the axis, spokes out to the rim (some snapped short).
  const hub = new THREE.CylinderGeometry(size * 0.07, size * 0.07, size * 0.3, 16);
  hub.rotateX(Math.PI / 2);
  parts.push({ geo: painted(hub, white, rng), mat: 'hull', key: -1 });
  const spokes = rng.int(3, 4);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const len = (R - size * 0.07) * (rng.chance(0.3) ? rng.range(0.35, 0.75) : 1);
    const s = new THREE.CylinderGeometry(tube * 0.35, tube * 0.35, len, 8);
    s.translate(0, size * 0.07 + len / 2, 0);
    s.rotateZ(a - Math.PI / 2);
    parts.push({ geo: painted(s, steel, rng), mat: 'hull', key: -1 });
  }
  for (const end of [-1, 1]) {
    const collar = new THREE.TorusGeometry(size * 0.05, tube * 0.3, 6, 16);
    collar.translate(0, 0, end * size * 0.15);
    parts.push({ geo: painted(collar, accent, rng), mat: 'hull', key: -1 });
    parts.push({ geo: bare(new THREE.SphereGeometry(tube * 0.35, 6, 4).translate(0, size * 0.075, end * size * 0.15)), mat: 'beacon', key: -1 });
  }
  // Solar mast across one end of the hub.
  const span = size * rng.range(0.25, 0.35);
  const mz = size * 0.2 * rng.pick([-1, 1]);
  parts.push({ geo: painted(box(span * 2, tube * 0.25, tube * 0.25, 0, 0, mz), steel, rng), mat: 'hull', key: -1 });
  for (const sx of [-1, 1]) {
    if (rng.chance(0.2)) continue;
    const p = blanket(span * 0.9, size * 0.07, 4);
    p.rotateX(rng.chance(0.3) ? rng.range(0.3, 0.9) : 0);
    p.translate(sx * span * 0.55, 0, mz);
    parts.push({ geo: p, mat: 'panel', key: -1 });
  }
  return parts;
}

/** Splits a station's parts into the pieces that drift apart. */
function slice(parts: Part[], kind: Station['kind'], pieces: number, rng: Rng, size: number): Part[][] {
  const out: Part[][] = Array.from({ length: pieces }, () => []);
  if (kind === 'spine') {
    const cuts = Array.from({ length: pieces - 1 }, () => rng.range(-size * 0.4, size * 0.4)).sort((a, b) => a - b);
    for (const p of parts) out[cuts.filter((c) => p.key > c).length]!.push(p);
  } else {
    // The hub keeps its spokes; the rim tears into arcs that fly outward.
    const cuts = Array.from({ length: pieces - 1 }, () => rng.range(0, Math.PI * 2)).sort((a, b) => a - b);
    for (const p of parts) {
      if (p.key < 0) out[0]!.push(p);
      else {
        const k = cuts.filter((c) => p.key > c).length % (pieces - 1);
        out[1 + k]!.push(p);
      }
    }
  }
  return out.filter((list) => list.length > 0);
}

type Spinner = { obj: THREE.Object3D; axis: THREE.Vector3; rate: number };

function buildStation(s: Station, mats: Record<Mat, THREE.Material>, colliders: Collider[], spinners: Spinner[]): THREE.Group {
  const rng = createRng(s.seed);
  const site = new THREE.Group();
  site.position.set(...s.position);
  site.rotation.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
  const parts = s.kind === 'spine' ? spineStation(rng, s.size) : ringStation(rng, s.size);
  for (const list of slice(parts, s.kind, Math.max(2, s.pieces), rng, s.size)) {
    const piece = new THREE.Group();
    const merged: Array<[Mat, THREE.BufferGeometry]> = [];
    for (const m of MATS) {
      const geos = list.filter((p) => p.mat === m).map((p) => p.geo);
      if (geos.length === 0) continue;
      const g = mergeGeometries(geos, false);
      if (g) merged.push([m, g]);
    }
    if (merged.length === 0) continue;
    const bounds = new THREE.Box3();
    for (const [, g] of merged) {
      g.computeBoundingBox();
      bounds.union(g.boundingBox!);
    }
    const center = bounds.getCenter(new THREE.Vector3());
    let radius = 0;
    for (const [m, g] of merged) {
      g.translate(-center.x, -center.y, -center.z);
      g.computeBoundingSphere();
      radius = Math.max(radius, g.boundingSphere!.center.length() + g.boundingSphere!.radius);
      piece.add(new THREE.Mesh(g, mats[m]));
    }
    // Away from the break: outward for a torn wheel, any way for a broken spine.
    const away = s.kind === 'ring' && center.lengthSq() > 1 ? center.clone().normalize() : new THREE.Vector3(...rng.onSphere());
    away.add(new THREE.Vector3(...rng.onSphere()).multiplyScalar(0.4)).normalize();
    piece.position.copy(center).addScaledVector(away, s.size * rng.range(0.08, 0.35));
    piece.rotation.set(rng.range(-0.5, 0.5), rng.range(-0.5, 0.5), rng.range(-0.5, 0.5));
    site.add(piece);
    spinners.push({ obj: piece, axis: new THREE.Vector3(...rng.onSphere()), rate: rng.range(0.004, 0.018) * rng.pick([-1, 1]) });
    site.updateMatrixWorld(true);
    const wp = piece.getWorldPosition(new THREE.Vector3());
    colliders.push({ position: [wp.x, wp.y, wp.z], radius: radius * 0.5 });
  }
  return site;
}

// --- satellites ---------------------------------------------------------------------------

type Template = { geos: Partial<Record<Mat, THREE.BufferGeometry>>; core: number };

function satelliteTemplate(rng: Rng): Template {
  const by: Partial<Record<Mat, THREE.BufferGeometry[]>> = {};
  const add = (m: Mat, g: THREE.BufferGeometry) => (by[m] ??= []).push(g);
  const w = rng.range(1.6, 3);
  const h = rng.range(1.6, 3);
  const d = rng.range(2, 4);
  const dark = new THREE.Color().setHSL(0.6, 0.05, rng.range(0.2, 0.3));
  const white = new THREE.Color().setHSL(0.6, 0.04, rng.range(0.6, 0.75));
  // Bus: gold foil blanket or painted panels.
  if (rng.chance(0.6)) add('foil', bare(crumple(new THREE.BoxGeometry(w, h, d, 4, 4, 4), Math.min(w, h) * 0.035, rng)));
  else add('hull', painted(new THREE.BoxGeometry(w, h, d), white, rng));
  // Solar wings on masts along ±X; dead ones lose a wing or have it folded.
  const span = rng.range(3.5, 8);
  const width = rng.range(1.3, 2.4);
  const tilt = rng.range(0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    if (sx > 0 && rng.chance(0.3)) continue;
    add('hull', painted(box(1.2, 0.12, 0.12, sx * (w / 2 + 0.6), 0, 0), dark, rng));
    const p = blanket(span, width, 1);
    p.rotateX(tilt + (rng.chance(0.25) ? rng.range(0.4, 1.2) : 0));
    p.translate(sx * (w / 2 + 1.2 + span / 2), 0, 0);
    add('panel', p);
  }
  // A dish on top, a feed in front of it.
  if (rng.chance(0.75)) {
    const r = rng.range(0.6, 1.5);
    const dd = dish(r, r * 0.35);
    dd.translate(0, h / 2 + 0.25, 0);
    add('hull', painted(dd, white, rng));
    add('hull', painted(new THREE.CylinderGeometry(0.04, 0.04, r * 0.9, 5).translate(0, h / 2 + 0.25 + r * 0.45, 0), dark, rng));
  }
  // Whip antennas and four little thrusters at the back.
  for (let i = 0; i < rng.int(1, 3); i++) {
    const len = rng.range(1.5, 4);
    const a = new THREE.CylinderGeometry(0.025, 0.025, len, 4);
    a.translate(0, len / 2, 0);
    a.rotateX(rng.range(-1.2, 1.2));
    a.rotateZ(rng.range(-1.2, 1.2));
    a.translate(rng.range(-w, w) * 0.4, h / 2, rng.range(-d, d) * 0.4);
    add('hull', painted(a, white, rng));
  }
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const n = new THREE.ConeGeometry(0.14, 0.35, 8, 1, true);
    n.rotateX(-Math.PI / 2);
    n.translate((sx * w) / 2.6, (sy * h) / 2.6, -d / 2 - 0.15);
    add('hull', painted(n, dark, rng));
  }
  const geos: Partial<Record<Mat, THREE.BufferGeometry>> = {};
  for (const m of MATS) {
    const list = by[m];
    if (list && list.length > 0) geos[m] = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false) ?? undefined;
  }
  return { geos, core: Math.max(w, h, d) * 0.6 };
}

type SatInstance = { template: number; index: number; position: THREE.Vector3; scale: number; base: THREE.Quaternion; axis: THREE.Vector3; rate: number };

// --- junk ---------------------------------------------------------------------------------

function junkGeometry(variant: number, rng: Rng): { geo: THREE.BufferGeometry; mat: Mat } {
  switch (variant % JUNK_VARIANTS) {
    case 0: {
      // A jagged shard of solar panel.
      const shape = new THREE.Shape();
      const n = rng.int(5, 7);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = rng.range(0.3, 0.6);
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.7);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.7);
      }
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      return { geo: bare(g, true), mat: 'panel' };
    }
    case 1: {
      // A length of truss.
      const parts = [box(0.08, 0.08, 1, -0.12, 0, 0), box(0.08, 0.08, 1, 0.12, 0, 0), box(0.32, 0.06, 0.06, 0, 0, -0.3), box(0.32, 0.06, 0.06, 0, 0, 0.3)];
      return { geo: painted(mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!, new THREE.Color(0.55, 0.57, 0.6), rng), mat: 'hull' };
    }
    case 2: {
      // A propellant tank.
      const body = new THREE.CylinderGeometry(0.28, 0.28, 0.7, 12, 1, true);
      const a = new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.35, 0);
      const b = new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -0.35, 0);
      return { geo: painted(mergeGeometries([body, a, b].map((p) => p.toNonIndexed()), false)!, new THREE.Color(0.8, 0.8, 0.78), rng), mat: 'hull' };
    }
    default:
      // A crumpled wad of foil.
      return { geo: bare(crumple(new THREE.IcosahedronGeometry(0.45, 1), 0.12, rng)), mat: 'foil' };
  }
}

// --- glints -------------------------------------------------------------------------------

/**
 * Metal catching the sun: a faint point per piece that only shows from afar, where the piece
 * itself is smaller than a pixel. It is what makes the junk ring read as a band from orbit.
 */
function glints(points: THREE.Vector3[], seed: number): { points: THREE.Points; time: { value: number } } {
  const rng = createRng(seed);
  const pos = new Float32Array(points.length * 3);
  const phase = new Float32Array(points.length);
  points.forEach((p, i) => {
    pos.set([p.x, p.y, p.z], i * 3);
    phase[i] = rng.range(0, 100);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const time = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: time },
    vertexShader: /* glsl */ `
      ${VERT_HEAD}
      attribute float phase;
      uniform float uTime;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = length(mv.xyz);
        // Hidden up close where the mesh shows, fading out again far beyond the scanner.
        float far = 1.0 - smoothstep(9000.0, 16000.0, d);
        float glint = pow(max(0.0, sin(uTime * 0.7 + phase)), 24.0);
        vA = smoothstep(700.0, 1800.0, d) * far * (0.55 + 1.4 * glint);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 2.2;
        ${VERT_TAIL}
      }`,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float a = exp(-dot(q, q) * 3.0) * vA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(0.95, 0.93, 0.88) * a, a);
        ${FRAG_TAIL}
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { points: pts, time };
}

// --- assembly -----------------------------------------------------------------------------

export function createDebris(stations: Station[], graveyards: Graveyard[], junk: Junk[], envMap: THREE.Texture | null, seed: number): DebrisView {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const mats = materials(envMap, seed ^ 0x5017);
  const spinners: Spinner[] = [];

  for (const s of stations) group.add(buildStation(s, mats, colliders, spinners));

  // Satellites: a few templates for the whole system, instanced.
  const trng = createRng(seed ^ 0x5a7e);
  const templates = Array.from({ length: 6 }, () => satelliteTemplate(trng));
  const sats: SatInstance[] = [];
  const perTemplate = templates.map(() => 0);
  for (const g of graveyards) {
    const rng = createRng(g.seed);
    for (let i = 0; i < g.satellites; i++) {
      const template = rng.int(0, templates.length - 1);
      const [x, y, z] = rng.inSphere();
      const scale = rng.range(1.8, 3.4);
      const position = new THREE.Vector3(g.center[0] + x * g.radius, g.center[1] + y * g.radius, g.center[2] + z * g.radius);
      const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)));
      sats.push({ template, index: perTemplate[template]!++, position, scale, base, axis: new THREE.Vector3(...rng.onSphere()), rate: rng.range(0.02, 0.12) * rng.pick([-1, 1]) });
      colliders.push({ position: [position.x, position.y, position.z], radius: templates[template]!.core * scale });
    }
  }
  const satMeshes: THREE.InstancedMesh[][] = templates.map((tpl, k) => {
    const meshes: THREE.InstancedMesh[] = [];
    if (perTemplate[k] === 0) return meshes;
    for (const m of MATS) {
      const geo = tpl.geos[m];
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, mats[m], perTemplate[k]!);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Satellites are spread across the system: the per-mesh bounds would always pass anyway.
      mesh.frustumCulled = false;
      meshes.push(mesh);
      group.add(mesh);
    }
    return meshes;
  });

  // Loose junk: static instances, one mesh per shape.
  const jrng = createRng(seed ^ 0x1a2b);
  const shapes = Array.from({ length: JUNK_VARIANTS }, (_, v) => junkGeometry(v, jrng));
  const counts = shapes.map(() => 0);
  for (const j of junk) counts[j.variant] = (counts[j.variant] ?? 0) + 1;
  const junkMeshes = shapes.map((s, v) => (counts[v]! > 0 ? new THREE.InstancedMesh(s.geo, mats[s.mat], counts[v]!) : null));
  const filled = shapes.map(() => 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const c = new THREE.Color();
  for (const j of junk) {
    const mesh = junkMeshes[j.variant];
    if (!mesh) continue;
    q.setFromEuler(e.set(...j.rotation));
    m.compose(p.set(...j.position), q, sc.setScalar(j.size));
    const i = filled[j.variant]!++;
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setScalar(j.shade));
    colliders.push({ position: j.position, radius: j.size * 0.5 });
  }
  for (const mesh of junkMeshes) {
    if (!mesh) continue;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  const sparkle = glints([...junk.map((j) => new THREE.Vector3(...j.position)), ...sats.map((s) => s.position)], seed ^ 0x611);
  group.add(sparkle.points);

  const glow = mats.glow as THREE.MeshBasicMaterial;
  const beacon = mats.beacon as THREE.MeshBasicMaterial;
  const beaconOn = beacon.color.clone();
  const glowOn = glow.color.clone();
  const tmpQ = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  return {
    group,
    colliders,
    update(t, dt) {
      sparkle.time.value = t;
      for (const s of spinners) s.obj.rotateOnAxis(s.axis, s.rate * dt);
      for (const s of sats) {
        tmpQ.setFromAxisAngle(s.axis, s.rate * t).premultiply(s.base);
        m.compose(s.position, tmpQ, scale.setScalar(s.scale));
        for (const mesh of satMeshes[s.template]!) mesh.setMatrixAt(s.index, m);
      }
      for (const list of satMeshes) for (const mesh of list) mesh.instanceMatrix.needsUpdate = true;
      // Beacons still blink on the old power; portholes brown out now and then.
      beacon.color.copy(beaconOn).multiplyScalar(t % 2 < 0.15 ? 1 : 0.06);
      const f = Math.sin(t * 1.3) * Math.sin(t * 3.7);
      glow.color.copy(glowOn).multiplyScalar(f > 0.9 ? 0.25 : 1);
    },
  };
}
