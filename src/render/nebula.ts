import * as THREE from 'three';
import { createNoise3, fbm3 } from '../core/noise.ts';
import { createRng } from '../core/rng.ts';
import type { Nebula } from '../world/generate.ts';
import { FRAG_HEAD, FRAG_TAIL, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/**
 * Coloured smoke: hundreds of large soft billboards per nebula, sampled from a 2×2 atlas of
 * domain-warped noise baked on the CPU at start-up. Puffs fade out as the camera flies into
 * them so there is never a hard sprite edge, and storms of light now and then flash inside.
 */

function bakeSmokeAtlas(seed: number): THREE.DataTexture {
  const cell = 256;
  const size = cell * 2;
  const data = new Uint8Array(size * size * 4);
  const noise = createNoise3(seed);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * cell;
    const oy = Math.floor(v / 2) * cell;
    const z = v * 17.3;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const u = (x / cell) * 2 - 1;
        const w = (y / cell) * 2 - 1;
        const r = Math.hypot(u, w);
        let d = 0;
        if (r < 1) {
          const s = 2.2;
          const qx = fbm3(noise, u * s, w * s, z, 4);
          const qy = fbm3(noise, u * s + 5.2, w * s + 1.3, z, 4);
          const n = fbm3(noise, u * s + 2.6 * qx, w * s + 2.6 * qy, z + 3.1, 5);
          const falloff = Math.pow(Math.max(0, 1 - r), 1.6);
          d = Math.max(0, Math.min(1, (n * 1.4 + 0.45) * falloff * 1.5));
        }
        const i = ((oy + y) * size + ox + x) * 4;
        const b = Math.round(d * 255);
        data[i] = b;
        data[i + 1] = b;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
  ${VERT_HEAD}
  attribute vec3 iOffset;
  attribute float iSize;
  attribute vec3 iColor;
  attribute float iRot;
  attribute float iVariant;
  attribute float iAlpha;
  uniform float uTime;
  uniform vec4 uFlash;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Through modelViewMatrix, so a nebula built around its own origin can be moved as a whole.
    vec4 center = modelViewMatrix * vec4(iOffset, 1.0);
    float dc = length(center.xyz);
    float ang = iRot + uTime * 0.006 * (fract(iVariant * 7.31 + iRot) - 0.5);
    float c = cos(ang);
    float s = sin(ang);
    vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
    vec4 mv = center;
    mv.xy += q * iSize;
    float inside = smoothstep(iSize * 0.06, iSize * 0.6, dc);
    float flash = uFlash.w * exp(-distance(iOffset, uFlash.xyz) / 2200.0);
    vAlpha = iAlpha * inside * (1.0 + flash * 4.0);
    vColor = mix(iColor, vec3(0.85, 0.9, 1.0), clamp(flash, 0.0, 0.6));
    float v = floor(iVariant + 0.5);
    vUv = uv * 0.5 + vec2(mod(v, 2.0), floor(v / 2.0)) * 0.5;
    gl_Position = projectionMatrix * mv;
    ${VERT_TAIL}
  }`;

const FRAG = /* glsl */ `
  ${FRAG_HEAD}
  uniform sampler2D uTex;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = texture2D(uTex, vUv).r;
    float a = d * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, a);
    ${FRAG_TAIL}
  }`;

export type NebulaView = { group: THREE.Group; update(t: number, dt: number): void };

/** Baking the smoke takes a while; infinite flight builds nebulae all the time, so keep one per seed. */
const atlases = new Map<number, THREE.DataTexture>();

export function createNebulae(nebulae: Nebula[], seed: number): NebulaView {
  const group = new THREE.Group();
  const key = seed ^ 0x5409e;
  let atlas = atlases.get(key);
  if (!atlas) {
    atlas = bakeSmokeAtlas(key);
    atlas.userData['shared'] = true;
    atlases.set(key, atlas);
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  const flashes: Array<{ uniform: { value: THREE.Vector4 }; next: number; centers: THREE.Vector3[]; rng: ReturnType<typeof createRng> }> = [];
  const timeUniforms: Array<{ value: number }> = [];

  for (const neb of nebulae) {
    const rng = createRng(neb.seed);
    const ca = new THREE.Color(neb.colors[0]);
    const cb = new THREE.Color(neb.colors[1]);
    const centers: THREE.Vector3[] = [];
    const nc = rng.int(5, 8);
    for (let i = 0; i < nc; i++) {
      const [x, y, z] = rng.inSphere();
      centers.push(new THREE.Vector3(neb.center[0] + x * neb.radius * 0.55, neb.center[1] + y * neb.radius * 0.3, neb.center[2] + z * neb.radius * 0.55));
    }
    const glowCores = rng.int(4, 7);
    const count = neb.puffs + glowCores;
    const offset = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const color = new Float32Array(count * 3);
    const rot = new Float32Array(count);
    const variant = new Float32Array(count);
    const alpha = new Float32Array(count);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const core = i >= neb.puffs;
      const c = rng.pick(centers);
      // Stretch each puff along a per-nebula filament direction for a wispy shape.
      const spread = neb.radius * (core ? 0.08 : 0.32);
      const p = new THREE.Vector3(rng.gauss() * spread * 1.6, rng.gauss() * spread * 0.6, rng.gauss() * spread).add(c);
      offset.set([p.x, p.y, p.z], i * 3);
      size[i] = core ? rng.range(500, 1000) : rng.range(1400, 4200);
      const t = 0.5 + 0.5 * Math.sin(p.x * 0.0004 + p.z * 0.0003 + rng.range(-0.6, 0.6));
      tmp.copy(ca).lerp(cb, t);
      const b = core ? rng.range(1.6, 3.2) : rng.range(0.12, 0.38);
      color.set([tmp.r * b, tmp.g * b, tmp.b * b], i * 3);
      rot[i] = rng.range(0, Math.PI * 2);
      variant[i] = rng.int(0, 3);
      alpha[i] = core ? 0.6 : rng.range(0.35, 0.8);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offset, 3));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 1));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(color, 3));
    geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(rot, 1));
    geo.setAttribute('iVariant', new THREE.InstancedBufferAttribute(variant, 1));
    geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(alpha, 1));
    geo.instanceCount = count;
    const flash = { value: new THREE.Vector4(0, 0, 0, 0) };
    const time = { value: 0 };
    timeUniforms.push(time);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: atlas }, uTime: time, uFlash: flash },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // The billboards are placed in the shader, so the default bounds would be wrong.
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    flashes.push({ uniform: flash, next: rng.range(2, 8), centers, rng });
  }

  return {
    group,
    update(t, dt) {
      for (const u of timeUniforms) u.value = t;
      for (const f of flashes) {
        const v = f.uniform.value;
        v.w = Math.max(0, v.w - dt * 2.5);
        f.next -= dt;
        if (f.next <= 0) {
          const c = f.rng.pick(f.centers);
          v.set(c.x + f.rng.gauss() * 800, c.y + f.rng.gauss() * 400, c.z + f.rng.gauss() * 800, f.rng.range(0.6, 1));
          f.next = f.rng.chance(0.3) ? f.rng.range(0.15, 0.4) : f.rng.range(4, 12);
        }
      }
    },
  };
}
