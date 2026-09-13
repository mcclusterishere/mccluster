import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ai/objectives.js', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/ai/router.js', import.meta.url), 'utf8');

test('objective synthesis jobs persist references instead of transcript payloads', () => {
  assert.match(source, /private_context_reference_only: true/);
  assert.match(source, /conversation_id: conversationId/);
  assert.match(source, /receipt_id: receiptId/);
  assert.doesNotMatch(source, /messages\s*[,}]/);
  assert.doesNotMatch(source, /source_url/);
  assert.doesNotMatch(source, /external_conversation_id/);
});

test('successful AI ingest automatically attempts objective synthesis', () => {
  assert.match(router, /queueObjectiveSynthesis/);
  assert.match(router, /objective_synthesis: synthesis/);
});
