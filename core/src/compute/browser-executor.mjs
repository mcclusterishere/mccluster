// The node's own browser: a loopback executor (127.0.0.1:4791) for the
// browser.act capability. Playwright Chromium in a persistent profile under the
// node state directory (never the owner's own browser profile), headless by
// default, driving a fixed action vocabulary on hosts the owner allowlisted in
// browser-policy.json beside the manifest. Every request, redirect hop
// included, is re-checked through context.route: http(s) only, allowlisted
// navigation, no private/loopback/link-local address after DNS. Every
// connection then leaves through this process's loopback egress proxy
// (browser-egress.mjs), which connects only to an address it validated, from
// the same DNS answer the check validated: a name that rebinds to a private
// address after the check is never connected there. Chromium is launched to
// use that proxy for everything, loopback included, with WebRTC held to
// proxied traffic. No downloads, file choosers, dialogs, popups, credentials or
// permissions; extractors are function literals in this file, never
// model-written code; per-task step, time and byte caps; one task at a time;
// every action logged.
//
// Playwright is resolved at start from the node (MCCLUSTER_BROWSER_PLAYWRIGHT_DIR,
// else the repository root, else this module's resolution). The Core package
// never depends on it; without it the server stays up and answers 503.
import http from 'node:http';
import fs from 'node:fs';
import dns from 'node:dns';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { checkRequest, parseBrowserPolicy } from './browser-policy.mjs';
import { createEgressProxy, EGRESS_REFUSAL_HEADER } from './browser-egress.mjs';
import { boundBrowserOutput, browserLimitsFromEnv, sanitizeActionForLog, validateBrowserTask } from './browser-actions.mjs';
import { imageDimensions, sniffImageType } from './ai-chat-images.mjs';
import { browserPaths } from './node-agent-config.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.MCCLUSTER_BROWSER_EXECUTOR_PORT ?? 4791);
const HEADED = String(process.env.MCCLUSTER_BROWSER_HEADED || '') === '1';
// Container and CI only (documented): Chromium's sandbox needs user namespaces.
const NO_SANDBOX = String(process.env.MCCLUSTER_BROWSER_NO_SANDBOX || '') === '1';
// Test only: the policy resolver answers the documentation address
// FIXTURE_ADDRESS for this one name, so the private-network rule stays armed,
// and the egress proxy delivers a connection to that one validated address to
// the loopback fixture on the same port (the test network). Never active
// without MCCLUSTER_BROWSER_TEST_FIXTURE_HOST.
const FIXTURE_HOST = /^[a-z0-9.-]{1,120}$/i.test(String(process.env.MCCLUSTER_BROWSER_TEST_FIXTURE_HOST || '')) ? String(process.env.MCCLUSTER_BROWSER_TEST_FIXTURE_HOST).toLowerCase() : null;
const FIXTURE_ADDRESS = '203.0.113.10';
const LIMITS = browserLimitsFromEnv(process.env);
const PATHS = browserPaths({ platform: process.platform, env: process.env });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const VIEWPORT = Object.freeze({ width: 1280, height: 800 });
const SCREENSHOT_MAX_BYTES = 200_000;
// Dense text pages measured 218 KB at quality 30 and 169 KB at 20, so the
// ladder ends at 20 rather than leaving text pages without a screenshot.
const SCREENSHOT_QUALITIES = [60, 45, 30, 20];
const MAX_NAVIGATION_REDIRECTS = 10;
const MAX_SUBRESOURCE_REDIRECTS = 5;
const ACTION_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3_000;
const BODY_LIMIT = 2_097_152;
const IMPLEMENTATION = 'chromium.local';
const REFUSAL_CODES = new Set(['BROWSER_SCHEME_REFUSED', 'BROWSER_URL_USERINFO', 'BROWSER_URL_INVALID', 'BROWSER_HOST_NOT_ALLOWED', 'BROWSER_PORT_NOT_ALLOWED', 'BROWSER_PRIVATE_ADDRESS', 'BROWSER_DNS_FAILED', 'BROWSER_POLICY_EMPTY', 'BROWSER_TASK_TIMEOUT', 'BROWSER_HANDLE_UNKNOWN', 'BROWSER_ACTION_INVALID']);

function log(record) { console.log(JSON.stringify(record)); }
function iso() { return new Date().toISOString(); }
function fail(code, message, status = 400, extra = {}) { return Object.assign(new Error(message), { status, code, retryable: false, ...extra }); }
function unavailable(reason) { return fail('BROWSER_UNAVAILABLE', `browser executor unavailable: ${reason}`, 503); }
function hostOf(url) { try { return new URL(url).hostname; } catch { return null; } }
function isTimeout(error) { return error?.name === 'TimeoutError' || /Timeout \d+ms exceeded/i.test(String(error?.message || '')); }

