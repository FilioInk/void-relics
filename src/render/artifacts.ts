import * as THREE from 'three';
import type { Artifact } from '../world/generate.ts';
import { FRAG_HEAD, FRAG_TAIL, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/**
 * A relic: a glowing core inside counter-rotating rings with orbiting shards. From far away
 * it shows only as a faint pulsing point of light that never shrinks below a couple of pixels,
 * so a sharp eye can spot one before the scanner does.
 */

const GLOW_VERT = /* glsl */ `
  ${VERT_HEAD}
  uniform float uSize;
  uniform float uMinPx;
  uniform float uViewport;
  varying vec2 vQ;
  void main() {
    vQ = position.xy * 2.0;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float d = -mv.z;
    // World size up close; a fixed handful of pixels far away.
    float minWorld = uMinPx * d / uViewport;
    mv.xy += position.xy * max(uSize, minWorld);
    gl_Position = projectionMatrix * mv;
    ${VERT_TAIL}
  }`;

const GLOW_FRAG = /* glsl */ `
  ${FRAG_HEAD}
  uniform vec3 uColor;
  uniform float uPulse;
  varying vec2 vQ;
  void main() {
    float r = length(vQ);
    if (r > 1.0) discard;
    float core = exp(-r * r * 18.0);
    float halo = exp(-r * 3.5) * 0.35;
    float a = (core + halo) * uPulse;
    gl_FragColor = vec4(uColor * a, a);
    ${FRAG_TAIL}
  }`;

export type ArtifactView = {
  group: THREE.Group;
  /** Hide one (collected) and play its burst. */
  collect(id: string): void;
  setFound(ids: readonly string[]): void;
  update(t: number, dt: number, viewportHeight: number): void;
};

type Item = { artifact: Artifact; root: THREE.Group; spinA: THREE.Object3D; spinB: THREE.Object3D; shards: THREE.Group; glow: THREE.ShaderMaterial; burst: number };

export function createArtifacts(list: Artifact[]): ArtifactView {
  const group = new THREE.Group();
  const items = new Map<string, Item>();
  const quad = new THREE.PlaneGeometry(1, 1);
  const coreGeo = new THREE.OctahedronGeometry(6, 0);
  const innerGeo = new THREE.IcosahedronGeometry(3.2, 0);
  const ringGeo = new THREE.TorusGeometry(12, 0.35, 8, 64);
  const ring2Geo = new THREE.TorusGeometry(16, 0.25, 8, 72);
  const shardGeo = new THREE.TetrahedronGeometry(1.6, 0);

  for (const a of list) {
    const color = new THREE.Color().setHSL(0.45 + a.hue * 0.4, 0.9, 0.6);
    const hot = color.clone().multiplyScalar(4);
    const root = new THREE.Group();
    root.position.set(...a.position);

    const shell = new THREE.MeshStandardMaterial({ color: 0x0c0c14, metalness: 0.9, roughness: 0.2, emissive: color, emissiveIntensity: 0.6, flatShading: true });
    const coreMat = new THREE.MeshBasicMaterial({ color: hot });
    root.add(new THREE.Mesh(coreGeo, shell));
    root.add(new THREE.Mesh(innerGeo, coreMat));

    const ringMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.5) });
    const spinA = new THREE.Mesh(ringGeo, ringMat);
    const spinB = new THREE.Mesh(ring2Geo, ringMat);
    spinB.rotation.x = Math.PI / 2;
    root.add(spinA, spinB);

    const shards = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(shardGeo, shell);
      const ang = (i / 7) * Math.PI * 2;
      s.position.set(Math.cos(ang) * 22, Math.sin(ang * 2) * 4, Math.sin(ang) * 22);
      s.rotation.set(ang, ang * 2, 0);
      shards.add(s);
    }
    root.add(shards);

    const glow = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: hot }, uSize: { value: 70 }, uMinPx: { value: 9 }, uViewport: { value: 800 }, uPulse: { value: 1 } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
    });
    const glowMesh = new THREE.Mesh(quad, glow);
    glowMesh.frustumCulled = false;
    glowMesh.renderOrder = 6;
    root.add(glowMesh);

    group.add(root);
    items.set(a.id, { artifact: a, root, spinA, spinB, shards, glow, burst: -1 });
  }

  return {
    group,
    collect(id) {
      const it = items.get(id);
      if (it) it.burst = 0;
    },
    setFound(ids) {
      for (const [id, it] of items) it.root.visible = !ids.includes(id);
    },
    update(t, dt, viewportHeight) {
      for (const it of items.values()) {
        if (!it.root.visible) continue;
        const ph = it.artifact.hue * 10;
        it.spinA.rotation.x = t * 0.7 + ph;
        it.spinA.rotation.y = t * 0.4;
        it.spinB.rotation.z = -t * 0.55 + ph;
        it.shards.rotation.y = t * 0.3;
        it.root.children[0]!.rotation.y = t * 0.5;
        const u = it.glow.uniforms;
        u['uViewport']!.value = viewportHeight;
        // A slow heartbeat: easy to tell apart from a star once you have seen one.
        u['uPulse']!.value = 0.55 + 0.45 * Math.pow(Math.sin(t * 1.7 + ph) * 0.5 + 0.5, 3);
        if (it.burst >= 0) {
          it.burst += dt;
          const k = it.burst / 0.9;
          it.root.scale.setScalar(1 + k * 3);
          u['uSize']!.value = 70 + k * 900;
          u['uPulse']!.value = Math.max(0, 1.5 * (1 - k));
          if (k >= 1) {
            it.root.visible = false;
            it.burst = -1;
            it.root.scale.setScalar(1);
            u['uSize']!.value = 70;
          }
        }
      }
    },
  };
}
