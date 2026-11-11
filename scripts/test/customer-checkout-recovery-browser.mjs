import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : createRequire(import.meta.url)('playwright');
const html = (await readFile(new URL('../../customer-commerce.html', import.meta.url), 'utf8')).replace(/<script[\s\S]*?<\/script>/g, '');
const script = await readFile(new URL('../../js/customer-commerce.js', import.meta.url), 'utf8');
const origin = 'https://commerce.fixture.test';
const owners = { A: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
const catalog = { mode: 'test', plans: [
 { plan: 'starter', period: 'monthly', amount: 1200, currency: 'usd' },
 { plan: 'pro', period: 'annual', amount: 24000, currency: 'usd' }
] };
const empty = () => ({ paid: false, subscriptions: [], checkout: null, can_reconcile: false });
const key = (account, plan = 'starter', period = 'monthly') => `creator-checkout-${owners[account]}-${plan}-${period}`;
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const pending = request_id => ({ status: 409, data: { error: 'The provider outcome is uncertain.', state: 'pending', request_id } });
const rejected = request_id => ({ status: 422, data: { error: 'Price validation failed.', state: 'validation_failed', released: true, retryable: true, request_id } });

async function fixture(t, handler, { account = 'A', storage = {} } = {}) {
 const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
 t.after(() => browser.close());
 const calls = [], contexts = [];
 async function device(initialAccount, initialStorage = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  contexts.push(context);
  await context.addInitScript(({ owners, initialAccount, initialStorage }) => {
   window.current = { access_token: initialAccount, user: { id: owners[initialAccount] } };
   window.MCC = { session: () => window.current, refreshIfNeeded: async () => window.current };
   // Seed once, preserving real sessionStorage across navigation and reload.
   if (!sessionStorage.getItem('fixture-initialized')) {
    for (const [key, value] of Object.entries(initialStorage)) sessionStorage.setItem(key, value);
    sessionStorage.setItem('fixture-initialized', 'true');
   }
  }, { owners, initialAccount, initialStorage });
  await context.route('**/*', async route => {
   const request = route.request(), url = new URL(request.url());
   if (url.origin === origin && url.pathname === '/customer-commerce.html') return route.fulfill({ contentType: 'text/html', body: html + '<script>' + script + '</script>' });
   if (url.hostname === 'checkout.stripe.com' || url.hostname === 'billing.stripe.com') return route.fulfill({ contentType: 'text/html', body: '<p>Synthetic provider destination. No network or charge.</p>' });
   if (url.hostname !== 'api.mccluster.org' || !url.pathname.startsWith('/v1/creator-billing/')) return route.abort('blockedbyclient');
   const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json' };
   if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
   const call = { path: url.pathname.split('/').at(-1), account: request.headers().authorization?.slice(7), body: request.postDataJSON(), method: request.method() };
   calls.push(call);
   const result = await handler(call, calls);
   if (result?.abort) return route.abort('failed');
   const data = result?.data ?? (call.path === 'plans' ? catalog : call.path === 'status' ? empty() : {});
   return route.fulfill({ status: result?.status || 200, headers, body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught browser errors'));
  await page.goto(origin + '/customer-commerce.html');
  return page;
 }
 const page = await device(account, storage);
 return { browser, page, calls, device, contexts };
}
async function state(page, expected) { await page.waitForFunction(value => document.getElementById('notice').dataset.state === value, expected); }
async function mobile(page) {
 const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
 assert.equal(dimensions.width, 390); assert.equal(dimensions.scroll, dimensions.width, 'no horizontal overflow at 390px');
}
async function stored(page) { return page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)]))); }
async function switchAccount(page, account) {
 await page.evaluate(({ account, owners }) => { window.current = account ? { access_token: account, user: { id: owners[account] } } : null; window.dispatchEvent(new Event('mcc:auth-changed')); }, { account, owners });
}