// ---------------------------------------------------------------- Playwright
function readVersion(dir) {
  try { return String(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null); } catch { return null; }
}

function resolvePlaywright() {
  const explicit = process.env.MCCLUSTER_BROWSER_PLAYWRIGHT_DIR;
  // An explicit directory is the owner's pin: it is the only place tried.
  const candidates = explicit
    ? [{ dir: path.resolve(explicit), load: () => createRequire(import.meta.url)(path.resolve(explicit)) }]
    : [
      { dir: null, load: () => { const req = createRequire(path.join(REPO_ROOT, 'package.json')); return { module: req('playwright'), dir: path.dirname(req.resolve('playwright/package.json')) }; } },
      { dir: null, load: () => { const req = createRequire(import.meta.url); return { module: req('playwright'), dir: path.dirname(req.resolve('playwright/package.json')) }; } }
    ];
  const errors = [];
  for (const candidate of candidates) {
    try {
      const loaded = candidate.load();
      const module = loaded?.module || loaded;
      const dir = loaded?.dir || candidate.dir;
      if (!module?.chromium?.launchPersistentContext) throw new Error('module has no chromium.launchPersistentContext');
      return { module, info: { found: true, version: readVersion(dir), dir } };
    } catch (error) {
      errors.push(String(error?.message || error).split('\n')[0].slice(0, 160));
    }
  }
  return { module: null, info: { found: false, version: null, dir: explicit ? path.resolve(explicit) : null, error: errors.join(' | ').slice(0, 400) } };
}

// ------------------------------------------------------------------- policy
function readPolicy() {
  let text;
  try { text = fs.readFileSync(PATHS.policyPath, 'utf8'); }
  catch (error) {
    return { parsed: null, info: { path: PATHS.policyPath, schema_ok: false, allowed_hosts_count: 0, allow_subdomains: false, loaded_at: iso(), error: error?.code === 'ENOENT' ? 'missing' : 'unreadable' } };
  }
  const parsed = parseBrowserPolicy(text);
  return {
    parsed: parsed.error ? null : parsed,
    info: { path: PATHS.policyPath, schema_ok: parsed.error === null, allowed_hosts_count: parsed.allowed.length, allow_subdomains: parsed.allowSubdomains, loaded_at: iso(), error: parsed.error }
  };
}

const resolver = FIXTURE_HOST
  ? async (host, options) => (host === FIXTURE_HOST ? [{ address: FIXTURE_ADDRESS, family: 4 }] : dns.promises.lookup(host, options))
  : (host, options) => dns.promises.lookup(host, options);

// ------------------------------------------------------------------- state
const playwright = resolvePlaywright();
const state = {
  policy: readPolicy(),
  context: null,
  page: null,
  launching: null,
  chromiumVersion: null,
  launchError: null,
  busy: false,
  current: null,
  lastTaskAt: null,
  lastError: null
};

// ------------------------------------------------------------------- egress
// The one place a destination is resolved for a connection: inside a task the
// task's DNS cache holds the answer the policy check validated for that name
// (so the connection uses exactly that answer); a name the check has not seen,
// or a request outside any task, is resolved once here. checkRequest applies
// the same address rule as the check (any private answer refuses).
function authorizeDestination(host) {
  const literal = net.isIPv6(host) ? `[${host}]` : host;
  return checkRequest(`http://${literal}/`, null, { navigation: false, resolve: resolver, cache: state.current?.dnsCache })
    .catch((error) => ({ ok: false, code: 'BROWSER_DNS_FAILED', reason: shortMessage(error) }));
}

// Test only (FIXTURE_HOST set): the documentation address is the loopback
// fixture. Production delivers every validated address as itself.
const testDelivery = FIXTURE_HOST
  ? (address, port) => (address === FIXTURE_ADDRESS ? { host: '127.0.0.1', port, test: true } : { host: address, port })
  : undefined;

const egress = createEgressProxy({
  authorize: authorizeDestination,
  ...(testDelivery ? { deliver: testDelivery } : {}),
  onRefused: ({ host, kind, code }) => {
    if (state.current) state.current.usage.egress_refused += 1;
    log({ event: 'browser_egress_refused', task_id: state.current?.id || null, kind, host: typeof host === 'string' && !net.isIP(host) ? host.slice(0, 120) : null, code });
  }
});
let egressError = null;
try { await egress.listen(); }
catch (error) { egressError = String(error?.message || error).split('\n')[0].slice(0, 200); }

