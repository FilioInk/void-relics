import * as THREE from 'three';
import { createRng } from '../core/rng.ts';
import { FRAG_HEAD, FRAG_TAIL, NOISE, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/**
 * The far sky in two parts: the smooth glow (milky band and faint distant nebulae) is baked
 * once into a small cube map used as the scene background, and the stars are real points so
 * they stay pin-sharp at any resolution.
 */

export const STAR_SPHERE = 400000;

function bakeBackground(renderer: THREE.WebGLRenderer, seed: number): THREE.CubeTexture {
  const rng = createRng(seed ^ 0xa11);
  const bandNormal = new THREE.Vector3(...rng.onSphere());
  // Keep the band tilted against the system plane so it crosses the view nicely.
  bandNormal.y = bandNormal.y * 0.4 + 0.75;
  bandNormal.normalize();
  const hueA = new THREE.Color().setHSL(rng.range(0.55, 0.75), 0.7, 0.5);
  const hueB = new THREE.Color().setHSL(rng.range(0.85, 1.05) % 1, 0.7, 0.5);

  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uBand: { value: bandNormal },
      uHueA: { value: hueA },
      uHueB: { value: hueB },
      uSeed: { value: rng.range(0, 100) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBand;
      uniform vec3 uHueA;
      uniform vec3 uHueB;
      uniform float uSeed;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float lat = dot(d, uBand);
        float band = exp(-lat * lat / 0.035);
        float dust = fbm(d * 5.0 + uSeed);
        float lanes = smoothstep(0.45, 0.75, fbm(d * 9.0 + uSeed * 2.0));
        vec3 col = vec3(0.0025, 0.003, 0.007);
        col += vec3(0.075, 0.07, 0.075) * band * (0.35 + dust) * (1.0 - 0.8 * lanes);
        col += vec3(0.05, 0.05, 0.065) * exp(-lat * lat / 0.004) * dust;
        float neb = fbm(d * 2.2 + uSeed * 3.0);
        col += uHueA * 0.05 * smoothstep(0.5, 0.85, neb);
        float neb2 = fbm(d * 3.1 - uSeed);
        col += uHueB * 0.035 * smoothstep(0.55, 0.9, neb2);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), material));

  const target = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(1, 1000, target);
  cam.update(renderer, scene);
  material.dispose();
  return target.texture;
}

function makeStars(seed: number): THREE.Points {
  const rng = createRng(seed ^ 0x57a);
  const count = 9000;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const [x, y, z] = rng.onSphere();
    pos.set([x * STAR_SPHERE, y * STAR_SPHERE, z * STAR_SPHERE], i * 3);
    const t = rng.next();
    // Mostly white-blue and pale yellow, a few red giants.
    if (t < 0.12) c.setRGB(1.0, 0.62, 0.45);
    else if (t < 0.4) c.setRGB(1.0, 0.9, 0.75);
    else c.setRGB(0.8, 0.88, 1.0);
    const b = Math.pow(rng.next(), 6);
    const bright = 0.35 + 2.8 * b;
    col.set([c.r * bright, c.g * bright, c.b * bright], i * 3);
    size[i] = 1.2 + 3.2 * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('starColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      ${VERT_HEAD}
      attribute float size;
      attribute vec3 starColor;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = starColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * uPixelRatio;
        ${VERT_TAIL}
      }`,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      varying vec3 vColor;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 3.5);
        gl_FragColor = vec4(vColor * a, a);
        ${FRAG_TAIL}
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -10;
  return points;
}

export type Sky = { background: THREE.CubeTexture; stars: THREE.Points; update(camera: THREE.Camera, pixelRatio: number): void };

export function createSky(renderer: THREE.WebGLRenderer, seed: number): Sky {
  const background = bakeBackground(renderer, seed);
  const stars = makeStars(seed);
  const mat = stars.material as THREE.ShaderMaterial;
  return {
    background,
    stars,
    update(camera, pixelRatio) {
      stars.position.copy(camera.position);
      mat.uniforms['uPixelRatio']!.value = pixelRatio;
    },
  };
}
