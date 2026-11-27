import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, type Rng } from '../core/rng.ts';
import {
  ARMILLARY_THICK,
  CROWN_INSET,
  GATE,
  HABITAT,
  RINGWORLD,
  armillaryRings,
  habitatMirrorAngles,
  latticePanels,
  megaFrame,
  type Armillary,
  type Gate,
  type Gigastructure,
  type Habitat,
  type Lattice,
  type Megastructure,
  type Ringworld,
} from '../world/megastructures.ts';
import { FRAG_HEAD, FRAG_TAIL, NOISE, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/**
 * Megastructures for infinite flight, kilometres across, drawn in a handful of draw calls each:
 * a ring gate of dark blocks with a lit inner rim and a counter-turning inner ring; an O'Neill
 * habitat (three land strips, three window strips, mirrors opened off one end, a turning
 * agricultural crown at the other); and a torn patch of a Dyson lattice — instanced hexagonal
 * collectors on a truss, a few still lit.
 *
 * Gigastructures, hundreds of kilometres across: a ringworld (a band of land and sea lit by its
 * star, rim walls on both edges, a haze of air over it) and Dyson rings (tilted rings of
 * collectors around a star, each turning at its own pace). These fade in, because infinite
 * flight has to load them while they are already in view.
 *
 * Every group is built around its own centre (the stream moves it into place) and the shapes
 * follow the proportions in `src/world/megastructures.ts`, which the director checks against
 * the flight corridor. Only built-in materials, so the log-depth chunks come for free.
 */

export type MegaView = { group: THREE.Group; update(t: number, dt: number): void };

export function createMegastructure(m: Megastructure, envMap: THREE.Texture | null): MegaView {
  const rng = createRng(m.seed);
  switch (m.type) {
    case 'gate':
      return gate(m, rng, envMap);
    case 'habitat':
      return habitat(m, rng, envMap);
    case 'lattice':
      return lattice(m, rng, envMap);
  }
}

// --- helpers -------------------------------------------------------------------------------

/** Non-indexed, no uv, one colour per quad (jittered): every part of a material merges. */
function solid(geo: THREE.BufferGeometry, color: THREE.Color, rng: Rng, jitter = 0.12): THREE.BufferGeometry {
  return quads(geo, () => color.clone().multiplyScalar(1 + rng.range(-jitter, jitter)));
}

/**
 * Colours a geometry two triangles (one quad) at a time, from `pick`: three's boxes, cylinders
 * and tori list each quad's two triangles together, so a face never shows a diagonal seam.
 */
function quads(geo: THREE.BufferGeometry, pick: () => THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 6) {
    const c = pick();
    for (let v = 0; v < 6 && i + v < n; v++) colors.set([c.r, c.g, c.b], (i + v) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function mesh(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh | null {
  if (parts.length === 0) return null;
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return new THREE.Mesh(geo, material);
}

function addAll(parent: THREE.Object3D, ...objects: Array<THREE.Object3D | null>): void {
  for (const o of objects) if (o) parent.add(o);
}

/** Orients a group so its local axes are the frame's: z along the axis, y toward `up`. */
function orient(group: THREE.Object3D, axis: [number, number, number], up: [number, number, number]): void {
  const { x, y, z } = megaFrame(axis, up);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
  group.quaternion.setFromRotationMatrix(m);
}

function hullMaterial(envMap: THREE.Texture | null): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.55, flatShading: true, envMap, envMapIntensity: 0.8 });
}

const glowMaterial = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ vertexColors: true });
const beaconMaterial = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.35, 0.25) });
/** On for a short flash every couple of seconds, like a navigation light. */
const blink = (t: number, phase = 0): number => (((t + phase) % 2.4) < 0.25 ? 1 : 0.08);

// --- ring gate -----------------------------------------------------------------------------