// Every request of every page goes through here. Playwright does not route
// redirect hops (a continued request is followed by Chromium itself), so no
// request is ever continued: the executor fetches it with maxRedirects 0 and
// fulfills the answer. A navigation redirect is checked against the allowlist
// and the address rule, then bounced through a client-side location.replace,
// which is a fresh navigation this handler sees again; a subresource redirect
// is followed hop by hop here, each hop checked, and the final answer served.
// The fetch itself runs through the context's proxy, the egress proxy, which
// connects at the address the check validated (the task's DNS cache).
function shortMessage(error) { return String(error?.message || error).split('\n')[0].slice(0, 200); }

function resolveLocation(location, base) {
  try { return new URL(String(location), base).href; } catch { return null; }
}

function fetchOptions(request, url, run) {
  const options = { maxRedirects: 0, timeout: run ? Math.max(1_000, Math.min(ACTION_TIMEOUT_MS, run.deadline - Date.now())) : ACTION_TIMEOUT_MS };
  if (url !== request.url()) options.url = url;
  return options;
}

// The egress proxy's own refusal (its CONNECT answer replayed as the response),
// never a page: the request is refused like any other.
function egressRefusal(response) {
  const code = response.headers()[EGRESS_REFUSAL_HEADER];
  return typeof code === 'string' && /^BROWSER_[A-Z_]{1,40}$/.test(code) ? { code, reason: 'the egress proxy refused the destination' } : null;
}

async function refuseRoute(route, run, navigation, url, verdict) {
  if (run) {
    run.usage.requests_blocked += 1;
    if (navigation) {
      run.lastRefusal = { code: verdict.code, reason: verdict.reason, host: hostOf(url) };
      run.notifyNavigationFailure?.();
    }
  }
  await route.abort('blockedbyclient').catch(() => {});
}

async function failRoute(route, run, navigation, reason) {
  if (run && navigation) {
    run.lastRefusal = { code: 'BROWSER_NAVIGATION_FAILED', reason, host: null };
    run.notifyNavigationFailure?.();
  }
  await route.abort('failed').catch(() => {});
}

// A navigation that landed on one of this task's trampolines is still moving:
// wait until the page leaves every trampoline URL (the redirect target loaded
// through the handler) or fail the moment the handler refuses the hop.
function refusedNavigation(run, fallback) {
  return fail('BROWSER_NAVIGATION_FAILED', run.lastRefusal ? `redirect refused: ${run.lastRefusal.reason}` : fallback, 502, run.lastRefusal ? { refusal: run.lastRefusal } : {});
}

async function settleTrampolines(page, run) {
  let hops = 0;
  while (true) {
    // A refused hop commits Chromium's own error page; that is a failed open.
    if (run.lastRefusal) throw refusedNavigation(run);
    if (/^chrome-error:/.test(page.url())) throw refusedNavigation(run, 'the navigation ended on the browser error page');
    if (!run.trampolines.has(page.url())) return;
    hops += 1;
    if (hops > MAX_NAVIGATION_REDIRECTS) throw fail('BROWSER_NAVIGATION_FAILED', `more than ${MAX_NAVIGATION_REDIRECTS} redirects`, 502);
    let notify;
    const failure = new Promise((resolve) => { notify = resolve; });
    run.notifyNavigationFailure = notify;
    try {
      await Promise.race([
        page.waitForURL((url) => !run.trampolines.has(url.href), { waitUntil: 'domcontentloaded', timeout: timeoutFor(run) }),
        failure.then(() => { throw refusedNavigation(run, 'navigation failed'); })
      ]);
    } catch (error) {
      if (isTimeout(error)) throw classifyTimeout(run, error, true);
      throw error;
    } finally {
      run.notifyNavigationFailure = null;
    }
  }
}

function isRedirect(response) {
  const status = response.status();
  return status >= 300 && status < 400 && Boolean(response.headers().location);
}

function trampoline(target) {
  const escaped = String(target).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escaped}"></head><body><script>location.replace(${JSON.stringify(target)});</script></body></html>`;
}

