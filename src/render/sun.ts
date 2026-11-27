import * as THREE from 'three';
import type { Sun } from '../world/generate.ts';
import type { Rgb, StarLook } from '../world/stars.ts';
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
 * The relic hunt's star keeps its hand-tuned golden palette, mixed from its tint; a star built
 * from a `StarLook` (infinite flight) takes its colours, brightness and corona from its class.
 * A `fading` star is drawn see-through so it can come and go without popping.
 */
export function createSun(sun: Sun, look?: StarLook, fading = false): SunView {
  const group = new THREE.Group();
  group.position.set(...sun.position);
  const tint = new THREE.Color(sun.color);
  const deep = look ? linear(look.deep) : new THREE.Color().setRGB(0.8, 0.14, 0.01);
  const mid = look ? linear(look.mid) : new THREE.Color().setRGB(1, 0.45, 0.06).lerp(tint, 0.3);
  const hot = look ? linear(look.hot) : new THREE.Color().setRGB(1, 0.82, 0.5);
  const coronaTint = look ? linear(look.corona) : new THREE.Color().setRGB(1, 0.55, 0.2).lerp(tint, 0.5);
  const gain = look?.gain ?? 1.9;
  const reach = look?.reach ?? 6.8;
  // The corona brightens more gently than the surface, and a wide one spreads its light thinner.
  const coronaGain = Math.sqrt(gain / 1.9) * Math.min(1, 6.8 / reach) ** 0.7;
  const fade = { value: 1 };

  const surface = new THREE.ShaderMaterial({
    transparent: fading,
    uniforms: { uTime: { value: 0 }, uDeep: { value: deep }, uMid: { value: mid }, uHot: { value: hot }, uGain: { value: gain }, uFade: fade, uCells: { value: look?.cells ?? 18 } },
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
    uniforms: { uTime: { value: 0 }, uTint: { value: coronaTint }, uRadius: { value: sun.radius }, uReach: { value: reach }, uGain: { value: coronaGain }, uFade: fade },
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

  const light = new THREE.PointLight(new THREE.Color(sun.color).lerp(new THREE.Color(0xffffff), 0.5), 3.2, 0, 0);
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