function gate(g: Gate, rng: Rng, envMap: THREE.Texture | null): MegaView {
  const R = g.radius;
  const N = GATE.blocks;
  const arc = (Math.PI * 2 * R) / N;
  const thick = GATE.thick * R;
  const depth = GATE.depth * R;
  const base = new THREE.Color().setHSL(rng.pick([0.07, 0.58, 0.75]), rng.range(0.06, 0.16), rng.range(0.16, 0.24));
  const rim = rng.pick([new THREE.Color(0.35, 2.2, 2.0), new THREE.Color(1.5, 0.6, 2.4), new THREE.Color(2.4, 1.4, 0.45)]);
  const hull: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const beacons: THREE.BufferGeometry[] = [];
  /** Built with +y outward, x along the ring and z along the axis, then turned to angle a. */
  const at = (geo: THREE.BufferGeometry, a: number, radius: number, z = 0) => {
    geo.translate(0, radius, z);
    geo.rotateZ(a - Math.PI / 2);
    return geo;
  };
  for (let k = 0; k < N; k++) {
    const a = ((k + 0.5) / N) * Math.PI * 2;
    const pylon = k % (N / 4) === 0;
    // An old structure: a block lost here and there, another slipped out of line.
    if (!pylon && rng.chance(0.06)) continue;
    const r = R + (rng.chance(0.08) ? rng.range(0.01, 0.035) * R : 0);
    const shade = base.clone().multiplyScalar(rng.range(0.8, 1.2));
    hull.push(solid(at(new THREE.BoxGeometry(arc * 0.86, thick, depth), a, r), shade, rng));
    hull.push(solid(at(new THREE.BoxGeometry(arc * 0.55, thick * 0.4, depth * 1.12), a, r + thick * 0.55), shade.clone().multiplyScalar(0.75), rng));
    // The lit strip on the inner face; some have gone dark.
    const lit = rng.chance(0.85) ? rng.range(0.7, 1.1) : 0.08;
    glow.push(solid(at(new THREE.BoxGeometry(arc * 0.7, thick * 0.08, depth * 0.28), a, r - thick / 2 - 0.6), rim.clone().multiplyScalar(lit), rng, 0));
    if (pylon) {
      const h = thick * GATE.pylon;
      hull.push(solid(at(new THREE.BoxGeometry(arc * 1.5, h, depth * 1.4), a, R - thick / 2 + h / 2), base.clone().multiplyScalar(0.9), rng));
      beacons.push(at(new THREE.BoxGeometry(R * 0.014, R * 0.014, R * 0.014), a, R - thick / 2 + h + R * 0.01).toNonIndexed());
    } else if (k % 4 === 2) {
      const f = GATE.fin * R;
      hull.push(solid(at(new THREE.BoxGeometry(arc * 0.22, f, depth * 0.6), a, R + thick / 2 + f / 2), base.clone().multiplyScalar(0.7), rng));
    }
  }
  for (const b of beacons) b.deleteAttribute('uv');

  // The inner ring, turning the other way: a thin band of light held by clamps.
  const innerR = R * 0.9;
  const innerHull: THREE.BufferGeometry[] = [];
  const band = new THREE.TorusGeometry(innerR, R * 0.006, 6, 192);
  const innerGlow = [solid(band, rim.clone().multiplyScalar(0.6), rng, 0)];
  for (let k = 0; k < 12; k++) innerHull.push(solid(at(new THREE.BoxGeometry(R * 0.05, R * 0.03, R * 0.04), (k / 12) * Math.PI * 2, innerR), base, rng));

  const hullMat = hullMaterial(envMap);
  const glowMat = glowMaterial();
  const beaconMat = beaconMaterial();
  const group = new THREE.Group();
  orient(group, g.axis, g.up);
  const spin = new THREE.Group();
  const inner = new THREE.Group();
  addAll(spin, mesh(hull, hullMat), mesh(glow, glowMat), mesh(beacons, beaconMat));
  addAll(inner, mesh(innerHull, hullMat), mesh(innerGlow, glowMat));
  group.add(spin, inner);
  const phase = rng.range(0, Math.PI * 2);
  return {
    group,
    update(t) {
      spin.rotation.z = phase + t * 0.01;
      inner.rotation.z = -phase - t * 0.025;
      glowMat.color.setScalar(0.85 + 0.15 * Math.sin(t * 0.6 + phase));
      beaconMat.color.setRGB(3, 0.35, 0.25).multiplyScalar(blink(t, phase));
    },
  };
}