async function policyRouteHandler(route, request) {
  const run = state.current;
  const navigation = request.isNavigationRequest();
  const url = request.url();
  const policy = run?.policy || state.policy.parsed;
  const check = (target, isNavigation) => checkRequest(target, policy, { navigation: isNavigation, resolve: resolver, cache: run?.dnsCache })
    .catch((error) => ({ ok: false, code: 'BROWSER_DNS_FAILED', reason: shortMessage(error) }));
  const verdict = await check(url, navigation);
  if (!verdict.ok) return refuseRoute(route, run, navigation, url, verdict);
  if (navigation) {
    let response;
    try { response = await route.fetch(fetchOptions(request, url, run)); }
    catch (error) { return failRoute(route, run, true, shortMessage(error)); }
    const refusedByEgress = egressRefusal(response);
    if (refusedByEgress) return refuseRoute(route, run, true, url, refusedByEgress);
    if (!isRedirect(response)) return route.fulfill({ response }).catch(() => {});
    const target = resolveLocation(response.headers().location, url);
    if (!target) return refuseRoute(route, run, true, url, { code: 'BROWSER_URL_INVALID', reason: 'the redirect target is not a URL' });
    if (run) {
      run.redirects += 1;
      if (run.redirects > MAX_NAVIGATION_REDIRECTS) return failRoute(route, run, true, `more than ${MAX_NAVIGATION_REDIRECTS} redirects`);
    }
    const hop = await check(target, true);
    if (!hop.ok) return refuseRoute(route, run, true, target, hop);
    run?.trampolines.add(url);
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: trampoline(target) }).catch(() => {});
  }
  let current = url;
  for (let hop = 0; ; hop += 1) {
    let response;
    try { response = await route.fetch(fetchOptions(request, current, run)); }
    catch (error) { return failRoute(route, run, false, shortMessage(error)); }
    const refusedByEgress = egressRefusal(response);
    if (refusedByEgress) return refuseRoute(route, run, false, current, refusedByEgress);
    if (!isRedirect(response)) return route.fulfill({ response }).catch(() => {});
    const target = resolveLocation(response.headers().location, current);
    if (!target || hop >= MAX_SUBRESOURCE_REDIRECTS) return refuseRoute(route, run, false, current, { code: 'BROWSER_URL_INVALID', reason: 'subresource redirect refused' });
    const verdict2 = await check(target, false);
    if (!verdict2.ok) return refuseRoute(route, run, false, target, verdict2);
    current = target;
  }
}

function attachPageGuards(page) {
  page.on('close', () => log({ event: 'browser_executor_page', action: 'task_page_closed', task_id: state.current?.id || null }));
  page.on('crash', () => log({ event: 'browser_executor_page', action: 'task_page_crashed', task_id: state.current?.id || null }));
  page.on('dialog', (dialog) => { if (state.current) state.current.usage.dialogs_dismissed += 1; dialog.dismiss().catch(() => {}); });
  page.on('download', (download) => { if (state.current) state.current.usage.downloads_cancelled += 1; download.cancel().catch(() => {}); });
  // A file chooser is never answered: nothing from the node's disk is uploaded.
  page.on('filechooser', () => { if (state.current) state.current.usage.file_choosers_refused += 1; });
}

