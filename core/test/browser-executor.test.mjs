// The browser executor against real Chromium and the loopback fixture: the
// action vocabulary end to end, the JPEG bound, the private-network rule kept
// on through the fixture-host mapping (loopback and redirect-to-loopback
// refused), allowlist, port and scheme refusals, downloads cancelled, dialogs
// dismissed, popups closed, websockets closed, loopback subresources blocked,
// DNS rebinding defeated (a name that turns private after the check is still
// connected at the address the check validated), WebRTC kept off loopback UDP,
// the egress proxy's own refusals, the step, time and output caps, one task at
// a time, and the 503 answers without Playwright or a policy file. Every
// executor here runs with the test-only rebinding resolver preloaded
// (helpers/browser-rebinding-dns.mjs; it changes only the rebind-*.test names).
// One Chromium at a time; every process started here is stopped in after().
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startBrowserFixture, startLanService } from './helpers/browser-fixture-server.mjs';

const EXECUTOR = fileURLToPath(new URL('../src/compute/browser-executor.mjs', import.meta.url));
const REBINDING_DNS = pathToFileURL(fileURLToPath(new URL('./helpers/browser-rebinding-dns.mjs', import.meta.url))).href;
const REBIND_NAMES = ['rebind-nav.test', 'rebind-sub.test', 'rebind-hop.test', 'rebind-idle.test'];
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
// The browser these tests drive, found where the executor finds it (MCCLUSTER_BROWSER_PLAYWRIGHT_DIR is the owner's pin
// and the only place tried; otherwise the checkout root, then the executor's own path), and its Chromium on disk.
// Without one, the tests skip as unverified here, unless MCCLUSTER_BROWSER_TESTS_REQUIRED=1 (the browser-executor CI
// job): then the first test fails and says what is missing, so the job can never pass with every test skipped
// (verification finding N2V-m1; proof: test/browser-executor-required.test.mjs).
const REQUIRED = /^(?:1|true)$/i.test(String(process.env.MCCLUSTER_BROWSER_TESTS_REQUIRED || ''));
function browserMissing() {
  const explicit = process.env.MCCLUSTER_BROWSER_PLAYWRIGHT_DIR;
  const loaders = explicit
    ? [() => createRequire(EXECUTOR)(path.resolve(explicit))]
    : [() => createRequire(path.join(REPO_ROOT, 'package.json'))('playwright'), () => createRequire(EXECUTOR)('playwright')];
  let playwright = null;
  for (const load of loaders) {
    try { const loaded = load(); if (loaded?.chromium?.executablePath) { playwright = loaded; break; } } catch { /* the next place */ }
  }
  if (!playwright) return `playwright not found${explicit ? ` in ${path.resolve(explicit)}` : ''}`;
  let chromium = '';
  try { chromium = playwright.chromium.executablePath(); } catch { chromium = ''; }
  return chromium && existsSync(chromium) ? null : `chromium not installed (${chromium || 'no executable path'})`;
}
const MISSING = browserMissing();
if (MISSING) console.log(`browser-executor: ${MISSING}, executor tests skipped (unverified here)`);
const skip = MISSING ? MISSING : false;
if (REQUIRED) {
  test('MCCLUSTER_BROWSER_TESTS_REQUIRED: the browser these tests need is installed, so none of them is skipped', () => {
    assert.equal(MISSING, null, `MCCLUSTER_BROWSER_TESTS_REQUIRED is set and ${MISSING}: install Chromium through Playwright's own installer before these tests`);
  });
}
const FIXTURE_HOST = 'fixture.test';

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  await exited;
  clearTimeout(timer);
}

