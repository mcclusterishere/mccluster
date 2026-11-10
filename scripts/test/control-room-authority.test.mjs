/* Audit A1 close-out (2026-11-10): default Control must never show one
   account's private data to another account, or after sign-out.

   These run the whole shipped page (js/control-room-v2.js with its real nav,
   format and sources modules) through scripts/test/support/control-room-page.mjs:
   real init(), request(), supa(), load(), per-view loaders and render(), with
   every read answered for the account whose token sent it. Account A's
   private strings carry AVOCADO and account B's carry BLUEBIRD, so "nothing
   of A" is a plain search of everything the page holds in its DOM.

   AUTH_TEST_SOURCE_ROOT=<checkout> runs them against another copy of the
   sources (an older control-room-v2.js fails on assertions, not on setup). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openControl, ready, session, MARKERS, sleep } from './support/control-room-page.mjs';

const A = MARKERS.A, B = MARKERS.B;
const B_EMAIL = 'b@fixture.invalid';
/* Every route whose view draws per-account state. */
const ROUTES = ['#home:today', '#home:ask', '#people:inbox:conversations', '#system:observability', '#create:publish:channels',
  '#system:resources', '#sell:orders:all', '#system:overview', '#system:workload', '#system:command', '#create:projects:library'];

function noTrace(page, marker, where) {
  const dom = page.dom(), at = dom.indexOf(marker);
  assert.equal(at, -1, where + ': ' + marker + ' is still in the page: ...' + dom.slice(Math.max(0, at - 120), at + 60).replace(/\s+/g, ' ') + '...');
}
/* The state behind the page (what the modules are handed as getState). */
function noStateTrace(page, marker, where) {
  const json = JSON.stringify(page.state()), at = json.indexOf(marker);
  assert.equal(at, -1, where + ': ' + marker + ' is still in Control state: ...' + json.slice(Math.max(0, at - 120), at + 60) + '...');
}
async function sweep(page, marker, label) {
  for (const route of ROUTES) { await page.go(route); await page.settle(); noTrace(page, marker, label + ', then ' + route); }
}
async function openAs(sub, hash, opts = {}) {
  const storage = opts.storage || new Map([['mccdb_session', session(sub)]]);
  const page = await openControl({ hash, storage, ...opts });
  assert.ok(await ready(page, (sub === 'owner-a' ? A : B) + '-operator'), sub + "'s default load committed");
  return page;
}
/* Account A works through every view that keeps its own private state, and
   leaves two unsent drafts. */
async function useEveryView(page) {
  const sees = what => assert.ok(page.dom().includes(A + what), 'fixture sanity: A sees ' + A + what);
  await page.go('#people:inbox:conversations'); await page.settle();
  await page.click('select-thread', 'thread-shared'); await page.settle(); sees(' message body');
  page.type('crReply', A + ' unsent reply');
  await page.go('#system:observability'); await page.settle(); sees(' event');
  await page.click('inspect-observation', 'ev-' + A); await page.click('observe-trace'); await page.settle();
  await page.go('#create:publish:channels'); await page.settle(); sees(' handle');
  await page.go('#system:resources'); await page.settle(); await page.click('load-resources'); await page.settle(); sees(' consumer');
  await page.go('#sell:orders:all'); await page.settle(); sees('-buyer');
  await page.go('#home:ask'); await page.settle(); sees(' ai reply');
  page.type('crAiComposer', A + ' unsent question'); sees(' unsent question');
}

test('A signing out in another tab conceals every view and shows the signed-out gate', async () => {
  const page = await openAs('owner-a', '#home:today');
  await useEveryView(page);
  const readsBefore = page.reads('owner-a').length;
  await page.otherTab(s => { s.delete('mccdb_session'); s.delete('mcc_sess_keep'); });
  assert.ok(page.gateShown(), 'the gate replaces the page');
  assert.match(page.note(), /signed out/i, 'the gate says why');
  noTrace(page, A, 'right after the sign-out');
  noStateTrace(page, A, 'right after the sign-out');
  assert.equal(page.reloads, 1, 'a sign-out no module heard replaces the page that held A');
  await sweep(page, A, 'after the sign-out');
  assert.equal(page.reads('owner-a').length, readsBefore, 'nothing is read with the old session after it ended');
  const fresh = await openControl({ hash: '#home:today', storage: page.storage, sessionStore: page.sessionStore });
  assert.ok(fresh.gateShown(), 'the replaced page opens on the gate');
  assert.match(fresh.note(), /signed out/i, 'and still says why');
  noTrace(fresh, A, 'on the replaced page');
});

