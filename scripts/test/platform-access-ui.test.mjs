// js/platform-access.js renders the v5 access projection as the server returns it: allowed/denied with reasons,
// trial and domain expiries kept distinct, hosting unresolved, no conversion; cancel hits the authenticated route
// with exactly {org_id}; an unconfigured contract is said plainly.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('js/platform-access.js', 'utf8');
const ORG = '33333333-3333-4333-8333-333333333333', ORDER = '44444444-4444-4444-8444-444444444444';
const projection = (trialState, extra = {}) => ({ scope: { org_id: ORG, app_key: 'social' }, capabilities: { base_manage: { allowed: true, reason: 'existing_owner_control' }, advanced: { allowed: trialState === 'active', reason: trialState === 'active' ? 'included_trial' : trialState }, white_label: { allowed: false, reason: trialState === 'active' ? 'included_trial' : trialState } },
  trial: { state: trialState, starts_at: '2026-11-02T00:00:00Z', expires_at: '2026-12-02T00:00:00Z', cancelled_at: null, policy: {} }, domain: { hostname: 'example.org', registered_at: '2026-11-02T00:00:00Z', expires_at: '2027-11-02T00:00:00Z', registration_state: 'fulfilled' }, hosting: { allowed: null, reason: 'economics_policy_unresolved' }, free_capabilities: ['existing_account_access'], existing_limits_unchanged: true, automatic_paid_conversion: false, ...extra });

function load(routes) {
  const calls = [];
  function el(tag) { return { tagName: tag, children: [], textContent: '', className: '', attrs: {}, value: '', disabled: false, appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; }, setAttribute(k, v) { this.attrs[k] = v; } }; }
  const fetch = async (url, init) => { const u = new URL(url), method = (init && init.method) || 'GET', body = init && init.body ? JSON.parse(init.body) : null; calls.push([method, u.pathname + u.search, body]); const r = routes[method + ' ' + u.pathname]; if (!r) throw new TypeError('unexpected'); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  const window = { confirm: () => true };
  vm.runInNewContext(SRC, { window, document: { createElement: el }, fetch, URL, JSON, Promise, String, Date, Object, Array, Number, console, encodeURIComponent });
  const text = n => [n.textContent, ...(n.children || []).map(text)].join(' ');
  return { PA: window.MCC_PLATFORM_ACCESS, calls, el, text };
}

test('an active included month renders allowed/denied with the server reasons and both expiries', async () => {
  const { PA, el, text } = load({});
  const box = el('div');
  PA.render(box, { ok: true, status: 200, data: projection('active') }, {});
  const t = text(box);
  assert.match(t, /Site management Available yours already/); assert.match(t, /Advanced modules Available included with your verified domain registration/);
  assert.match(t, /White-label Not available/, 'denied stays visible, greyed');
  assert.match(t, /Included platform month: active until/); assert.match(t, /Domain example\.org: registered .* for its paid term until/); assert.match(t, /annual registration does not end with the platform month/);
  assert.match(t, /Hosting: hosting terms are not decided yet/); assert.match(t, /No automatic paid conversion/);
});

test('expired, cancelled and registration_blocked states keep site/data/control and say why advanced is off', () => {
  const { PA, el, text } = load({});
  for (const [state, expect] of [['expired', /ended .* Your site, data and control are kept/], ['cancelled', /cancelled .* Your site, data and control are kept/], ['registration_blocked', /paused: the domain order is/], ['not_granted', /No included platform month recorded/]]) {
    const box = el('div'); PA.render(box, { ok: true, status: 200, data: projection(state) }, {}); assert.match(text(box), expect, state);
    assert.match(text(box), /Advanced modules Not available/);
  }
});

test('an unconfigured contract, a signed-out session and a foreign workspace are each said plainly', () => {
  const { PA, el, text } = load({});
  const a = el('div'); PA.render(a, { ok: false, status: 503, data: { ok: false, code: 'module_contract_unconfigured' } }); assert.match(text(a), /not switched on for this site yet/);
  const b = el('div'); PA.render(b, { ok: false, status: 401, data: { code: 'signin' } }); assert.match(text(b), /Sign in again/);
  const c = el('div'); PA.render(c, { ok: false, status: 403, data: { code: 'module_not_authorized' } }); assert.match(text(c), /not yours to check/);
});

test('access and cancel call the exact routes with the exact scope; a malformed scope never leaves the browser', async () => {
  const { PA, calls } = load({ 'GET /v2/platform/apps/social/access': { status: 200, body: projection('active') }, ['POST /v2/platform/domain-trials/' + ORDER + '/cancel']: { status: 200, body: { ok: true, cancelled_at: '2026-11-03T00:00:00Z' } } });
  const r = await PA.access('tok', 'social', ORG); assert.equal(r.ok, true); assert.deepEqual(calls[0], ['GET', '/v2/platform/apps/social/access?org_id=' + ORG, null]);
  const c = await PA.cancel('tok', ORDER, ORG); assert.equal(c.ok, true); assert.deepEqual(calls[1], ['POST', '/v2/platform/domain-trials/' + ORDER + '/cancel', { org_id: ORG }]);
  const bad = await PA.access('tok', 'social', 'not-a-uuid'); assert.equal(bad.status, 400); assert.equal(calls.length, 2, 'nothing sent');
  const bad2 = await PA.cancel('tok', 'nope', ORG); assert.equal(bad2.status, 400); assert.equal(calls.length, 2);
});

test('cancellation is offered only with an order to name, confirms, and is never shown for an ended month', () => {
  const { PA, el, text } = load({});
  let cancelled = null;
  const a = el('div'); PA.render(a, { ok: true, status: 200, data: projection('active') }, { orderIds: [ORDER], onCancel: id => { cancelled = id; return Promise.resolve(); } });
  const button = [...a.children].flatMap(x => x.children || []).find(x => x.tagName === 'button'); assert.ok(button); button.onclick(); assert.equal(cancelled, ORDER);
  const b = el('div'); PA.render(b, { ok: true, status: 200, data: projection('active') }, { orderIds: [], onCancel: () => {} }); assert.match(text(b), /open your domain purchases/);
  const c = el('div'); PA.render(c, { ok: true, status: 200, data: projection('expired') }, { orderIds: [ORDER], onCancel: () => {} }); assert.ok(!text(c).includes('Cancel the included'));
});