// Spawns the executor on an OS-assigned port; the FIRST stdout line is the ready event.
async function spawnExecutor(env) {
  const child = spawn(process.execPath, ['--import', REBINDING_DNS, EXECUTOR], {
    env: { ...process.env, MCCLUSTER_BROWSER_EXECUTOR_PORT: '0', MCCLUSTER_BROWSER_TEST_FIXTURE_HOST: FIXTURE_HOST, MCCLUSTER_BROWSER_NO_SANDBOX: '1', MCCLUSTER_TEST_REBIND_NAMES: REBIND_NAMES.join(','), ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ready line within 15 s; stderr=${output.stderr}`)), 15000);
    const check = () => {
      if (!output.stdout.includes('\n')) return;
      clearTimeout(timer); child.stdout.off('data', check);
      try {
        const first = JSON.parse(output.stdout.split('\n')[0]);
        assert.equal(first.event, 'browser_executor_ready', 'the ready event stays the first stdout line');
        resolve(first);
      } catch (error) { reject(error); }
    };
    child.stdout.on('data', check);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`executor exited ${code}; stderr=${output.stderr}`)); });
  });
  const url = `http://127.0.0.1:${ready.port}`;
  const get = async (route) => { const r = await fetch(`${url}${route}`); return { status: r.status, body: await r.json() }; };
  const post = async (route, body) => { const r = await fetch(`${url}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const events = () => output.stdout.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { child, ready, url, get, post, events, output, stop: () => stop(child) };
}

let fixture;
let lan;
let dir;
let policyPath;
let executor;
const execute = (actions, extra = {}) => executor.post('/execute', { capability: 'browser.act', implementation: 'chromium.local', input: { actions, ...extra }, metadata: { source: 'test' }, priority: 0 });
const outcomes = (result) => result.body.steps.map((step) => step.outcome);
const writePolicy = (hosts, allowSubdomains = false) => writeFile(policyPath, JSON.stringify({ schema: 'mccluster-browser-policy/1', allowed_hosts: hosts, allow_subdomains: allowSubdomains }));

before(async () => {
  if (MISSING) return;
  fixture = await startBrowserFixture({ host: FIXTURE_HOST });
  lan = await startLanService({ address: '127.0.0.2', port: fixture.port });
  dir = await mkdtemp(path.join(os.tmpdir(), 'mccluster-browser-executor-'));
  policyPath = path.join(dir, 'browser-policy.json');
  await writePolicy([`${FIXTURE_HOST}:${fixture.port}`]);
  executor = await spawnExecutor({ MCCLUSTER_BROWSER_PROFILE_DIR: path.join(dir, 'profile'), MCCLUSTER_BROWSER_POLICY: policyPath });
});

after(async () => {
  if (executor) await executor.stop();
  if (lan) await lan.close();
  if (fixture) await fixture.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

// One raw exchange with the executor's egress proxy: the status line and the
// body of its answer (the connection is closed after the answer).
function rawProxyExchange(port, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let data = '';
    const timer = setTimeout(() => { socket.destroy(); resolve({ status: 0, text: data }); }, 10000);
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk) => {
      data += chunk;
      // A tunnel stays open: the status line of the CONNECT answer is enough.
      if (/^HTTP\/1\.1 200/.test(data) && data.includes('\r\n\r\n') && /^CONNECT /.test(request)) { clearTimeout(timer); socket.destroy(); resolve({ status: 200, text: data }); }
    });
    socket.on('end', () => { clearTimeout(timer); resolve({ status: Number((/^HTTP\/1\.[01] (\d{3})/.exec(data) || [])[1] || 0), text: data }); });
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

test('health says what it has; ready launches the persistent Chromium once', { skip, timeout: 60000 }, async () => {
  assert.equal(executor.ready.test_fixture_host, FIXTURE_HOST);
  assert.equal(typeof executor.ready.playwright, 'string');
  const health = await executor.get('/health');
  assert.equal(health.status, 200, JSON.stringify(health.body));
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, 'mccluster-browser-executor');
  assert.equal(health.body.playwright.found, true);
  assert.match(health.body.playwright.version, /^\d+\.\d+\.\d+/);
  assert.equal(health.body.policy.schema_ok, true);
  assert.equal(health.body.policy.allowed_hosts_count, 1);
  assert.equal(health.body.policy.allow_subdomains, false);
  assert.equal(health.body.headed, false);
  assert.equal(health.body.browser_ready, false, 'lazy: no Chromium before the first /ready or task');
  assert.equal(health.body.test_fixture_host, FIXTURE_HOST);
  assert.equal(health.body.busy, false);
  const ready = await executor.get('/ready');
  assert.equal(ready.status, 200, JSON.stringify(ready.body));
  assert.equal(ready.body.browser_ready, true);
  assert.match(String(ready.body.chromium_version), /^\d+\./);
  assert.equal((await executor.get('/health')).body.browser_ready, true);
  assert.equal(executor.events().filter((e) => e.event === 'browser_executor_launched').length, 1);
});

test('the vocabulary end to end: open, read, find, click, read, back, screenshot, done', { skip, timeout: 60000 }, async () => {
  const result = await execute([
    { type: 'open', url: `${fixture.origin}/` },
    { type: 'read' },
    { type: 'find', role: 'link', name: 'Second page' },
    { type: 'click', handle: 'h1' },
    { type: 'read', max_chars: 500 },
    { type: 'back' },
    { type: 'screenshot' },
    { type: 'done', note: 'toured' }
  ]);
  assert.equal(result.status, 200, JSON.stringify(result.body).slice(0, 500));
  const out = result.body;
  assert.equal(out.ok, true, JSON.stringify(out.steps));
  assert.equal(out.implementation, 'chromium.local');
  assert.deepEqual(outcomes(result), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  assert.deepEqual(out.steps[0].result, { url: `${fixture.origin}/`, status: 200, redirects: 0 });
  assert.equal(out.steps[1].result, undefined, 'read goes to page, not to the step');
  const [handle] = out.steps[2].result.handles;
  assert.equal(handle.handle, 'h1');
  assert.equal(handle.role, 'link');
  assert.equal(handle.tag, 'a');
  assert.equal(handle.text, 'Second page');
  assert.equal(handle.visible, true);
  assert.equal(out.steps[2].result.total, 1);
  assert.match(out.page.text, /PAGE_TWO_TEXT/, 'the last read is the page block');
  assert.equal(out.page.url, `${fixture.origin}/page2`);
  assert.equal(out.page.title, 'Fixture');
  assert.deepEqual(out.steps[5].result, { url: `${fixture.origin}/` }, 'back returned home');
  assert.deepEqual(out.steps[7].result, { note: 'toured' });
  const shot = out.screenshot;
  assert.equal(shot.type, 'image/jpeg');
  assert.equal(shot.width, 1280);
  assert.equal(shot.height, 800);
  assert.ok(shot.bytes <= 200_000, `screenshot ${shot.bytes} bytes`);
  const bytes = Buffer.from(shot.base64, 'base64');
  assert.equal(bytes.length, shot.bytes);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
  assert.deepEqual(out.steps[6].result, { width: 1280, height: 800, bytes: shot.bytes });
  assert.equal(out.usage.steps, 8);
  assert.equal(out.usage.navigations, 2, 'open and back');
  assert.equal(out.usage.requests_blocked, 0);
  assert.ok(Number.isFinite(out.usage.wall_ms) && Number.isFinite(out.usage.output_bytes));
  const actions = executor.events().filter((e) => e.event === 'browser_action' && e.task_id === out.task_id);
  assert.equal(actions.length, 8);
  assert.deepEqual(actions.map((e) => e.type), ['open', 'read', 'find', 'click', 'read', 'back', 'screenshot', 'done']);
  assert.ok(actions.every((e) => e.host === FIXTURE_HOST && e.outcome === 'ok' && e.code === null && Number.isFinite(e.ms)));
});

test('read: body text without scripts, styles and hidden nodes; http(s) links only; visible form fields with labels', { skip, timeout: 60000 }, async () => {
  const home = await execute([{ type: 'open', url: `${fixture.origin}/` }, { type: 'read', max_chars: 20 }], { screenshot_on_done: false });
  assert.equal(home.body.ok, true);
  assert.equal(home.body.page.text.length, 20);
  assert.equal(home.body.page.truncated, true);
  assert.equal(home.body.screenshot, undefined);
  const full = await execute([{ type: 'open', url: `${fixture.origin}/` }, { type: 'read' }], { screenshot_on_done: false });
  const page = full.body.page;
  assert.match(page.text, /Fixture home/);
  assert.match(page.text, /Welcome to the fixture home page/);
  assert.doesNotMatch(page.text, /HIDDEN_TEXT|SCRIPT_TEXT|decoy/);
  assert.equal(page.truncated, false);
  assert.deepEqual(page.links.map((link) => link.href), [`${fixture.origin}/page2`, `${fixture.origin}/form`, `${fixture.loopback}/private`], 'mailto is not a link the browser may follow');
  assert.equal(page.links[0].text, 'Second page');
  const form = await execute([{ type: 'open', url: `${fixture.origin}/form` }, { type: 'read', links: false }], { screenshot_on_done: false });
  assert.equal(form.body.page.links, undefined);
  assert.deepEqual(form.body.page.forms, [{ action: `${fixture.origin}/submitted`, method: 'get', fields: [{ name: 'q', type: 'text', label: 'Query' }, { name: 'region', type: 'select', label: 'Region' }] }], 'the hidden field is not listed');
});

test('forms: find by role, type, select, click the submit button; type with submit presses Enter', { skip, timeout: 60000 }, async () => {
  const result = await execute([
    { type: 'open', url: `${fixture.origin}/form` },
    { type: 'find', role: 'textbox' },
    { type: 'find', role: 'combobox' },
    { type: 'type', handle: 'h1', text: 'kittens' },
    { type: 'select', handle: 'h2', value: 'us' },
    { type: 'find', role: 'button', name: 'Search', exact: true },
    { type: 'click', handle: 'h3' },
    { type: 'read' }
  ], { screenshot_on_done: false });
  assert.equal(result.body.ok, true, JSON.stringify(result.body.steps));
  assert.equal(result.body.steps[1].result.handles[0].name, 'Query', 'the label names the field');
  assert.equal(result.body.steps[1].result.handles[0].tag, 'input');
  assert.equal(result.body.steps[2].result.handles[0].tag, 'select');
  assert.match(result.body.page.text, /SUBMITTED q=kittens region=us/);
  assert.equal(result.body.page.url, `${fixture.origin}/submitted?q=kittens&region=us&h=1`);
  const submit = await execute([
    { type: 'open', url: `${fixture.origin}/form` },
    { type: 'find', role: 'textbox' },
    { type: 'type', handle: 'h1', text: 'dogs', submit: true },
    { type: 'read', max_chars: 200 }
  ], { screenshot_on_done: false });
  assert.equal(submit.body.ok, true, JSON.stringify(submit.body.steps));
  assert.match(submit.body.page.text, /SUBMITTED q=dogs region=eu/);
  const unknown = await execute([{ type: 'open', url: `${fixture.origin}/form` }, { type: 'click', handle: 'h9' }, { type: 'read' }]);
  assert.equal(unknown.body.ok, false);
  assert.deepEqual(outcomes(unknown), ['ok', 'refused', 'skipped']);
  assert.equal(unknown.body.steps[1].error.code, 'BROWSER_HANDLE_UNKNOWN');
  assert.equal(unknown.body.refused.code, 'BROWSER_HANDLE_UNKNOWN');
  const stale = await execute([{ type: 'open', url: `${fixture.origin}/form` }, { type: 'click', handle: 'h1' }]);
  assert.equal(stale.body.steps[1].error.code, 'BROWSER_HANDLE_UNKNOWN', 'handles never survive a task');
});

test('scroll and wait complete; a find that matches nothing returns no handles', { skip, timeout: 60000 }, async () => {
  const result = await execute([
    { type: 'open', url: `${fixture.origin}/scroll` },
    { type: 'scroll', direction: 'down', amount: 3 },
    { type: 'wait', ms: 150 },
    { type: 'wait', for: 'load', timeout_ms: 2000 },
    { type: 'scroll', direction: 'up' },
    { type: 'find', text: 'NOWHERE_TEXT' },
    { type: 'find', text: 'BOTTOM_MARKER', exact: true }
  ], { screenshot_on_done: false });
  assert.equal(result.body.ok, true, JSON.stringify(result.body.steps));
  assert.deepEqual(result.body.steps[5].result, { handles: [], total: 0 });
  assert.equal(result.body.steps[6].result.handles[0].tag, 'p');
  assert.equal(result.body.steps[6].result.handles[0].handle, 'h1', 'handles are minted per task starting at h1');
});

test('a loopback navigation is refused before Chromium touches it, even when the owner allowlisted the address; later steps are skipped', { skip, timeout: 60000 }, async () => {
  fixture.hits.private = 0;
  const outside = await execute([{ type: 'open', url: `${fixture.loopback}/private` }, { type: 'read' }, { type: 'done' }]);
  assert.equal(outside.status, 200);
  assert.equal(outside.body.ok, false);
  assert.deepEqual(outcomes(outside), ['refused', 'skipped', 'skipped']);
  assert.equal(outside.body.steps[0].error.code, 'BROWSER_HOST_NOT_ALLOWED', 'the allowlist is checked first');
  assert.equal(outside.body.usage.navigations, 0);
  assert.equal(outside.body.screenshot, undefined, 'about:blank or a stale page is not screenshotted');
  await writePolicy([`${FIXTURE_HOST}:${fixture.port}`, `127.0.0.1:${fixture.port}`, `localhost:${fixture.port}`, `[::1]:${fixture.port}`]);
  try {
    for (const url of [`${fixture.loopback}/private`, `http://localhost:${fixture.port}/private`, `http://[::1]:${fixture.port}/private`]) {
      const refused = await execute([{ type: 'open', url }, { type: 'read' }]);
      assert.equal(refused.body.ok, false, url);
      assert.deepEqual(outcomes(refused), ['refused', 'skipped'], url);
      assert.equal(refused.body.steps[0].error.code, 'BROWSER_PRIVATE_ADDRESS', `${url}: ${refused.body.steps[0].error.reason}`);
      assert.equal(refused.body.refused.code, 'BROWSER_PRIVATE_ADDRESS');
      assert.doesNotMatch(refused.body.steps[0].error.reason, /127\.0\.0\.1|::1/, 'the reason never echoes an address');
      assert.equal(refused.body.usage.navigations, 0, url);
    }
  } finally {
    await writePolicy([`${FIXTURE_HOST}:${fixture.port}`]);
  }
  assert.equal(fixture.hits.private, 0);
});

test('a redirect to a loopback address is aborted mid-navigation with the refusal recorded; a redirect inside the allowlist is followed', { skip, timeout: 60000 }, async () => {
  fixture.hits.private = 0;
  const result = await execute([{ type: 'open', url: `${fixture.origin}/redirect-private` }, { type: 'read' }]);
  assert.equal(result.body.ok, false, JSON.stringify(result.body.steps));
  assert.deepEqual(outcomes(result), ['failed', 'skipped']);
  assert.equal(result.body.steps[0].error.code, 'BROWSER_NAVIGATION_FAILED');
  assert.equal(result.body.steps[0].error.refusal.code, 'BROWSER_HOST_NOT_ALLOWED', 'the redirect hop was checked like an open: the allowlist first');
  assert.equal(result.body.failed.refusal.code, 'BROWSER_HOST_NOT_ALLOWED');
  assert.ok(result.body.usage.requests_blocked >= 1);
  assert.equal(fixture.hits.private, 0, 'the loopback target was never reached');
  await writePolicy([`${FIXTURE_HOST}:${fixture.port}`, `127.0.0.1:${fixture.port}`]);
  try {
    const allowlisted = await execute([{ type: 'open', url: `${fixture.origin}/redirect-private` }, { type: 'read' }]);
    assert.equal(allowlisted.body.ok, false, JSON.stringify(allowlisted.body.steps));
    assert.equal(allowlisted.body.steps[0].error.refusal.code, 'BROWSER_PRIVATE_ADDRESS', 'an allowlisted loopback address is still refused at the hop');
    assert.equal(fixture.hits.private, 0);
  } finally {
    await writePolicy([`${FIXTURE_HOST}:${fixture.port}`]);
  }
  const followed = await execute([{ type: 'open', url: `${fixture.origin}/redirect-ok` }, { type: 'read', max_chars: 100 }], { screenshot_on_done: false });
  assert.equal(followed.body.ok, true, JSON.stringify(followed.body.steps));
  assert.equal(followed.body.steps[0].result.url, `${fixture.origin}/ok`);
  assert.equal(followed.body.steps[0].result.redirects, 1);
  assert.match(followed.body.page.text, /OK_PAGE/);
  assert.equal(followed.body.page.url, `${fixture.origin}/ok`, 'the page lands on the real target URL');
  const chain = await execute([{ type: 'open', url: `${fixture.origin}/redirect-chain` }, { type: 'read', max_chars: 100 }], { screenshot_on_done: false });
  assert.equal(chain.body.ok, true, JSON.stringify(chain.body.steps));
  assert.equal(chain.body.steps[0].result.redirects, 2);
  assert.equal(chain.body.steps[0].result.url, `${fixture.origin}/ok`);
  assert.match(chain.body.page.text, /OK_PAGE/);
  fixture.hits.private = 0;
  const chainPrivate = await execute([{ type: 'open', url: `${fixture.origin}/redirect-chain-private` }]);
  assert.equal(chainPrivate.body.ok, false, `the second hop of a chain is checked like the first: ${JSON.stringify(chainPrivate.body.steps)}`);
  assert.equal(chainPrivate.body.steps[0].outcome, 'failed');
  assert.equal(chainPrivate.body.steps[0].error.code, 'BROWSER_NAVIGATION_FAILED');
  assert.equal(chainPrivate.body.steps[0].error.refusal.code, 'BROWSER_HOST_NOT_ALLOWED');
  assert.equal(fixture.hits.private, 0);
  const subresource = await execute([{ type: 'open', url: `${fixture.origin}/sub-redirect` }, { type: 'wait', for: 'networkidle', timeout_ms: 5000 }, { type: 'read', max_chars: 200 }], { screenshot_on_done: false });
  assert.equal(subresource.body.ok, true, JSON.stringify(subresource.body.steps));
  assert.match(subresource.body.page.text, /OK_SCRIPT_RAN/, 'a subresource redirect inside the public web is followed hop by hop');
  assert.equal(fixture.hits.private, 0, 'a subresource redirect to loopback is refused at the hop');
  assert.ok(subresource.body.usage.requests_blocked >= 1);
});

test('hosts outside the allowlist, wrong ports, credentials and refused schemes never open', { skip, timeout: 60000 }, async () => {
  const cases = [
    ['http://other.test/', 'BROWSER_HOST_NOT_ALLOWED'],
    [`http://www.${FIXTURE_HOST}:${fixture.port}/`, 'BROWSER_HOST_NOT_ALLOWED'],
    [`http://${FIXTURE_HOST}:${fixture.port + 1}/`, 'BROWSER_PORT_NOT_ALLOWED'],
    [`http://user:pw@${FIXTURE_HOST}:${fixture.port}/`, 'BROWSER_URL_USERINFO'],
    ['file:///etc/passwd', 'BROWSER_SCHEME_REFUSED'],
    ['javascript:alert(1)', 'BROWSER_SCHEME_REFUSED'],
    ['data:text/html,<b>x</b>', 'BROWSER_SCHEME_REFUSED'],
    [`blob:${fixture.origin}/00000000-0000-4000-8000-000000000000`, 'BROWSER_SCHEME_REFUSED'],
    ['chrome://settings', 'BROWSER_SCHEME_REFUSED'],
    ['not a url', 'BROWSER_URL_INVALID']
  ];
  for (const [url, code] of cases) {
    const result = await execute([{ type: 'open', url }, { type: 'read' }]);
    assert.equal(result.status, 200, url);
    assert.equal(result.body.ok, false, url);
    assert.equal(result.body.steps[0].outcome, 'refused', url);
    assert.equal(result.body.steps[0].error.code, code, `${url}: ${result.body.steps[0].error.reason}`);
    assert.equal(result.body.usage.navigations, 0, url);
  }
  const blank = await execute([{ type: 'open', url: 'about:blank' }], { screenshot_on_done: false });
  assert.equal(blank.body.ok, true, 'about:blank is an allowed open');
});

test('a download is cancelled and never saved', { skip, timeout: 60000 }, async () => {
  fixture.hits.downloads = 0;
  const result = await execute([{ type: 'open', url: `${fixture.origin}/download` }, { type: 'read' }]);
  assert.equal(result.body.ok, false, JSON.stringify(result.body.steps));
  assert.equal(result.body.steps[0].outcome, 'failed');
  assert.equal(result.body.steps[0].error.code, 'BROWSER_NAVIGATION_FAILED');
  assert.equal(fixture.hits.downloads, 1, 'the request was made and refused as a download, not as a page');
  const files = await readdir(path.join(dir, 'profile')).catch(() => []);
  assert.equal(files.some((name) => /file\.bin$/.test(name)), false);
  assert.ok(result.body.usage.downloads_cancelled >= 1, `downloads_cancelled ${result.body.usage.downloads_cancelled}`);
});

test('a dialog is dismissed and the page continues; a popup is closed', { skip, timeout: 60000 }, async () => {
  const alert = await execute([{ type: 'open', url: `${fixture.origin}/alert` }, { type: 'wait', ms: 300 }, { type: 'read', max_chars: 200 }], { screenshot_on_done: false });
  assert.equal(alert.body.ok, true, JSON.stringify(alert.body.steps));
  assert.match(alert.body.page.text, /ALERT_PAGE/);
  assert.match(alert.body.page.text, /AFTER_ALERT/, 'the script continued after the dismissed alert');
  assert.equal(alert.body.usage.dialogs_dismissed, 1);
  const popup = await execute([
    { type: 'open', url: `${fixture.origin}/popup` },
    { type: 'find', role: 'button', name: 'Open popup' },
    { type: 'click', handle: 'h1' },
    { type: 'wait', ms: 600 },
    { type: 'read', max_chars: 200 }
  ], { screenshot_on_done: false });
  assert.equal(popup.body.ok, true, JSON.stringify(popup.body.steps));
  assert.match(popup.body.page.text, /POPUP_REQUESTED/);
  assert.equal(popup.body.usage.popups_closed, 1);
  assert.equal(popup.body.page.url, `${fixture.origin}/popup`, 'the task page stays the task page');
});

test('a websocket never reaches the server and loopback subresources are blocked while the page itself loads', { skip, timeout: 60000 }, async () => {
  fixture.hits.upgrades = 0;
  const ws = await execute([{ type: 'open', url: `${fixture.origin}/ws` }, { type: 'wait', ms: 800 }, { type: 'read', max_chars: 200 }], { screenshot_on_done: false });
  assert.equal(ws.body.ok, true, JSON.stringify(ws.body.steps) + JSON.stringify(ws.body.usage));
  assert.match(ws.body.page.text, /WS_PAGE/);
  assert.doesNotMatch(ws.body.page.text, /WS_OPEN/);
  assert.match(ws.body.page.text, /WS_CLOSED|WS_ERROR/);
  assert.equal(fixture.hits.upgrades, 0);
  assert.equal(ws.body.usage.websockets_closed, 1);
  fixture.hits.private = 0;
  const sub = await execute([{ type: 'open', url: `${fixture.origin}/subresource` }, { type: 'wait', for: 'networkidle', timeout_ms: 5000 }, { type: 'read', max_chars: 300 }], { screenshot_on_done: false });
  assert.equal(sub.body.ok, true, JSON.stringify(sub.body.steps));
  assert.match(sub.body.page.text, /SUB_PAGE/);
  assert.match(sub.body.page.text, /FETCH_BLOCKED/);
  assert.doesNotMatch(sub.body.page.text, /FETCHED_/);
  assert.equal(fixture.hits.private, 0, 'script, image and fetch to the loopback address were all aborted');
  assert.ok(sub.body.usage.requests_blocked >= 3, `requests_blocked ${sub.body.usage.requests_blocked}`);
});

// DNS rebinding (review N2R-1): each rebind-*.test name answers the public
// documentation address on its first lookup and 127.0.0.2 afterwards (the
// preloaded resolver), and a LAN stand-in listens on 127.0.0.2 at the fixture's
// port. The check sees a public answer; a connection that resolved the name
// again would land on the LAN service. The executor must connect at the address
// the check validated: the fixture (the public face) answers, the LAN never.
test('DNS rebinding: a name that answers public at the check and private afterwards is connected only at the validated address (navigation, subresource, redirect hop)', { skip, timeout: 90000 }, async (t) => {
  if (!lan) {
    // where the browser is required, the rebinding proof is too (it is the N2R-1 fix's evidence)
    assert.ok(!REQUIRED, 'MCCLUSTER_BROWSER_TESTS_REQUIRED is set and no second loopback address (127.0.0.2) can be bound here');
    t.skip('no second loopback address (127.0.0.2) can be bound here');
    return;
  }
  lan.hits.count = 0;
  fixture.hits.hosts.length = 0;
  await writePolicy([`${FIXTURE_HOST}:${fixture.port}`, `rebind-nav.test:${fixture.port}`, `rebind-hop.test:${fixture.port}`]);
  try {
    // Each variant uses its own name, so each sees the rebinding sequence fresh.
    await t.test('navigation', async () => {
      const before = lan.hits.count;
      const nav = await execute([{ type: 'open', url: `http://rebind-nav.test:${fixture.port}/secret` }, { type: 'read', max_chars: 200 }], { screenshot_on_done: false });
      assert.equal(nav.status, 200);
      assert.doesNotMatch(String(nav.body.page?.text), /LAN_SECRET/, `the navigation reached the LAN service: ${JSON.stringify(nav.body.steps)}`);
      assert.equal(lan.hits.count, before, 'the LAN stand-in was reached');
      assert.equal(nav.body.ok, true, JSON.stringify(nav.body.steps));
      assert.match(nav.body.page.text, /PUBLIC_FACE/, 'the navigation was served from the validated public address');
    });
    await t.test('subresource (no allowlist needed)', async () => {
      const before = lan.hits.count;
      const sub = await execute([{ type: 'open', url: `${fixture.origin}/rebind-sub` }, { type: 'wait', for: 'networkidle', timeout_ms: 5000 }, { type: 'read', max_chars: 300 }], { screenshot_on_done: false });
      assert.equal(sub.body.ok, true, JSON.stringify(sub.body.steps));
      assert.doesNotMatch(sub.body.page.text, /LAN_SECRET/, 'the subresource fetch read the LAN service');
      assert.equal(lan.hits.count, before, 'the LAN stand-in was reached');
      assert.match(sub.body.page.text, /FETCHED PUBLIC_FACE/, 'the subresource was fetched from the validated public address');
    });
    await t.test('redirect hop', async () => {
      const before = lan.hits.count;
      const hop = await execute([{ type: 'open', url: `${fixture.origin}/redirect-rebind` }, { type: 'read', max_chars: 200 }], { screenshot_on_done: false });
      assert.doesNotMatch(String(hop.body.page?.text), /LAN_SECRET/, `the redirect hop reached the LAN service: ${JSON.stringify(hop.body.steps)}`);
      assert.equal(lan.hits.count, before, 'the LAN stand-in was reached');
      assert.equal(hop.body.ok, true, JSON.stringify(hop.body.steps));
      assert.equal(hop.body.steps[0].result.url, `http://rebind-hop.test:${fixture.port}/secret`);
      assert.equal(hop.body.steps[0].result.redirects, 1);
      assert.match(hop.body.page.text, /PUBLIC_FACE/);
    });
    // A page left open after its task fetches with no task (so no task DNS
    // cache): the route check and the egress proxy each resolve once, and the
    // proxy validates the answer it connects with, so the rebound one is refused.
    await t.test('between tasks (no task cache)', async () => {
      const before = lan.hits.count;
      const refusedBefore = (await executor.get('/health')).body.egress?.refused ?? 0;
      const idle = await execute([{ type: 'open', url: `${fixture.origin}/rebind-idle` }], { screenshot_on_done: false });
      assert.equal(idle.body.ok, true, JSON.stringify(idle.body.steps));
      await new Promise((resolve) => setTimeout(resolve, 2500));
      assert.equal(lan.hits.count, before, 'the page reached the LAN service after its task');
      const refusedAfter = (await executor.get('/health')).body.egress?.refused ?? 0;
      assert.ok(refusedAfter > refusedBefore, `the egress proxy refused the rebound answer (${refusedBefore} -> ${refusedAfter})`);
    });
    assert.equal(lan.hits.count, 0, `the LAN stand-in was reached: ${lan.hits.paths.join(', ')}`);
    for (const name of ['rebind-nav.test', 'rebind-sub.test', 'rebind-hop.test']) assert.ok(fixture.hits.hosts.includes(`${name}:${fixture.port}`), `${name} was answered by the public face`);
  } finally {
    await writePolicy([`${FIXTURE_HOST}:${fixture.port}`]);
  }
});

// WebRTC does not go through an HTTP proxy or the request router: without the
// policy flag a page's STUN request leaves as UDP to any address it names.
test('WebRTC never sends UDP to a loopback service: a page STUN request to 127.0.0.1 is not delivered', { skip, timeout: 60000 }, async () => {
  const udp = dgram.createSocket('udp4');
  let packets = 0;
  udp.on('message', () => { packets += 1; });
  await new Promise((resolve) => udp.bind(0, '127.0.0.1', resolve));
  try {
    const result = await execute([{ type: 'open', url: `${fixture.origin}/webrtc?port=${udp.address().port}` }, { type: 'wait', ms: 2500 }, { type: 'read', max_chars: 200 }], { screenshot_on_done: false });
    assert.equal(result.body.ok, true, JSON.stringify(result.body.steps));
    assert.match(result.body.page.text, /RTC_PAGE/);
    assert.equal(packets, 0, `${packets} UDP packets reached the loopback STUN port`);
  } finally {
    udp.close();
  }
});

// The proxy the browser is launched with refuses private destinations itself,
// for CONNECT (https, wss, the executor's own fetches) and absolute-form http,
// and never echoes an address in its answer.
test('the egress proxy refuses private destinations on its own: CONNECT and absolute-form requests to loopback are 403 and never reach the fixture', { skip, timeout: 60000 }, async () => {
  const health = await executor.get('/health');
  assert.equal(health.body.egress?.listening, true, JSON.stringify(health.body.egress));
  const port = health.body.egress.port;
  assert.ok(Number.isInteger(port) && port > 0);
  assert.equal(executor.ready.egress_port, port, 'the ready event names the egress port');
  fixture.hits.private = 0;
  for (const authority of [`127.0.0.1:${fixture.port}`, `localhost:${fixture.port}`, `[::1]:${fixture.port}`, `127.0.0.2:${fixture.port}`]) {
    const answer = await rawProxyExchange(port, `CONNECT ${authority} HTTP/1.1\r\nhost: ${authority}\r\n\r\n`);
    assert.equal(answer.status, 403, `${authority}: ${answer.text.split('\r\n')[0]}`);
    assert.match(answer.text, /x-mccluster-egress-refusal: BROWSER_(PRIVATE_ADDRESS|DNS_FAILED)/i);
    assert.doesNotMatch(answer.text, /127\.0\.0\.[12]|::1/, 'the answer never echoes an address');
  }
  const absolute = await rawProxyExchange(port, `GET http://127.0.0.1:${fixture.port}/private HTTP/1.1\r\nhost: 127.0.0.1:${fixture.port}\r\nconnection: close\r\n\r\n`);
  assert.equal(absolute.status, 403);
  const origin = await rawProxyExchange(port, 'GET /private HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n');
  assert.equal(origin.status, 400, 'the proxy is not a web server');
  const tunnel = await rawProxyExchange(port, `CONNECT ${FIXTURE_HOST}:${fixture.port} HTTP/1.1\r\nhost: ${FIXTURE_HOST}:${fixture.port}\r\n\r\n`);
  assert.equal(tunnel.status, 200, 'a public destination is tunnelled');
  assert.equal(fixture.hits.private, 0);
  if (lan) assert.equal(lan.hits.count, 0);
});

test('the step cap, a bad action and the wrong capability are 400 before any browser work', { skip, timeout: 60000 }, async () => {
  const many = await execute(Array.from({ length: 26 }, () => ({ type: 'screenshot' })));
  assert.equal(many.status, 400);
  assert.equal(many.body.code, 'BROWSER_TOO_MANY_STEPS');
  const capped = await execute([{ type: 'screenshot' }, { type: 'screenshot' }, { type: 'done' }], { max_steps: 2 });
  assert.equal(capped.body.code, 'BROWSER_TOO_MANY_STEPS');
  const invalid = await execute([{ type: 'open', url: `${fixture.origin}/` }, { type: 'evaluate', script: 'document.cookie' }]);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'BROWSER_ACTION_INVALID');
  const envelope = await executor.post('/execute', { capability: 'browser.act', input: { actions: [] } });
  assert.equal(envelope.body.code, 'BROWSER_INPUT_INVALID');
  const other = await executor.post('/execute', { capability: 'ai.chat', input: { prompt: 'x' } });
  assert.equal(other.status, 400);
  assert.equal(other.body.code, 'BROWSER_UNSUPPORTED_CAPABILITY');
  assert.equal((await executor.get('/health')).body.busy, false);
});

test('the time cap: once max_ms has passed the next action is refused with BROWSER_TASK_TIMEOUT and the rest is skipped', { skip, timeout: 60000 }, async () => {
  const result = await execute([
    { type: 'open', url: `${fixture.origin}/` },
    { type: 'wait', ms: 9000 },
    { type: 'read' },
    { type: 'done' }
  ], { max_ms: 5000, screenshot_on_done: false });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.deepEqual(outcomes(result), ['ok', 'ok', 'refused', 'skipped'], JSON.stringify(result.body.steps));
  assert.equal(result.body.steps[2].error.code, 'BROWSER_TASK_TIMEOUT');
  assert.equal(result.body.refused.code, 'BROWSER_TASK_TIMEOUT');
  assert.ok(result.body.usage.wall_ms >= 4500 && result.body.usage.wall_ms < 8000, `wall ${result.body.usage.wall_ms}`);
});

test('one task at a time: a concurrent task is 429 BROWSER_BUSY while the first completes', { skip, timeout: 60000 }, async () => {
  const first = execute([{ type: 'open', url: `${fixture.origin}/slow?ms=1500` }], { screenshot_on_done: false });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const second = await execute([{ type: 'open', url: `${fixture.origin}/` }]);
  assert.equal(second.status, 429);
  assert.equal(second.body.code, 'BROWSER_BUSY');
  assert.equal(second.body.retryable, true);
  assert.equal(second.body.busy, true);
  const done = await first;
  assert.equal(done.body.ok, true, JSON.stringify(done.body.steps));
  assert.equal((await executor.get('/health')).body.busy, false);
});

test('the policy file is read per task: an invalid file makes the executor unavailable, an empty allowlist refuses every open and names the file', { skip, timeout: 60000 }, async () => {
  await writeFile(policyPath, '{not json');
  const health = await executor.get('/health');
  assert.equal(health.status, 503);
  assert.equal(health.body.policy.schema_ok, false);
  assert.equal(health.body.policy.error, 'invalid_json');
  const broken = await execute([{ type: 'open', url: `${fixture.origin}/` }]);
  assert.equal(broken.status, 503);
  assert.equal(broken.body.code, 'BROWSER_UNAVAILABLE');
  await writePolicy([]);
  const empty = await execute([{ type: 'open', url: `${fixture.origin}/` }, { type: 'read' }]);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.steps[0].error.code, 'BROWSER_POLICY_EMPTY');
  assert.match(empty.body.steps[0].error.reason, /browser-policy\.json/);
  await rm(policyPath);
  assert.equal((await executor.get('/ready')).status, 503);
  assert.equal((await execute([{ type: 'open', url: `${fixture.origin}/` }])).body.code, 'BROWSER_UNAVAILABLE');
  await writePolicy([`${FIXTURE_HOST}:${fixture.port}`]);
  assert.equal((await executor.get('/health')).status, 200);
  assert.equal((await execute([{ type: 'open', url: `${fixture.origin}/ok` }], { screenshot_on_done: false })).body.ok, true);
});

