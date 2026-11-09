/* Integrated panel + real transport lifecycle regressions (audit EQ1, EQ2, 2026-11-09).
   Synthetic DOM and fetch only: no network, no membership mutation, no production state. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountEnvironment } from '../../vendor/equity-uprise/src/environment/panel.mjs';
import { createEnvironmentTransport } from '../../vendor/equity-uprise/src/environment/transport.mjs';

class E {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.textContent = ''; this.hidden = false; this.attrs = {}; this.value = ''; this.checked = false; this.disabled = false; }
  set innerHTML(s) { this.ids = Object.fromEntries([...s.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map(m => { const n = new E(m[1]); n.id = m[2]; return [m[2], n]; })); this.children = Object.values(this.ids); }
  querySelector(s) { if (s.startsWith('#')) return (this.id === s.slice(1) ? this : null) || this.ids?.[s.slice(1)] || this.children.map(c => c.querySelector(s)).find(Boolean) || null; return this.querySelectorAll(s)[0] || null; }
  querySelectorAll(s) { const out = []; const walk = n => { for (const c of n.children) { if (c.tag === s) out.push(c); walk(c); } }; walk(this); return out; }
  append(...x) { this.children.push(...x); }
  replaceChildren(...x) { this.children = x; }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; }
  scrollIntoView() {}
}
const find = (e, label) => e.textContent === label ? e : e.children.map(x => find(x, label)).find(Boolean);
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const installation = { schema: 'equity-uprise.installation/v1', id: 'test-install', appOrigin: 'https://test.example.invalid', apiOrigin: 'https://api.example.invalid', brand: { name: 'Synthetic' }, modules: { environment: true } };
const ID = '11111111-1111-4111-8111-111111111111', ASSIGNMENT = '22222222-2222-4222-8222-222222222222', PROOF = '33333333-3333-4333-8333-333333333333';
const event = { id: 'usgs:test', title: 'Fixture observation', category: 'Earthquake', lat: 41, lon: -73, observed_at: '2026-11-06T12:00:00Z', fetched_at: '2026-11-07T12:00:00Z', stale: true, source: { label: 'USGS', url: 'https://earthquake.usgs.gov/eventpage/test' }, actions: [{ id: 'verify', title: 'Verify public guidance', description: 'Check notices.', proof: 'Link', safety: 'Stay out.' }] };

function harness({ owner = false, joined = true, assigned = false, proof = null, openMission = true } = {}) {
  const panel = new E('div'), frame = { contentWindow: {} }, handlers = new Map(), writes = [], sent = [];
  let identity = 'user-A', pauseNext = false, release = null;
  const transport = createEnvironmentTransport({
    installation,
    token: () => pauseNext ? (pauseNext = false, new Promise(r => { release = r; })) : identity,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname.slice('/v1/world/environment'.length);
      if (options.method === 'POST') writes.push({ path, authorization: options.headers.authorization, body: options.body });
      if (path === '') return Response.json({ schema: 'world-environment/v1', events: [event], sources: [], missions: openMission ? [{ id: ID, event_id: event.id, action_id: 'verify', status: 'open' }] : [] });
      if (path === '/team') return Response.json({ ok: true, membership: { joined }, assignments: assigned ? [{ mission_id: ID, assignment_id: ASSIGNMENT, status: 'joined', mission_status: 'open', title: 'Saved mission', event_id: event.id, source: event.source }] : [] });
      if (path === '/oversight') return owner ? Response.json({ ok: true, missions: [{ id: ID, title: 'Proposal', status: 'proposed', assignments: [] }] }) : Response.json({ error: 'owner' }, { status: 403 });
      if (path === '/proofs') return owner ? Response.json({ ok: true, proofs: proof ? [{ proof_id: PROOF, assignment_id: ASSIGNMENT, title: 'Saved mission', statement: 'done', status: 'pending', proof_revision: 'a'.repeat(32) }] : [] }) : Response.json({ error: 'owner' }, { status: 403 });
      if (path === `/assignments/${ASSIGNMENT}/proof`) return Response.json({ ok: true, assignment_id: ASSIGNMENT, status: 'joined', mission_status: 'open', can_submit: true, can_share: true, share: false, proof: null });
      return Response.json({ ok: true, assignment_id: ASSIGNMENT, proof_id: PROOF, status: 'submitted', id: ID, post_id: PROOF, proof_published: true });
    }
  });
  const d = { createElement: tag => new E(tag), documentElement: { dataset: { worldMode: 'environment' } }, getElementById: () => null };
  const w = { location: { origin: installation.appOrigin }, confirm: () => true, addEventListener: (k, v) => handlers.set(k, v), removeEventListener: () => {} };
  const mounted = mountEnvironment(w, d, { panel, frame, token: () => identity, request: transport.request, signIn() {}, sendGlobe: data => sent.push(data) });
  return {
    panel, mounted, writes, sent, handlers, w,
    pause() { pauseNext = true; },
    switchToB() { identity = 'user-B'; handlers.get('environment:auth')(); },
    signOut() { identity = null; handlers.get('environment:auth')(); },
    release() { release(identity); },
    identity: () => identity
  };
}

const selectEvent = h => h.panel.querySelector('#weEvents').querySelectorAll('button')[0].onclick();
const RACES = [
  ['leave the team', { joined: true }, h => find(h.panel.querySelector('#weTeam'), 'Leave the team').onclick()],
  ['join the team', { joined: false }, h => { h.panel.querySelector('#weJoinConsent').checked = true; return find(h.panel.querySelector('#weTeam'), 'Join the team').onclick(); }],
  ['join an approved mission', { joined: true }, h => find(h.panel.querySelector('#weDetail'), 'Join approved mission').onclick()],
  ['suggest a mission for review', { joined: true, openMission: false }, h => find(h.panel.querySelector('#weDetail'), 'Suggest this mission for review').onclick()],
  ['review a mission as owner', { owner: true }, h => find(h.panel.querySelector('#weOwner'), 'Approve mission').onclick()],
  ['submit mission evidence', { joined: true, assigned: true }, async h => { find(h.panel.querySelector('#weAssignments'), 'Open mission evidence').onclick(); await flush(8); const form = h.panel.querySelector('#weProof').querySelectorAll('form')[0]; const statement = form.querySelectorAll('textarea')[0], consent = form.querySelectorAll('input')[1]; statement.value = 'Checked the dated official guidance remotely and recorded it.'; consent.checked = true; return form.onsubmit({ preventDefault() {} }); }],
  ['share verified evidence', { joined: true, assigned: true }, async h => { find(h.panel.querySelector('#weAssignments'), 'Open mission evidence').onclick(); await flush(8); return find(h.panel.querySelector('#weProof'), 'Post verified proof to the feed').onclick(); }],
  ['verify evidence as owner', { owner: true, proof: true }, h => find(h.panel.querySelector('#weOwner'), 'Verify evidence').onclick()]
];

for (const [name, options, act] of RACES) {
  for (const [change, apply] of [['the account switches to B and the panel is destroyed', h => { h.switchToB(); h.mounted.destroy(); }], ['the account signs out', h => h.signOut()], ['the panel is destroyed', h => h.mounted.destroy()]]) {
    test(`EQ1: ${name}, then ${change} while the transport resolves the token: nothing is sent`, async () => {
      const h = harness(options);
      await flush(8);
      if (/mission/.test(name) && !/evidence|owner/.test(name)) { selectEvent(h); await flush(); }
      h.pause();
      try {
        const pending = Promise.resolve(act(h)).catch(() => {});
        await flush();
        apply(h);
        h.release();
        await pending; await flush(8);
      } finally { h.mounted.destroy(); }
      assert.deepEqual(h.writes, [], `no POST may be issued for "${name}" after ${change}`);
    });
  }
  test(`EQ1 control: ${name} with a stable account still dispatches exactly one request as that account`, async () => {
    const h = harness(options);
    await flush(8);
    if (/mission/.test(name) && !/evidence|owner/.test(name)) { selectEvent(h); await flush(); }
    try { await Promise.resolve(act(h)).catch(() => {}); await flush(8); } finally { h.mounted.destroy(); }
    assert.equal(h.writes.length, 1, name);
    assert.equal(h.writes[0].authorization, 'Bearer user-A');
  });
}

test('EQ1 transport contract: a private write without the identity/lifecycle guard is refused before any fetch', async () => {
  let fetched = 0;
  const transport = createEnvironmentTransport({ installation, token: () => 'user-A', fetchImpl: async () => { fetched++; return Response.json({ ok: true }); } });
  await assert.rejects(transport.request('/team', { method: 'POST', body: { join: false } }), /guard/i);
  await assert.rejects(transport.request('/team', { method: 'POST', body: { join: false }, expectedToken: 'user-A' }), /guard/i);
  assert.equal(fetched, 0);
  await transport.request('/team', { method: 'POST', body: { join: false }, expectedToken: 'user-A', isCurrent: () => true });
  assert.equal(fetched, 1);
  await assert.rejects(transport.request('/team', { method: 'POST', body: {}, expectedToken: 'user-B', isCurrent: () => true }), { status: 409 });
  assert.equal(fetched, 1);
});

test('EQ2: destroying an old instance after a remount does not clear the new mount or its pins', async () => {
  const panel = new E('div'), frame = { contentWindow: {} }, sent = [];
  const d = { createElement: tag => new E(tag), documentElement: { dataset: { worldMode: 'environment' } }, getElementById: () => null };
  const w = { location: { origin: installation.appOrigin }, confirm: () => true, addEventListener() {}, removeEventListener() {} };
  const adapter = { panel, frame, token: () => null, request: async () => ({ schema: 'world-environment/v1', events: [event], sources: [], missions: [] }), signIn() {}, sendGlobe: data => sent.push(data) };
  const a = mountEnvironment(w, d, adapter); await flush(8);
  a.destroy();
  const b = mountEnvironment(w, d, adapter); await flush(8);
  assert.ok(panel.children.length > 0 && panel.hidden === false, 'B is mounted and visible');
  sent.length = 0;
  a.destroy(); a.destroy();
  assert.ok(panel.children.length > 0, 'old destroy must not empty the new mount');
  assert.equal(panel.hidden, false);
  assert.deepEqual(sent, [], 'old destroy must not switch off the new mount’s pins');
  b.destroy();
  assert.equal(panel.children.length, 0); assert.equal(panel.hidden, true);
  assert.deepEqual(sent.at(-1), { type: 'hu:environment-pins', on: false, items: [] });
});
