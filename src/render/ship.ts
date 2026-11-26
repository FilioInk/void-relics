import * as THREE from 'three';
import { FRAG_HEAD, FRAG_TAIL, NOISE, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/**
 * The player's light scout, built from primitives: a lathed fuselage, a canopy, swept wings,
 * twin engines with flames that grow with throttle and boost, and blinking navigation lights.
 * Nose points to -Z.
 */

export const SHIP_RADIUS = 7;

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
        vec3 cool = vec3(0.35, 0.65, 1.0);
        vec3 hot = vec3(1.0, 0.95, 0.9);
        vec3 col = mix(cool, hot, pow(1.0 - along, 9.0));
        col = mix(col, vec3(1.0, 0.55, 0.95), uBoost * 0.35 * along);
        float power = 0.08 + uPower;
        gl_FragColor = vec4(col * a * power * 0.7, a);
        ${FRAG_TAIL}
      }`,
  });
}

export type ShipView = {
  root: THREE.Group;
  /** Visual-only bank applied under the flight orientation. */
  model: THREE.Group;
  update(t: number, throttle: number, boost: number, bank: number): void;
};

export function createShip(envMap: THREE.Texture | null): ShipView {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);

  const hull = new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 0.55, roughness: 0.32, envMap, envMapIntensity: 1.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.7, roughness: 0.4, envMap });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff7a1a, metalness: 0.3, roughness: 0.45, emissive: 0x401800 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1828, metalness: 1, roughness: 0.06, envMap, emissive: 0x0a3050, emissiveIntensity: 0.6 });

  // Fuselage: a lathe profile from nose (y = 7) to tail (y = -7), then laid along -Z.
  const profile: THREE.Vector2[] = [
    [0, 7.2], [0.35, 6.6], [0.9, 5], [1.35, 3], [1.6, 1], [1.7, -1.5], [1.55, -4], [1.25, -6], [0.9, -6.6], [0, -6.6],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const fuselageGeo = new THREE.LatheGeometry(profile, 20);
  fuselageGeo.rotateX(-Math.PI / 2);
  fuselageGeo.scale(1, 0.72, 1);
  model.add(new THREE.Mesh(fuselageGeo, hull));

  const canopyGeo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  canopyGeo.scale(0.95, 0.75, 2.6);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  canopy.position.set(0, 0.75, -2.6);
  model.add(canopy);

  // Swept wings.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 2.5);
  wingShape.lineTo(6.8, -2.2);
  wingShape.lineTo(7.2, -3.6);
  wingShape.lineTo(5.6, -3.8);
  wingShape.lineTo(0, -4.6);
  wingShape.lineTo(0, 2.5);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 1 });
  wingGeo.rotateX(-Math.PI / 2);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, hull);
    wing.scale.x = side;
    wing.position.set(side * 0.9, -0.25, 0.6);
    wing.rotation.z = side * -0.08;
    model.add(wing);
    // Orange wingtip stripe.
    const tip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.6), accent);
    tip.position.set(side * 7.0, -0.2, 3.4);
    tip.rotation.y = side * -0.55;
    model.add(tip);
    // Canted tail fin.
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 2.4), dark);
    fin.position.set(side * 1.3, 1.2, 4.6);
    fin.rotation.set(-0.35, 0, side * -0.35);
    model.add(fin);
  }

  // Twin engines.
  const flames: THREE.ShaderMaterial[] = [];
  const nozzleBase = new THREE.Color(0.45, 0.75, 1.0);
  const nozzleGlow = new THREE.MeshBasicMaterial({ color: nozzleBase.clone() });
  for (const side of [-1, 1]) {
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 4.4, 16), dark);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(side * 2.1, -0.1, 4.6);
    model.add(nacelle);
    const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.72, 16), nozzleGlow);
    nozzle.position.set(side * 2.1, -0.1, 6.82);
    model.add(nozzle);
    const fm = flameMaterial();
    flames.push(fm);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1, 16, 1, true), fm);
    flame.rotation.x = Math.PI / 2;
    flame.position.set(side * 2.1, -0.1, 6.85);
    flame.name = 'flame';
    model.add(flame);
  }

  // Navigation lights: red port, green starboard, white strobe on the tail.
  const nav = (color: THREE.ColorRepresentation, x: number, y: number, z: number) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2) });
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), m);
    s.position.set(x, y, z);
    model.add(s);
    return m;
  };
  const red = nav(0xff2020, -7.4, -0.15, 3.0);
  const green = nav(0x20ff40, 7.4, -0.15, 3.0);
  const strobe = nav(0xffffff, 0, 0.9, 6.2);
  const redBase = red.color.clone();
  const greenBase = green.color.clone();
  const strobeBase = strobe.color.clone();

  const flameMeshes = model.children.filter((c) => c.name === 'flame');

  return {
    root,
    model,
    update(t, throttle, boost, bank) {
      model.rotation.z = bank;
      const power = Math.max(0, throttle) * 0.8 + boost * 1.6;
      const len = 1 + Math.max(0, throttle) * 3.5 + boost * 8;
      for (const m of flameMeshes) {
        m.scale.set(0.8 + boost * 0.25, len, 0.8 + boost * 0.25);
        m.position.z = 6.85 + len / 2;
      }
      nozzleGlow.color.copy(nozzleBase).multiplyScalar(0.25 + power * 0.8);
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