// --- habitat cylinder ----------------------------------------------------------------------

function habitat(h: Habitat, rng: Rng, envMap: THREE.Texture | null): MegaView {
  const R = h.radius;
  const L = h.length;
  const hull: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const mirrors: THREE.BufferGeometry[] = [];
  const beacons: THREE.BufferGeometry[] = [];
  const white = new THREE.Color().setHSL(rng.range(0.05, 0.6), 0.06, rng.range(0.55, 0.68));
  const dark = white.clone().multiplyScalar(0.45);
  /** CylinderGeometry stands on y: lie it along z. Its angle θ ends up at θ - π/2 around z. */
  const lying = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);

  // Three land strips and three window strips, a sixth of the circle each.
  for (let s = 0; s < 6; s++) {
    const start = (s * Math.PI) / 3;
    if (s % 2 === 0) {
      const land = lying(new THREE.CylinderGeometry(R, R, L, 10, 24, true, start, Math.PI / 3));
      hull.push(quads(land, () => white.clone().multiplyScalar(rng.chance(0.12) ? rng.range(0.55, 0.7) : rng.range(0.85, 1.05))));
    } else {
      const pane = lying(new THREE.CylinderGeometry(R * 0.995, R * 0.995, L, 10, 24, true, start, Math.PI / 3));
      glow.push(
        quads(pane, () =>
          rng.chance(0.12) ? new THREE.Color(1.4, 1.0, 0.55).multiplyScalar(rng.range(0.6, 1)) : new THREE.Color(0.7, 0.76, 0.88).multiplyScalar(rng.range(0.3, 0.6)),
        ),
      );
    }
    // A longeron along each seam.
    const beam = new THREE.BoxGeometry(R * 0.035, R * 0.035, L);
    beam.translate(0, R * 1.005, 0);
    // From +y (π/2) to the seam, which sits at start - π/2 around z.
    beam.rotateZ(start - Math.PI);
    hull.push(solid(beam, dark, rng));
  }
  // Hoops along the length.
  for (let k = 0; k <= 14; k++) {
    const hoop = lying(new THREE.CylinderGeometry(R * 1.012, R * 1.012, R * 0.025, 72, 1, true));
    hoop.translate(0, 0, -L / 2 + (L * k) / 14);
    hull.push(solid(hoop, dark, rng));
  }
  // End caps, each with a spindle and its docking lights.
  for (const side of [1, -1]) {
    const cap = new THREE.CylinderGeometry(R * 0.18, R, HABITAT.cap * R, 48, 1, true);
    cap.rotateX((side * Math.PI) / 2);
    cap.translate(0, 0, side * (L / 2 + (HABITAT.cap * R) / 2));
    hull.push(solid(cap, white.clone().multiplyScalar(0.8), rng));
    const spindle = new THREE.CylinderGeometry(R * 0.1, R * 0.18, HABITAT.spindle * R, 24);
    spindle.rotateX((side * Math.PI) / 2);
    spindle.translate(0, 0, side * (L / 2 + HABITAT.cap * R + (HABITAT.spindle * R) / 2));
    hull.push(solid(spindle, dark, rng));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const b = new THREE.BoxGeometry(R * 0.02, R * 0.02, R * 0.02);
      b.translate(Math.cos(a) * R * 0.1, Math.sin(a) * R * 0.1, side * (L / 2 + (HABITAT.cap + HABITAT.spindle) * R));
      b.deleteAttribute('uv');
      beacons.push(b.toNonIndexed());
    }
  }
  // Mirrors hinged at the +z end over each window strip, opened outward.
  const span = HABITAT.mirrorLength * L;
  for (const phi of habitatMirrorAngles()) {
    const m = new THREE.BoxGeometry(R * 0.95, R * 0.012, span);
    m.translate(0, 0, -span / 2);
    m.rotateX(HABITAT.mirrorTilt);
    m.translate(0, R * 1.04, L / 2);
    m.rotateZ(phi - Math.PI / 2);
    m.deleteAttribute('uv');
    mirrors.push(m.toNonIndexed());
    const hinge = new THREE.BoxGeometry(R * 0.95, R * 0.05, R * 0.05);
    hinge.translate(0, R * 1.03, L / 2);
    hinge.rotateZ(phi - Math.PI / 2);
    hull.push(solid(hinge, dark, rng));
  }
  // The agricultural crown at the -z end: a ring of greenhouses on six spokes, turning.
  const crownHull: THREE.BufferGeometry[] = [];
  const crownGlow: THREE.BufferGeometry[] = [];
  const crownR = HABITAT.crown * R;
  const crownZ = -L / 2 + R * CROWN_INSET;
  const crown = new THREE.TorusGeometry(crownR, HABITAT.tube * R, 10, 120);
  crown.translate(0, 0, crownZ);
  crownHull.push(solid(crown, white.clone().multiplyScalar(0.9), rng, 0.05));
  for (let k = 0; k < 6; k++) {
    const spoke = new THREE.BoxGeometry(R * 0.04, crownR - R, R * 0.04);
    spoke.translate(0, (crownR + R) / 2, crownZ);
    spoke.rotateZ((k / 6) * Math.PI * 2 + 0.3);
    crownHull.push(solid(spoke, dark, rng));
  }
  for (let k = 0; k < 60; k++) {
    if (rng.chance(0.2)) continue;
    const pane = new THREE.BoxGeometry(R * 0.05, R * 0.012, R * 0.06);
    pane.translate(0, crownR + HABITAT.tube * R * 0.9, crownZ);
    pane.rotateZ((k / 60) * Math.PI * 2);
    crownGlow.push(solid(pane, new THREE.Color(0.5, 1.3, 0.6).multiplyScalar(rng.range(0.6, 1)), rng, 0));
  }

  const glowMat = glowMaterial();
  const beaconMat = beaconMaterial();
  const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xc8d4e0, metalness: 1, roughness: 0.08, envMap, envMapIntensity: 1.6, side: THREE.DoubleSide });
  const hullMat = hullMaterial(envMap);
  const group = new THREE.Group();
  orient(group, h.axis, h.up);
  addAll(group, mesh(hull, hullMat), mesh(glow, glowMat), mesh(mirrors, mirrorMat), mesh(beacons, beaconMat));
  const spin = new THREE.Group();
  addAll(spin, mesh(crownHull, hullMat), mesh(crownGlow, glowMat));
  group.add(spin);
  const phase = rng.range(0, Math.PI * 2);
  return {
    group,
    update(t) {
      // The crown turns, slowed down to something the eye can follow; the hull and mirrors
      // stand still, which keeps the star system's collisions where they are drawn.
      spin.rotation.z = phase + t * 0.04;
      beaconMat.color.setRGB(3, 0.35, 0.25).multiplyScalar(blink(t, phase));
    },
  };
}

