import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

async function runLogin(query) {
  const html = await source('../../../login.html');
  const match = html.match(/<script>\s*(\(async function\(\)\{[\s\S]*?\}\)\(\);)\s*<\/script>/);
  assert.ok(match, 'Google sign-in script not found');
  const requests = [], navigations = [];
  let onGoogle = null;
  const google = { accounts: { id: {
    initialize({ callback }) { onGoogle = callback; },
    renderButton() {}
  } } };
  const location = {
    search: query, origin: 'https://matthew.mccluster.org',
    assign(to) { navigations.push(to); }
  };
  const elements = { status: { textContent: '', className: '' }, googleButton: {} };
  const ctx = {
    URL, URLSearchParams, location, google, window: { google },
    document: { getElementById: id => elements[id] },
    setTimeout: (f) => { f(); return 1; },
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method || 'GET' });
      return new Response(JSON.stringify(options.method === 'POST' ? { ok: true } : { googleClientId: 'test-id' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
  };
  await vm.runInNewContext(match[1], ctx);
  assert.equal(typeof onGoogle, 'function');
  await onGoogle({ credential: 'synthetic-google-credential' });
  return { requests, navigations };
}

test('Google credential never reaches query-selected auth server or javascript redirect', async () => {
  const result = await runLogin('?auth=https%3A%2F%2Fattacker.test&next=javascript%3Aalert(1)');
  assert.equal(result.requests.length, 2);
  assert.ok(result.requests.every(r => r.url.startsWith('https://auth.mccluster.org/')));
  assert.deepEqual(result.navigations, ['/account.html']);
});

test('Google callback rejects network paths, encoded origin changes and backslashes, but preserves legitimate same-origin return', async () => {
  for (const next of ['//evil.test/', '/\\evil.test/', 'https://evil.test/', 'javascript:alert(1)']) {
    const result = await runLogin('?next=' + encodeURIComponent(next));
    assert.deepEqual(result.navigations, ['/account.html'], next);
  }
  const allowed = await runLogin('?next=' + encodeURIComponent('/control.html?tab=analytics#overview'));
  assert.deepEqual(allowed.navigations, ['/control.html?tab=analytics#overview']);
});

test('shared auth callback validates navigation using URL origin and rejects backslashes', async () => {
  const html = await source('../../../auth/index.html');
  const block = html.match(/<script>\s*(\/\* OAuth callback[\s\S]*?\}\)\(\);)\s*<\/script>/);
  assert.ok(block, 'OAuth callback not found');
  const run = async (raw) => {
    const nexts = [];
    const location = { origin: 'https://matthew.mccluster.org', search: '?next=' + encodeURIComponent(raw), replace: to => nexts.push(to) };
    const ctx = { URL, URLSearchParams, location, document: { getElementById: () => ({ textContent: '', innerHTML: '', className: '' }) },
      window: { MCC: { complete: () => Promise.resolve({ id: 'test' }) } } };
    vm.runInNewContext(block[1], ctx);
    await new Promise(resolve => setImmediate(resolve));
    return nexts[0];
  };
  assert.equal(await run('/\\evil.test'), '/account.html');
  assert.equal(await run('//evil.test'), '/account.html');
  assert.equal(await run('/account.html?from=music'), '/account.html?from=music');
});

test('Whip rider, rental, operator and identity clients cannot load a URL-selected API destination', async () => {
  const files = ['rider/app.js', 'driver/app.js', 'rentals/app.js', 'rider/operator.js', 'driver/identity-client.js', 'rentals/identity-client.js'];
  for (const file of files) {
    const content = await source('../../../whip/' + file);
    assert.match(content, /https:\/\/api\.mccluster\.org/, file);
    assert.doesNotMatch(content, /get\(['"]api['"]\)|we-api-base/, file);
  }
});

test('legacy session import does not trust query-string bearer tokens', async () => {
  const backend = await source('../../../js/backend.js');
  assert.match(backend, /var raw = location\.hash\.slice\(1\);/);
  assert.doesNotMatch(backend, /location\.hash\.slice\(1\)\s*\+\s*["']&["']\s*\+\s*location\.search/);
});
