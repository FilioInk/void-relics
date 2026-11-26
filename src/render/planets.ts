import * as THREE from 'three';
import type { Planet, PlanetKind } from '../world/generate.ts';
import { FRAG_HEAD, FRAG_TAIL, NOISE, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/** Planets are shaded entirely in GLSL from object-space noise, so no textures are shipped. */

const KIND_ID: Record<PlanetKind, number> = { lava: 0, desert: 1, rocky: 2, terran: 3, gas: 4, ice: 5 };

const SURFACE_VERT = /* glsl */ `
  ${VERT_HEAD}
  varying vec3 vObj;
  varying vec3 vWorldN;
  varying vec3 vWorldPos;
  void main() {
    vObj = normalize(position);
    vWorldN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    ${VERT_TAIL}
  }`;

const SURFACE_FRAG = /* glsl */ `
  ${FRAG_HEAD}
  uniform vec3 uSun;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uAtmo;
  uniform float uSeed;
  uniform int uKind;
  varying vec3 vObj;
  varying vec3 vWorldN;
  varying vec3 vWorldPos;
  ${NOISE}
  void main() {
    vec3 p = normalize(vObj);
    vec3 sp = p + vec3(uSeed);
    vec3 N = normalize(vWorldN);
    vec3 L = normalize(uSun - vWorldPos);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndl = dot(N, L);
    float day = smoothstep(-0.12, 0.35, ndl);
    float diff = max(ndl, 0.0);
    vec3 albedo;
    vec3 emissive = vec3(0.0);
    float spec = 0.0;

    if (uKind == 0) {
      float crust = fbm(sp * 2.4);
      float cracks = ridged(sp * 3.2);
      albedo = mix(uC0, uC1, smoothstep(0.3, 0.7, crust));
      float glow = pow(clamp(cracks, 0.0, 1.0), 7.0);
      emissive = uC2 * glow * 3.0 * (1.2 - day * 0.6);
    } else if (uKind == 1) {
      float h = fbm(sp * 2.2);
      float dunes = 0.5 + 0.5 * sin(p.x * 40.0 + p.z * 25.0 + fbm(sp * 6.0) * 9.0);
      albedo = mix(uC0, uC1, smoothstep(0.3, 0.65, h));
      albedo = mix(albedo, uC2, smoothstep(0.6, 0.8, h) * 0.7);
      albedo *= 0.88 + 0.12 * dunes;
    } else if (uKind == 2) {
      float h = fbm(sp * 2.6);
      float craters = ridged(sp * 5.0);
      albedo = mix(uC0, uC1, smoothstep(0.25, 0.7, h));
      albedo = mix(albedo, uC2, smoothstep(0.75, 0.95, craters) * 0.6);
      albedo *= 0.8 + 0.25 * fbm(sp * 18.0);
    } else if (uKind == 3) {
      float h = fbm(sp * 1.7);
      float lat = abs(p.y);
      vec3 deep = uC0 * 0.6;
      vec3 shallow = uC0 * 1.6 + vec3(0.0, 0.08, 0.1);
      vec3 land = mix(uC1, uC2 * 0.7, smoothstep(0.55, 0.72, h));
      bool ocean = h < 0.5;
      albedo = ocean ? mix(deep, shallow, smoothstep(0.38, 0.5, h)) : land;
      float ice = smoothstep(0.78, 0.86, lat + fbm(sp * 4.0) * 0.12);
      albedo = mix(albedo, vec3(0.92, 0.95, 1.0), ice);
      if (ocean && ice < 0.5) {
        vec3 H = normalize(L + V);
        spec = pow(max(dot(N, H), 0.0), 60.0) * 0.8;
      }
      // City lights on the night side.
      float cities = step(0.78, vnoise(sp * 160.0)) * smoothstep(0.52, 0.6, h) * (1.0 - ice);
      emissive = vec3(1.0, 0.75, 0.4) * cities * (1.0 - day) * 0.6;
    } else if (uKind == 4) {
      float warp = fbm(sp * vec3(1.5, 5.0, 1.5)) * 3.0;
      float bands = 0.5 + 0.5 * sin(p.y * 18.0 + warp);
      float fine = 0.5 + 0.5 * sin(p.y * 55.0 + warp * 2.0);
      albedo = mix(uC0, uC1, bands);
      albedo = mix(albedo, uC2, fine * 0.35);
      // One great storm.
      vec3 sc = normalize(vec3(0.6, -0.35, 0.7));
      float storm = smoothstep(0.22, 0.0, length(p - sc) + fbm(sp * 8.0) * 0.05);
      albedo = mix(albedo, uC2 * vec3(1.1, 0.75, 0.6), storm * 0.8);
    } else {
      float h = fbm(sp * 2.0);
      float cracks = ridged(sp * 4.5);
      albedo = mix(uC1, uC2, smoothstep(0.3, 0.7, h));
      albedo = mix(albedo, uC0, smoothstep(0.8, 0.95, cracks) * 0.7);
      vec3 H = normalize(L + V);
      spec = pow(max(dot(N, H), 0.0), 24.0) * 0.25;
    }

    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 col = albedo * (diff * 1.25 + 0.015) + spec * day + emissive;
    col += uAtmo * rim * (0.15 + 0.85 * day) * 0.9;
    gl_FragColor = vec4(col, 1.0);
    ${FRAG_TAIL}
  }`;

function atmosphereMaterial(color: THREE.Color, sun: THREE.Vector3, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: sun }, uColor: { value: color }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      ${VERT_HEAD}
      varying vec3 vWorldN;
      varying vec3 vWorldPos;
      varying vec3 vViewN;
      void main() {
        vWorldN = normalize(mat3(modelMatrix) * normal);
        vViewN = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${VERT_TAIL}
      }`,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      uniform vec3 uSun;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vWorldN;
      varying vec3 vWorldPos;
      varying vec3 vViewN;
      void main() {
        float limb = pow(clamp(1.0 + vViewN.z, 0.0, 1.0), 4.0);
        float lit = smoothstep(-0.3, 0.4, dot(normalize(vWorldN), normalize(uSun - vWorldPos)));
        gl_FragColor = vec4(uColor * limb * lit * uStrength, 1.0);
        ${FRAG_TAIL}
      }`,
  });
}

