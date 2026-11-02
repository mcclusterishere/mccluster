// js/customer-social.js against the v6 status contract (REMAINING-GATES.md): entitlement_reason is rendered separately
// from provider/connection readiness, publish is enabled only on can_publish, recovery controls stay available, an
// expired/cancelled included month is never called a missing paid workspace, and 403 is a generic authorization error.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('js/customer-social.js', 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
function page(status, { jobs = { jobs: [] }, statusCode = 200 } = {}) {
  const byId = new Map(); const calls = [];
  const el = () => ({ textContent: '', className: '', hidden: false, disabled: false, value: '', href: '', files: [], children: [], listeners: {}, replaceChildren(...c) { this.children = c; }, append(...c) { this.children.push(...c); }, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } });
  for (const id of ['site-link', 'notice', 'entitlement', 'connection', 'connect', 'disconnect', 'selection', 'accounts', 'select', 'publish', 'video', 'caption', 'publish-button', 'refresh', 'jobs']) byId.set(id, el());
  const window = { MCC: { api: async (path, init) => { calls.push([path, init]); if (path.startsWith('/v1/customer-social/status')) return { ok: statusCode < 400, status: statusCode, json: async () => status }; if (path.startsWith('/v1/customer-social/jobs')) return { ok: true, status: 200, json: async () => jobs }; return { ok: true, status: 200, json: async () => ({}) }; } }, addEventListener() {} };
  vm.runInNewContext(SRC, { window, document: { getElementById: id => byId.get(id), createElement: () => el() }, location: { search: '?org_id=33333333-3333-4333-8333-333333333333', pathname: '/customer-social.html' }, history: { replaceState() {} }, sessionStorage: { getItem: () => null, removeItem() {}, setItem() {} }, URLSearchParams, URL, JSON, Promise, Object, Array, String, Error, crypto: { randomUUID: () => 'k' }, console });
  return { byId, calls, text: id => byId.get(id).textContent, async ready() { await flush(); } };
}
const status = (capability, extra = {}) => ({ org_id: 'o', module_consumer: { mode: 'module', eligible: capability.eligible }, legacy_paid_gate_required: false, configured: true, blockers: [], connection: { handle: '@me', status: 'connected' }, capability: { authority: 'atomic_customer_social_consumer_v2', formats: ['instagram_reels'], ...capability }, ...extra });

test('eligible and ready: authority shown, entitlement named, publish enabled', async () => {
  const p = page(status({ eligible: true, can_publish: true, reason: null, entitlement_reason: 'included_trial' })); await p.ready();
  assert.match(p.text('entitlement'), /module entitlement \(atomic consumer\)/); assert.match(p.text('entitlement'), /included platform month/); assert.match(p.text('entitlement'), /Ready to publish/);
  assert.equal(p.byId.get('publish-button').disabled, false);
});

test('eligible but not ready: entitlement stays positive, readiness names the blocker, publish disabled', async () => {
  const p = page(status({ eligible: true, can_publish: false, reason: 'owned_connection_required', entitlement_reason: 'included_trial' }, { connection: null })); await p.ready();
  assert.match(p.text('entitlement'), /Covered by the included platform month/); assert.match(p.text('entitlement'), /Connect an Instagram account you own/);
  assert.equal(p.byId.get('publish-button').disabled, true);
  const q = page(status({ eligible: true, can_publish: false, reason: 'provider_unavailable', entitlement_reason: 'mapped_paid_subscription' })); await q.ready();
  assert.match(q.text('entitlement'), /paid subscription mapped/); assert.match(q.text('entitlement'), /entitlement is unaffected/);
});

test('expired or cancelled included month is never described as a missing paid workspace; recovery controls remain', async () => {
  for (const r of ['expired', 'cancelled']) {
    const p = page(status({ eligible: false, can_publish: false, reason: r, entitlement_reason: r })); await p.ready();
    assert.doesNotMatch(p.text('entitlement'), /paid workspace/i); assert.match(p.text('entitlement'), /kept/);
    assert.equal(p.byId.get('publish-button').disabled, true); assert.equal(p.byId.get('disconnect').hidden, false); assert.equal(p.byId.get('connect').disabled, false);
  }
});

test('every reason in the contract has words; safety_disabled, module_not_included and legacy_paid_required are distinct', async () => {
  for (const [r, expect] of [['safety_disabled', /paused by McCluster for safety/], ['module_not_included', /does not include this module/], ['module_capability_unavailable', /does not include this capability/], ['legacy_paid_required', /paid-plan rule/], ['registration_blocked', /not fulfilled/], ['module_authorization_unavailable', /nothing was assumed/], ['trial_disabled', /not switched on/], ['not_granted', /No included platform month or paid module/]]) {
    const p = page(status({ eligible: false, can_publish: false, reason: r, entitlement_reason: r })); await p.ready(); assert.match(p.text('entitlement'), expect, r);
  }
});

test('the legacy (feature-off) response keeps its own wording and authority label', async () => {
  const p = page({ org_id: 'o', module_consumer: null, legacy_paid_gate_required: true, configured: true, blockers: [], connection: null, capability: { eligible: false, can_publish: false, reason: 'active_owned_workspace_required', entitlement_reason: 'active_owned_workspace_required', authority: 'owned_active_creator_workspace' } }); await p.ready();
  assert.match(p.text('entitlement'), /paid-plan rule \(legacy\)/); assert.match(p.text('entitlement'), /active paid workspace you own/);
});

test('a 403 is a generic authorization error, never another tenant\'s status; a 401 asks to sign in', async () => {
  const p = page({ error: 'forbidden' }, { statusCode: 403 }); await p.ready(); assert.match(p.text('notice'), /not yours to manage/); assert.equal(p.text('entitlement'), '');
  const q = page({ error: 'signin' }, { statusCode: 401 }); await q.ready(); assert.match(q.text('notice'), /Sign in again/);
});
