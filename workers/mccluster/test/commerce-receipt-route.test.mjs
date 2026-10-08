/* The receipt route through the real Worker entry: public (no sign-in, it
   answers the buyer's own browser after Stripe), never cached, and refusing
   anything but a Checkout Session id before it reads. */
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
const { default: entry } = await import('../src/entry.js');

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const get = (q, origin = 'https://matthew.mccluster.org') =>
  entry.fetch(new Request(`https://api.mccluster.org/v1/commerce/receipt${q}`, { headers: { origin } }), env, { waitUntil() {} });

test('a receipt needs no sign-in, is never cached, and answers the site', async () => {
  const original = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await get('?session=cs_live_a1B2c3D4e5F6g7H8');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://matthew.mccluster.org');
    assert.deepEqual(await res.json(), { ok: true, recorded: false, test: false });
    assert.ok(asked.every((u) => u.startsWith('https://example.supabase.co/rest/v1/work_orders?')), 'only the order lookup ran');

    asked.length = 0;
    const bad = await get('?session=not-a-session');
    assert.equal(bad.status, 400);
    assert.equal(asked.length, 0, 'nothing read for a bad id');
  } finally {
    globalThis.fetch = original;
  }
});