// --- Dyson lattice -------------------------------------------------------------------------

function lattice(l: Lattice, rng: Rng, envMap: THREE.Texture | null): MegaView {
  const panels = latticePanels(l);
  const c = new THREE.Vector3(...l.center);
  const along = new THREE.Vector3(...l.along);
  const local = (p: [number, number, number]) => new THREE.Vector3(...p).sub(c);
  // Pointy-top hexagons: CylinderGeometry's six corners, laid along z, point along ±y.
  const hex = (r: number, depth: number) => new THREE.CylinderGeometry(r, r, depth, 6).rotateX(Math.PI / 2);
  const cellR = l.cell / Math.sqrt(3);

  const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.35, flatShading: true, envMap, envMapIntensity: 1.2 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lit = panels.filter((p) => p.glow);
  const plates = new THREE.InstancedMesh(hex(cellR * 0.94, 5), panelMat, panels.length);
  const lamps = new THREE.InstancedMesh(hex(cellR * 0.62, 2), glowMat, Math.max(1, lit.length));
  lamps.count = lit.length;
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const z = new THREE.Vector3();
  const hue = rng.range(0.58, 0.68);
  const lampColors = [new THREE.Color(1.5, 0.85, 0.3), new THREE.Color(0.35, 1.2, 1.4)];
  const back = new Map<string, THREE.Vector3>();
  let li = 0;
  panels.forEach((p, k) => {
    z.set(...p.normal);
    x.copy(along).addScaledVector(z, -along.dot(z)).normalize();
    y.crossVectors(z, x);
    const pos = local(p.at);
    m.makeBasis(x, y, z).setPosition(pos);
    plates.setMatrixAt(k, m);
    plates.setColorAt(k, new THREE.Color().setHSL(hue, 0.3, 0.13 + 0.12 * p.tone));
    if (p.glow) {
      m.makeBasis(x, y, z).setPosition(pos.clone().addScaledVector(z, 3));
      lamps.setMatrixAt(li, m);
      lamps.setColorAt(li, lampColors[li % 5 === 0 ? 1 : 0]!.clone().multiplyScalar(0.6 + 0.4 * p.tone));
      li++;
    }
    // The truss runs behind the panels (away from the path).
    back.set(`${p.i},${p.j}`, pos.clone().addScaledVector(z, -32));
  });

  // The web between the panels' backs, and heavier girders every few rows and columns.
  const lines: number[] = [];
  const beams: Array<[THREE.Vector3, THREE.Vector3]> = [];
  for (const p of panels) {
    const a = back.get(`${p.i},${p.j}`)!;
    const up = p.j & 1 ? [p.i, p.i + 1] : [p.i - 1, p.i];
    const next: Array<[number, number, boolean]> = [
      [p.i + 1, p.j, p.j % 6 === 0],
      [up[0]!, p.j + 1, false],
      [up[1]!, p.j + 1, p.i % 7 === 0],
    ];
    for (const [i, j, girder] of next) {
      const b = back.get(`${i},${j}`);
      if (!b) continue;
      lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
      if (girder) beams.push([a, b]);
    }
  }
  const webGeo = new THREE.BufferGeometry();
  webGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const web = new THREE.LineSegments(webGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.2, 0.22, 0.26) }));
  const girderMat = new THREE.MeshStandardMaterial({ color: 0x5a5f68, metalness: 0.6, roughness: 0.5, flatShading: true, envMap, envMapIntensity: 0.7 });
  const girders = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), girderMat, Math.max(1, beams.length));
  girders.count = beams.length;
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const dir = new THREE.Vector3();
  beams.forEach(([a, b], k) => {
    dir.subVectors(b, a);
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    s.set(14, 14, dir.length() + 14);
    m.compose(a.clone().add(b).multiplyScalar(0.5), q, s);
    girders.setMatrixAt(k, m);
  });

  for (const im of [plates, lamps, girders]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }
  const group = new THREE.Group();
  group.add(plates, lamps, web, girders);
  const phase = rng.range(0, Math.PI * 2);
  return {
    group,
    update(t) {
      // The lit panels breathe, slowly and out of step with everything else.
      glowMat.color.setScalar(0.75 + 0.25 * Math.sin(t * 0.35 + phase));
    },
  };
}