async function ensureBrowser() {
  if (state.context) return state.context;
  if (!playwright.module) throw unavailable('playwright not found');
  if (!egress.listening || !egress.port) throw unavailable(`the egress proxy is not listening${egressError ? ` (${egressError})` : ''}`);
  if (!state.launching) {
    state.launching = (async () => {
      fs.mkdirSync(PATHS.profileDir, { recursive: true, mode: 0o700 });
      // Everything Chromium sends goes to the egress proxy: the proxy option
      // also carries the executor's own route.fetch, the explicit switches
      // come last so they win over any default, `<-loopback>` removes
      // Chromium's implicit loopback bypass, and WebRTC may not send UDP that
      // does not go through the proxy (it ignores proxies otherwise).
      const egressServer = `http://127.0.0.1:${egress.port}`;
      const args = ['--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync'];
      if (NO_SANDBOX) args.push('--no-sandbox');
      args.push(`--proxy-server=${egressServer}`, '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
      const context = await playwright.module.chromium.launchPersistentContext(PATHS.profileDir, {
        headless: !HEADED,
        viewport: { ...VIEWPORT },
        deviceScaleFactor: 1,
        acceptDownloads: false,
        serviceWorkers: 'block',
        permissions: [],
        ignoreHTTPSErrors: false,
        bypassCSP: false,
        javaScriptEnabled: true,
        proxy: { server: egressServer },
        args
      });
      const page = context.pages()[0] || await context.newPage();
      await context.route('**/*', policyRouteHandler);
      await context.routeWebSocket('**/*', (ws) => { if (state.current) state.current.usage.websockets_closed += 1; ws.close(); });
      context.on('page', (extra) => {
        if (extra === state.page) return;
        if (state.current) state.current.usage.popups_closed += 1;
        log({ event: 'browser_executor_page', action: 'popup_closed', task_id: state.current?.id || null, host: hostOf(extra.url()) });
        extra.close().catch(() => {});
      });
      context.on('close', () => { state.context = null; state.page = null; state.launching = null; });
      attachPageGuards(page);
      state.context = context;
      state.page = page;
      state.chromiumVersion = (() => { try { return context.browser()?.version() || null; } catch { return null; } })();
      state.launchError = null;
      log({ event: 'browser_executor_launched', chromium_version: state.chromiumVersion, headed: HEADED, profile_dir: PATHS.profileDir });
      return context;
    })().catch((error) => {
      state.launching = null;
      state.launchError = String(error?.message || error).split('\n')[0].slice(0, 300);
      throw unavailable(`chromium failed to launch (${state.launchError})`);
    });
  }
  return state.launching;
}

async function currentPage() {
  const context = await ensureBrowser();
  if (!state.page || state.page.isClosed()) {
    state.page = await context.newPage();
    attachPageGuards(state.page);
  }
  return state.page;
}

// ---------------------------------------------------------------- extractors
// Fixed extractors, defined here and only here: body text without scripts,
// styles and hidden nodes, whitespace collapsed; http(s) links; visible form fields.
const EXTRACT_PAGE = ({ maxChars, links, forms }) => {
  const text = String(document.body ? document.body.innerText : '').replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const out = { text: text.slice(0, maxChars), truncated: text.length > maxChars };
  if (links) {
    out.links = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => ({ text: String(a.innerText || a.textContent || '').trim().slice(0, 80), href: String(a.href || '').slice(0, 300) }))
      .filter((link) => /^https?:/i.test(link.href))
      .slice(0, 60);
  }
  if (forms) {
    const label = (field) => {
      const byFor = field.id ? document.querySelector(`label[for="${field.id.replace(/"/g, '\\"')}"]`) : null;
      const node = byFor || (field.closest ? field.closest('label') : null);
      return String(node ? node.innerText : (field.getAttribute('aria-label') || field.placeholder || '')).trim().slice(0, 60);
    };
    out.forms = Array.from(document.querySelectorAll('form')).slice(0, 10).map((form) => ({
      action: String(form.action || '').slice(0, 300),
      method: String(form.method || 'get').toLowerCase().slice(0, 10),
      fields: Array.from(form.querySelectorAll('input,select,textarea')).filter((field) => field.type !== 'hidden').slice(0, 20).map((field) => ({
        name: String(field.name || field.id || '').slice(0, 60),
        type: String(field.tagName === 'INPUT' ? field.type : field.tagName.toLowerCase()).slice(0, 20),
        label: label(field)
      }))
    }));
  }
  return out;
};
const EXTRACT_ELEMENT = (element) => ({
  tag: String(element.tagName || '').toLowerCase(),
  text: String(element.innerText || element.textContent || '').trim().slice(0, 120),
  role: element.getAttribute('role'),
  name: element.getAttribute('aria-label') || (element.labels && element.labels[0] ? String(element.labels[0].innerText).trim() : null) || element.getAttribute('placeholder') || element.getAttribute('name') || null
});

// ------------------------------------------------------------------ actions
function handleOf(run, handle) {
  const locator = run.handles.get(handle);
  if (!locator) throw fail('BROWSER_HANDLE_UNKNOWN', `${handle} was not returned by find in this task`);
  return locator;
}

function timeoutFor(run, cap = ACTION_TIMEOUT_MS) {
  return Math.max(250, Math.min(cap, run.deadline - Date.now()));
}

function classifyTimeout(run, error, navigation = false) {
  if (Date.now() >= run.deadline) return fail('BROWSER_TASK_TIMEOUT', 'the task exceeded max_ms');
  return fail(navigation ? 'BROWSER_NAVIGATION_TIMEOUT' : 'BROWSER_ACTION_TIMEOUT', String(error?.message || error).split('\n')[0].slice(0, 200), 504);
}

async function settle(page, run) {
  await page.waitForLoadState('domcontentloaded', { timeout: Math.min(SETTLE_MS, timeoutFor(run)) }).catch(() => {});
  await settleTrampolines(page, run);
}

