import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playLabel } from './screens.ts';

test('the main game button names the hunt, and shows the score once relics are found', () => {
  assert.equal(playLabel(0), 'Collect relics');
  assert.equal(playLabel(7), 'Collect relics — 7/20');
});