// --- gigastructures ------------------------------------------------------------------------

export type GigaView = {
  group: THREE.Group;
  update(t: number, dt: number): void;
  /** 0..1: infinite flight fades a gigastructure in, since it loads while already in view. */
  setOpacity(k: number): void;
};

export function createGigastructure(g: Gigastructure, envMap: THREE.Texture | null): GigaView {
  return g.type === 'ringworld' ? ringworld(g, envMap) : armillary(g, envMap);
}

/**
 * The ringworld's land, shaded per pixel from its own position on the band so it holds detail
 * from orbit down to a few hundred metres: seas, coasts, plains and dry country, mountains with
 * snow, weather, darker near the rim walls and hazier far across the ring. It is lit by its
 * own star at the centre, which faces every part of the band, so it needs no light of ours.
 */
const LAND_VERT = /* glsl */ `
  ${VERT_HEAD}
  varying vec3 vObj;
  varying vec3 vWorldPos;
  varying float vAcross;
  uniform float uHalf;
  void main() {
    vObj = position;
    vAcross = position.z / uHalf;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    ${VERT_TAIL}
  }`;

const LAND_FRAG = /* glsl */ `
  ${FRAG_HEAD}
  uniform float uScale;
  uniform vec3 uSeed;
  uniform float uSea;
  uniform float uOpacity;
  varying vec3 vObj;
  varying vec3 vWorldPos;
  varying float vAcross;
  ${NOISE}
  void main() {
    vec3 q = vObj / uScale + uSeed;
    float h = fbm(q);
    vec3 col;
    if (h < uSea) {
      col = mix(vec3(0.015, 0.05, 0.13), vec3(0.04, 0.16, 0.24), smoothstep(uSea - 0.1, uSea, h));
    } else {
      float t = (h - uSea) / (1.0 - uSea);
      float dry = fbm3o(q * 1.7 + 5.0);
      col = mix(vec3(0.06, 0.18, 0.04), vec3(0.36, 0.27, 0.12), smoothstep(0.42, 0.62, dry));
      col = mix(col, vec3(0.26, 0.24, 0.21), smoothstep(0.16, 0.3, t));
      col = mix(col, vec3(0.8, 0.82, 0.86), smoothstep(0.3, 0.4, t));
      // Relief: hills and valleys at a finer scale than the coastlines.
      col *= 0.6 + 0.8 * fbm3o(q * 14.0);
    }
    float cloud = fbm3o(q * 2.3 + vec3(11.0, 3.0, 7.0));
    col = mix(col, vec3(0.62, 0.64, 0.68), smoothstep(0.58, 0.8, cloud) * 0.6);
    // In the shadow of the rim walls along both edges.
    float edge = 1.0 - abs(vAcross);
    col *= mix(0.35, 1.0, smoothstep(0.0, 0.08, edge));
    // Air: the further across the ring, the bluer.
    float d = length(cameraPosition - vWorldPos);
    col = mix(col, vec3(0.22, 0.36, 0.6), clamp(d / 450000.0, 0.0, 0.45));
    gl_FragColor = vec4(col * 1.15, uOpacity);
    ${FRAG_TAIL}
  }`;