async function takeScreenshot(page, run) {
  for (const quality of SCREENSHOT_QUALITIES) {
    const buffer = await page.screenshot({ type: 'jpeg', quality, fullPage: false, timeout: timeoutFor(run) });
    if (buffer.length <= SCREENSHOT_MAX_BYTES) {
      const dimensions = imageDimensions(buffer, sniffImageType(buffer)) || { ...VIEWPORT };
      return { base64: buffer.toString('base64'), width: dimensions.width, height: dimensions.height, bytes: buffer.length, type: 'image/jpeg' };
    }
  }
  return null;
}

async function executeAction(action, run, page) {
  switch (action.type) {
    case 'open': {
      const verdict = await checkRequest(action.url, run.policy, { navigation: true, resolve: resolver, cache: run.dnsCache });
      if (!verdict.ok) throw fail(verdict.code, verdict.reason);
      run.usage.navigations += 1;
      run.lastRefusal = null;
      run.redirects = 0;
      let response;
      try { response = await page.goto(verdict.url, { waitUntil: 'domcontentloaded', timeout: timeoutFor(run) }); }
      catch (error) {
        if (isTimeout(error)) throw classifyTimeout(run, error, true);
        throw fail('BROWSER_NAVIGATION_FAILED', String(error?.message || error).split('\n')[0].slice(0, 200), 502, run.lastRefusal ? { refusal: run.lastRefusal } : {});
      }
      await settleTrampolines(page, run);
      return { url: page.url(), status: response ? response.status() : null, redirects: run.redirects };
    }
    case 'read': {
      const extracted = await page.evaluate(EXTRACT_PAGE, { maxChars: action.max_chars, links: action.links, forms: action.forms });
      run.page = { url: page.url(), title: String(await page.title().catch(() => '')).slice(0, 300), ...extracted };
      return undefined;
    }
    case 'find': {
      const locator = action.role
        ? page.getByRole(action.role, action.name ? { name: action.name, exact: action.exact } : {})
        : page.getByText(action.text, { exact: action.exact });
      const count = await locator.count();
      const handles = [];
      for (let i = 0; i < Math.min(count, action.limit); i += 1) {
        if (run.handleCount >= 999) break;
        const element = locator.nth(i);
        const info = await element.evaluate(EXTRACT_ELEMENT, undefined, { timeout: timeoutFor(run, 5_000) }).catch(() => ({ tag: null, text: '', role: null, name: null }));
        const [visible, enabled] = await Promise.all([element.isVisible().catch(() => false), element.isEnabled().catch(() => false)]);
        run.handleCount += 1;
        const handle = `h${run.handleCount}`;
        run.handles.set(handle, element);
        handles.push({ handle, role: action.role || info.role || null, name: String(action.name || info.name || '').slice(0, 120) || null, tag: info.tag, text: String(info.text || '').slice(0, 120), visible, enabled });
      }
      return { handles, total: count };
    }
    case 'click':
      await handleOf(run, action.handle).click({ timeout: timeoutFor(run) });
      await settle(page, run);
      return undefined;
    case 'type': {
      const locator = handleOf(run, action.handle);
      await locator.fill(action.text, { timeout: timeoutFor(run) });
      if (action.submit) {
        await locator.press('Enter', { timeout: timeoutFor(run) });
        await settle(page, run);
      }
      return undefined;
    }
    case 'select':
      await handleOf(run, action.handle).selectOption(action.value, { timeout: timeoutFor(run) });
      return undefined;
    case 'scroll':
      await page.mouse.wheel(0, (action.direction === 'down' ? 1 : -1) * action.amount * VIEWPORT.height);
      await page.waitForTimeout(100);
      return undefined;
    case 'wait':
      if (action.ms != null) {
        await page.waitForTimeout(Math.min(action.ms, Math.max(0, run.deadline - Date.now())));
        return undefined;
      }
      await page.waitForLoadState(action.for, { timeout: Math.min(action.timeout_ms, timeoutFor(run)) });
      return undefined;
    case 'screenshot': {
      const shot = await takeScreenshot(page, run);
      if (!shot) { run.screenshotError = 'BROWSER_SCREENSHOT_TOO_LARGE'; return { error: 'BROWSER_SCREENSHOT_TOO_LARGE' }; }
      run.screenshot = shot;
      run.screenshotError = null;
      return { width: shot.width, height: shot.height, bytes: shot.bytes };
    }
    case 'back': {
      run.usage.navigations += 1;
      run.lastRefusal = null;
      run.redirects = 0;
      try { await page.goBack({ waitUntil: 'domcontentloaded', timeout: timeoutFor(run) }); }
      catch (error) {
        if (isTimeout(error)) throw classifyTimeout(run, error, true);
        throw fail('BROWSER_NAVIGATION_FAILED', String(error?.message || error).split('\n')[0].slice(0, 200), 502, run.lastRefusal ? { refusal: run.lastRefusal } : {});
      }
      await settleTrampolines(page, run);
      return { url: page.url() };
    }
    case 'done':
      return action.note ? { note: action.note } : undefined;
    default:
      throw fail('BROWSER_ACTION_INVALID', `unknown action ${String(action.type).slice(0, 40)}`);
  }
}

