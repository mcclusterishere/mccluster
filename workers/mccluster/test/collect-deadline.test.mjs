/* #538: the /v1/collect forwarder must not wait on the collector forever, and its deadline must outlast the
   collector's own worst case so a slow-but-answering collector is never cut off mid-receipt. Static: no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../src/entry.js', import.meta.url), 'utf8');
const collect = await readFile(new URL('../../../supabase/functions/collect/index.ts', import.meta.url), 'utf8');

test('the collect forwarder has a bounded deadline that outlasts the collector worst case', () => {
  const at = entry.indexOf("if (path === '/v1/collect')");
  assert.ok(at > 0);
  const block = entry.slice(at, entry.indexOf('/* The browser\'s CORS preflight', at));
  const m = block.match(/setTimeout\(\(\) => collectorDeadline\.abort\(\), (\d+)\)/);
  assert.ok(m, 'the forwarder aborts at a fixed deadline');
  assert.match(block, /signal: collectorDeadline\.signal/);
  assert.match(block, /clearTimeout\(collectorTimer\)/);
  assert.match(block, /retryable: true/);
  const d = (name) => Number(collect.match(new RegExp(`deadlineMs\\("${name}", (\\d+)`))[1]);
  const worst = d('COLLECT_AUTH_DEADLINE_MS') + 2 * d('COLLECT_LOOKUP_DEADLINE_MS') + 2 * d('COLLECT_INSERT_DEADLINE_MS') + 360;
  assert.ok(Number(m[1]) > worst, `forwarder ${m[1]} ms must exceed collector worst case ${worst} ms`);
  assert.ok(Number(m[1]) < 150000, 'and end before the platform would');
});
