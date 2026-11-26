import assert from 'node:assert/strict';
import { test } from 'node:test';
import { patchShader } from './glsl.ts';

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