function cloudMaterial(sun: THREE.Vector3, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uSun: { value: sun }, uSeed: { value: seed }, uTime: { value: 0 } },
    vertexShader: SURFACE_VERT,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      uniform vec3 uSun;
      uniform float uSeed;
      uniform float uTime;
      varying vec3 vObj;
      varying vec3 vWorldN;
      varying vec3 vWorldPos;
      ${NOISE}
      void main() {
        vec3 p = normalize(vObj) + vec3(uSeed + 3.0);
        float c = fbm(p * 3.0 + vec3(uTime * 0.004, 0.0, 0.0));
        float a = smoothstep(0.48, 0.72, c);
        float day = smoothstep(-0.1, 0.4, dot(normalize(vWorldN), normalize(uSun - vWorldPos)));
        gl_FragColor = vec4(vec3(0.95) * (0.03 + day * 1.0), a * 0.85);
        ${FRAG_TAIL}
      }`,
  });
}

function ringMaterial(planet: Planet, center: THREE.Vector3, sun: THREE.Vector3): THREE.ShaderMaterial {
  const ring = planet.ring!;
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSun: { value: sun },
      uCenter: { value: center },
      uPlanetR: { value: planet.radius },
      uInner: { value: ring.inner },
      uOuter: { value: ring.outer },
      uColor: { value: new THREE.Color(ring.color) },
      uSeed: { value: planet.seed % 1000 },
    },
    vertexShader: /* glsl */ `
      ${VERT_HEAD}
      varying vec3 vLocal;
      varying vec3 vWorldPos;
      void main() {
        vLocal = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${VERT_TAIL}
      }`,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      uniform vec3 uSun;
      uniform vec3 uCenter;
      uniform float uPlanetR;
      uniform float uInner;
      uniform float uOuter;
      uniform vec3 uColor;
      uniform float uSeed;
      varying vec3 vLocal;
      varying vec3 vWorldPos;
      ${NOISE}
      void main() {
        float r = (length(vLocal.xy) - uInner) / (uOuter - uInner);
        if (r < 0.0 || r > 1.0) discard;
        float bands = vnoise(vec3(r * 70.0, uSeed, 0.0)) * 0.6 + vnoise(vec3(r * 230.0, uSeed, 1.0)) * 0.4;
        float gaps = smoothstep(0.04, 0.0, abs(r - 0.62)) ;
        float alpha = bands * smoothstep(0.0, 0.06, r) * smoothstep(1.0, 0.85, r) * (1.0 - gaps * 0.9);
        // Planet shadow: does the ray toward the sun pass through the planet?
        vec3 Ld = normalize(uSun - vWorldPos);
        vec3 oc = vWorldPos - uCenter;
        float b = dot(oc, Ld);
        float c = dot(oc, oc) - uPlanetR * uPlanetR;
        float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.08 : 1.0;
        vec3 col = uColor * (0.25 + 0.75 * bands) * shadow * 0.9;
        gl_FragColor = vec4(col, alpha * 0.85);
        ${FRAG_TAIL}
      }`,
  });
}

