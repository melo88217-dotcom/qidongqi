import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('runtime preload exposes the conflict release API', () => {
  const preload = fs.readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /releasePortConflict/);
  assert.match(preload, /project:releaseConflict/);
});