function normalizeActionError(run, error) {
  if (error?.code && String(error.code).startsWith('BROWSER_')) return error;
  if (isTimeout(error)) return classifyTimeout(run, error, false);
  return fail('BROWSER_ACTION_FAILED', String(error?.message || error).split('\n')[0].slice(0, 300), 502);
}

async function runTask(body, taskId) {
  const task = validateBrowserTask(body.input, LIMITS);
  state.policy = readPolicy();
  if (!state.policy.parsed) throw unavailable(`policy file ${state.policy.info.error} (${PATHS.policyPath})`);
  const page = await currentPage();
  // Every task starts from a blank page: nothing of the previous task's page
  // (its content, its handles, a stale screenshot) leaks into this one. The
  // profile's cookies and storage persist on purpose.
  if (page.url() !== 'about:blank') await page.goto('about:blank', { timeout: 5_000 }).catch(() => {});
  const started = Date.now();
  const run = {
    id: taskId,
    deadline: started + task.max_ms,
    policy: state.policy.parsed,
    dnsCache: new Map(),
    handles: new Map(),
    handleCount: 0,
    steps: [],
    page: { url: null, title: null },
    screenshot: null,
    screenshotError: null,
    lastRefusal: null,
    redirects: 0,
    trampolines: new Set(),
    notifyNavigationFailure: null,
    refused: null,
    failed: null,
    usage: { steps: 0, wall_ms: 0, navigations: 0, requests_blocked: 0, egress_refused: 0, downloads_cancelled: 0, dialogs_dismissed: 0, popups_closed: 0, websockets_closed: 0, file_choosers_refused: 0 }
  };
  state.current = run;
  try {
    for (let index = 0; index < task.actions.length; index += 1) {
      const action = task.actions[index];
      const stepStarted = Date.now();
      const step = { index, action: sanitizeActionForLog(action), started_at: iso(), ended_at: null, outcome: 'skipped' };
      if (!run.refused && !run.failed) {
        if (Date.now() >= run.deadline) {
          step.outcome = 'refused';
          step.error = { code: 'BROWSER_TASK_TIMEOUT', reason: 'the task exceeded max_ms' };
          run.refused = { ...step.error };
        } else {
          try {
            const result = await executeAction(action, run, page);
            step.outcome = 'ok';
            if (result !== undefined) step.result = result;
          } catch (rawError) {
            const error = normalizeActionError(run, rawError);
            step.outcome = REFUSAL_CODES.has(error.code) ? 'refused' : 'failed';
            step.error = { code: error.code, reason: String(error.message).slice(0, 300), ...(error.refusal ? { refusal: error.refusal } : {}) };
            if (step.outcome === 'refused') run.refused = { code: error.code, reason: step.error.reason };
            else run.failed = { code: error.code, reason: step.error.reason, ...(error.refusal ? { refusal: error.refusal } : {}) };
          }
          run.usage.steps += 1;
        }
      }
      step.ended_at = iso();
      run.steps.push(step);
      log({ event: 'browser_action', task_id: run.id, index, type: action.type, host: action.type === 'open' ? hostOf(action.url) : hostOf(page.url()), outcome: step.outcome, code: step.error?.code || null, ms: Date.now() - stepStarted });
      if (action.type === 'done' && step.outcome === 'ok') break;
    }
    if (!run.page.url) run.page = { ...run.page, url: page.url(), title: String(await page.title().catch(() => '')).slice(0, 300) };
    if (task.screenshot_on_done && !run.screenshot && !run.screenshotError && run.usage.navigations > 0 && page.url() !== 'about:blank' && Date.now() < run.deadline) {
      try {
        const shot = await takeScreenshot(page, run);
        if (shot) run.screenshot = shot; else run.screenshotError = 'BROWSER_SCREENSHOT_TOO_LARGE';
      } catch (error) { run.screenshotError = `BROWSER_SCREENSHOT_FAILED: ${String(error?.message || error).split('\n')[0].slice(0, 120)}`; }
    }
  } finally {
    state.current = null;
    run.handles.clear();
  }
  const output = {
    ok: !run.refused && !run.failed,
    implementation: IMPLEMENTATION,
    task_id: run.id,
    steps: run.steps,
    page: run.page,
    ...(run.screenshot ? { screenshot: run.screenshot } : {}),
    ...(run.screenshotError ? { screenshot_error: run.screenshotError } : {}),
    ...(run.refused ? { refused: run.refused } : {}),
    ...(run.failed ? { failed: run.failed } : {}),
    usage: { ...run.usage, wall_ms: Date.now() - started, output_bytes: 0 }
  };
  return boundBrowserOutput(output, LIMITS.maxOutputBytes);
}

