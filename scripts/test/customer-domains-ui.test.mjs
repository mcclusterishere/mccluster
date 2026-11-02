// js/customer-domains.js: connection cards use the Worker's real status vocabulary without overstating, and surface
// the documented 24-hour provider-verification lapse (no unattended refresh exists) with the Verify-again recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('js/customer-domains.js', 'utf8');
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
function page(domains) {
  const byId = new Map(); const calls = [];
  const el = (tag) => ({ tagName: tag, children: [], textContent: '', className: '', disabled: false, value: '', listeners: {}, append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; }, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } });
  for (const id of ['domains', 'domainStatus', 'domainTarget', 'connect', 'domainForm', 'domainRefresh', 'hostname']) byId.set(id, el(id));
  const document = { getElementById: id => byId.get(id), createElement: el };
  const fetch = async (url, init) => { calls.push([init.method, url]); return { ok: true, status: 200, json: async () => ({ capabilities: { reason: 'ok', connect: true }, targets: [], domains, cname_target: 'edge.example' }) }; };
  vm.runInNewContext(SRC, { window: { MCC_SUPA: { token: async () => 't' }, addEventListener() {} }, document, fetch, JSON, Promise, Date, Number, String, Object, Array, Math, isFinite, AbortController, console });
  const text = n => [n.textContent, ...(n.children || []).map(text)].join(' ');
  return { calls, async ready() { await flush(); }, text: () => text(byId.get('domains')) };
}
const row = (status, checkedAgoHours, extra = {}) => ({ id: 'd1', hostname: 'www.example.org', status, ssl_status: 'active', last_checked_at: new Date(Date.now() - checkedAgoHours * 3600000).toISOString(), records: [{ type: 'TXT', name: '_mccluster.www.example.org', value: 'tok' }], provider_records: [], routing_candidate: { requires_public_cname: true, name: 'www.example.org', value: 'edge.example' }, ...extra });

test('statuses are worded from the Worker vocabulary without overstating', async () => {
  for (const [status, expect] of [['ownership_pending', /ownership not yet verified/], ['dns_pending', /CNAME does not point/], ['tls_pending', /certificate not active yet/], ['active', /routing and certificate active/], ['error', /last check failed/], ['reconciliation_required', /needs a reviewed provider check/]]) {
    const p = page([row(status, 1)]); await p.ready(); assert.match(p.text(), expect, status);
  }
});

test('the 24-hour provider lapse is shown: current, lapsing soon, lapsed — and never claimed to refresh itself', async () => {
  const current = page([row('active', 2)]); await current.ready(); assert.match(current.text(), /current until about/); assert.match(current.text(), /not refreshed automatically/);
  const soon = page([row('active', 20)]); await soon.ready(); assert.match(soon.text(), /lapses in about \d+ hour/);
  const lapsed = page([row('active', 30)]); await lapsed.ready(); assert.match(lapsed.text(), /has lapsed/); assert.match(lapsed.text(), /Routing may stop until you verify again/);
  const unverified = page([row('ownership_pending', 30)]); await unverified.ready(); assert.doesNotMatch(unverified.text(), /lapse/);
});