export type PlanetView = { group: THREE.Group; update(dt: number, t: number): void };

export function createPlanet(planet: Planet, sunPos: THREE.Vector3): PlanetView {
  const group = new THREE.Group();
  group.position.set(...planet.position);
  group.rotation.z = planet.axialTilt;
  const center = new THREE.Vector3(...planet.position);

  const [c0, c1, c2] = planet.palette.map((c) => new THREE.Color(c)) as [THREE.Color, THREE.Color, THREE.Color];
  const surfaceMat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunPos },
      uC0: { value: c0 },
      uC1: { value: c1 },
      uC2: { value: c2 },
      uAtmo: { value: new THREE.Color(planet.atmosphere) },
      uSeed: { value: (planet.seed % 997) / 13 },
      uKind: { value: KIND_ID[planet.kind] },
    },
    vertexShader: SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(planet.radius, 160, 120), surfaceMat);
  group.add(body);

  const atmoScale = planet.kind === 'gas' ? 1.025 : planet.kind === 'rocky' ? 1.015 : 1.05;
  const atmoStrength = planet.kind === 'rocky' ? 0.35 : planet.kind === 'lava' ? 0.8 : 1.1;
  group.add(new THREE.Mesh(new THREE.SphereGeometry(planet.radius * atmoScale, 96, 64), atmosphereMaterial(new THREE.Color(planet.atmosphere), sunPos, atmoStrength)));

  let clouds: THREE.Mesh | null = null;
  if (planet.clouds) {
    clouds = new THREE.Mesh(new THREE.SphereGeometry(planet.radius * 1.012, 128, 96), cloudMaterial(sunPos, (planet.seed % 991) / 17));
    group.add(clouds);
  }

  if (planet.ring) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(planet.ring.inner, planet.ring.outer, 256, 1), ringMaterial(planet, center, sunPos));
    ring.rotation.x = -Math.PI / 2 + planet.ring.tilt;
    ring.renderOrder = 3;
    group.add(ring);
  }

  return {
    group,
    update(dt, t) {
      body.rotation.y += planet.spin * dt;
      if (clouds) {
        clouds.rotation.y += planet.spin * 1.3 * dt;
        (clouds.material as THREE.ShaderMaterial).uniforms['uTime']!.value = t;
      }
    },
  };
}