// Requests are routed in Chromium; no real backend or payment provider is contacted.
test('verified rejection rotates only the same owner/plan identity; uncertain retry stays locked', async t => {
 let attempts = 0;
 const { page, calls } = await fixture(t, async call => {
  if (call.path === 'checkout') return ++attempts === 1 ? rejected(call.body.request_id) : pending(call.body.request_id);
  if (call.path === 'resume') return pending(calls.findLast(row => row.path === 'checkout').body.request_id);
 }, { storage: { [key('A')]: 'original-starter-request', [key('A', 'pro', 'annual')]: 'original-pro-request', [key('B')]: 'other-account-request' } });
 await state(page, 'available');
 await page.locator('#plans button').first().click();
 await state(page, 'validation_failed');
 assert.match(await page.locator('#notice').innerText(), /validation failed/i);
 let values = await stored(page);
 assert.equal(values[key('A')], undefined);
 assert.equal(values[key('A', 'pro', 'annual')], 'original-pro-request');
 assert.equal(values[key('B')], 'other-account-request');
 await page.locator('#plans button').first().click();
 await state(page, 'pending');
 await page.waitForFunction(() => document.getElementById('resume').disabled === false);
 const checkoutCalls = calls.filter(row => row.path === 'checkout');
 assert.equal(checkoutCalls.length, 2);
 assert.equal(checkoutCalls[0].body.request_id, 'original-starter-request');
 assert.notEqual(checkoutCalls[1].body.request_id, checkoutCalls[0].body.request_id);
 assert.deepEqual(checkoutCalls.map(row => [row.body.plan, row.body.period]), [['starter', 'monthly'], ['starter', 'monthly']]);
 assert.deepEqual(await page.locator('#plans button').evaluateAll(buttons => buttons.map(button => button.disabled)), [true, true]);
 await page.locator('#resume').click();
 await page.waitForFunction(() => document.getElementById('resume').disabled === false);
 assert.deepEqual(calls.find(row => row.path === 'resume').body, {});
 values = await stored(page);
 assert.equal(values[key('A')], checkoutCalls[1].body.request_id);
 assert.equal(calls.filter(row => row.path === 'checkout').length, 2);
 await mobile(page);
});

test('timeout recovery survives reload and a new device using only the server-held attempt', async t => {
 let attempt = null;
 const { page, calls, device } = await fixture(t, async call => {
  if (call.path === 'checkout') { attempt = { ...call.body, state: 'pending', recoverable: true }; return { abort: true }; }
  if (call.path === 'status') return { data: { ...empty(), checkout: attempt } };
  if (call.path === 'resume') return { data: { request_id: attempt.request_id, session_id: 'cs_test_original', url: 'https://checkout.stripe.com/c/pay/cs_test_original' } };
 });
 await state(page, 'available');
 await page.locator('#plans button').first().click();
 await state(page, 'pending');
 await page.waitForFunction(() => document.getElementById('resume').disabled === false);
 const original = attempt.request_id;
 await page.reload(); await state(page, 'pending');
 assert.equal((await stored(page))[key('A')], original);
 assert.equal(await page.locator('#plans button').last().isDisabled(), true);
 await mobile(page);
 const newDevice = await device('A'); await state(newDevice, 'pending');
 assert.equal((await stored(newDevice))[key('A')], undefined);
 assert.match(await newDevice.locator('#checkout-detail').innerText(), new RegExp(original));
 assert.equal(await newDevice.locator('#plans button').last().isDisabled(), true);
 await mobile(newDevice);
 await newDevice.locator('#resume').click();
 await newDevice.waitForURL('https://checkout.stripe.com/c/pay/cs_test_original');
 assert.equal(calls.filter(row => row.path === 'checkout').length, 1);
 assert.deepEqual(calls.find(row => row.path === 'resume').body, {});
 assert.equal(attempt.request_id, original);
});

test('plan changes remain blocked until proven release; release clears only the current account', async t => {
 let attempt = { request_id: 'existing-starter-request', plan: 'starter', period: 'monthly', state: 'pending', recoverable: true };
 const { page, calls } = await fixture(t, async call => {
  if (call.path === 'status') return { data: { ...empty(), checkout: attempt } };
  if (call.path === 'resume') { attempt = null; return { data: { released: true } }; }
  if (call.path === 'checkout') { attempt = { ...call.body, state: 'pending', recoverable: true }; return pending(call.body.request_id); }
 }, { storage: { [key('A')]: 'existing-starter-request', [key('A', 'pro', 'annual')]: 'old-pro-request', [key('B')]: 'other-account-request' } });
 await state(page, 'pending');
 assert.equal(await page.locator('#plans button').last().isDisabled(), true);
 assert.equal(calls.filter(row => row.path === 'checkout').length, 0);
 await page.locator('#resume').click(); await state(page, 'available');
 const values = await stored(page);
 assert.equal(values[key('A')], undefined); assert.equal(values[key('A', 'pro', 'annual')], undefined);
 assert.equal(values[key('B')], 'other-account-request');
 await page.locator('#plans button').last().click(); await state(page, 'pending');
 await page.waitForFunction(() => document.getElementById('resume').disabled === false);
 const checkout = calls.find(row => row.path === 'checkout');
 assert.equal(checkout.body.plan, 'pro'); assert.equal(checkout.body.period, 'annual'); assert.notEqual(checkout.body.request_id, 'old-pro-request');
 await mobile(page);
});

