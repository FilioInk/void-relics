import * as THREE from 'three';
import { FRAG_HEAD, FRAG_TAIL, VERT_HEAD, VERT_TAIL } from './glsl.ts';

/**
 * Space dust around the camera, wrapped in a box so it never runs out. Each mote is a short
 * line stretched along the ship's velocity: the faster you go, the longer the streaks.
 */
export type DustView = { lines: THREE.LineSegments; update(camera: THREE.Camera, velocity: THREE.Vector3, tint: THREE.Color): void };

export function createDust(): DustView {
  const count = 1800;
  const box = 700;
  const pos = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * box;
    const y = Math.random() * box;
    const z = Math.random() * box;
    pos.set([x, y, z, x, y, z], i * 6);
    end[i * 2] = 0;
    end[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uBox: { value: box }, uTint: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: /* glsl */ `
      ${VERT_HEAD}
      attribute float aEnd;
      uniform vec3 uCam;
      uniform vec3 uVel;
      uniform float uBox;
      varying float vA;
      void main() {
        vec3 p = mod(position - uCam, uBox) - uBox * 0.5 + uCam;
        float speed = length(uVel);
        // Streak length follows speed but is capped so boosting reads as motion, not rain.
        vec3 streak = uVel * 0.03;
        float sl = length(streak);
        if (sl > 45.0) streak *= 45.0 / sl;
        p -= streak * aEnd;
        float d = length(p - uCam) / (uBox * 0.5);
        vA = (1.0 - smoothstep(0.55, 1.0, d)) * smoothstep(8.0, 120.0, speed) * (1.0 - aEnd * 0.85);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        ${VERT_TAIL}
      }`,
    fragmentShader: /* glsl */ `
      ${FRAG_HEAD}
      uniform vec3 uTint;
      varying float vA;
      void main() {
        gl_FragColor = vec4(uTint * vA * 0.55, vA);
        ${FRAG_TAIL}
      }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return {
    lines,
    update(camera, velocity, tint) {
      mat.uniforms['uCam']!.value.copy(camera.position);
      mat.uniforms['uVel']!.value.copy(velocity);
      mat.uniforms['uTint']!.value.copy(tint);
    },
  };
}