test('B signing in where A was signed out gets a fresh page, never the one A used', async () => {
  const page = await openAs('owner-a', '#system:observability');
  await useEveryView(page);
  await page.otherTab(s => { s.delete('mccdb_session'); s.delete('mcc_sess_keep'); });
  await page.signInHere(B_EMAIL);
  assert.equal(page.reloads, 1, 'the page that held A was replaced, and B does not reopen it');
  assert.equal(page.reads('member-b').length, 0, 'no read for B is made from the page that held A');
  assert.ok(!page.appShown(), 'the old page is not reopened for B');
  noTrace(page, A, 'after B signed in');
  const fresh = await openAs('member-b', '#system:observability', { storage: page.storage });
  await fresh.go('#create:publish:channels'); await fresh.settle();
  assert.ok(fresh.dom().includes(B + ' handle'), "B's own data loads after the reload");
  noTrace(fresh, A, 'on the reloaded page');
});

test('another account replacing A in another tab conceals the page at once and reloads it for that account', async () => {
  const page = await openAs('owner-a', '#home:today');
  await useEveryView(page);
  await page.go('#system:observability'); await page.settle();
  await page.otherTab(s => s.set('mccdb_session', session('member-b')));
  assert.equal(page.reloads, 1, 'Control reloads for the account now signed in');
  assert.match(page.visible(), /account changed/i, 'the page says why it is reloading');
  noTrace(page, A, 'right after the replacement');
  assert.equal(page.reads('member-b').length, 0, 'the page that held A sends nothing for B');
  const fresh = await openAs('member-b', '#system:observability', { storage: page.storage, sessionStore: page.sessionStore });
  assert.ok(fresh.dom().includes(B + ' event'), "B's own events load after the reload");
  assert.match(fresh.visible(), /account changed/i, 'the reloaded page still says why it reloaded');
  noTrace(fresh, A, 'on the reloaded page');
});

for (const [name, change] of [
  ['A signs out in this tab (an in-tab sign-out event, no reload)', null],
  ['A signs out in another tab', s => { s.delete('mccdb_session'); s.delete('mcc_sess_keep'); }],
  ['another account replaces A in another tab', s => s.set('mccdb_session', session('member-b'))]
]) {
  test('reads A started are never committed after ' + name, async () => {
    const page = await openAs('owner-a', '#system:overview');
    const late = page.hold(e => e.sub === 'owner-a');
    await page.go('#system:observability'); await page.settle();
    await page.go('#create:publish:channels'); await page.settle();
    await page.go('#sell:orders:all'); await page.settle();
    await page.go('#home:ask'); await page.settle();
    await page.go('#system:resources'); await page.settle(); await page.click('load-resources'); await page.settle();
    await page.go('#people:inbox:conversations'); await page.settle(); await page.click('select-thread', 'thread-shared'); await page.settle();
    const held = page.fetchLog.filter(e => e.held).map(e => e.path);
    for (const path of ['/v1/observability/events', '/v1/social/accounts', '/rest/v1/music_orders', '/rest/v1/ops_ai_messages', '/v1/developer/consumers', '/v1/comms/threads/thread-shared/messages']) {
      assert.ok(held.includes(path), 'fixture sanity: ' + path + ' is in flight for A');
    }
    if (change) await page.otherTab(change);
    else { await page.win.MCC_AUTH.signOut(); await page.settle(); }
    late.release(); await page.settle(); await sleep(20); await page.settle();
    noTrace(page, A, 'after the late reads answered');
    noStateTrace(page, A, 'after the late reads answered');
    await sweep(page, A, 'after the late reads answered');
  });
}

