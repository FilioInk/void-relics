import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { backgroundVertexFix, patchShader } from './glsl.ts';

test('patchShader replaces each anchor once, in order', () => {
  const src = 'uniform sampler2D a;\nvoid main() { gl_FragColor = texture2D(a, uv); }';
  const out = patchShader(src, [
    ['uniform sampler2D a;', 'uniform sampler2D a;\nuniform sampler2D b;'],
    ['gl_FragColor = texture2D(a, uv);', 'gl_FragColor = texture2D(a, uv) + texture2D(b, uv);'],
  ]);
  assert.match(out, /uniform sampler2D b;/);
  assert.match(out, /\+ texture2D\(b, uv\)/);
});

test('patchShader fails loudly when an anchor is gone', () => {
  assert.throws(() => patchShader('void main() {}', [['gl_FragColor = x;', 'y']]), /not found/);
});

test('the sky box stays inside the clip volume under reversed depth', () => {
  const out = backgroundVertexFix(THREE.ShaderLib.backgroundCube.vertexShader);
  const reversed = out.slice(out.indexOf('#ifdef USE_REVERSED_DEPTH_BUFFER'), out.indexOf('#else'));
  const standard = out.slice(out.indexOf('#else'), out.indexOf('#endif'));
  // Reversed depth clips at 0 <= z <= w, and z = w is the near plane: keep strictly inside.
  assert.match(reversed, /gl_Position\.z = 0\.5 \* gl_Position\.w;/);
  // The regular depth buffer keeps three's far-plane trick unchanged.
  assert.match(standard, /gl_Position\.z = gl_Position\.w;/);
});