test('requires_owner explains review without fake release; active subscription guards remain', async t => {
 let status = { ...empty(), checkout: { request_id: 'long-reference-'.repeat(8), plan: 'starter', period: 'monthly', state: 'requires_owner', recoverable: false } };
 const { page, calls } = await fixture(t, call => call.path === 'status' ? { data: status } : undefined);
 await state(page, 'requires_owner');
 assert.match(await page.locator('#notice').innerText(), /McCluster owner or billing support/);
 assert.equal(await page.locator('#resume').isDisabled(), true);
 assert.equal(await page.locator('#plans button').first().isDisabled(), true);
 assert.equal(await page.locator('#recovery').isVisible(), false);
 assert.equal(calls.some(row => row.path === 'recovery'), false);
 await mobile(page);
 for (const value of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']) {
  status = { ...empty(), subscriptions: [{ status: value, stripe_subscription_id: 'sub_fixture' }] };
  await page.locator('#refresh').click(); await state(page, 'pending');
  assert.equal(await page.locator('#plans button').first().isDisabled(), true, value);
  assert.equal(await page.locator('#resume').isDisabled(), true, value);
  assert.equal(await page.locator('#subscriptions button').isDisabled(), false, value);
 }
 status = { ...empty(), paid: true };
 await page.locator('#refresh').click(); await state(page, 'paid');
 assert.equal(await page.locator('#plans button').first().isDisabled(), true);
 assert.equal(calls.some(row => row.path === 'checkout'), false);
});

test('stale account release never clears another account storage or its in-flight busy state', async t => {
 const releaseA = gate(), seenA = gate(), releaseB = gate(), seenB = gate();
 const { page, calls } = await fixture(t, async call => {
  if (call.path === 'resume' && call.account === 'A') { seenA.resolve(); await releaseA.promise; return { data: { released: true } }; }
  if (call.path === 'checkout' && call.account === 'B') { seenB.resolve(); await releaseB.promise; return pending(call.body.request_id); }
 }, { storage: { [key('A')]: 'keep-account-a-request', [key('B')]: 'keep-account-b-request' } });
 await state(page, 'available');
 await page.locator('#resume').click(); await seenA.promise;
 await switchAccount(page, 'B'); await state(page, 'available');
 await page.locator('#plans button').first().click(); await seenB.promise;
 releaseA.resolve();
 // Let A's fulfilled response reach its finally block while B is still held.
 await page.waitForResponse(response => response.url().endsWith('/resume'));
 await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 assert.equal(await page.locator('#resume').isDisabled(), true);
 assert.equal(await page.locator('#refresh').isDisabled(), true);
 assert.equal(await page.locator('#plans button').last().isDisabled(), true);
 const values = await stored(page);
 assert.equal(values[key('A')], 'keep-account-a-request'); assert.equal(values[key('B')], 'keep-account-b-request');
 releaseB.resolve();
 await page.waitForFunction(() => document.getElementById('resume').disabled === false);
 assert.equal(await page.locator('#notice').getAttribute('data-state'), 'pending');
 assert.equal(calls.filter(row => row.path === 'checkout').length, 1);
 assert.equal(calls.find(row => row.path === 'checkout').account, 'B');
 await switchAccount(page, null); await state(page, 'unavailable');
 assert.equal(await page.locator('#subscriptions').innerText(), '');
 assert.equal(await page.locator('#plans').innerText(), '');
 assert.equal(await page.locator('#resume').isDisabled(), true);
});

test('owner queue is fenced on account switch and private delayed responses stay hidden', async t => {
 const release = gate(), seen = gate();
 const { page, calls } = await fixture(t, async call => {
  if (call.path === 'status') return { data: { ...empty(), can_reconcile: call.account === 'A' } };
  if (call.path === 'recovery') { seen.resolve(); await release.promise; return { data: { attempts: [{ owner_user_id: 'private-owner-reference', request_id: 'private-checkout-reference', plan: 'starter', period: 'monthly', state: 'requires_owner' }] } }; }
 });
 await seen.promise;
 await switchAccount(page, 'B'); await state(page, 'available');
 release.resolve();
 await page.waitForResponse(response => response.url().endsWith('/recovery'));
 await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 assert.equal(await page.locator('#recovery').isVisible(), false);
 assert.doesNotMatch(await page.locator('body').innerText(), /private-owner-reference|private-checkout-reference/);
 assert.equal(calls.filter(row => row.path === 'recovery').length, 1);
 await mobile(page);
});