test("a module's read made for A is never delivered after A's session ends, not even as a failure", async () => {
  const page = await openAs('owner-a', '#system:overview');
  const slow = page.hold(e => e.sub === 'owner-a' && /\/v1\/status$|\/rest\/v1\/leads$/.test(e.path));
  const outcomes = [];
  for (const read of [() => page.module.request('/v1/status'), () => page.module.supa('leads?select=*')]) {
    read().then(v => outcomes.push(['delivered', JSON.stringify(v)]), e => outcomes.push(['failed', e.message]));
  }
  await page.settle();
  assert.equal(page.fetchLog.filter(e => e.held).length, 2, 'fixture sanity: both reads are in flight');
  await page.otherTab(s => s.set('mccdb_session', session('member-b')));
  slow.release(); await page.settle(); await sleep(30); await page.settle();
  assert.deepEqual(outcomes, [], 'nothing reached the module');
  /* The same account refreshing its token is not a change: its reads arrive. */
  const same = await openAs('owner-a', '#system:overview');
  const held = same.hold(e => e.path === '/v1/status');
  const got = same.module.request('/v1/status');
  await same.settle();
  await same.otherTab(s => s.set('mccdb_session', session('owner-a', 'refreshed')));
  held.release();
  assert.match(JSON.stringify(await got), new RegExp(A + '-operator'));
});

test('a refresh that overtakes an earlier load of the same account is not undone by it', async () => {
  const page = await openAs('owner-a', '#people:inbox:conversations');
  /* The first refresh's Core read is slow; its conversations read is still in
     flight when the second refresh starts, so that one is aborted. */
  const once = test => { let used = false; return e => !used && test(e) && (used = true); };
  const slow = page.hold(once(e => e.path === '/v1/core/mcp' && e.rpc && e.rpc.method === 'tools/list'));
  page.hold(once(e => e.path === '/v1/comms/threads'));
  await page.click('refresh'); await page.settle();
  await page.click('refresh'); await page.settle(); await sleep(20); await page.settle();
  assert.ok(page.surface().includes(A + ' contact'), 'the newer load committed');
  slow.release(); await page.settle(); await sleep(20); await page.settle();
  assert.ok(page.surface().includes(A + ' contact'), 'the overtaken load did not replace the newer one');
  assert.doesNotMatch(page.surface(), /could not be read|aborted/i, 'no aborted read is committed over fresh data');
});

test("a refresh aborts every read of the load it overtakes, and that load's late result never lands", async () => {
  const page = await openAs('owner-a', '#people:inbox:conversations');
  /* The first refresh: its private reads are all held, and its public record read is slow. */
  const first = page.hold(e => e.sub === 'owner-a' && e.path !== '/v1/workspaces/me');
  let publicOnce = false;
  const slowPublic = page.hold(e => e.path === '/data/seo/entity-graph.json' && !publicOnce && (publicOnce = true));
  const mark = page.fetchLog.length;
  await page.click('refresh'); await page.settle();
  const overtaken = page.fetchLog.slice(mark).filter(e => e.sub === 'owner-a' && e.held);
  assert.ok(overtaken.length >= 20, 'fixture sanity: the first refresh is in flight (' + overtaken.length + ' reads)');
  first.open = false;
  /* The server's data changes; the second refresh reads it and commits. */
  page.override(e => e.path === '/v1/comms/threads', body => ({ threads: body.threads.map(t => ({ ...t, comms_contacts: { display_name: A + ' newer contact', address: 'newer@example.invalid' } })) }));
  await page.click('refresh'); await page.settle(); await sleep(20); await page.settle();
  const left = overtaken.filter(e => !(e.signal && e.signal.aborted)).map(e => e.path + (e.rpc ? ' ' + (e.rpc.method === 'tools/call' ? e.rpc.params.name : e.rpc.method) : ''));
  assert.deepEqual(left, [], 'reads of the overtaken load still running');
  assert.ok(page.surface().includes(A + ' newer contact'), 'the newer refresh committed');
  first.release(); slowPublic.release(); await page.settle(); await sleep(20); await page.settle();
  assert.ok(page.surface().includes(A + ' newer contact'), 'the overtaken load, settling last, did not put older data back');
  /* The first read of a load (which workspace) is aborted too when a refresh overtakes it. */
  let wsOnce = false;
  const ws = page.hold(e => e.path === '/v1/workspaces/me' && !wsOnce && (wsOnce = true));
  const before = page.fetchLog.length;
  await page.click('refresh'); await page.settle();
  const discovering = page.fetchLog.slice(before).find(e => e.path === '/v1/workspaces/me' && e.held);
  assert.ok(discovering, 'fixture sanity: the workspace read is in flight');
  await page.click('refresh'); await page.settle(); await sleep(20); await page.settle();
  assert.ok(discovering.signal && discovering.signal.aborted, 'the overtaken workspace read was aborted');
  ws.release(); await page.settle();
  assert.ok(page.surface().includes(A + ' newer contact'));
});

