/* Control · System · Equity Uprise ops › Missions & fellows › Mission sources: the house owner's card for a mission catalog's
   source page in the World (the first is Project Drawdown's, the source of the catalog 'drawdown').
   docs/control-plane/WORLD-MISSION-SOURCES.md is the record; every decision there is a default adopted pending Matthew's
   confirmation. A source page is McCluster Corp's page about the organization a catalog was written from: never that
   organization's account.

   Registered as window.CR.missionSources and reached from js/control-room/action-network.js: a chip beside the campaigns,
   init from its init, render and bind from its own. Presentation over the owner-only Worker routes /v1/mission-sources
   (workers/mccluster/src/mission-sources.js), through the Control Room's own requester (the owner's bearer). It creates no
   permission and decides nothing the store decides: the Worker checks the house owner, and the store checks the owner,
   the revision, the key and the words again in one transaction. A 403 shows only the denied line.

   One row per source. Buttons by state: Draft: Preview, Show; Shown: Preview, Hide, Edit words; Hidden: Preview, Show,
   Edit words. Every command carries a fresh key, the revision that was read and a reason; while one is pending its buttons
   wait (aria-disabled, still focusable). Show opens a confirmation: Matthew confirms, outside this repository, that the
   written permission covers the page, and the date he did; Show stays unavailable until both are given, and the record
   keeps only the date. Edit words checks the shared deny list (js/mission-source-words.js) and the shapes before sending;
   the database still decides. A refusal changed nothing and says why. A lost or unreadable answer is an UNKNOWN outcome,
   never resent by itself: the history is read back and searched for the key; found means recorded, absent offers the
   same change with the same key by hand ("Send again"), which the store records at most once. Preview opens the World on
   this origin in a new tab. Text headings only; no mark. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var PATH = '/v1/mission-sources';
  var MAX_FACTS = 6;

  /* ---------------------------------------------------------------- words (exact; docs/control-plane/WORLD-MISSION-SOURCES.md) */
  var WORDS = Object.freeze({
    title: 'Mission sources',
    intro: 'A source page credits the organization whose work a mission catalog was written from. It is McCluster Corp’s page, never the organization’s account.',
    preview: 'Preview in the World', show: 'Show on the World', hide: 'Hide from the World', edit: 'Edit words', save: 'Save', cancel: 'Cancel', again: 'Send again',
    reason: 'Why (kept in the audit record; house members can read it)',
    confirmDate: 'Confirmed on',
    confirmNote: 'The record keeps only this date; the letter stays with you.',
    shownDone: 'Shown: the page and its door are public for every new visit.',
    hiddenDone: 'Hidden: the page and its door are gone for every new visit; pages already open keep them until they reload.',
    saved: 'Saved.',
    editingShown: 'This page is public: the change shows on every new visit.',
    notApplied: 'The mission sources table is not applied yet (supabase/pending/20261119140000_mission_catalog_sources_v1.sql). Nothing can be shown, hidden or edited until it is approved and applied.',
    unavailable: 'The mission sources could not be read right now. Nothing was changed.',
    loading: 'Reading the mission sources…',
    none: 'No mission source is recorded.',
    denied: 'Only the house owner can change a mission source.',
    signedOut: 'Sign in as the house owner.',
    checking: 'Not known whether this was saved. Checking the record…',
    recorded: 'Recorded.',
    notRecorded: 'Not recorded. Send it again: the same change is recorded at most once.',
    unreadBack: 'Not known whether this was saved, and the record could not be read back. Read it again before deciding: the same change with the same key is recorded at most once.',
    readAgain: 'Read the record again',
    reasonNeeded: 'Say why, on one line of 1 to 500 characters.',
    confirmNeeded: 'Tick the confirmation and give the date it was confirmed.',
    sending: 'Sending…',
    withdraw: 'Withdraw the page: the reviewed rollback SQL, not a button. It refuses, changing nothing, while anything else in the database names the Project Drawdown organization; Hide still takes the page down for every new visit.',
    quotations: 'Remove Project Drawdown’s quotations from the missions: a reviewed SQL change (README, “If that permission is ever withdrawn”), not a button.',
    attribution: 'A licensor’s or creator’s request to remove attribution items from a credit (CC BY 4.0, section 3(a)(3)): a reviewed SQL change to the named credit lines, not a button.',
    record: 'The organization’s own record (its name, type, description, website and verification) and a second catalog: each a reviewed SQL change, not a button.',
    cannot: 'What this card does not do',
    history: 'History'
  });
  var REFUSED = Object.freeze({
    words_refused: 'These words cannot be saved: a source page never calls its source a sponsor, partner, funder, author or operator, and never says it endorsed, recommended or approved anything.',
    facts_refused: 'Each fact needs a label (up to 40 characters), a value (up to 160) and an https source; up to six facts, with the date they were read.',
    role_line_refused: 'The role line must be one line of 1 to 160 characters.',
    invalid: 'That change could not be read. Nothing was changed.',
    moved: 'This source changed since you opened it. Reload it and try again.',
    key_reused: 'That command key was already used for a different change. Reload and try again.',
    store_busy: 'The store is busy. Nothing was changed; send it again.',
    owner_required: 'Only the house owner can change a mission source.',
    not_found: 'There is no source page for that catalog. Nothing was changed.',
    store_not_applied: WORDS.notApplied,
    authentication_required: 'Sign in as the house owner.'
  });
  function confirmText(name) {
    return 'I have confirmed, outside this repository, that ' + name + '’s written permission covers a page headed by its name on McCluster Corp’s platform, which also sells sponsorships, the quotations on it, and the citation.';
  }
  var STATE_WORD = { draft: 'Draft', shown: 'Shown', hidden: 'Hidden' };
  var EVENT_WORD = { 'mission_source.show': 'Shown', 'mission_source.hide': 'Hidden', 'mission_source.edit': 'Edited' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------------------------------------------------------------- pure helpers (unit-tested) */
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var isObject = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var isInt = function (v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; };
  var CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
  var DAY = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
  var length = function (s) { return Array.from(String(s)).length; };
  /* a calendar day (YYYY-MM-DD) as words, never through Date's UTC parse */
  function calendar(day) {
    var m = DAY.exec(String(day || ''));
    if (!m) return '';
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = new Date(y, mo - 1, d);
    if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return '';
    return d + ' ' + MONTHS[mo - 1] + ' ' + y;
  }
  /* a timestamp's local calendar day as words */
  function dayOf(iso) {
    var t = new Date(iso || '');
    if (isNaN(t.getTime())) return '';
    return t.getDate() + ' ' + MONTHS[t.getMonth()] + ' ' + t.getFullYear();
  }
  function rowLine(s) {
    var o = s.organization || {};
    return (o.name || 'Unnamed') + ' · catalog ' + s.catalog + ' · ' + (STATE_WORD[s.state] || s.state) + ' · revision ' + s.revision;
  }
  function factsLine(s) {
    var n = isInt(s.open_missions) ? s.open_missions : 0;
    var line = n + ' open ' + (n === 1 ? 'mission' : 'missions');
    if (s.shown_at && dayOf(s.shown_at)) line += ' · on the World since ' + dayOf(s.shown_at);
    return line;
  }
  function historyLine(h) {
    var parts = [dayOf(h.at) || 'undated', EVENT_WORD[h.event] || h.event];
    if (isInt(h.revision)) parts.push('revision ' + h.revision);
    if (h.reason) parts.push(h.reason);
    var line = parts.join(' · ');
    if (h.event === 'mission_source.show' && h.permission_confirmed_on) line += ' · permission confirmed ' + (calendar(h.permission_confirmed_on) || h.permission_confirmed_on);
    return line;
  }
  /* the buttons a state offers */
  function commandsFor(state) {
    if (state === 'draft') return ['show'];
    if (state === 'shown') return ['hide', 'edit'];
    if (state === 'hidden') return ['show', 'edit'];
    return [];
  }
  function previewHref(slug) { return '/mnet.html?source=' + encodeURIComponent(slug) + '&preview=1'; }
  function reasonOk(r) { return typeof r === 'string' && length(r) >= 1 && length(r) <= 500 && !CONTROL.test(r); }
  function today() { var t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  /* the Show confirmation: ticked, and a real day from 2026-11-17 (the permission statement) to today */
  function confirmationOk(ticked, day, now) {
    if (ticked !== true || !calendar(day)) return false;
    return day >= '2026-11-17' && day <= (now || today());
  }
  var denied = function (text) { return !!(window.MCC_SOURCE_WORDS && window.MCC_SOURCE_WORDS.denied(text)); };
  /* Edit words, checked before sending. form: { role_line, facts: [{label, value, source}], facts_read_on }, current: the
     source as read. Returns { ok: true, payload } or { ok: false, code } (a key of REFUSED). The database still decides. */
  function checkEdit(form, current) {
    var role = String(form.role_line == null ? '' : form.role_line);
    if (length(role) < 1 || length(role) > 160 || CONTROL.test(role)) return { ok: false, code: 'role_line_refused' };
    if (!window.MCC_SOURCE_WORDS) return { ok: false, code: 'invalid' };
    if (denied(role)) return { ok: false, code: 'words_refused' };
    var rows = (form.facts || []).filter(function (f) { return f && (f.label || f.value || f.source); });
    if (rows.length > MAX_FACTS) return { ok: false, code: 'facts_refused' };
    var facts = [];
    for (var i = 0; i < rows.length; i += 1) {
      var f = { label: String(rows[i].label || ''), value: String(rows[i].value || ''), source: String(rows[i].source || '') };
      if (denied(f.label) || denied(f.value)) return { ok: false, code: 'words_refused' };
      if (length(f.label) < 1 || length(f.label) > 40 || CONTROL.test(f.label)) return { ok: false, code: 'facts_refused' };
      if (length(f.value) < 1 || length(f.value) > 160 || CONTROL.test(f.value)) return { ok: false, code: 'facts_refused' };
      if (!/^https:\/\/[^\s\u0000-\u001f\u007f-\u009f]{4,250}$/.test(f.source)) return { ok: false, code: 'facts_refused' };
      facts.push(f);
    }
    var payload = { role_line: role };
    var same = JSON.stringify(facts) === JSON.stringify((current && current.facts) || []);
    var day = String(form.facts_read_on || '');
    if (day) {
      if (!calendar(day)) return { ok: false, code: 'facts_refused' };
      payload.facts = facts; payload.facts_read_on = day;
    } else if (!same) {
      return { ok: false, code: 'facts_refused' };
    }
    return { ok: true, payload: payload };
  }
  /* what an error from the requester means: { kind: 'refused', code } (nothing changed), 'denied', 'signed_out', or
     'unknown' (the outcome is not known: read back) */
  function classify(err) {
    var status = err && err.status, code = err && err.detail && err.detail.code;
    if (status === 401) return { kind: 'signed_out' };
    if (status === 403) return { kind: 'denied' };
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(REFUSED, code) && code !== 'owner_required' && code !== 'authentication_required') return { kind: 'refused', code: code };
    return { kind: 'unknown' };
  }

  /* ---------------------------------------------------------------- state */
  var S = { request: null, rerender: null, loading: false, loaded: false, data: null, error: null,
    open: null, form: {}, pending: null, notes: {}, outcomes: {}, gen: 0 };
  function redraw() { if (S.rerender) S.rerender(); }
  function load() {
    if (!S.request) return Promise.resolve();
    S.loading = true; var gen = ++S.gen; redraw();
    return S.request(PATH).then(function (data) {
      if (gen !== S.gen) return;
      S.data = isObject(data) ? data : null; S.error = S.data ? null : 'unavailable';
    }).catch(function (err) {
      if (gen !== S.gen) return;
      var c = classify(err); S.data = null;
      S.error = c.kind === 'denied' ? 'denied' : c.kind === 'signed_out' ? 'signed_out' : 'unavailable';
    }).then(function () { if (gen === S.gen) { S.loading = false; S.loaded = true; } redraw(); });
  }
  function sources() { return (S.data && S.data.store === 'applied' && Array.isArray(S.data.sources)) ? S.data.sources : []; }
  function sourceOf(catalog) { return sources().filter(function (s) { return s.catalog === catalog; })[0] || null; }

  /* send one command; never resent by itself */
  function send(catalog, body) {
    S.pending = { catalog: catalog, body: body };
    S.notes[catalog] = { text: WORDS.sending, kind: 'pending' };
    delete S.outcomes[catalog];
    redraw();
    return S.request(PATH + '/commands', { method: 'POST', body: body }).then(function (r) {
      S.pending = null;
      var c = r && r.receipt && r.receipt.command;
      S.notes[catalog] = { text: c === 'show' ? WORDS.shownDone : c === 'hide' ? WORDS.hiddenDone : WORDS.saved, kind: 'done' };
      S.open = null; S.form = {};
      return load();
    }, function (err) {
      S.pending = null;
      var c = classify(err);
      if (c.kind === 'refused') {
        S.notes[catalog] = { text: REFUSED[c.code], kind: 'refused', code: c.code };
        if (c.code === 'store_busy') S.outcomes[catalog] = { resend: true, body: body };
        redraw();
        return c.code === 'moved' ? load() : null;
      }
      if (c.kind === 'denied' || c.kind === 'signed_out') { S.notes[catalog] = { text: c.kind === 'denied' ? WORDS.denied : WORDS.signedOut, kind: 'refused' }; redraw(); return null; }
      S.notes[catalog] = { text: WORDS.checking, kind: 'unknown' };
      S.outcomes[catalog] = { resend: false, body: body, checking: true };
      redraw();
      return readBack(catalog, body);
    });
  }
  /* an unknown outcome: read the history back and look for the key */
  function readBack(catalog, body) {
    return S.request(PATH).then(function (data) {
      var found = isObject(data) && Array.isArray(data.history) && data.history.some(function (h) { return h && h.key === body.key; });
      if (isObject(data) && data.store === 'applied') S.data = data;
      if (found) { S.notes[catalog] = { text: WORDS.recorded, kind: 'done' }; delete S.outcomes[catalog]; S.open = null; S.form = {}; }
      else { S.notes[catalog] = { text: WORDS.notRecorded, kind: 'unknown' }; S.outcomes[catalog] = { resend: true, body: body }; }
      redraw();
    }, function () {
      S.notes[catalog] = { text: WORDS.unreadBack, kind: 'unknown' };
      S.outcomes[catalog] = { resend: false, readAgain: true, body: body };
      redraw();
    });
  }

  /* ---------------------------------------------------------------- render */
  function button(label, attrs, pending) {
    return '<button class="cr-btn" type="button" ' + attrs + (pending ? ' aria-disabled="true"' : '') + '>' + esc(label) + '</button>';
  }
  function reasonField(catalog, id) {
    return '<label class="crm-src__field"><span>' + esc(WORDS.reason) + '</span>' +
      '<input type="text" id="' + id + '" maxlength="500" autocomplete="off" data-ms-reason="' + esc(catalog) + '" value="' + esc(S.form.reason || '') + '"></label>';
  }
  function panel(s) {
    if (!S.open || S.open.catalog !== s.catalog) return '';
    var c = s.catalog, busy = !!(S.pending && S.pending.catalog === c), name = (s.organization && s.organization.name) || 'This organization';
    var cid = 'crmSrc-' + c;
    if (S.open.command === 'show') {
      var ok = confirmationOk(S.form.confirmed === true, S.form.confirmedOn || '') && reasonOk(S.form.reason || '');
      return '<div class="crm-src__panel" data-ms-panel="show">' +
        '<label class="crm-src__check"><input type="checkbox" id="' + cid + '-confirm" data-ms-confirm' + (S.form.confirmed ? ' checked' : '') + '><span>' + esc(confirmText(name)) + '</span></label>' +
        '<label class="crm-src__field"><span>' + esc(WORDS.confirmDate) + '</span><input type="date" id="' + cid + '-date" data-ms-confirmed-on min="2026-11-17" max="' + today() + '" value="' + esc(S.form.confirmedOn || '') + '"></label>' +
        '<p class="crm-src__hint">' + esc(WORDS.confirmNote) + '</p>' + reasonField(c, cid + '-reason') +
        '<div class="crm-src__actions">' + button(WORDS.show, 'data-ms-send="show" data-ms-catalog="' + esc(c) + '"', busy || !ok) + button(WORDS.cancel, 'data-ms-cancel', busy) + '</div></div>';
    }
    if (S.open.command === 'hide') {
      return '<div class="crm-src__panel" data-ms-panel="hide">' + reasonField(c, cid + '-reason') +
        '<div class="crm-src__actions">' + button(WORDS.hide, 'data-ms-send="hide" data-ms-catalog="' + esc(c) + '"', busy) + button(WORDS.cancel, 'data-ms-cancel', busy) + '</div></div>';
    }
    var f = S.form.facts || [];
    var rows = '';
    for (var i = 0; i < MAX_FACTS; i += 1) {
      var x = f[i] || {};
      rows += '<fieldset class="crm-src__fact"><legend>Fact ' + (i + 1) + '</legend>' +
        '<label class="crm-src__field"><span>Label</span><input type="text" maxlength="40" data-ms-fact="' + i + '" data-ms-key="label" value="' + esc(x.label || '') + '"></label>' +
        '<label class="crm-src__field"><span>Value</span><input type="text" maxlength="160" data-ms-fact="' + i + '" data-ms-key="value" value="' + esc(x.value || '') + '"></label>' +
        '<label class="crm-src__field"><span>Source (https)</span><input type="url" maxlength="258" inputmode="url" data-ms-fact="' + i + '" data-ms-key="source" value="' + esc(x.source || '') + '"></label></fieldset>';
    }
    return '<div class="crm-src__panel" data-ms-panel="edit">' + (s.state === 'shown' ? '<p class="crm-src__hint" data-ms-public>' + esc(WORDS.editingShown) + '</p>' : '') +
      '<label class="crm-src__field"><span>Role line</span><input type="text" maxlength="160" data-ms-role value="' + esc(S.form.role_line == null ? '' : S.form.role_line) + '"></label>' +
      rows + '<label class="crm-src__field"><span>Facts read on</span><input type="date" data-ms-read-on max="' + today() + '" value="' + esc(S.form.facts_read_on || '') + '"></label>' +
      reasonField(c, cid + '-reason') +
      '<div class="crm-src__actions">' + button(WORDS.save, 'data-ms-send="edit" data-ms-catalog="' + esc(c) + '"', busy) + button(WORDS.cancel, 'data-ms-cancel', busy) + '</div></div>';
  }
  function row(s) {
    var c = s.catalog, busy = !!(S.pending && S.pending.catalog === c), o = s.organization || {};
    var note = S.notes[c], out = S.outcomes[c];
    var acts = '<a class="cr-btn" href="' + esc(previewHref(o.slug || '')) + '" target="_blank" rel="noopener" data-ms-preview>' + esc(WORDS.preview) + '<span class="crm-src__sr"> (opens in a new tab)</span></a>' +
      commandsFor(s.state).map(function (cmd) { return button(cmd === 'show' ? WORDS.show : cmd === 'hide' ? WORDS.hide : WORDS.edit, 'data-ms-open="' + cmd + '" data-ms-catalog="' + esc(c) + '"', busy); }).join('');
    return '<article class="crm-src__row" data-ms-source="' + esc(c) + '" data-ms-state="' + esc(s.state) + '">' +
      '<h4>' + esc(o.name || 'Unnamed') + '</h4>' +
      '<p class="crm-src__line" data-ms-line>' + esc(rowLine(s)) + '</p>' +
      '<p class="crm-src__line" data-ms-facts>' + esc(factsLine(s)) + '</p>' +
      '<div class="crm-src__actions">' + acts + '</div>' + panel(s) +
      '<p class="crm-src__status" role="status" aria-live="polite" data-ms-status="' + esc(note ? note.kind : '') + '" data-ms-status-for="' + esc(c) + '">' + esc(note ? note.text : '') + '</p>' +
      (out && out.resend ? '<div class="crm-src__actions">' + button(WORDS.again, 'data-ms-again="' + esc(c) + '"', busy) + '</div>' : '') +
      (out && out.readAgain ? '<div class="crm-src__actions">' + button(WORDS.readAgain, 'data-ms-readback="' + esc(c) + '"', busy) + '</div>' : '') +
      '</article>';
  }
  function render() {
    if (!S.loaded && !S.loading) load();
    var head = '<h3 id="crmSrcTitle">' + esc(WORDS.title) + '</h3><p class="crm-src__intro">' + esc(WORDS.intro) + '</p>';
    var body;
    if (S.error === 'denied') return '<section class="crm-src" data-mission-sources data-ms-view="denied" aria-labelledby="crmSrcTitle"><h3 id="crmSrcTitle">' + esc(WORDS.title) + '</h3><p class="crm-src__line" data-ms-denied>' + esc(WORDS.denied) + '</p></section>';
    if (!S.loaded) body = '<p class="crm-src__line" aria-busy="true">' + esc(WORDS.loading) + '</p>';
    else if (S.error === 'signed_out') body = '<p class="crm-src__line" data-ms-signed-out>' + esc(WORDS.signedOut) + '</p>';
    else if (S.error || !S.data || S.data.store === 'unavailable') body = '<p class="crm-src__line" data-ms-unavailable>' + esc(WORDS.unavailable) + '</p><div class="crm-src__actions">' + button(WORDS.readAgain, 'data-ms-reload', S.loading) + '</div>';
    else if (S.data.store === 'not_applied') body = '<p class="crm-src__line" data-ms-not-applied>' + esc(WORDS.notApplied) + '</p>';
    else {
      var list = sources();
      var history = (Array.isArray(S.data.history) ? S.data.history : []).slice(0, 20);
      body = (list.length ? list.map(row).join('') : '<p class="crm-src__line">' + esc(WORDS.none) + '</p>') +
        (history.length ? '<h4>' + esc(WORDS.history) + '</h4><ol class="crm-src__history" data-ms-history>' + history.map(function (h) { return '<li data-ms-key="' + esc(h.key || '') + '">' + esc(historyLine(h)) + '</li>'; }).join('') + '</ol>' : '');
    }
    var cannot = '<h4>' + esc(WORDS.cannot) + '</h4><ul class="crm-src__cannot" data-ms-cannot>' + [WORDS.withdraw, WORDS.quotations, WORDS.attribution, WORDS.record].map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    return '<section class="crm-src" data-mission-sources data-ms-view="' + esc(S.data ? S.data.store : (S.error || 'loading')) + '" aria-labelledby="crmSrcTitle">' + head + body + cannot + '</section>';
  }

  /* ---------------------------------------------------------------- bind */
  function formFrom(s, command) {
    if (command === 'edit') return { role_line: s.role_line || '', facts: (s.facts || []).map(function (f) { return { label: f.label, value: f.value, source: f.source }; }), facts_read_on: '', reason: '' };
    return { reason: '', confirmed: false, confirmedOn: '' };
  }
  function bodyFor(s, command) {
    var key = window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : null;
    var body = { command: command, catalog: s.catalog, expected_revision: s.revision, key: key, reason: S.form.reason || '' };
    if (command === 'show') body.payload = { permission_confirmed: true, permission_confirmed_on: S.form.confirmedOn };
    return body;
  }
  function bind(root) {
    if (!root) return;
    var host = root.querySelector('[data-mission-sources]');
    if (!host) return;
    var waiting = function (b) { return b.getAttribute('aria-disabled') === 'true'; };
    var reload = host.querySelector('[data-ms-reload]');
    if (reload) reload.onclick = function () { if (!waiting(reload)) load(); };
    host.querySelectorAll('[data-ms-open]').forEach(function (b) {
      b.onclick = function () {
        if (waiting(b)) return;
        var s = sourceOf(b.getAttribute('data-ms-catalog')); if (!s) return;
        var cmd = b.getAttribute('data-ms-open');
        S.open = { catalog: s.catalog, command: cmd }; S.form = formFrom(s, cmd);
        delete S.notes[s.catalog]; delete S.outcomes[s.catalog];
        redraw();
      };
    });
    host.querySelectorAll('[data-ms-cancel]').forEach(function (b) { b.onclick = function () { if (waiting(b)) return; S.open = null; S.form = {}; redraw(); }; });
    /* typing is kept in the state, so a redraw never loses it */
    host.querySelectorAll('[data-ms-reason]').forEach(function (i) { i.oninput = function () { S.form.reason = i.value; refreshShow(host); settleLocal(host); }; });
    var conf = host.querySelector('[data-ms-confirm]');
    if (conf) conf.onchange = function () { S.form.confirmed = !!conf.checked; refreshShow(host); settleLocal(host); };
    var on = host.querySelector('[data-ms-confirmed-on]');
    if (on) on.oninput = on.onchange = function () { S.form.confirmedOn = on.value; refreshShow(host); settleLocal(host); };
    var role = host.querySelector('[data-ms-role]');
    if (role) role.oninput = function () { S.form.role_line = role.value; };
    var readOn = host.querySelector('[data-ms-read-on]');
    if (readOn) readOn.oninput = readOn.onchange = function () { S.form.facts_read_on = readOn.value; };
    host.querySelectorAll('[data-ms-fact]').forEach(function (i) {
      i.oninput = function () {
        var n = +i.getAttribute('data-ms-fact'), k = i.getAttribute('data-ms-key');
        S.form.facts = S.form.facts || [];
        while (S.form.facts.length <= n) S.form.facts.push({ label: '', value: '', source: '' });
        S.form.facts[n][k] = i.value;
      };
    });
    host.querySelectorAll('[data-ms-send]').forEach(function (b) {
      b.onclick = function () {
        if (waiting(b) && b.getAttribute('data-ms-send') !== 'show') return;
        var s = sourceOf(b.getAttribute('data-ms-catalog')); if (!s || S.pending) return;
        var cmd = b.getAttribute('data-ms-send');
        if (cmd === 'show' && !confirmationOk(S.form.confirmed === true, S.form.confirmedOn || '')) { S.notes[s.catalog] = { text: WORDS.confirmNeeded, kind: 'refused', local: 'confirm' }; redraw(); return; }
        if (!reasonOk(S.form.reason || '')) { S.notes[s.catalog] = { text: WORDS.reasonNeeded, kind: 'refused', local: 'reason' }; redraw(); return; }
        var body = bodyFor(s, cmd);
        if (!body.key) { S.notes[s.catalog] = { text: REFUSED.invalid, kind: 'refused' }; redraw(); return; }
        if (cmd === 'edit') {
          var checked = checkEdit(S.form, s);
          if (!checked.ok) { S.notes[s.catalog] = { text: REFUSED[checked.code], kind: 'refused', code: checked.code }; redraw(); return; }
          body.payload = checked.payload;
        }
        send(s.catalog, body);
      };
    });
    host.querySelectorAll('[data-ms-again]').forEach(function (b) {
      b.onclick = function () {
        if (waiting(b) || S.pending) return;
        var c = b.getAttribute('data-ms-again'), o = S.outcomes[c];
        if (o && o.body) send(c, o.body);
      };
    });
    host.querySelectorAll('[data-ms-readback]').forEach(function (b) {
      b.onclick = function () {
        if (waiting(b)) return;
        var c = b.getAttribute('data-ms-readback'), o = S.outcomes[c];
        if (o && o.body) { S.notes[c] = { text: WORDS.checking, kind: 'unknown' }; redraw(); readBack(c, o.body); }
      };
    });
  }
  /* a refusal made here, before anything was sent, goes as soon as what it asked for is given; in place, so typing keeps
     its place */
  function settleLocal(host) {
    var c = S.open && S.open.catalog, n = c && S.notes[c];
    if (!n || !n.local) return;
    if (!(n.local === 'confirm' ? confirmationOk(S.form.confirmed === true, S.form.confirmedOn || '') : reasonOk(S.form.reason || ''))) return;
    delete S.notes[c];
    host.querySelectorAll('[data-ms-status-for]').forEach(function (st) {
      if (st.getAttribute('data-ms-status-for') === c) { st.textContent = ''; st.setAttribute('data-ms-status', ''); }
    });
  }
  /* Show is available only with the confirmation, its date and a reason; updated in place while typing */
  function refreshShow(host) {
    var b = host.querySelector('[data-ms-send="show"]');
    if (!b) return;
    var ok = confirmationOk(S.form.confirmed === true, S.form.confirmedOn || '') && reasonOk(S.form.reason || '') && !S.pending;
    if (ok) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
  }

  window.CR.missionSources = {
    init: function (opts) { S.request = opts && opts.request; S.rerender = opts && opts.render; },
    render: render, bind: bind, load: load, state: S,
    helpers: { WORDS: WORDS, REFUSED: REFUSED, confirmText: confirmText, calendar: calendar, dayOf: dayOf, rowLine: rowLine, factsLine: factsLine,
      historyLine: historyLine, commandsFor: commandsFor, previewHref: previewHref, reasonOk: reasonOk, confirmationOk: confirmationOk,
      checkEdit: checkEdit, classify: classify, esc: esc }
  };
})();
