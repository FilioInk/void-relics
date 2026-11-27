/** Shared GLSL: hash noise, fbm, and the log-depth plumbing every custom shader needs. */

export const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
float fbm3o(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.07 + vec3(4.1, 1.3, 7.7);
    a *= 0.5;
  }
  return s;
}
float ridged(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0));
    p = p * 2.1 + vec3(3.3, 7.1, 1.9);
    a *= 0.5;
  }
  return s;
}
`;

/** Vertex-side declarations: three's common helpers and the log depth varyings. */
export const VERT_HEAD = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
`;
export const VERT_TAIL = /* glsl */ `
#include <logdepthbuf_vertex>
`;
export const FRAG_HEAD = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
`;
export const FRAG_TAIL = /* glsl */ `
#include <logdepthbuf_fragment>
`;

/** String surgery on one of three's shaders; loud if an upgrade moved a line it relies on. */
export function patchShader(source: string, edits: ReadonlyArray<readonly [string, string]>): string {
  let out = source;
  for (const [from, to] of edits) {
    if (!out.includes(from)) throw new Error(`patchShader: "${from}" not found — did three change?`);
    out = out.replace(from, to);
  }
  return out;
}