function ringworld(g: Ringworld, envMap: THREE.Texture | null): GigaView {
  const rng = createRng(g.seed);
  const R = g.radius;
  const W = g.width;
  const wall = W * RINGWORLD.wall;
  const hull = W * RINGWORLD.hull;
  const SEG = 1024;
  const group = new THREE.Group();
  orient(group, g.axis, g.up);

  // The land: the inside of an open cylinder, axis along z.
  const land = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, W, SEG, 1, true).rotateX(Math.PI / 2),
    new THREE.ShaderMaterial({
      vertexShader: LAND_VERT,
      fragmentShader: LAND_FRAG,
      side: THREE.BackSide,
      transparent: true,
      uniforms: {
        uHalf: { value: W / 2 },
        uScale: { value: W * rng.range(0.9, 1.3) },
        uSeed: { value: new THREE.Vector3(rng.range(0, 100), rng.range(0, 100), rng.range(0, 100)) },
        uSea: { value: rng.range(0.44, 0.52) },
        uOpacity: { value: 1 },
      },
    }),
  );
  // The underside, and the rim walls standing inward from both edges, with lights along the top.
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x3a3e46, metalness: 0.6, roughness: 0.6, envMap, envMapIntensity: 0.6, transparent: true });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a4e56, metalness: 0.5, roughness: 0.7, envMap, envMapIntensity: 0.5, side: THREE.DoubleSide, transparent: true });
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.15, 0.7), transparent: true });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R + hull, R + hull, W, SEG / 2, 1, true).rotateX(Math.PI / 2), shellMat);
  const walls: THREE.Mesh[] = [];
  for (const side of [1, -1]) {
    walls.push(new THREE.Mesh(new THREE.RingGeometry(R - wall, R + hull, SEG, 1).translate(0, 0, (side * W) / 2), wallMat));
    walls.push(new THREE.Mesh(new THREE.RingGeometry(R - wall - 25, R - wall, SEG, 1).translate(0, 0, (side * W) / 2), lightMat));
  }
  // A thin haze of air over the land, brightest seen edge-on.
  const hazeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.5, 0.95), transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide });
  const haze = new THREE.Mesh(new THREE.CylinderGeometry(R - wall * 0.6, R - wall * 0.6, W * 0.97, SEG / 2, 1, true).rotateX(Math.PI / 2), hazeMat);
  group.add(land, shell, haze, ...walls);
  const landUniforms = (land.material as THREE.ShaderMaterial).uniforms;
  return {
    group,
    update() {},
    setOpacity(k) {
      landUniforms['uOpacity']!.value = k;
      shellMat.opacity = wallMat.opacity = lightMat.opacity = k;
      hazeMat.opacity = 0.06 * k;
    },
  };
}

