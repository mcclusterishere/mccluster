// js/control-room/member-fronts.js: the house owner's moderation screen reads a member's record and revision first,
// takes a publication down with that revision and a recorded reason, re-reads on a conflict, and uses the legacy
// unconditional takedown only where the versioned API reports itself unconfigured.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const REVISIONS = readFileSync('js/editor-revisions.js', 'utf8');
const MOD = readFileSync('js/control-room/member-fronts.js', 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

function screen(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const path = url.replace('https://api.mccluster.org', ''), method = (init && init.method) || 'GET', body = init && init.body ? JSON.parse(init.body) : null;
    calls.push([method, path, body]);
    const r = routes[method + ' ' + path]; if (!r) throw new TypeError('unexpected ' + method + ' ' + path);
    const res = typeof r === 'function' ? r(body) : r;
    return { ok: res.status < 400, status: res.status, json: async () => res.body };
  };
  const window = { CR: {}, MCC_SUPA: { token: async () => 'house' }, confirm: () => true };
  const ctx = { window, document: { querySelector: () => null, createElement: () => ({}) }, fetch, JSON, Date, Promise, String, Number, Object, Array, Error, Boolean, encodeURIComponent, setTimeout: f => setImmediate(f), console };
  vm.runInNewContext(REVISIONS + '\n' + MOD, ctx);
  const M = window.CR.memberFronts;
  return { M, S: M.state, calls, html: () => M.render(), async look(handle) { M.state.handle = handle; M.look(); await flush(); }, async takedown(reason) { M.state.reason = reason; M.takedown(); await flush(); await flush(); } };
}
const rec = (revision, extra = {}) => ({ status: 200, body: { ok: true, revision, protected: revision > 0, snapshot: { handle: 'bob', published: { schema: 'mccluster-front/v1' }, published_at: '2026-11-01T00:00:00Z', removed_at: null, updated_at: '2026-11-01T00:00:00Z', ...extra } } });

test('look up reads the record with its revision and offers a takedown with a recorded reason', async () => {
  const s = screen({ 'GET /v2/fronts/bob/edit': rec(5) });
  await s.look('bob');
  assert.equal(s.S.v2.revision, 5); assert.match(s.html(), /@bob/); assert.match(s.html(), /revision 5/); assert.match(s.html(), /data-cmf="takedown"/);
});

test('takedown carries expected_revision and the reason; nothing is sent without a reason', async () => {
  let got = null;
  const s = screen({ 'GET /v2/fronts/bob/edit': rec(5), 'POST /v2/fronts/bob/takedown': b => { got = b; return rec(6, { published: null, removed_at: '2026-11-02T00:00:00Z', removed_reason: b.reason }); } });
  await s.look('bob');
  await s.takedown('');
  assert.equal(got, null); assert.match(s.S.message, /reason first/);
  await s.takedown('Reported artwork');
  assert.deepEqual(JSON.parse(JSON.stringify(got)), { expected_revision: 5, reason: 'Reported artwork' });
  assert.equal(s.S.v2.revision, 6); assert.match(s.html(), /Already taken down/);
  assert.equal(s.calls.filter(c => c[1].startsWith('/v1/')).length, 0, 'no legacy route');
});

test('a stale takedown is refused and the record is read again for a fresh decision', async () => {
  const s = screen({ 'GET /v2/fronts/bob/edit': () => rec(7), 'POST /v2/fronts/bob/takedown': { status: 409, body: { code: 'editor_revision_conflict' } } });
  await s.look('bob'); s.S.v2.revision = 5;
  await s.takedown('Reported');
  assert.equal(s.S.v2.revision, 7); assert.match(s.S.message, /changed since you looked/); assert.ok(s.S.conflict);
});

test('without the versioned API the legacy unconditional takedown is offered and labelled', async () => {
  let legacy = null;
  const s = screen({ 'GET /v2/fronts/bob/edit': { status: 503, body: { code: 'unconfigured', error: 'Versioned editor is not enabled' } }, 'POST /v1/fronts/bob/takedown': b => { legacy = b; return { status: 200, body: { ok: true, removed: true } }; } });
  await s.look('bob');
  assert.equal(s.S.legacy, true); assert.match(s.S.message, /legacy takedown route/);
});

test('FINDING 1: a 403, generic 503, network failure or malformed read pauses takedown — no legacy route is used', async () => {
  for (const [label, res] of [['403', { status: 403, body: { code: 'forbidden' } }], ['503', { status: 503, body: { code: 'storage_unavailable' } }], ['malformed', { status: 200, body: { ok: true } }]]) {
    let legacy = 0;
    const s = screen({ 'GET /v2/fronts/bob/edit': res, 'POST /v1/fronts/bob/takedown': () => { legacy++; return { status: 200, body: { ok: true } }; } });
    await s.look('bob'); assert.equal(s.S.legacy, false, label); assert.ok(s.S.blocked, label);
    await s.takedown('Reported'); assert.equal(legacy, 0, label + ': no legacy takedown'); assert.match(s.S.message, /could not be reached|paused/, label);
  }
});