// -------------------------------------------------------------------- http
function send(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw fail('BROWSER_INPUT_INVALID', 'request too large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw fail('BROWSER_INPUT_INVALID', 'invalid JSON body'); }
}

function healthBody() {
  const ok = Boolean(playwright.module) && Boolean(state.policy.parsed) && egress.listening;
  return {
    ok,
    service: 'mccluster-browser-executor',
    implementation: IMPLEMENTATION,
    playwright: playwright.info,
    policy: state.policy.info,
    egress: { listening: egress.listening, port: egress.port, ...egress.stats, error: egressError },
    profile_dir: PATHS.profileDir,
    headed: HEADED,
    browser_ready: Boolean(state.context),
    chromium_version: state.chromiumVersion,
    launch_error: state.launchError,
    busy: state.busy,
    last_task_at: state.lastTaskAt,
    last_error: state.lastError,
    test_fixture_host: FIXTURE_HOST
  };
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url || '/', 'http://127.0.0.1'); }
  catch { return send(res, 400, { error: 'invalid request url' }); }
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /health') {
      state.policy = readPolicy();
      const body = healthBody();
      return send(res, body.ok ? 200 : 503, body);
    }
    if (route === 'GET /ready') {
      state.policy = readPolicy();
      if (!state.policy.parsed) return send(res, 503, { ok: false, reason: `policy file ${state.policy.info.error}`, policy: state.policy.info });
      try {
        await ensureBrowser();
        return send(res, 200, { ok: true, browser_ready: true, chromium_version: state.chromiumVersion, implementation: IMPLEMENTATION, busy: state.busy, policy: state.policy.info });
      } catch (error) {
        return send(res, 503, { ok: false, reason: String(error?.message || error).slice(0, 300), playwright: playwright.info });
      }
    }
    if (route === 'POST /execute') {
      const body = await readJson(req);
      if (body?.capability !== 'browser.act') throw fail('BROWSER_UNSUPPORTED_CAPABILITY', `unsupported capability: ${String(body?.capability || '').slice(0, 80)}`);
      if (state.busy) throw Object.assign(fail('BROWSER_BUSY', 'a browser task is already running on this node', 429), { retryable: true });
      state.busy = true;
      const taskId = typeof body?.metadata?.compute_task_id === 'string' ? body.metadata.compute_task_id.slice(0, 80) : `task_${randomUUID().slice(0, 8)}`;
      try {
        const output = await runTask(body, taskId);
        state.lastError = output.ok ? null : `${(output.refused || output.failed)?.code || 'unknown'}`;
        return send(res, 200, output);
      } catch (error) {
        state.lastError = String(error?.code || error?.message || error).slice(0, 300);
        throw error;
      } finally {
        state.busy = false;
        state.lastTaskAt = iso();
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (error) {
    return send(res, Number(error?.status || 500), { error: String(error?.message || error).slice(0, 500), code: error?.code || null, retryable: error?.retryable === true, busy: state.busy });
  }
});

server.listen(PORT, HOST, () => {
  // The ready event stays the first stdout line; tests read it to find the port.
  log({ event: 'browser_executor_ready', host: HOST, port: server.address().port, playwright: playwright.info.version, headed: HEADED, policy_path: PATHS.policyPath, profile_dir: PATHS.profileDir, egress_port: egress.port, test_fixture_host: FIXTURE_HOST });
});

async function shutdown(signal) {
  log({ event: 'browser_executor_shutdown', signal });
  const context = state.context;
  state.context = null;
  try { if (context) await context.close(); } catch { /* closing anyway */ }
  await egress.close().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
for (const signal of ['SIGTERM', 'SIGINT', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])]) {
  process.on(signal, () => { shutdown(signal).catch(() => process.exit(1)); });
}
