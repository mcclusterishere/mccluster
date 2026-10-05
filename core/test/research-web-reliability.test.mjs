import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedResearchQuery, researchWeb } from '../src/tools/research.mjs';

test('research.web bounds arbitrary callers inside the provider margin', () => {
  const value = 'latest '.concat('Connecticut municipal budget hearing updates '.repeat(30));
  const query = boundedResearchQuery(value);
  assert.ok(query.length <= 580, query.length);
  assert.ok(query.split(/\s+/).length <= 70, query.split(/\s+/).length);
});

test('research.web falls back when Brave refuses a request', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.includes('api.search.brave.com')) return new Response('bad', { status: 429 });
    if (url.includes('html.duckduckgo.com')) {
      return new Response('<a class="result__a" href="https://example.com/x">Result</a><a class="result__snippet">Fallback worked.</a>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    }
    throw new Error('unexpected fetch: ' + url);
  };
  try {
    const out = await researchWeb({ objective: 'latest test', limit: 1 }, { BRAVE_SEARCH_API_KEY: 'key' });
    assert.equal(out.provider, 'duckduckgo-html');
    assert.equal(out.result_count, 1);
    assert.equal(out.provenance.fallback_from, 'brave');
    assert.match(out.provenance.fallback_reason, /429/);
    assert.equal(seen.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});
