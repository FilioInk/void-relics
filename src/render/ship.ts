import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng.ts';
import { FRAG_HEAD, FRAG_TAIL, NOISE, VERT_HEAD, VERT_TAIL } from './glsl.ts';
import { paintPlating } from './plating.ts';

/**
 * The player's light scout. A lathed fuselage in painted plating (panel seams, rivets, a hull
 * number, stripes, soot by the engines), a framed canopy, swept wings with a leading edge,
 * flaps and a cannon under each, canted tail fins, and two engines with intakes, radiators and
 * belled nozzles whose rims glow with the burn. Static parts are merged per material, so the
 * detail costs a handful of draw calls. Nose points to -Z.
 */

export const SHIP_RADIUS = 7;

/** The right wing's frame: a slight droop, then out to its root on the fuselage. */
const WING = new THREE.Matrix4().makeRotationZ(-0.08).premultiply(new THREE.Matrix4().makeTranslation(0.9, -0.25, 0.6));
const onWing = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.applyMatrix4(WING);

/** The right cannon's muzzle in the flat wing's frame: under the wing, ahead of its leading edge. */
const GUN_LOCAL = new THREE.Vector3(3.9, -0.27, -1.6);
const muzzle = GUN_LOCAL.clone().applyMatrix4(WING);

/** Cannon muzzles in the ship's frame (nose -Z), left then right. */
export const GUN_MOUNTS: ReadonlyArray<readonly [number, number, number]> = [
  [-muzzle.x, muzzle.y, muzzle.z],
  [muzzle.x, muzzle.y, muzzle.z],
];

const NOZZLE_END = 7.2;

function flameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uPower: { value: 0 }, uBoost: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      ${VERT_HEAD}
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${VERT_TAIL}
      }`,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      uniform float uPower;
      uniform float uBoost;
      uniform float uTime;
      varying vec3 vP;
      ${NOISE}
      void main() {
        // Cone spans y from -0.5 (base, at the nozzle) to 0.5 (tip, trailing behind).
        float along = clamp(vP.y + 0.5, 0.0, 1.0);
        float flicker = 0.75 + 0.5 * vnoise(vec3(along * 6.0 - uTime * 30.0, uTime * 7.0, 0.0));
        float a = pow(1.0 - along, 1.6) * flicker;
        // Shock diamonds: bright knots standing in the exhaust, crisper the harder it burns.
        float knots = pow(0.5 + 0.5 * cos(along * 34.0 - uTime * 1.5), 8.0) * smoothstep(0.0, 0.08, along) * (1.0 - along);
        a *= 1.0 + knots * (0.4 + uPower) * 1.6;
        // White-hot at the throat, orange through the body, a deep ember at the tail. Boost
        // pushes the white core further down the plume rather than changing its hue.
        vec3 white = vec3(1.0, 0.94, 0.82);
        vec3 orange = vec3(1.0, 0.42, 0.08);
        vec3 ember = vec3(0.8, 0.16, 0.02);
        vec3 col = mix(orange, ember, smoothstep(0.35, 1.0, along));
        float core = pow(1.0 - along, 4.5 - uBoost * 2.5);
        col = mix(col, white, clamp(core + knots * 0.6, 0.0, 1.0));
        float power = 0.08 + uPower;
        gl_FragColor = vec4(col * a * power * 0.7, a);
        ${FRAG_TAIL}
      }`,
  });
}

// --- geometry helpers ---------------------------------------------------------------------

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Scales a geometry's uv so the tiling plating keeps the same size in metres everywhere. */
function uvScale(geo: THREE.BufferGeometry, su: number, sv = su): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/** A mirror image across x = 0, with the triangles turned back the right way round. */
function mirrorX(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone()).scale(-1, 1, 1);
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < a.itemSize; k++) {
        const v1 = a.array[(t + 1) * a.itemSize + k]!;
        a.array[(t + 1) * a.itemSize + k] = a.array[(t + 2) * a.itemSize + k]!;
        a.array[(t + 2) * a.itemSize + k] = v1;
      }
    }
    a.needsUpdate = true;
  }
  return g;
}

/** Merges parts for one material: everything non-indexed, the same attributes on all. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ready = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    return g;
  });
  return mergeGeometries(ready, false)!;
}

/** Right-hand parts plus their mirror images. */
const both = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry[] => [...parts, ...parts.map(mirrorX)];

// --- textures -----------------------------------------------------------------------------

