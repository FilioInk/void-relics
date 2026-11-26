import * as THREE from 'three';
import type { Sun } from '../world/generate.ts';
import { FRAG_HEAD, FRAG_TAIL, NOISE, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/** The star: a boiling HDR surface for the bloom to catch, a corona billboard, and the light. */
export type SunView = { group: THREE.Group; light: THREE.PointLight; update(t: number, camera: THREE.Camera): void };

export function createSun(sun: Sun): SunView {
  const group = new THREE.Group();
  group.position.set(...sun.position);
  const tint = new THREE.Color(sun.color);

  const surface = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTint: { value: tint } },
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
      uniform vec3 uTint;
      varying vec3 vN;
      varying vec3 vWorldN;
      varying vec3 vView;
      ${NOISE}
      void main() {
        vec3 p = normalize(vN);
        float t = uTime;
        float big = fbm(p * 2.5 + vec3(t * 0.010, -t * 0.006, t * 0.008));
        float gran = fbm(p * 18.0 + vec3(-t * 0.05, t * 0.04, big * 2.0));
        float spots = smoothstep(0.66, 0.74, fbm(p * 1.6 + 7.3 + t * 0.002));
        vec3 deep = vec3(0.8, 0.14, 0.01);
        vec3 mid = mix(vec3(1.0, 0.45, 0.06), uTint, 0.3);
        vec3 hot = vec3(1.0, 0.82, 0.5);
        vec3 col = mix(deep, mid, smoothstep(0.25, 0.6, big + gran * 0.35));
        col = mix(col, hot, smoothstep(0.55, 0.85, gran + big * 0.25));
        col *= 0.55 + 0.9 * gran;
        col *= 1.0 - 0.75 * spots;
        float mu = clamp(dot(normalize(vWorldN), normalize(vView)), 0.0, 1.0);
        col *= 0.45 + 0.55 * pow(mu, 0.45);
        // Bright enough to bloom from afar, dim enough that the boiling surface reads up close.
        gl_FragColor = vec4(col * 1.9, 1.0);
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
    uniforms: { uTime: { value: 0 }, uTint: { value: tint }, uRadius: { value: sun.radius } },
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
      varying vec2 vQ;
      ${NOISE}
      void main() {
        float r = length(vQ);
        if (r < 0.98) discard;
        float a = atan(vQ.y, vQ.x);
        float rays = fbm3o(vec3(cos(a) * 3.0, sin(a) * 3.0, uTime * 0.05 + r * 0.4));
        float glow = exp(-(r - 1.0) * 2.6) * 0.8 + exp(-(r - 1.0) * 0.8) * 0.06;
        glow *= (0.65 + 0.8 * rays) * smoothstep(6.8, 3.5, r);
        vec3 col = mix(vec3(1.0, 0.55, 0.2), uTint, 0.5) * glow * 2.2;
        gl_FragColor = vec4(col, 1.0);
        ${FRAG_TAIL}
      }`,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), coronaMat);
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
  };
}