test('the output cap (second instance, 10 KB): page text is cut, links and the screenshot go, usage says so', { skip, timeout: 60000 }, async () => {
  if (process.env.MCCLUSTER_BROWSER_TEST_DEBUG) await writeFile(process.env.MCCLUSTER_BROWSER_TEST_DEBUG, executor.output.stdout + '\n--- stderr ---\n' + executor.output.stderr);
  await executor.stop();
  executor = null;
  const small = await spawnExecutor({ MCCLUSTER_BROWSER_PROFILE_DIR: path.join(dir, 'profile-small'), MCCLUSTER_BROWSER_POLICY: policyPath, MCCLUSTER_BROWSER_MAX_OUTPUT_BYTES: '10000' });
  try {
    const result = await small.post('/execute', { capability: 'browser.act', input: { actions: [{ type: 'open', url: `${fixture.origin}/long` }, { type: 'read', max_chars: 20000 }, { type: 'screenshot' }] } });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true, JSON.stringify(result.body.steps));
    assert.equal(result.body.usage.output_truncated, 'BROWSER_OUTPUT_TRUNCATED');
    assert.equal(result.body.page.truncated, true);
    assert.ok(result.body.page.text.length < 20000);
    assert.equal(result.body.screenshot, undefined);
    assert.equal(result.body.screenshot_error, 'BROWSER_OUTPUT_TRUNCATED');
    assert.ok(Buffer.byteLength(JSON.stringify(result.body)) <= 10_000, `${Buffer.byteLength(JSON.stringify(result.body))} bytes`);
  } finally {
    await small.stop();
  }
  executor = await spawnExecutor({ MCCLUSTER_BROWSER_PROFILE_DIR: path.join(dir, 'profile'), MCCLUSTER_BROWSER_POLICY: policyPath });
});

