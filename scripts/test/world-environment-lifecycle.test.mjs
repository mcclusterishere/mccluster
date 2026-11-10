/* Integrated panel + real transport lifecycle regressions (audit EQ1, EQ2, 2026-11-09).
   Synthetic DOM and fetch only: no network, no membership mutation, no production state.
   Close-out 2026-11-10: races that open the editor first and pause the POST's own credential
   step (evidence submit and share, the four owner planning calls), session changes with no
   auth event (the transport's identity recheck), and the transport's pre-credential check. */
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
const REVIEW = '44444444-4444-4444-8444-444444444444', COMPANY = '55555555-5555-4555-8555-555555555555';
const event = { id: 'usgs:test', title: 'Fixture observation', category: 'Earthquake', lat: 41, lon: -73, observed_at: '2026-11-06T12:00:00Z', fetched_at: '2026-11-07T12:00:00Z', stale: true, source: { label: 'USGS', url: 'https://earthquake.usgs.gov/eventpage/test' }, actions: [{ id: 'verify', title: 'Verify public guidance', description: 'Check notices.', proof: 'Link', safety: 'Stay out.' }] };

function harness({ owner = false, joined = true, assigned = false, proof = null, openMission = true } = {}) {
  const panel = new E('div'), frame = { contentWindow: {} }, handlers = new Map(), writes = [], sent = [], entered = [];
  let identity = 'user-A', pauseAfter = -1, release = null;
  const transport = createEnvironmentTransport({
    installation,
    /* pause(n) lets n credential reads through, then holds the next one until release() */
    token: () => { if (pauseAfter === 0) { pauseAfter = -1; return new Promise(r => { release = r; }); } if (pauseAfter > 0) pauseAfter--; return identity; },
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname.slice('/v1/world/environment'.length);
      if (options.method === 'POST') writes.push({ path, authorization: options.headers.authorization, body: options.body });
      if (path === '') return Response.json({ schema: 'world-environment/v1', events: [event], sources: [], missions: openMission ? [{ id: ID, event_id: event.id, action_id: 'verify', status: 'open' }] : [] });
      if (path === '/team') return Response.json({ ok: true, membership: { joined }, assignments: assigned ? [{ mission_id: ID, assignment_id: ASSIGNMENT, status: 'joined', mission_status: 'open', title: 'Saved mission', event_id: event.id, source: event.source }] : [] });
      if (path === '/oversight') return owner ? Response.json({ ok: true, missions: [{ id: ID, title: 'Proposal', status: 'proposed', assignments: [] }] }) : Response.json({ error: 'owner' }, { status: 403 });
      if (path === '/proofs') return owner ? Response.json({ ok: true, proofs: proof ? [{ proof_id: PROOF, assignment_id: ASSIGNMENT, title: 'Saved mission', statement: 'done', status: 'pending', proof_revision: 'a'.repeat(32) }] : [] }) : Response.json({ error: 'owner' }, { status: 403 });
      if (path === `/assignments/${ASSIGNMENT}/proof`) return Response.json({ ok: true, assignment_id: ASSIGNMENT, status: 'joined', mission_status: 'open', can_submit: true, can_share: true, share: false, proof: null });
      if (path === '/planning/context') return Response.json({ ok: true, coverage: 'Synthetic candidate pool.', reviewed: [{ review_id: REVIEW, title: 'Reviewed headline', canonical_url: 'https://news.example.invalid/reviewed' }], articles: [{ id: 'article-1', revision: 'rev-1', title: 'Candidate headline', within_daily_window: true, seen_at: '2026-11-07T12:00:00Z', canonical_url: 'https://news.example.invalid/candidate' }] });
      if (path === '/planning/review') return Response.json({ ok: true, review_id: REVIEW });
      if (path === '/planning/companies') return Response.json({ ok: true, companies: [{ company_id: COMPANY, name: 'Synthetic Co', alignmentExcerpt: 'Synthetic fit note.' }] });
      if (path === '/planning/sponsor-draft') return Response.json({ ok: true, subject: 'Synthetic subject', body: 'Synthetic body', citation_limitation: 'Synthetic limitation' });
      return Response.json({ ok: true, assignment_id: ASSIGNMENT, proof_id: PROOF, status: 'submitted', id: ID, post_id: PROOF, proof_published: true });
    }
  });
  const d = { createElement: tag => new E(tag), documentElement: { dataset: { worldMode: 'environment' } }, getElementById: () => null };
  const w = { location: { origin: installation.appOrigin }, confirm: () => true, addEventListener: (k, v) => handlers.set(k, v), removeEventListener: () => {} };
  /* entered: every request the panel hands the transport, in order ("POST /team") */
  const request = (path, options) => { entered.push(`${options?.method || 'GET'} ${path}`); return transport.request(path, options); };
  const mounted = mountEnvironment(w, d, { panel, frame, token: () => identity, request, signIn() {}, sendGlobe: data => sent.push(data) });
  return {
    panel, mounted, writes, sent, handlers, w, entered,
    pause(after = 0) { pauseAfter = after; },
    paused: () => release !== null,
    switchToB() { identity = 'user-B'; handlers.get('environment:auth')(); },
    silentSwitchToB() { identity = 'user-B'; },
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

/* The submit and share races above pause the evidence GET (the act opens the editor itself), so
   their POST never comes up. Here the editor is opened first and the pause lands on the POST's
   own credential step: evidence submit and share, and the four owner planning calls. */
const openEvidence = async h => { find(h.panel.querySelector('#weAssignments'), 'Open mission evidence').onclick(); await flush(8); };
const openPlanning = async h => { selectEvent(h); await flush(); find(h.panel.querySelector('#weDetail'), 'Review daily news context').onclick(); await flush(8); };
const closeEvidence = h => find(h.panel.querySelector('#weProof'), 'Close evidence').onclick();
const closePlanning = h => find(h.panel.querySelector('#wePlanning'), 'Close planning').onclick();
const POST_RACES = [
  ['submit mission evidence', `/assignments/${ASSIGNMENT}/proof`, { joined: true, assigned: true }, openEvidence, h => {
    const form = h.panel.querySelector('#weProof').querySelectorAll('form')[0];
    form.querySelectorAll('textarea')[0].value = 'Checked the dated official guidance remotely and recorded it.';
    form.querySelectorAll('input')[1].checked = true;
    return form.onsubmit({ preventDefault() {} });
  }, closeEvidence],
  ['share verified evidence', `/assignments/${ASSIGNMENT}/share`, { joined: true, assigned: true }, openEvidence,
    h => find(h.panel.querySelector('#weProof'), 'Post verified proof to the feed').onclick(), closeEvidence],
  ['load the news context as owner', '/planning/context', { owner: true }, async h => { selectEvent(h); await flush(); },
    h => find(h.panel.querySelector('#weDetail'), 'Review daily news context').onclick(), null],
  ['approve headline context as owner', '/planning/review', { owner: true }, openPlanning, h => {
    h.panel.querySelector('#wePlanning').querySelectorAll('textarea')[0].value = 'It reports the same observation at the same place.';
    return find(h.panel.querySelector('#wePlanning'), 'Approve this headline context').onclick();
  }, closePlanning],
  ['find sponsor candidates as owner', '/planning/companies', { owner: true }, openPlanning,
    h => find(h.panel.querySelector('#wePlanning'), 'Find CRM sponsor candidates').onclick(), closePlanning],
  ['prepare a sponsor draft as owner', '/planning/sponsor-draft', { owner: true }, async h => { await openPlanning(h); find(h.panel.querySelector('#wePlanning'), 'Find CRM sponsor candidates').onclick(); await flush(8); },
    h => find(h.panel.querySelector('#wePlanning'), 'Prepare partnership draft').onclick(), closePlanning]
];

for (const [name, path, options, open, act, close] of POST_RACES) {
  const changes = [
    ['the panel is destroyed', h => h.mounted.destroy()],
    ...(close ? [['the editor is closed', close]] : []),
    ['the account switches to B (the panel stays mounted)', h => h.switchToB()],
    ['the session silently becomes B (no auth event)', h => h.silentSwitchToB()]
  ];
  for (const [change, apply] of changes) {
    test(`EQ1: ${name} with the editor open, then ${change} while the POST resolves the token: nothing is sent`, async () => {
      const h = harness(options);
      await flush(8);
      await open(h);
      const before = h.writes.length;
      h.pause();
      try {
        const pending = Promise.resolve(act(h)).catch(() => {});
        await flush();
        assert.ok(h.paused(), 'a credential read is held');
        assert.equal(h.entered.at(-1), `POST ${path}`, 'the held read is the POST\'s own');
        apply(h);
        h.release();
        await pending; await flush(8);
      } finally { h.mounted.destroy(); }
      assert.deepEqual(h.writes.slice(before), [], `no POST may be issued for "${name}" after ${change}`);
    });
  }
  test(`EQ1 control: ${name} with the editor open and a stable account dispatches exactly one POST as that account`, async () => {
    const h = harness(options);
    await flush(8);
    await open(h);
    const before = h.writes.length;
    try { await act(h); await flush(8); } finally { h.mounted.destroy(); }
    const writes = h.writes.slice(before);
    assert.deepEqual(writes.filter(w => w.path === path).map(w => w.authorization), ['Bearer user-A'], name);
    assert.ok(writes.every(w => w.authorization === 'Bearer user-A'));
  });
}

/* A session that becomes B with no auth or storage event leaves the panel's epochs untouched:
   only the transport's identity recheck can refuse. The evidence races are covered above. */
for (const [name, options, act] of RACES.filter(([name]) => !['submit mission evidence', 'share verified evidence'].includes(name))) {
  test(`EQ1: ${name}, then the session silently becomes B (no auth event) while the transport resolves the token: nothing is sent`, async () => {
    const h = harness(options);
    await flush(8);
    if (/mission/.test(name) && !/evidence|owner/.test(name)) { selectEvent(h); await flush(); }
    h.pause();
    try {
      const pending = Promise.resolve(act(h)).catch(() => {});
      await flush();
      assert.ok(h.paused(), 'a credential read is held');
      assert.match(h.entered.at(-1), /^POST /, 'the held read is the POST\'s own');
      h.silentSwitchToB();
      h.release();
      await pending; await flush(8);
    } finally { h.mounted.destroy(); }
    assert.deepEqual(h.writes, [], `no POST may be issued for "${name}" as or after B`);
  });
}

test('EQ1: leave the team, then the session silently becomes B during the transport\'s second credential read: nothing is sent', async () => {
  const h = harness({ joined: true });
  await flush(8);
  h.pause(1); /* the first read returns A and matches; hold the confirming second read */
  try {
    const pending = Promise.resolve(find(h.panel.querySelector('#weTeam'), 'Leave the team').onclick()).catch(() => {});
    await flush();
    assert.deepEqual(h.writes, [], 'nothing is sent before the second read answers');
    assert.ok(h.paused(), 'the second credential read is held');
    assert.equal(h.entered.at(-1), 'POST /team');
    h.silentSwitchToB();
    h.release();
    await pending; await flush(8);
  } finally { h.mounted.destroy(); }
  assert.deepEqual(h.writes, []);
});

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

test('EQ1 transport contract: an action that is no longer current is refused before the credential is read', async () => {
  let reads = 0, fetched = 0;
  const transport = createEnvironmentTransport({ installation, token: () => { reads++; return 'user-A'; }, fetchImpl: async () => { fetched++; return Response.json({ ok: true }); } });
  await assert.rejects(transport.request('/team', { method: 'POST', body: { join: false }, expectedToken: 'user-A', isCurrent: () => false }), { status: 409 });
  assert.equal(reads, 0, 'a stale action must not read, or refresh, the credential');
  assert.equal(fetched, 0);
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
