import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOllamaStream, collectAdapterStream, readJsonLines } from '../src/compute/ndjson.mjs';

function stream(lines) { return new Response(new ReadableStream({ start(controller) { for (const line of lines) controller.enqueue(new TextEncoder().encode(line)); controller.close(); } }), { headers: { 'content-type': 'application/x-ndjson' } }); }
test('Ollama streaming preserves visible text and tool calls without publishing private thinking', async () => {
  const progress = [];
  const result = await collectOllamaStream(stream([
    '{"model":"qwen3:8b","message":{"thinking":"private work"},"done":false}\n',
    '{"message":{"content":"Hello "},"done":false}\n{"message":{"content":"world","tool_calls":[{"function":{"name":"read","arguments":{}}}]},"done":false}\n',
    '{"done":true,"eval_count":2,"eval_duration":1000000000}\n',
  ]), update => progress.push(update));
  assert.equal(result.message.content, 'Hello world'); assert.equal(result.message.tool_calls.length, 1);
  assert.equal(JSON.stringify(progress).includes('private work'), false); assert.ok(progress.some(item => item.content === 'Hello '));
});
test('an interrupted stream cannot masquerade as a completed answer', async () => {
  await assert.rejects(collectOllamaStream(stream(['{"message":{"content":"unfinished"}}\n'])), /complete|finish|ended/i);
  await assert.rejects(collectAdapterStream(stream(['{"type":"progress","progress":{"delta":"unfinished"}}\n'])), /complete|finish|ended/i);
});
test('stream parser handles chunk boundaries and enforces bounded upstream data', async () => {
  const items = [];
  await readJsonLines(stream(['{"messa', 'ge":"fine"}\n']), item => items.push(item));
  assert.deepEqual(items, [{ message: 'fine' }]);
  await assert.rejects(readJsonLines(stream(['x'.repeat(50)]), () => {}, { maxLineBytes: 20, maxBytes: 40 }), /large|limit|exceed/i);
});