function texture(c: HTMLCanvasElement, srgb: boolean, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The fuselage skin: u runs round the hull (0 bottom, 0.25 right, 0.5 top), v from nose to tail. */
function fuselageSkin() {
  return paintPlating(1024, 512, 0x5c0ff, {
    base: [206, 211, 218],
    rows: 9,
    perRow: 14,
    grime: 0.8,
    decorate(g, w, h) {
      const y = (v: number) => h * (1 - v);
      // Matt dark anti-glare panel ahead of the canopy.
      g.fillStyle = 'rgba(38,44,52,0.92)';
      g.fillRect(w * 0.43, y(0.17), w * 0.14, y(0.03) - y(0.17));
      // Orange bands behind the cockpit.
      g.fillStyle = 'rgba(214,98,26,0.95)';
      g.fillRect(0, y(0.6), w, y(0.565) - y(0.6));
      g.fillRect(0, y(0.625), w, y(0.613) - y(0.625));
      // The hull number on both flanks, reading along the hull. Texels are ~3× longer along the
      // hull than around it, so the letters are squeezed to come out square on the ship.
      for (const u of [0.25, 0.75]) {
        g.save();
        g.translate(w * u, y(0.72));
        g.rotate(u < 0.5 ? -Math.PI / 2 : Math.PI / 2);
        g.scale(0.32, 1);
        g.font = '700 64px "Exo 2", system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = 'rgba(30,36,46,0.85)';
        g.fillText('VR-7', 0, 0);
        g.restore();
      }
      // Soot from the engines over the tail.
      const soot = g.createLinearGradient(0, y(0.8), 0, y(1));
      soot.addColorStop(0, 'rgba(20,18,16,0)');
      soot.addColorStop(1, 'rgba(20,18,16,0.55)');
      g.fillStyle = soot;
      g.fillRect(0, y(1), w, y(0.8) - y(1));
    },
  });
}

function tilingSkin(base: [number, number, number], seed: number) {
  return paintPlating(512, 512, seed, { base, rows: 5, perRow: 4, grime: 1.1 });
}

// --- assembly -----------------------------------------------------------------------------

export type ShipView = {
  root: THREE.Group;
  /** Visual-only bank applied under the flight orientation. */
  model: THREE.Group;
  update(t: number, throttle: number, boost: number, bank: number): void;
};

export function createShip(envMap: THREE.Texture | null): ShipView {
  const rng = createRng(0x5f1d);
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);

  const skin = fuselageSkin();
  const plate = tilingSkin([200, 205, 212], 0x91a7);
  const darkPlate = tilingSkin([58, 64, 72], 0x2d2d);
  const fuselageMat = new THREE.MeshStandardMaterial({ map: texture(skin.color, true), normalMap: texture(skin.normal, false), roughnessMap: texture(skin.rough, false), metalness: 0.55, roughness: 1, envMap, envMapIntensity: 1.2 });
  const hullMat = new THREE.MeshStandardMaterial({ map: texture(plate.color, true), normalMap: texture(plate.normal, false), roughnessMap: texture(plate.rough, false), metalness: 0.55, roughness: 1, envMap, envMapIntensity: 1.2 });
  const darkMat = new THREE.MeshStandardMaterial({ map: texture(darkPlate.color, true), normalMap: texture(darkPlate.normal, false), roughnessMap: texture(darkPlate.rough, false), metalness: 0.75, roughness: 1, envMap, envMapIntensity: 0.9, side: THREE.DoubleSide });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xd6621a, metalness: 0.3, roughness: 0.5, emissive: 0x2a0e00 });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x08090b, metalness: 0.4, roughness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1420, metalness: 0.1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, envMap, envMapIntensity: 1.8, emissive: 0x06202e, emissiveIntensity: 0.7 });

  const hull: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const black: THREE.BufferGeometry[] = [];

  // --- fuselage: a lathe from nose (z = -7.3) to tail, flattened a little --------------------
  const profile = [
    [0, -7.3], [0.28, -6.9], [0.62, -6.1], [0.95, -5.0], [1.22, -3.6], [1.45, -2.0], [1.62, -0.2], [1.7, 1.5], [1.66, 3.2], [1.52, 4.8], [1.28, 6.0], [0.95, 6.7], [0.6, 6.9], [0, 6.9],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const fuselage = new THREE.LatheGeometry(profile, 48);
  // v by distance along the profile, so panels and decals are not stretched at the nose.
  {
    const lengths = [0];
    for (let j = 1; j < profile.length; j++) lengths.push(lengths[j - 1]! + profile[j]!.distanceTo(profile[j - 1]!));
    const total = lengths[lengths.length - 1]!;
    const uv = fuselage.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setY(k, lengths[k % profile.length]! / total);
  }
  fuselage.rotateX(Math.PI / 2);
  fuselage.scale(1, 0.72, 1);
  model.add(new THREE.Mesh(fuselage, fuselageMat));

  // Dorsal spine behind the cockpit, and a belly keel.
  hull.push(uvScale(box(0.55, 0.28, 5.2, 0, 1.18, 2.7), 0.5, 1.6));
  dark.push(uvScale(box(0.4, 0.2, 6, 0, -1.2, 1.5), 0.4, 2));

  // --- canopy, its frame and sill -------------------------------------------------------------
  const canopyGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  canopyGeo.scale(0.95, 0.75, 2.6);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  canopy.position.set(0, 0.75, -2.6);
  model.add(canopy);
  for (const dz of [-1.25, 0.15, 1.35]) {
    const s = Math.sqrt(1 - (dz * dz) / (2.6 * 2.6));
    const arch = new THREE.TorusGeometry(1, 0.05, 6, 28, Math.PI);
    arch.scale(0.97 * s, 0.77 * s, 1);
    arch.translate(0, 0.75, -2.6 + dz);
    dark.push(arch);
  }
  const sill = new THREE.TorusGeometry(1, 0.07, 6, 48);
  sill.rotateX(Math.PI / 2);
  sill.scale(0.98, 1, 2.62);
  sill.translate(0, 0.76, -2.6);
  dark.push(sill);
  dark.push(box(0.06, 0.06, 4.6, 0, 1.5, -2.6));

  // --- right-hand parts, mirrored for the left -------------------------------------------------
  const right: { hull: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[]; accent: THREE.BufferGeometry[]; black: THREE.BufferGeometry[] } = { hull: [], dark: [], accent: [], black: [] };

  // Wing: the old outline with a bevel. Everything fixed to the wing is built in the flat wing's
  // own frame (root at x = 0, top surface at y ≈ 0.28, leading edge from z = -2.5 to 2.2) and
  // then given the same droop and position, so it stays on the surface out to the tip.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 2.5);
  wingShape.lineTo(6.8, -2.2);
  wingShape.lineTo(7.2, -3.6);
  wingShape.lineTo(5.6, -3.8);
  wingShape.lineTo(0, -4.6);
  wingShape.lineTo(0, 2.5);
  const wing = new THREE.ExtrudeGeometry(wingShape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 2 });
  wing.rotateX(-Math.PI / 2);
  right.hull.push(onWing(uvScale(wing, 1 / 3)));
  // Leading edge, wrapped round the front of the wing.
  const edge = box(8.27, 0.32, 0.22);
  edge.rotateY(-0.605);
  edge.translate(3.4, 0.11, -0.15);
  right.dark.push(onWing(uvScale(edge, 2, 0.1)));
  // Flaps along the trailing edge, drooped a touch.
  for (const [x, z] of [[1.4, 4.78], [4.0, 4.42]] as const) {
    const flap = box(2.5, 0.08, 0.5);
    flap.rotateX(0.12);
    flap.rotateY(0.14);
    flap.translate(x, 0.08, z);
    right.dark.push(onWing(uvScale(flap, 0.8, 0.2)));
  }
  // Wingtip fairing, and an orange stripe on top near the tip.
  const tip = new THREE.CylinderGeometry(0.16, 0.16, 1.9, 10);
  tip.rotateX(Math.PI / 2);
  tip.translate(7.05, 0.11, 2.95);
  right.hull.push(onWing(uvScale(tip, 0.4, 0.6)));
  const stripe = box(1.5, 0.02, 0.3);
  stripe.rotateY(-0.605);
  stripe.translate(5.5, 0.3, 1.0);
  right.accent.push(onWing(stripe));

  // Cannon slung under the wing: a housing, a barrel with cooling rings, a muzzle.
  right.dark.push(onWing(uvScale(box(0.38, 0.3, 2.4, GUN_LOCAL.x, GUN_LOCAL.y + 0.06, 1.3), 0.3, 0.8)));
  const barrel = new THREE.CylinderGeometry(0.09, 0.11, 1.75, 10);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(GUN_LOCAL.x, GUN_LOCAL.y, GUN_LOCAL.z + 0.87);
  right.dark.push(onWing(barrel));
  for (const z of [GUN_LOCAL.z + 1.6, GUN_LOCAL.z + 1.1, GUN_LOCAL.z + 0.02]) {
    const ring = new THREE.TorusGeometry(z < GUN_LOCAL.z + 0.5 ? 0.13 : 0.15, 0.035, 5, 12);
    ring.translate(GUN_LOCAL.x, GUN_LOCAL.y, z);
    right.dark.push(onWing(ring));
  }

  // Canted tail fin with a stripe, and a little ventral fin.
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(2.4, 0);
  finShape.lineTo(2.7, 2.1);
  finShape.lineTo(1.6, 2.1);
  finShape.lineTo(0, 0);
  const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 1 });
  fin.rotateY(-Math.PI / 2);
  fin.translate(0.07, 0, 0);
  fin.rotateZ(-0.35);
  fin.translate(1.15, 0.85, 3.4);
  right.hull.push(uvScale(fin, 1 / 3));
  // Built in the fin's own frame (centred on its thickness, near the top edge), then canted with it.
  const finStripe = box(0.22, 0.25, 1.2, 0, 1.72, 2.0);
  finStripe.rotateZ(-0.35);
  finStripe.translate(1.15, 0.85, 3.4);
  right.accent.push(finStripe);

  // Intake scoop at the wing root, its mouth black.
  right.dark.push(uvScale(box(0.55, 0.55, 1.8, 1.55, 0.05, -0.9), 0.4, 0.6));
  right.black.push(box(0.42, 0.42, 0.05, 1.55, 0.05, -1.82));

  // RCS blocks fore and aft, each with a couple of tiny nozzles.
  for (const [x, y, z] of [[1.0, 0.38, -4.3], [1.3, 0.42, 5.6]] as const) {
    right.dark.push(box(0.32, 0.22, 0.34, x, y, z));
    for (const dz of [-0.08, 0.08]) {
      const n = new THREE.CylinderGeometry(0.04, 0.05, 0.08, 6);
      n.rotateZ(Math.PI / 2);
      n.translate(x + 0.19, y, z + dz);
      right.black.push(n);
    }
  }

  // --- engines --------------------------------------------------------------------------------
  const ex = 2.1;
  const ey = -0.1;
  const nacelle = new THREE.LatheGeometry(
    [[0.72, 2.25], [0.92, 2.55], [0.96, 3.2], [0.96, 5.6], [0.88, 6.3], [0.8, 6.6]].map(([r, z]) => new THREE.Vector2(r, z)),
    24,
  );
  nacelle.rotateX(Math.PI / 2);
  nacelle.translate(ex, ey, 0);
  right.dark.push(uvScale(nacelle, 3, 1.5));
  for (const z of [3.3, 5.1]) {
    const band = new THREE.TorusGeometry(0.975, 0.045, 6, 24);
    band.translate(ex, ey, z);
    right.dark.push(band);
  }
  const lip = new THREE.TorusGeometry(0.78, 0.07, 8, 24);
  lip.translate(ex, ey, 2.28);
  right.hull.push(lip);
  const fan = new THREE.CircleGeometry(0.72, 24);
  fan.rotateY(Math.PI);
  fan.translate(ex, ey, 2.35);
  right.black.push(fan);
  const spinner = new THREE.ConeGeometry(0.22, 0.45, 12);
  spinner.rotateX(-Math.PI / 2);
  spinner.translate(ex, ey, 2.3);
  right.dark.push(spinner);
  // Radiator on top of the nacelle: a plate with fins.
  right.dark.push(box(0.8, 0.05, 1.7, ex, ey + 0.92, 4.3));
  for (let k = 0; k < 8; k++) right.dark.push(box(0.025, 0.14, 1.6, ex - 0.35 + k * 0.1, ey + 1.0, 4.3));
  // Nozzle bell.
  const bell = new THREE.LatheGeometry(
    [[0.78, 6.55], [0.8, 6.75], [0.86, 6.95], [0.95, 7.15], [0.97, NOZZLE_END]].map(([r, z]) => new THREE.Vector2(r, z)),
    24,
  );
  bell.rotateX(Math.PI / 2);
  bell.translate(ex, ey, 0);
  right.dark.push(bell);

  // Antennas and a few greebles along the spine.
  const whip = new THREE.CylinderGeometry(0.02, 0.03, 1.5, 5);
  whip.translate(0, 0.75, 0);
  whip.rotateX(0.5);
  whip.translate(0.32, 1.25, 1.6);
  right.dark.push(whip);
  for (let k = 0; k < 7; k++) {
    const z = 0.6 + k * 0.62 + rng.range(-0.1, 0.1);
    if (rng.chance(0.5)) right.dark.push(box(rng.range(0.12, 0.22), rng.range(0.06, 0.14), rng.range(0.2, 0.42), rng.range(0.32, 0.6), 1.15 + rng.range(0, 0.06), z));
    else {
      const pipe = new THREE.CylinderGeometry(0.035, 0.035, rng.range(0.4, 0.7), 6);
      pipe.rotateX(Math.PI / 2);
      pipe.translate(rng.range(0.3, 0.55), 1.22, z);
      right.dark.push(pipe);
    }
  }
  dark.push(box(0.04, 0.45, 0.6, 0, 1.45, 3.2));
  const ventral = new THREE.Shape();
  ventral.moveTo(0, 0);
  ventral.lineTo(1.8, 0);
  ventral.lineTo(2.0, -0.9);
  ventral.lineTo(1.2, -0.9);
  ventral.lineTo(0, 0);
  const vfin = new THREE.ExtrudeGeometry(ventral, { depth: 0.12, bevelEnabled: false });
  vfin.rotateY(-Math.PI / 2);
  vfin.translate(0.06, -1.05, 4.4);
  dark.push(uvScale(vfin, 1 / 3));

  hull.push(...both(right.hull));
  dark.push(...both(right.dark));
  accent.push(...both(right.accent));
  black.push(...both(right.black));
  model.add(new THREE.Mesh(merge(hull), hullMat));
  model.add(new THREE.Mesh(merge(dark), darkMat));
  model.add(new THREE.Mesh(merge(accent), accentMat));
  model.add(new THREE.Mesh(merge(black), blackMat));

  // --- glowing parts: nozzle throats, hot rims, flames ----------------------------------------
  const flames: THREE.ShaderMaterial[] = [];
  const flameMeshes: THREE.Mesh[] = [];
  const nozzleBase = new THREE.Color(1.0, 0.62, 0.3);
  const nozzleGlow = new THREE.MeshBasicMaterial({ color: nozzleBase.clone() });
  const rimBase = new THREE.Color(1.0, 0.45, 0.2);
  const rimGlow = new THREE.MeshBasicMaterial({ color: rimBase.clone() });
  const rims: THREE.BufferGeometry[] = [];
  const throats: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    throats.push(new THREE.CircleGeometry(0.78, 24).translate(side * ex, ey, 6.6));
    rims.push(new THREE.TorusGeometry(0.96, 0.035, 6, 32).translate(side * ex, ey, NOZZLE_END));
    const fm = flameMaterial();
    flames.push(fm);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1, 20, 1, true), fm);
    flame.rotation.x = Math.PI / 2;
    flame.position.set(side * ex, ey, NOZZLE_END);
    model.add(flame);
    flameMeshes.push(flame);
  }
  model.add(new THREE.Mesh(merge(throats), nozzleGlow));
  model.add(new THREE.Mesh(merge(rims), rimGlow));

  // Navigation lights: red port, green starboard, white strobe on the tail.
  const nav = (color: THREE.ColorRepresentation, x: number, y: number, z: number) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2) });
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), m);
    s.position.set(x, y, z);
    model.add(s);
    return m;
  };
  const lamp = new THREE.Vector3(7.05, 0.11, 3.95).applyMatrix4(WING);
  const red = nav(0xff2020, -lamp.x, lamp.y, lamp.z);
  const green = nav(0x20ff40, lamp.x, lamp.y, lamp.z);
  const strobe = nav(0xffffff, 0, 1.72, 3.5);
  const redBase = red.color.clone();
  const greenBase = green.color.clone();
  const strobeBase = strobe.color.clone();

  return {
    root,
    model,
    update(t, throttle, boost, bank) {
      model.rotation.z = bank;
      const power = Math.max(0, throttle) * 0.8 + boost * 1.6;
      const len = 1 + Math.max(0, throttle) * 3.5 + boost * 8;
      for (const m of flameMeshes) {
        m.scale.set(0.85 + boost * 0.25, len, 0.85 + boost * 0.25);
        m.position.z = NOZZLE_END + len / 2;
      }
      nozzleGlow.color.copy(nozzleBase).multiplyScalar(0.25 + power * 0.8);
      // The bell's lip heats from a dull red to near white with the burn.
      rimGlow.color.copy(rimBase).lerp(WHITE_HOT, Math.min(1, power * 0.4)).multiplyScalar(0.15 + power * 0.9);
      for (const f of flames) {
        f.uniforms['uPower']!.value = power;
        f.uniforms['uBoost']!.value = boost;
        f.uniforms['uTime']!.value = t;
      }
      const blink = (t % 1.2) < 0.12;
      red.color.copy(redBase).multiplyScalar(blink ? 1 : 0.15);
      green.color.copy(greenBase).multiplyScalar(blink ? 1 : 0.15);
      strobe.color.copy(strobeBase).multiplyScalar((t + 0.6) % 1.2 < 0.06 ? 1.5 : 0.05);
    },
  };
}

const WHITE_HOT = new THREE.Color(1, 0.92, 0.8);