function armillary(a: Armillary, envMap: THREE.Texture | null): GigaView {
  const rng = createRng(a.seed).fork('build');
  const group = new THREE.Group();
  // A faint glow of their own keeps the collectors readable from the dark side, far off.
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0.05, 0.09, 0.16), metalness: 0.75, roughness: 0.35, flatShading: true, envMap, envMapIntensity: 1.1, transparent: true });
  const hoopMat = new THREE.MeshStandardMaterial({ color: 0x6a6e78, metalness: 0.7, roughness: 0.45, envMap, envMapIntensity: 0.8, transparent: true });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.05, 0.45), transparent: true });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const z = new THREE.Vector3(0, 0, 1);
  const spins = armillaryRings(a).map((r) => {
    const ring = new THREE.Group();
    orient(ring, r.axis, r.up);
    const spin = new THREE.Group();
    ring.add(spin);
    const n = Math.max(60, Math.round((Math.PI * 2 * r.radius) / 260));
    const seg = (Math.PI * 2 * r.radius) / n;
    const panels = new THREE.InstancedMesh(box, panelMat, n);
    const lamps = new THREE.InstancedMesh(box, lampMat, n);
    let count = 0;
    let lit = 0;
    const hue = rng.range(0.58, 0.66);
    for (let k = 0; k < n; k++) {
      if (rng.chance(0.08)) continue;
      const ang = ((k + 0.5) / n) * Math.PI * 2;
      q.setFromAxisAngle(z, ang - Math.PI / 2);
      // Built with x along the ring, y outward and z across it.
      m.compose(new THREE.Vector3(Math.cos(ang) * r.radius, Math.sin(ang) * r.radius, 0), q, new THREE.Vector3(seg * 0.92, ARMILLARY_THICK, r.width));
      panels.setMatrixAt(count, m);
      panels.setColorAt(count, new THREE.Color().setHSL(hue, 0.35, rng.range(0.1, 0.2)));
      count++;
      if (k % 3 === 0) {
        const out = r.radius + ARMILLARY_THICK / 2 + 3;
        m.compose(new THREE.Vector3(Math.cos(ang) * out, Math.sin(ang) * out, 0), q, new THREE.Vector3(seg * 0.35, 6, r.width * 0.3));
        lamps.setMatrixAt(lit++, m);
      }
    }
    panels.count = count;
    lamps.count = lit;
    for (const im of [panels, lamps]) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
    // A structural hoop along each edge.
    const hoops = [1, -1].map((side) => new THREE.Mesh(new THREE.TorusGeometry(r.radius, 14, 6, 360).translate(0, 0, (side * r.width) / 2), hoopMat));
    spin.add(panels, lamps, ...hoops);
    group.add(ring);
    return { spin, speed: r.speed, phase: r.phase };
  });
  return {
    group,
    update(t) {
      // Each ring of collectors drifts round at its own pace; the lamps breathe.
      for (const s of spins) s.spin.rotation.z = s.phase + t * s.speed;
      lampMat.color.setRGB(1.7, 1.05, 0.45).multiplyScalar(0.75 + 0.25 * Math.sin(t * 0.5));
    },
    setOpacity(k) {
      panelMat.opacity = hoopMat.opacity = lampMat.opacity = k;
    },
  };
}
