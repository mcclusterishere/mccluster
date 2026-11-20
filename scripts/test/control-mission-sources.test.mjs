/* Control › Missions & fellows › Mission sources (js/control-room/mission-sources.js, reached from
   js/control-room/action-network.js): the house owner's card over /v1/mission-sources
   (workers/mccluster/src/mission-sources.js), on a synthetic DOM with fixture answers in the route's documented shapes. It is
   a fixture, not the Worker and not the SQL: the route over the real SQL is scripts/test/mission-sources-owner.integration.mjs
   and the real page is scripts/e2e/control-mission-sources.e2e.mjs.
   Proves: the exact owner-facing words; the buttons each state offers; Show unavailable until the dated confirmation and a
   reason are given, then sent with the revision that was read and a fresh key; Edit words refused before sending by the
   shared deny list and the shapes; every refusal says why and changed nothing; an unknown outcome is never resent by itself,
   is read back by key, and offers the same change with the same key by hand; 403 shows only the denied line; the store not
   applied offers no command; text from the store is escaped; the wiring in action-network.js, control.html and nav.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

class El extends EventTarget {
  constructor(tag, attrs, text) { super(); this.tag = tag || 'div'; this.attrs = attrs || {}; this.text = text || ''; this.kids = []; this.value = this.attrs.value || ''; this.checked = Object.hasOwn(this.attrs, 'checked'); this._html = ''; }
  set innerHTML(s) { this._html = String(s); this.kids = parse(this._html); this.kids.forEach((k) => { k.owner = this.kids; }); }
  get innerHTML() { return this._html; }
  get textContent() { return this.kids.length ? this._html.replace(/<[^>]+>/g, ' ') : this.text; }
  set textContent(v) { this.text = String(v); this.kids = []; this._html = ''; }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelectorAll(sel) { const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel); if (!m) return []; const pool = this.kids.length ? this.kids : (this.owner || []); return pool.filter((k) => k !== this && Object.hasOwn(k.attrs, m[1]) && (m[2] === undefined || k.attrs[m[1]] === m[2])); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function parse(html) {
  const out = []; const re = /<([a-z][a-z0-9]*)\b([^>]*)>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = {}; for (const a of m[2].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : a[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const close = html.indexOf('</' + m[1] + '>', re.lastIndex);
    out.push(new El(m[1], attrs, close > 0 ? html.slice(re.lastIndex, close).replace(/<[^>]+>/g, ' ') : ''));
  }
  return out;
}
globalThis.window = new EventTarget();
window.crypto = globalThis.crypto; window.CR = {};
window.MCC_SOURCE_WORDS = createRequire(import.meta.url)('../../js/mission-source-words.js');
const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i += 1) await flush(); };
await import('../../js/control-room/mission-sources.js');
const M = window.CR.missionSources, H = M.helpers;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FACTS = [{ label: 'Organization', value: '501(c)(3) nonprofit', source: 'https://drawdown.org/about' }];
const source = (extra = {}) => ({ catalog: 'drawdown', state: 'draft', revision: 1, role_line: 'Missions written by McCluster Corp from Project Drawdown’s climate solutions.', facts: FACTS,
  facts_read_on: '2026-11-19', shown_at: null, organization: { slug: 'project-drawdown', name: 'Project Drawdown', website_url: 'https://drawdown.org/', organization_type: 'nonprofit', verification_state: 'unverified' }, open_missions: 125, ...extra });
const applied = (extra = {}, history = []) => ({ ok: true, store: 'applied', sources: [source(extra)], history });
const http = (status, code) => Object.assign(new Error(code || 'HTTP ' + status), { status, detail: code ? { ok: false, code, error: 'fixed sentence' } : null });

/* one card on a synthetic surface; `answers` is a queue of (path, opts) => value | Error */
function card(answers) {
  const calls = [];
  const surface = new El('div');
  const draw = () => { surface.innerHTML = M.render(); M.bind(surface); };
  M.state.loaded = false; M.state.loading = false; M.state.data = null; M.state.error = null; M.state.open = null; M.state.form = {}; M.state.pending = null; M.state.notes = {}; M.state.outcomes = {};
  M.init({ request: async (path, opts = {}) => { calls.push({ path, opts: JSON.parse(JSON.stringify(opts)) }); const a = answers.shift(); const v = typeof a === 'function' ? a(path, opts) : a; if (v instanceof Error) throw v; return v; }, render: draw });
  return { calls, surface, draw, q: (sel) => surface.querySelector(sel), all: (sel) => surface.querySelectorAll(sel), text: () => surface.innerHTML.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ') };
}

test('the exact owner-facing words', () => {
  assert.equal(H.WORDS.title, 'Mission sources');
  assert.equal(H.WORDS.intro, 'A source page credits the organization whose work a mission catalog was written from. It is McCluster Corp’s page, never the organization’s account.');
  assert.deepEqual([H.WORDS.preview, H.WORDS.show, H.WORDS.hide, H.WORDS.edit, H.WORDS.save, H.WORDS.cancel, H.WORDS.again],
    ['Preview in the World', 'Show on the World', 'Hide from the World', 'Edit words', 'Save', 'Cancel', 'Send again']);
  assert.equal(H.WORDS.reason, 'Why (kept in the audit record; house members can read it)');
  assert.equal(H.confirmText('Project Drawdown'), 'I have confirmed, outside this repository, that Project Drawdown’s written permission covers a page headed by its name on McCluster Corp’s platform, which also sells sponsorships, the quotations on it, and the citation.');
  assert.equal(H.WORDS.confirmDate, 'Confirmed on');
  assert.equal(H.WORDS.confirmNote, 'The record keeps only this date; the letter stays with you.');
  assert.equal(H.WORDS.shownDone, 'Shown: the page and its door are public for every new visit.');
  assert.equal(H.WORDS.hiddenDone, 'Hidden: the page and its door are gone for every new visit; pages already open keep them until they reload.');
  assert.equal(H.WORDS.editingShown, 'This page is public: the change shows on every new visit.');
  assert.equal(H.WORDS.notApplied, 'The mission sources table is not applied yet (supabase/pending/20261119140000_mission_catalog_sources_v1.sql). Nothing can be shown, hidden or edited until it is approved and applied.');
  assert.equal(H.WORDS.unavailable, 'The mission sources could not be read right now. Nothing was changed.');
  assert.equal(H.REFUSED.words_refused, 'These words cannot be saved: a source page never calls its source a sponsor, partner, funder, author or operator, and never says it endorsed, recommended or approved anything.');
  assert.equal(H.REFUSED.facts_refused, 'Each fact needs a label (up to 40 characters), a value (up to 160) and an https source; up to six facts, with the date they were read.');
  assert.equal(H.REFUSED.role_line_refused, 'The role line must be one line of 1 to 160 characters.');
  assert.equal(H.REFUSED.invalid, 'That change could not be read. Nothing was changed.');
  assert.equal(H.REFUSED.moved, 'This source changed since you opened it. Reload it and try again.');
  assert.equal(H.REFUSED.key_reused, 'That command key was already used for a different change. Reload and try again.');
  assert.equal(H.REFUSED.store_busy, 'The store is busy. Nothing was changed; send it again.');
  assert.equal(H.WORDS.denied, 'Only the house owner can change a mission source.');
  assert.equal(H.WORDS.checking, 'Not known whether this was saved. Checking the record…');
  assert.equal(H.WORDS.recorded, 'Recorded.');
  assert.equal(H.WORDS.notRecorded, 'Not recorded. Send it again: the same change is recorded at most once.');
  assert.ok(H.WORDS.withdraw.startsWith('Withdraw the page: the reviewed rollback SQL, not a button.'));
  assert.ok(H.WORDS.quotations.startsWith('Remove Project Drawdown’s quotations from the missions: a reviewed SQL change'));
  assert.ok(H.WORDS.attribution.startsWith('A licensor’s or creator’s request to remove attribution items from a credit (CC BY 4.0, section 3(a)(3))'));
  for (const t of [...Object.values(H.WORDS), ...Object.values(H.REFUSED)]) assert.doesNotMatch(t, /Equity Uprise|Human Uprise/i);
});

test('the rows, dates and history lines', () => {
  assert.equal(H.rowLine(source()), 'Project Drawdown · catalog drawdown · Draft · revision 1');
  assert.equal(H.rowLine(source({ state: 'shown', revision: 2 })), 'Project Drawdown · catalog drawdown · Shown · revision 2');
  assert.equal(H.factsLine(source()), '125 open missions');
  assert.equal(H.factsLine(source({ open_missions: 1 })), '1 open mission');
  assert.match(H.factsLine(source({ shown_at: '2026-11-20T15:00:00Z' })), /^125 open missions · on the World since (20|21) November 2026$/);
  assert.equal(H.calendar('2026-11-19'), '19 November 2026', 'a calendar day, never through a UTC parse');
  assert.equal(H.calendar('2026-02-30'), '');
  assert.equal(H.historyLine({ at: '2026-11-20T15:00:00Z', event: 'mission_source.show', revision: 2, reason: 'Matthew confirmed the permission.', permission_confirmed_on: '2026-11-19' }).replace(/^(20|21) November 2026/, 'D'),
    'D · Shown · revision 2 · Matthew confirmed the permission. · permission confirmed 19 November 2026');
  assert.equal(H.historyLine({ at: '2026-11-21T12:00:00Z', event: 'mission_source.hide', revision: 3, reason: 'Paused.' }).split(' · ').slice(1).join(' · '), 'Hidden · revision 3 · Paused.');
  assert.deepEqual(H.commandsFor('draft'), ['show']);
  assert.deepEqual(H.commandsFor('shown'), ['hide', 'edit']);
  assert.deepEqual(H.commandsFor('hidden'), ['show', 'edit']);
  assert.equal(H.previewHref('project-drawdown'), '/mnet.html?source=project-drawdown&preview=1');
});

test('Edit words is checked before sending: the deny list, the shapes, the read date', () => {
  const cur = source();
  const ok = H.checkEdit({ role_line: 'Missions written by McCluster Corp from Project Drawdown’s climate solutions, by area.', facts: FACTS, facts_read_on: '' }, cur);
  assert.deepEqual(ok, { ok: true, payload: { role_line: 'Missions written by McCluster Corp from Project Drawdown’s climate solutions, by area.' } }, 'unchanged facts are not resent');
  assert.deepEqual(H.checkEdit({ role_line: 'A line.', facts: [], facts_read_on: '2026-11-20' }, cur), { ok: true, payload: { role_line: 'A line.', facts: [], facts_read_on: '2026-11-20' } });
  for (const [form, code] of [
    [{ role_line: 'Sponsored by Project Drawdown.', facts: FACTS }, 'words_refused'],
    [{ role_line: 'Our official partner.', facts: FACTS }, 'words_refused'],
    [{ role_line: 'Missions from this source.', facts: FACTS }, 'words_refused'],
    [{ role_line: 'A line.', facts: [{ ...FACTS[0], value: 'Endorsed by them' }], facts_read_on: '2026-11-20' }, 'words_refused'],
    [{ role_line: '', facts: FACTS }, 'role_line_refused'],
    [{ role_line: 'one\ntwo', facts: FACTS }, 'role_line_refused'],
    [{ role_line: 'x'.repeat(161), facts: FACTS }, 'role_line_refused'],
    [{ role_line: 'A line.', facts: [{ ...FACTS[0], source: 'http://drawdown.org/about' }], facts_read_on: '2026-11-20' }, 'facts_refused'],
    [{ role_line: 'A line.', facts: [{ ...FACTS[0], source: 'https://drawdown.org/ about' }], facts_read_on: '2026-11-20' }, 'facts_refused'],
    [{ role_line: 'A line.', facts: [{ ...FACTS[0], label: 'x'.repeat(41) }], facts_read_on: '2026-11-20' }, 'facts_refused'],
    [{ role_line: 'A line.', facts: [{ label: 'Only a label' }], facts_read_on: '2026-11-20' }, 'facts_refused'],
    [{ role_line: 'A line.', facts: Array(7).fill(FACTS[0]), facts_read_on: '2026-11-20' }, 'facts_refused'],
    [{ role_line: 'A line.', facts: [] }, 'facts_refused']
  ]) assert.deepEqual(H.checkEdit(form, cur), { ok: false, code }, JSON.stringify(form).slice(0, 80));
  assert.equal(H.reasonOk(''), false); assert.equal(H.reasonOk('x'.repeat(501)), false); assert.equal(H.reasonOk('two\nlines'), false); assert.equal(H.reasonOk('One line.'), true);
  assert.equal(H.confirmationOk(true, '2026-11-19', '2026-11-20'), true);
  assert.equal(H.confirmationOk(false, '2026-11-19', '2026-11-20'), false);
  assert.equal(H.confirmationOk(true, '', '2026-11-20'), false);
  assert.equal(H.confirmationOk(true, '2026-11-16', '2026-11-20'), false, 'before the permission statement of 2026-11-17');
  assert.equal(H.confirmationOk(true, '2026-11-21', '2026-11-20'), false, 'not after today');
});

test('a draft: Preview and Show only; Show waits for the confirmation, its date and a reason, then sends the read revision and a fresh key', async () => {
  const c = card([applied(), (path, opts) => ({ ok: true, receipt: { ok: true, catalog: 'drawdown', command: 'show', state: 'shown', revision: 2, key: opts.body.key, audit_id: 1, replayed: false } }), applied({ state: 'shown', revision: 2, shown_at: '2026-11-20T15:00:00Z' })]);
  c.draw(); await settle();
  assert.equal(c.calls[0].path, '/v1/mission-sources');
  assert.match(c.text(), /Project Drawdown · catalog drawdown · Draft · revision 1/);
  assert.deepEqual(c.all('[data-ms-open]').map((b) => b.getAttribute('data-ms-open')), ['show']);
  const preview = c.q('[data-ms-preview]');
  assert.equal(preview.getAttribute('href'), '/mnet.html?source=project-drawdown&preview=1');
  assert.equal(preview.getAttribute('target'), '_blank');
  c.q('[data-ms-open="show"]').onclick(); await settle();
  const send = () => c.q('[data-ms-send="show"]');
  assert.equal(send().getAttribute('aria-disabled'), 'true', 'Show waits');
  send().onclick(); await settle();
  assert.equal(c.calls.length, 1, 'nothing sent without the confirmation');
  assert.match(c.text(), /Tick the confirmation and give the date it was confirmed\./);
  const status = () => c.q('[data-ms-status-for="drawdown"]');
  const box = c.q('[data-ms-confirm]'); box.checked = true; box.onchange();
  assert.equal(status().getAttribute('data-ms-status'), 'refused', 'the refusal stays while the date is missing');
  const day = c.q('[data-ms-confirmed-on]'); day.value = '2026-11-19'; day.oninput();
  assert.equal(status().getAttribute('data-ms-status'), '', 'the refusal goes once the confirmation and its date are given');
  assert.equal(status().textContent, '');
  assert.equal(send().getAttribute('aria-disabled'), 'true', 'still waits for a reason');
  const why = c.q('[data-ms-reason]'); why.value = 'Matthew confirmed the written permission covers the page.'; why.oninput();
  assert.equal(send().getAttribute('aria-disabled'), null, 'now available');
  send().onclick(); await settle();
  const sent = c.calls[1];
  assert.equal(sent.path, '/v1/mission-sources/commands'); assert.equal(sent.opts.method, 'POST');
  assert.equal(sent.opts.body.command, 'show'); assert.equal(sent.opts.body.catalog, 'drawdown'); assert.equal(sent.opts.body.expected_revision, 1);
  assert.match(sent.opts.body.key, UUID); assert.equal(sent.opts.body.reason, 'Matthew confirmed the written permission covers the page.');
  assert.deepEqual(sent.opts.body.payload, { permission_confirmed: true, permission_confirmed_on: '2026-11-19' });
  assert.match(c.text(), /Shown: the page and its door are public for every new visit\./);
  assert.match(c.text(), /Shown · revision 2/);
  assert.deepEqual(c.all('[data-ms-open]').map((b) => b.getAttribute('data-ms-open')), ['hide', 'edit']);
});

test('Hide needs a reason; Edit words refuses a denied word before sending, then saves; the shown page says the change is public', async () => {
  const c = card([applied({ state: 'shown', revision: 2 }), (p, o) => ({ ok: true, receipt: { ok: true, command: 'edit', state: 'shown', revision: 3, key: o.body.key } }), applied({ state: 'shown', revision: 3 }),
    (p, o) => ({ ok: true, receipt: { ok: true, command: 'hide', state: 'hidden', revision: 4, key: o.body.key } }), applied({ state: 'hidden', revision: 4 })]);
  c.draw(); await settle();
  c.q('[data-ms-open="edit"]').onclick(); await settle();
  assert.match(c.text(), /This page is public: the change shows on every new visit\./);
  assert.equal(c.q('[data-ms-role]').getAttribute('value'), 'Missions written by McCluster Corp from Project Drawdown’s climate solutions.');
  const role = c.q('[data-ms-role]'); role.value = 'Missions written with our partner Project Drawdown.'; role.oninput();
  const why = c.q('[data-ms-reason]'); why.value = 'Testing the words.'; why.oninput();
  c.q('[data-ms-send="edit"]').onclick(); await settle();
  assert.equal(c.calls.length, 1, 'refused before sending');
  assert.match(c.text(), /These words cannot be saved/);
  c.q('[data-ms-role]').value = 'Missions written by McCluster Corp from Project Drawdown’s climate solutions, by area.'; c.q('[data-ms-role]').oninput();
  c.q('[data-ms-send="edit"]').onclick(); await settle();
  assert.equal(c.calls[1].opts.body.command, 'edit'); assert.equal(c.calls[1].opts.body.expected_revision, 2);
  assert.deepEqual(c.calls[1].opts.body.payload, { role_line: 'Missions written by McCluster Corp from Project Drawdown’s climate solutions, by area.' });
  assert.match(c.text(), /Saved\./);
  c.q('[data-ms-open="hide"]').onclick(); await settle();
  c.q('[data-ms-send="hide"]').onclick(); await settle();
  assert.equal(c.calls.length, 3, 'no Hide without a reason');
  assert.match(c.text(), /Say why, on one line of 1 to 500 characters\./);
  c.q('[data-ms-reason]').value = 'Paused while the permission is checked.'; c.q('[data-ms-reason]').oninput();
  assert.equal(c.q('[data-ms-status-for="drawdown"]').textContent, '', 'the reason refusal goes once a reason is given');
  c.q('[data-ms-send="hide"]').onclick(); await settle();
  assert.equal(c.calls[3].opts.body.command, 'hide'); assert.equal(c.calls[3].opts.body.expected_revision, 3); assert.equal(c.calls[3].opts.body.payload, undefined);
  assert.match(c.text(), /Hidden: the page and its door are gone for every new visit; pages already open keep them until they reload\./);
  assert.deepEqual(c.all('[data-ms-open]').map((b) => b.getAttribute('data-ms-open')), ['show', 'edit']);
});

test('every refusal says why and changed nothing; moved reads again; busy offers the same key again', async () => {
  for (const code of ['words_refused', 'facts_refused', 'role_line_refused', 'invalid', 'key_reused', 'not_found', 'store_not_applied']) {
    const c = card([applied({ state: 'shown', revision: 2 }), http(code === 'not_found' ? 404 : code === 'key_reused' ? 409 : code === 'store_not_applied' ? 503 : 422, code)]);
    c.draw(); await settle();
    c.q('[data-ms-open="hide"]').onclick(); c.q('[data-ms-reason]').value = 'Reason.'; c.q('[data-ms-reason]').oninput();
    c.q('[data-ms-send="hide"]').onclick(); await settle();
    assert.equal(c.q('[data-ms-status]').getAttribute('data-ms-status'), 'refused', code);
    assert.ok(c.text().includes(H.REFUSED[code].replace(/’/g, '’')), code);
    assert.equal(c.calls.length, 2, code + ': nothing resent');
  }
  const moved = card([applied({ state: 'shown', revision: 2 }), http(409, 'moved'), applied({ state: 'shown', revision: 5 })]);
  moved.draw(); await settle();
  moved.q('[data-ms-open="hide"]').onclick(); moved.q('[data-ms-reason]').value = 'Reason.'; moved.q('[data-ms-reason]').oninput();
  moved.q('[data-ms-send="hide"]').onclick(); await settle();
  assert.equal(moved.calls[2].path, '/v1/mission-sources', 'moved: read again');
  assert.match(moved.text(), /revision 5/);
  const busy = card([applied({ state: 'shown', revision: 2 }), http(503, 'store_busy'), (p, o) => ({ ok: true, receipt: { ok: true, command: 'hide', state: 'hidden', revision: 3, key: o.body.key } }), applied({ state: 'hidden', revision: 3 })]);
  busy.draw(); await settle();
  busy.q('[data-ms-open="hide"]').onclick(); busy.q('[data-ms-reason]').value = 'Reason.'; busy.q('[data-ms-reason]').oninput();
  busy.q('[data-ms-send="hide"]').onclick(); await settle();
  assert.match(busy.text(), /The store is busy\. Nothing was changed; send it again\./);
  busy.q('[data-ms-again]').onclick(); await settle();
  assert.equal(busy.calls[2].opts.body.key, busy.calls[1].opts.body.key, 'the same key');
  assert.deepEqual(busy.calls[2].opts.body, busy.calls[1].opts.body, 'the same body');
});

test('an unknown outcome is read back by key: found is recorded; absent offers the same change by hand, never by itself', async () => {
  let sentKey = null;
  const found = card([applied({ state: 'shown', revision: 2 }), (p, o) => { sentKey = o.body.key; return http(503, 'storage_unavailable'); },
    () => applied({ state: 'hidden', revision: 3 }, [{ audit_id: 9, at: '2026-11-20T15:00:00Z', event: 'mission_source.hide', catalog: 'drawdown', key: sentKey, reason: 'Reason.', revision: 3 }])]);
  found.draw(); await settle();
  found.q('[data-ms-open="hide"]').onclick(); found.q('[data-ms-reason]').value = 'Reason.'; found.q('[data-ms-reason]').oninput();
  found.q('[data-ms-send="hide"]').onclick(); await settle();
  assert.equal(found.calls.length, 3, 'one read back, nothing resent');
  assert.match(found.text(), /Recorded\./);
  assert.equal(found.q('[data-ms-again]'), null);
  const absent = card([applied({ state: 'shown', revision: 2 }), Object.assign(new TypeError('Failed to fetch')), applied({ state: 'shown', revision: 2 }, []),
    (p, o) => ({ ok: true, receipt: { ok: true, command: 'hide', state: 'hidden', revision: 3, key: o.body.key } }), applied({ state: 'hidden', revision: 3 })]);
  absent.draw(); await settle();
  absent.q('[data-ms-open="hide"]').onclick(); absent.q('[data-ms-reason]').value = 'Reason.'; absent.q('[data-ms-reason]').oninput();
  absent.q('[data-ms-send="hide"]').onclick(); await settle();
  assert.equal(absent.calls.length, 3, 'a lost answer: read back once, not resent');
  assert.match(absent.text(), /Not recorded\. Send it again: the same change is recorded at most once\./);
  absent.q('[data-ms-again]').onclick(); await settle();
  assert.deepEqual(absent.calls[3].opts.body, absent.calls[1].opts.body, 'by hand, the same key and body');
  assert.match(absent.text(), /Hidden: the page and its door are gone/);
  const unread = card([applied({ state: 'shown', revision: 2 }), http(502), http(500)]);
  unread.draw(); await settle();
  unread.q('[data-ms-open="hide"]').onclick(); unread.q('[data-ms-reason]').value = 'Reason.'; unread.q('[data-ms-reason]').oninput();
  unread.q('[data-ms-send="hide"]').onclick(); await settle();
  assert.match(unread.text(), /the record could not be read back/);
  assert.equal(unread.q('[data-ms-again]'), null, 'no resend offered when the record could not be read');
  assert.ok(unread.q('[data-ms-readback]'));
});

test('403 shows only the denied line; not applied and unavailable offer no command; store text is escaped', async () => {
  const d = card([http(403, 'owner_required')]); d.draw(); await settle();
  assert.equal(d.q('[data-mission-sources]').getAttribute('data-ms-view'), 'denied');
  assert.match(d.text(), /Only the house owner can change a mission source\./);
  assert.equal(d.all('[data-ms-open]').length, 0); assert.equal(d.q('[data-ms-preview]'), null);
  const n = card([{ ok: true, store: 'not_applied', sources: [], history: [] }]); n.draw(); await settle();
  assert.match(n.text(), /The mission sources table is not applied yet/); assert.equal(n.all('[data-ms-open]').length, 0);
  const u = card([{ ok: true, store: 'unavailable', sources: [], history: [] }]); u.draw(); await settle();
  assert.match(u.text(), /could not be read right now\. Nothing was changed\./); assert.equal(u.all('[data-ms-open]').length, 0);
  const x = card([applied({ organization: { slug: 'project-drawdown', name: '<img src=x onerror=alert(1)>' } }, [{ at: '2026-11-20T15:00:00Z', event: 'mission_source.edit', revision: 2, reason: '<script>bad()</script>', key: 'k' }])]);
  x.draw(); await settle();
  assert.ok(!x.surface.innerHTML.includes('<img src=x') && !x.surface.innerHTML.includes('<script>'));
  assert.ok(x.surface.innerHTML.includes('&lt;img src=x'));
});

test('the wiring: a chip in Missions & fellows, init from its init, three tags in control.html, search words', () => {
  const an = read('js/control-room/action-network.js');
  assert.match(an, /data-crn-tab="sources">Mission sources<\/button><button class="cro-chip'\+\(A\.tab==="new"\?" is-on":""\)\+'" type="button" data-crn-tab="new">\+ New campaign/);
  assert.match(an, /if\(A\.tab==="sources"\)return'<div class="cro">'\+chips\+head\+\(window\.CR\.missionSources\?window\.CR\.missionSources\.render\(\):note\("The mission sources module did not load \(js\/control-room\/mission-sources\.js\)\.",true\)\)\+'<\/div>';\n    if\(!c\)return/);
  assert.match(an, /if\(window\.CR\.missionSources&&A\.tab==="sources"\)window\.CR\.missionSources\.bind\(root\);/);
  assert.match(an, /if\(window\.CR\.missionSources\)window\.CR\.missionSources\.init\(opts\);/);
  const html = read('control.html');
  const tags = ['<link rel="stylesheet" href="css/control-mission-sources.css?v=b51ede03a4fa">', '<script src="js/mission-source-words.js?v=b51ede03a4fa"></script>', '<script src="js/control-room/mission-sources.js?v=b51ede03a4fa"></script>'];
  const at = tags.map((t) => html.indexOf(t));
  assert.ok(at.every((i) => i > html.indexOf('js/control-room/identity-review.js') && i < html.indexOf('js/control-room-v2.js')), 'after identity-review.js, before the shell');
  const nav = read('js/control-room/nav.js');
  assert.match(nav, /"mobilize", "mission sources", "source page", "project drawdown"\]/);
  const css = read('css/control-mission-sources.css');
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'min-width queries only');
  assert.doesNotMatch(css.replace(/minmax\(0,\s*1fr\)/g, ''), /\b1fr\b/, 'minmax(0, 1fr), never a bare 1fr');
  assert.match(css, /font-size: max\(16px, 1rem\)/, 'fields at 16 px or more');
  assert.doesNotMatch(css, /url\(|background-image|<svg/, 'no image and no mark');
});
