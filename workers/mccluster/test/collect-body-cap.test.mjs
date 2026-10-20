/* /v1/collect is public and reflects any Origin (customer sites post with a
   site_key from their own domains), then forwards with the service-role key.
   It must refuse an oversized body before that hop, whether or not the
   client declared a Content-Length. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.html$/.test(url)) {
      const text = readFileSync(new URL(url), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return next(url, context);
  }
});
const { default: entry, COLLECT_MAX_BODY_BYTES } = await import('../src/entry.js');

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const ORIGIN = 'https://customer.example';

function withCollector(fn) {
  const original = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith('/functions/v1/collect')) {
      forwarded.push({ href, body: init.body });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, { status: 201 });
  };
  return Promise.resolve().then(() => fn(forwarded)).finally(() => { globalThis.fetch = original; });
}

function streamOf(bytes, chunk = 8192) {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes) { controller.close(); return; }
      const n = Math.min(chunk, bytes - at);
      at += n;
      controller.enqueue(new Uint8Array(n).fill(0x61));
    }
  });
}

const post = (init) => entry.fetch(new Request('https://api.mccluster.org/v1/collect', {
  method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(init.headers || {}) }, ...init.rest
}), env, { waitUntil() {} });

test('the cap matches the collector edge function', () => {
  const src = readFileSync(new URL('../../../supabase/functions/collect/index.ts', import.meta.url), 'utf8');
  const m = src.match(/const MAX_BODY_BYTES = ([0-9* ]+);/);
  assert.ok(m, 'collector declares MAX_BODY_BYTES');
  assert.equal(COLLECT_MAX_BODY_BYTES, Function(`return ${m[1]}`)());
});

test('a declared oversized body is refused with 413 and never forwarded', async () => {
  await withCollector(async (forwarded) => {
    const res = await post({
      headers: { 'content-length': String(COLLECT_MAX_BODY_BYTES + 1) },
      rest: { body: 'x'.repeat(COLLECT_MAX_BODY_BYTES + 1) }
    });
    assert.equal(res.status, 413);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    assert.deepEqual(await res.json(), { ok: false, reason: 'too large' });
    assert.equal(forwarded.length, 0);
  });
});

test('an oversized streamed body without Content-Length is refused while reading', async () => {
  await withCollector(async (forwarded) => {
    const res = await post({ rest: { body: streamOf(COLLECT_MAX_BODY_BYTES * 4), duplex: 'half' } });
    assert.equal(res.status, 413);
    assert.equal(forwarded.length, 0);
  });
});

test('a body at the cap is forwarded unchanged and the third-party origin is still reflected', async () => {
  await withCollector(async (forwarded) => {
    const body = JSON.stringify({ site_key: 'mca_' + '0'.repeat(32), events: [], pad: '' });
    const padded = body.replace('"pad":""', `"pad":"${'p'.repeat(COLLECT_MAX_BODY_BYTES - body.length)}"`);
    assert.equal(new TextEncoder().encode(padded).byteLength, COLLECT_MAX_BODY_BYTES);
    const res = await post({ rest: { body: padded } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].body, padded);
  });
});