test('every private read carries an abort signal, and an account change aborts the reads in flight', async () => {
  const committed = await openAs('owner-a', '#home:today');
  await useEveryView(committed);
  const unsignalled = committed.fetchLog.filter(e => e.sub && !e.signal).map(e => e.path + (e.rpc ? ' ' + (e.rpc.method === 'tools/call' ? e.rpc.params.name : e.rpc.method) : ''));
  assert.deepEqual(unsignalled, [], 'private reads without an abort signal');

  const page = await openControl({ hash: '#home:today', storage: new Map([['mccdb_session', session('owner-a')]]), hold: e => e.sub === 'owner-a' && e.path !== '/v1/workspaces/me' });
  const inFlight = page.fetchLog.filter(e => e.sub === 'owner-a' && e.held);
  assert.ok(inFlight.length >= 20, 'fixture sanity: the default load is in flight (' + inFlight.length + ' reads)');
  /* and per-view reads of a committed page */
  const viewPage = await openAs('owner-a', '#home:today');
  const views = viewPage.hold(e => e.sub === 'owner-a');
  await viewPage.go('#system:observability'); await viewPage.settle();
  await viewPage.go('#create:publish:channels'); await viewPage.settle();
  const viewReads = viewPage.fetchLog.filter(e => e.held);
  assert.ok(viewReads.length >= 2, 'fixture sanity: per-view reads are in flight');
  await viewPage.otherTab(s => s.set('mccdb_session', session('member-b')));
  assert.deepEqual(viewReads.filter(e => !(e.signal && e.signal.aborted)).map(e => e.path), [], 'per-view reads of the old account left running');
  views.release();
  await page.otherTab(s => s.set('mccdb_session', session('member-b')));
  const still = inFlight.filter(e => !(e.signal && e.signal.aborted)).map(e => e.path + (e.rpc ? ' ' + (e.rpc.method === 'tools/call' ? e.rpc.params.name : e.rpc.method) : ''));
  assert.deepEqual(still, [], 'reads of the old account left running after the change');
});

test('a page restored from the back/forward cache is checked against the stored account', async () => {
  const page = await openAs('owner-a', '#system:observability');
  page.pageshow(false); page.pageshow(true); await page.settle();
  assert.ok(page.dom().includes(A + ' event'), 'same account: the restored page keeps its data');
  assert.equal(page.reloads, 0);
  page.storage.set('mccdb_session', session('member-b')); /* changed while the page was cached: no storage event reaches it */
  page.pageshow(true); await page.settle();
  assert.equal(page.reloads, 1, 'another account: the restored page reloads');
  noTrace(page, A, 'after restoring into another account');
});

test('storage cleared in another tab (a storage event with no key) signs this page out', async () => {
  const page = await openAs('owner-a', '#home:today');
  await useEveryView(page);
  await page.otherTab(s => s.clear());
  assert.ok(page.gateShown());
  assert.equal(page.reloads, 1, 'the page that held A is replaced');
  noStateTrace(page, A, 'after storage was cleared');
  await sweep(page, A, 'after storage was cleared');
});

test('a same-account token refresh keeps the page, the drafts and the reads in flight', async () => {
  const page = await openAs('owner-a', '#home:ask');
  page.type('crAiComposer', A + ' unsent question');
  const obs = page.hold(e => e.path === '/v1/observability/events');
  await page.go('#system:observability'); await page.settle();
  await page.otherTab(s => s.set('mccdb_session', session('owner-a', 'refreshed')));
  page.fire('mcc:auth-changed', { signed_in: true }); await page.settle();
  obs.release(); await page.settle();
  assert.ok(page.appShown() && page.reloads === 0, 'nothing is concealed or reloaded');
  assert.ok(page.surface().includes(A + ' event'), 'the read in flight is delivered');
  await page.go('#home:ask'); await page.settle();
  assert.equal(page.el('crAiComposer').value, A + ' unsent question', 'the draft survives a refresh of the same account');
});

test('a session that ends inside this tab (refresh refused) signs the page out at the next read', async () => {
  const page = await openAs('owner-a', '#home:today');
  await useEveryView(page);
  await page.go('#system:observability'); await page.settle();
  page.setTokenMode('refresh-fails');
  await page.click('refresh'); await page.settle(); await sleep(20); await page.settle();
  assert.ok(page.gateShown(), 'the gate replaces the page');
  assert.match(page.note(), /signed out/i);
  assert.equal(page.reloads, 1, 'no module heard this sign-out, so the page is replaced');
  noStateTrace(page, A, 'after the session ended in this tab');
  await sweep(page, A, 'after the session ended in this tab');
});

