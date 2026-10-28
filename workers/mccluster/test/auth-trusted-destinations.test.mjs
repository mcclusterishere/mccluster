import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

/* login.html is a thin same-origin forwarder to account.html (the M Account
   sign-in). It once posted a Google credential to an auth host that was never
   provisioned; these tests pin that the page makes no request at all and only
   ever lands on account.html, carrying a sanitised ?next= when one is usable. */
async function runLogin(query) {
  const html = await source('../../../login.html');
  const match = html.match(/<script>\s*(\/\* THIN FORWARDER[\s\S]*?\}\)\(\);)\s*<\/script>/);
  assert.ok(match, 'forwarder script not found');
  const navigations = [], requests = [];
  const anchor = { href: 'account.html' };
  const location = {
    search: query, origin: 'https://matthew.mccluster.org',
    replace(to) { navigations.push(to); }, assign(to) { navigations.push(to); }
  };
  const ctx = {
    URL, URLSearchParams, encodeURIComponent, location,
    document: { getElementById: (id) => (id === 'go' ? anchor : null) },
    fetch: async (url) => { requests.push(String(url)); return new Response('{}'); }
  };
  vm.runInNewContext(match[1], ctx);
  return { navigations, requests, anchor };
}

test('login.html never speaks to a network: no auth service, no Google script, no fetch', async () => {
  const html = await source('../../../login.html');
  assert.doesNotMatch(html, /auth\.mccluster\.org/);
  assert.doesNotMatch(html, /accounts\.google\.com/);
  assert.doesNotMatch(html, /fetch\(/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  const result = await runLogin('?auth=https%3A%2F%2Fattacker.test&next=javascript%3Aalert(1)');
  assert.deepEqual(result.requests, []);
  assert.deepEqual(result.navigations, ['account.html']);
  assert.equal(result.anchor.href, 'account.html', 'the no-script link agrees with the redirect');
});

test('login.html forwards to account.html alone for network paths, encoded origin changes, backslashes and schemes', async () => {
  for (const next of ['//evil.test/', '/\\evil.test/', 'https://evil.test/', 'https://evil.example', '//evil.example', 'javascript:alert(1)', 'data:text/html,hi', '/account.html', 'account.html?from=music']) {
    const result = await runLogin('?next=' + encodeURIComponent(next));
    assert.deepEqual(result.navigations, ['account.html'], next);
  }
});

test('login.html carries a legitimate same-origin return into account.html, as a rooted path', async () => {
  const allowed = await runLogin('?next=' + encodeURIComponent('/control.html?tab=analytics#overview'));
  assert.deepEqual(allowed.navigations, ['account.html?next=' + encodeURIComponent('/control.html?tab=analytics#overview')]);
  /* the live entry points send a relative page; it leaves here rooted, which MCC.safeNext accepts */
  const relative = await runLogin('?next=' + encodeURIComponent('identity-verify.html?level=v1_live_intro'));
  assert.deepEqual(relative.navigations, ['account.html?next=' + encodeURIComponent('/identity-verify.html?level=v1_live_intro')]);
  assert.equal(relative.anchor.href, relative.navigations[0]);
});

test('every live sign-in door goes to account.html directly, never through login.html', async () => {
  const doors = {
    'js/identity-verify.js': /href="account\.html\?next=' \+ encodeURIComponent\("identity-verify\.html" \+ location\.search\)/,
    'js/live-mission-capture.js': /w\.location\.href = "account\.html\?next=" \+ encodeURIComponent\(/,
    'js/member-desk.js': /else location\.href = "account\.html"; return;/,
    'js/policy-fellowship-desk.js': /<a href="account\.html">Sign in<\/a>/
  };
  for (const [file, expected] of Object.entries(doors)) {
    const content = await source('../../../' + file);
    assert.match(content, expected, file);
    assert.doesNotMatch(content, /login\.html/, file + ' still names login.html');
  }
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
