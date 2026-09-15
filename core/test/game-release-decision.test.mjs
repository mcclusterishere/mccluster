import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/executors/game-release-decision.mjs', import.meta.url), 'utf8');

test('release decision only accepts explicit approve/reject', () => {
  assert.match(source, /\['approve', 'reject'\]/);
  assert.match(source, /game_release_decision decision must be approve or reject/);
});

test('approved validated build queues preview deployment', () => {
  assert.match(source, /jobType:\s*'preview_deploy'/);
  assert.match(source, /game_studio\.preview_approved/);
  assert.match(source, /state:\s*'preview_queued'/);
});

test('rejected validated build queues revision plus validation watcher', () => {
  assert.match(source, /jobType:\s*'code_patch'/);
  assert.match(source, /jobType:\s*'game_implementation_collect'/);
  assert.match(source, /game_studio\.preview_rejected/);
  assert.match(source, /state:\s*'revision_queued'/);
});