test('a read made after the session changed inside this tab, with no event, is never sent for the wrong account', async () => {
  /* The session ended (a refused refresh): the next per-view read signs the page out. */
  const ended = await openAs('owner-a', '#home:today');
  ended.setTokenMode('refresh-fails');
  await ended.go('#system:observability'); await ended.settle();
  assert.ok(ended.gateShown(), 'the gate replaces the page');
  assert.equal(ended.reloads, 1, 'and the page is replaced');
  /* Another account's session was written into this tab without an event:
     the next read is not sent for it, and the page is replaced instead. */
  const swapped = await openAs('owner-a', '#home:today');
  swapped.storage.set('mccdb_session', session('member-b'));
  await swapped.go('#create:publish:channels'); await swapped.settle();
  assert.equal(swapped.reads('member-b').length, 0, "no read went out with B's token from A's page");
  assert.equal(swapped.reloads, 1, 'the page is replaced for the account now stored');
  noStateTrace(swapped, B, "B's data in A's page");
});

test('a workspace switched in another tab during a load is not committed, and the page says so', async () => {
  const page = await openAs('owner-a', '#people:inbox:conversations');
  /* Reads for the old workspace in flight: the observability tail and an open conversation. */
  const obs = page.hold(e => e.path === '/v1/observability/events');
  await page.go('#system:observability'); await page.settle();
  const transcript = page.hold(e => /\/messages$/.test(e.path));
  await page.go('#people:inbox:conversations'); await page.settle();
  await page.click('select-thread', 'thread-shared'); await page.settle();
  assert.equal(page.fetchLog.filter(e => e.held).length, 2, 'fixture sanity: two reads for the old workspace are in flight');
  const status = page.hold(e => e.path === '/v1/status');
  await page.click('refresh'); await page.settle();
  page.storage.set('mcc.control.org', 'org-elsewhere');
  status.release(); await page.settle(); await sleep(20); await page.settle();
  assert.match(page.visible(), /workspace changed/i, 'the page says why it is empty');
  assert.ok(!page.surface().includes(A + ' contact'), 'the result read for the old workspace is not shown');
  obs.release(); transcript.release(); await page.settle(); await sleep(20); await page.settle();
  assert.equal(page.state().observability, null, 'a read for the old workspace commits nothing, not even a failure');
  assert.deepEqual(page.state().transcripts, {}, 'nor does the conversation read for it');
  assert.equal(page.reloads, 0);
  /* Refresh reads the selected workspace; a conversation opened then loads:
     no read of the old workspace is left in the way. */
  await page.click('refresh'); await page.settle(); await sleep(20); await page.settle();
  await page.click('select-thread', 'thread-shared'); await page.settle(); await sleep(20); await page.settle();
  assert.ok(page.surface().includes(A + ' message body'), 'the conversation loads after Refresh');
});

/* A page reloaded for another account lands on the view it was on. Channels
   used to cache "no workspace" before the first load committed and never
   read the account list (it did so on a direct open too, before A1). */
test('a page opened on Channels reads that account\'s list once its workspace is known', async () => {
  const page = await openAs('member-b', '#create:publish:channels');
  await page.settle(); await sleep(20); await page.settle();
  assert.ok(page.surface().includes(B + ' handle'), "B's social accounts are read and shown");
  assert.doesNotMatch(page.surface(), /No workspace is selected/);
});

test('a sign-out signal while the session is still stored conceals the page, and the next sign-in reloads it', async () => {
  const page = await openAs('owner-a', '#home:today');
  await useEveryView(page);
  page.fire('mcc:auth-changed', { signed_in: false }); await page.settle();
  assert.ok(page.gateShown());
  assert.equal(page.reloads, 0, 'an in-tab sign-out event reached every module itself');
  noStateTrace(page, A, 'after the sign-out signal');
  await sweep(page, A, 'after the sign-out signal');
  /* A module asking for a refresh does not load the concealed page again. */
  const readsBefore = page.reads('owner-a').length;
  await page.module.refresh(); await page.settle();
  assert.equal(page.reads('owner-a').length, readsBefore, 'the concealed page loads nothing');
  noStateTrace(page, A, 'after a module asked for a refresh');
  await page.signInHere('a@fixture.invalid');
  assert.equal(page.reloads, 1, 'a page concealed once is not reused');
});

