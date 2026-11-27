import * as THREE from 'three';
import type { Sun } from '../world/generate.ts';
import { starLook, type Rgb } from '../world/stars.ts';
import { FRAG_HEAD, FRAG_TAIL, NOISE, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/** The star: a boiling HDR surface for the bloom to catch, a corona billboard, and the light. */
export type SunView = {
  group: THREE.Group;
  light: THREE.PointLight;
  update(t: number, camera: THREE.Camera): void;
  /** 0–1: fades the star in and out (only for a star built with `fading`). */
  setFade(f: number): void;
};

const linear = (c: Rgb): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2]);

/**
 * A star takes its colours, brightness, corona and light from its class (`starLook`). A
 * `fading` star (infinite flight) is drawn see-through so it can come and go without popping.
 */
export function createSun(sun: Sun, fading = false): SunView {
  const group = new THREE.Group();
  group.position.set(...sun.position);
  const look = starLook(sun.star);
  const { gain, reach } = look;
  // The corona brightens more gently than the surface, and a wide one spreads its light thinner.
  const coronaGain = Math.sqrt(gain / 1.9) * Math.min(1, 6.8 / reach) ** 0.7;
  const fade = { value: 1 };

  const surface = new THREE.ShaderMaterial({
    transparent: fading,
    uniforms: { uTime: { value: 0 }, uDeep: { value: linear(look.deep) }, uMid: { value: linear(look.mid) }, uHot: { value: linear(look.hot) }, uGain: { value: gain }, uFade: fade, uCells: { value: look.cells } },
    vertexShader: /* glsl */ `
      ${VERT_HEAD}
      varying vec3 vN;
      varying vec3 vWorldN;
      varying vec3 vView;
      void main() {
        vN = normal;
        vWorldN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${VERT_TAIL}
      }`,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uMid;
      uniform vec3 uHot;
      uniform float uGain;
      uniform float uFade;
      uniform float uCells;
      varying vec3 vN;
      varying vec3 vWorldN;
      varying vec3 vView;
      ${NOISE}
      void main() {
        vec3 p = normalize(vN);
        float t = uTime;
        float big = fbm(p * 2.5 + vec3(t * 0.010, -t * 0.006, t * 0.008));
        float gran = fbm(p * uCells + vec3(-t * 0.05, t * 0.04, big * 2.0));
        float spots = smoothstep(0.66, 0.74, fbm(p * 1.6 + 7.3 + t * 0.002));
        vec3 col = mix(uDeep, uMid, smoothstep(0.25, 0.6, big + gran * 0.35));
        col = mix(col, uHot, smoothstep(0.55, 0.85, gran + big * 0.25));
        col *= 0.55 + 0.9 * gran;
        col *= 1.0 - 0.75 * spots;
        float mu = clamp(dot(normalize(vWorldN), normalize(vView)), 0.0, 1.0);
        col *= 0.45 + 0.55 * pow(mu, 0.45);
        // Bright enough to bloom from afar, dim enough that the boiling surface reads up close.
        gl_FragColor = vec4(col * uGain, uFade);
        ${FRAG_TAIL}
      }`,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(sun.radius, 128, 96), surface);
  group.add(sphere);

  // Corona: a camera-facing quad, drawn only outside the disc thanks to the depth test.
  const coronaMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uTint: { value: linear(look.corona) }, uRadius: { value: sun.radius }, uReach: { value: reach }, uGain: { value: coronaGain }, uFade: fade },
    vertexShader: /* glsl */ `
      ${VERT_HEAD}
      uniform float uRadius;
      varying vec2 vQ;
      void main() {
        vQ = position.xy;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * uRadius;
        gl_Position = projectionMatrix * mv;
        ${VERT_TAIL}
      }`,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      uniform float uTime;
      uniform vec3 uTint;
      uniform float uReach;
      uniform float uGain;
      uniform float uFade;
      varying vec2 vQ;
      ${NOISE}
      void main() {
        float r = length(vQ);
        if (r < 0.98) discard;
        float a = atan(vQ.y, vQ.x);
        // Falloffs stretch with the reach: 6.8 radii is the Sun's corona.
        float k = 6.8 / uReach;
        float rays = fbm3o(vec3(cos(a) * 3.0, sin(a) * 3.0, uTime * 0.05 + r * 0.4 * k));
        float glow = exp(-(r - 1.0) * 2.6 * k) * 0.8 + exp(-(r - 1.0) * 0.8 * k) * 0.06;
        glow *= (0.65 + 0.8 * rays) * smoothstep(uReach, uReach * (3.5 / 6.8), r);
        vec3 col = uTint * glow * 2.2 * uGain * uFade;
        gl_FragColor = vec4(col, 1.0);
        ${FRAG_TAIL}
      }`,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(reach * 2 + 0.4, reach * 2 + 0.4), coronaMat);
  corona.frustumCulled = false;
  corona.renderOrder = 2;
  group.add(corona);

  // 3.2 for a Sun-like star, more or less with the class's luminosity (lightIntensity is 2.6 for the Sun).
  const light = new THREE.PointLight(linear(look.light), (3.2 * look.lightIntensity) / 2.6, 0, 0);
  group.add(light);

  return {
    group,
    light,
    update(t) {
      surface.uniforms['uTime']!.value = t;
      coronaMat.uniforms['uTime']!.value = t;
    },
    setFade(f) {
      fade.value = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 1));
      // Fully gone: skip it rather than draw an invisible sphere. The meshes, not the group:
      // the stream hides the group until its shaders are compiled.
      sphere.visible = corona.visible = fade.value > 0.001;
    },
  };
}