test('without Playwright the executor stays up and answers 503 everywhere, launching nothing', { skip, timeout: 60000 }, async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), 'mccluster-no-playwright-'));
  const bare = await spawnExecutor({ MCCLUSTER_BROWSER_PLAYWRIGHT_DIR: empty, MCCLUSTER_BROWSER_PROFILE_DIR: path.join(dir, 'profile-none'), MCCLUSTER_BROWSER_POLICY: policyPath });
  try {
    assert.equal(bare.ready.playwright, null);
    const health = await bare.get('/health');
    assert.equal(health.status, 503);
    assert.equal(health.body.playwright.found, false);
    assert.equal(health.body.playwright.dir, empty);
    const ready = await bare.get('/ready');
    assert.equal(ready.status, 503);
    assert.match(ready.body.reason, /playwright not found/);
    const run = await bare.post('/execute', { capability: 'browser.act', input: { actions: [{ type: 'open', url: `${fixture.origin}/` }] } });
    assert.equal(run.status, 503);
    assert.equal(run.body.code, 'BROWSER_UNAVAILABLE');
    assert.equal(bare.events().some((e) => e.event === 'browser_executor_launched'), false);
  } finally {
    await bare.stop();
    await rm(empty, { recursive: true, force: true });
  }
});

test('the executor evaluates only its own extractor literals, never a task string, and hard-codes loopback', async () => {
  const source = await readFile(EXECUTOR, 'utf8');
  const evaluations = [...source.matchAll(/\.evaluate\(([^,)]+)/g)].map((match) => match[1].trim());
  assert.ok(evaluations.length >= 2);
  for (const argument of evaluations) assert.match(argument, /^EXTRACT_[A-Z_]+$/, `page.evaluate takes a fixed extractor, got ${argument}`);
  assert.doesNotMatch(source, /addInitScript|evaluateHandle|exposeFunction|setInputFiles|storageState|cookies\(/);
  assert.match(source, /const HOST = '127\.0\.0\.1'/);
  assert.match(source, /acceptDownloads: false/);
  assert.match(source, /serviceWorkers: 'block'/);
  assert.match(source, /routeWebSocket\('\*\*\/\*'/);
  assert.match(source, /route\.abort\('blockedbyclient'\)/);
  // Every connection leaves through the egress proxy: Chromium is launched with
  // it (loopback included), WebRTC is held to proxied traffic, and no resolver
  // rule maps a name around it.
  assert.match(source, /proxy: \{ server: /);
  assert.match(source, /--proxy-bypass-list=<-loopback>/);
  assert.match(source, /--force-webrtc-ip-handling-policy=disable_non_proxied_udp/);
  assert.doesNotMatch(source, /host-resolver-rules/);
});