test('owner reconciliation refreshes the queue without navigating or clearing the operator identities', async t => {
 const row = { owner_user_id: owners.B, request_id: 'target-b-original-request', plan: 'pro', period: 'annual', state: 'requires_owner' };
 let attempts = [row];
 const { page, calls } = await fixture(t, call => {
  if (call.path === 'status') return { data: { ...empty(), can_reconcile: true } };
  if (call.path === 'recovery') return { data: { attempts } };
  if (call.path === 'reconcile') { attempts = []; return { data: { released: true, request_id: row.request_id, url: 'https://checkout.stripe.com/c/pay/never-redirect-the-operator' } }; }
 }, { storage: { [key('A')]: 'operator-own-request', [key('B')]: 'target-local-request' } });
 await page.locator('#recovery input').waitFor(); await mobile(page);
 await page.locator('#recovery input').fill('not-a-session');
 await page.locator('#recovery button').click();
 assert.equal(calls.some(call => call.path === 'reconcile'), false);
 await page.locator('#recovery input').fill('cs_test_verified_original');
 await page.locator('#recovery button').click();
 await page.waitForFunction(() => document.getElementById('recovery').textContent.includes('Reconciliation checked.'));
 assert.equal(calls.filter(row => row.path === 'recovery').length, 2);
 assert.deepEqual(calls.find(row => row.path === 'reconcile').body, { owner_user_id: owners.B, request_id: row.request_id, session_id: 'cs_test_verified_original' });
 assert.equal(page.url(), origin + '/customer-commerce.html');
 const values = await stored(page);
 assert.equal(values[key('A')], 'operator-own-request'); assert.equal(values[key('B')], 'target-local-request');
 assert.equal(await page.locator('#recovery input').count(), 0);
 await mobile(page);
});

test('retryable-looking but unverified or wrong-identity errors never release the buyer', async t => {
 for (const variant of ['not-released', 'wrong-identity', 'pending']) {
  await t.test(variant, async t => {
   const { page } = await fixture(t, call => {
    if (call.path !== 'checkout') return;
    const response = rejected(call.body.request_id);
    if (variant === 'not-released') delete response.data.released;
    if (variant === 'wrong-identity') response.data.request_id = 'another-original-request';
    if (variant === 'pending') response.data.state = 'pending';
    return response;
   }, { storage: { [key('A')]: 'keep-original-request' } });
   await state(page, 'available'); await page.locator('#plans button').first().click();
   await page.waitForFunction(() => document.getElementById('resume').disabled === false);
   await state(page, 'pending');
   assert.equal((await stored(page))[key('A')], 'keep-original-request');
   assert.equal(await page.locator('#plans button').last().isDisabled(), true);
  });
 }
});
test('paid workspace wins over a retained pending checkout receipt', async t => {
 const { page } = await fixture(t, async call => {
  if (call.path === 'status') return { data: { ...empty(), paid: true, subscriptions: [{ status: 'active', stripe_subscription_id: 'sub_fixture' }], checkout: { plan: 'starter', period: 'monthly', request_id: 'fixture-pending-paid', state: 'pending', recoverable: true } } };
 });
 await state(page, 'paid');
 assert.match(await page.locator('#notice').innerText(), /paid workspace is active/);
 assert.equal(await page.locator('#resume').isDisabled(), true);
 assert.equal(await page.locator('#subscriptions button').isDisabled(), false);
 await mobile(page);
});
test('a second-device conflict displays the server-held identity and plan', async t => {
 const { page } = await fixture(t, async call => {
  if (call.path === 'checkout') return { status: 409, data: { error: 'Resume the existing checkout.', state: 'pending', request_id: 'canonical-other-device', checkout: { request_id: 'canonical-other-device', plan: 'starter', period: 'monthly', state: 'pending', recoverable: true } } };
 });
 await state(page, 'available');await page.locator('#plans button').last().click();await state(page, 'pending');
 await page.waitForFunction(() => document.getElementById('checkout-detail').textContent.includes('canonical-other-device'));
 assert.match(await page.locator('#checkout-detail').innerText(), /starter · monthly/);
 assert.match(await page.locator('#checkout-detail').innerText(), /canonical-other-device/);
 assert.equal(await page.locator('#plans button').first().isDisabled(), true);
 await mobile(page);
});
