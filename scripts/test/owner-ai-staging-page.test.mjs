/* Test-only transport isolation; no staging listener is created by this test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { renderOwnerAiStagingPage, BOOTSTRAP_PATH } from '../staging/owner-ai/render-page.mjs';
const bootstrap = await readFile(BOOTSTRAP_PATH, 'utf8');

function harness(valid = true, mount = false) {
  const calls = [], nodes = [], events = new Map(), marker = valid ? { content: 'owner-ai-isolated-runtime' } : null;
  const nativeFetch = async (url, options) => { calls.push({ url: String(url), options }); return new Response('{}', { status: 200 }); };
  const element = () => { const node = { listeners: {}, value: '', children: [], setAttribute() {}, appendChild(child) { this.children.push(child); return child; }, insertBefore(child) { this.children.unshift(child); }, insertAdjacentElement() {}, addEventListener(type, fn) { this.listeners[type] = fn; } }; nodes.push(node); return node; };
  const document = { readyState: mount ? 'complete' : 'loading', querySelector: () => marker, querySelectorAll: () => [], getElementById: id => nodes.find(node => node.id === id) || null, addEventListener() {}, body: element(), createElement: element };
  const window = { fetch: nativeFetch, addEventListener(type, fn) { events.set(type, fn); }, MCC_SUPA: { token: async () => 'synthetic-fixture-session' } };
  const c = vm.createContext({ window, document, location: { origin: 'https://isolated.example.test', href: 'https://isolated.example.test/control.html#home:ask' }, URL, Request, Response, Object, JSON, Error });
  return { calls, window, events, node: document.getElementById, run: () => vm.runInContext(bootstrap, c), nativeFetch };
}

test('staging maps canonical transports without losing method, authorization or body', async () => {
  const h = harness(); h.run();
  const body = JSON.stringify({ method: 'tools/call', params: { name: 'core.compute.devices.list' } });
  await h.window.fetch('https://api.mccluster.org/v1/core/mcp', { method: 'POST', headers: { authorization: 'Bearer synthetic-fixture' }, body });
  assert.equal(h.calls[0].url, 'https://isolated.example.test/v1/core/mcp');
  assert.equal(h.calls[0].options.method, 'POST'); assert.equal(h.calls[0].options.body, body);
  assert.equal(h.calls[0].options.headers.authorization, 'Bearer synthetic-fixture');
  assert.equal(h.calls[0].options.credentials, 'same-origin'); assert.equal(h.calls[0].options.redirect, 'error');
  await h.window.fetch('https://zmnhbrjyhxzhkxmhkexs.supabase.co/rest/v1/ops_ai_messages?thread_id=eq.fixture');
  assert.equal(h.calls[1].url, 'https://isolated.example.test/rest/v1/ops_ai_messages?thread_id=eq.fixture');
});

test('unrelated integrations and deceptive hostnames never receive a request', async () => {
  const h = harness(); h.run();
  for (const url of ['https://api.mccluster.org.evil.example/v1/core/mcp', 'https://example.org/collect', 'data:text/plain,hello']) {
    const response = await h.window.fetch(url, { method: 'POST', body: 'do not forward' }); assert.equal(response.status, 503);
  }
  assert.equal(h.calls.length, 0);
  await h.window.fetch('/downloads/mccluster-macos-worker.manifest.json'); assert.equal(h.calls.length, 1);
});

test('the adapter refuses an ordinary product page and production HTML never imports it', async () => {
  const h = harness(false); assert.throws(h.run, /isolated staging page/); assert.equal(h.window.fetch, h.nativeFetch);
  const original = await readFile(new URL('../../control.html', import.meta.url), 'utf8');
  assert.doesNotMatch(original, /owner-ai-bootstrap|owner-ai-isolated-runtime/);
  const staged = await renderOwnerAiStagingPage();
  assert.ok(staged.indexOf('/__staging/owner-ai-bootstrap.js') < staged.indexOf('js/backend.js'));
  assert.ok(staged.includes('js/control-room-v2.js')); assert.ok(staged.includes('js/control-room/owner-ai.js'));
  assert.doesNotMatch(staged, /class="cr-env">PROD/);
});

test('explicit simulated-worker installation clears the masked credential and sends it only in the gated request body', async () => {
  const h = harness(true, true); h.run();
  const input = h.node('stagingWorkerCredential'), button = h.node('stagingInstallWorker');
  assert.equal(input.type, 'password'); assert.equal(input.autocomplete, 'off');
  input.value = 'mcen1_' + 'X'.repeat(43); h.node('stagingWorkerName').value = 'Test iMac';
  const pending = button.listeners.click();
  assert.equal(input.value, '', 'the credential is cleared synchronously before the network await');
  await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, '/__staging/workers');
  assert.equal(h.calls[0].options.method, 'POST'); assert.equal(h.calls[0].options.credentials, 'same-origin');
  assert.equal(h.calls[0].options.headers.authorization, 'Bearer synthetic-fixture-session');
  assert.equal(JSON.parse(h.calls[0].options.body).display_name, 'Test iMac');
  assert.equal(JSON.parse(h.calls[0].options.body).credential.length, 49);
  assert.equal(input.value, ''); assert.match(h.node('stagingWorkerStatus').textContent, /Refresh devices/);
  input.value = 'another private input'; h.events.get('mcc:auth-changed')(); assert.equal(input.value, '');
  input.value = 'another private input'; h.events.get('pagehide')(); assert.equal(input.value, '');
});
