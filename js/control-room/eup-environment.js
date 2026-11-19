/* Control · System · E=Up › Environmental events: the owner's controls for the E=UP environmental event timeline
   (owner direction 2026-11-19: "Start with owner controls for source health, review and rollback"; slice S2 of
   docs/control-plane/EUP-EVENT-TIMELINE.md).

   Registered as window.CR.eupEnvironment and created once per bound workspace by js/control-room/eup.js, which calls it from
   paneEnvironment, wirePane and load('environment') and resets it with every private pane. It is presentation over the
   owner-only Worker routes /v1/eup/environment/* (workers/mccluster/src/eup/environment/owner.js), reached through eup.js's
   bounded, epoch-stamped requester; the slow live check of the providers (up to FIRMS's 25 s) goes through a second requester
   with a 45 s deadline. It creates no permission and decides nothing the store decides: the Worker checks the house owner,
   and the store checks the owner, the revision and the key again in one transaction. A 403 or a 401 conceals the whole
   workspace (eup.js).

   Four local views inside the one tab, phone first:
     Sources    every E=UP source, three facts each, in words and never by colour alone: what a signed-out visitor gets for
                it NOW (off, outage, no data or reporting), what the provider answers now, and what the event store recorded;
                the USGS rule and its switches (pause or resume the ingest, hide or show it on the timeline)
     Review     the store's review queue (candidates, held, withdrawn by the owner or by USGS, merged, corrected, coverage
                waiting), one event in full with its revisions, and hold, release, withdraw, restore, and restore an older
                revision as a new one (rollback); coverage attach, reject and retract
     Preview    the public timeline exactly as the store projects it, readable while the module is off (decision D11,
                default adopted pending Matthew's confirmation: an authorization addition that ships only with his approval
                of the pull request)
     Decisions  the store's append-only decision log
   While the store is not applied (the five pending parts nobody has applied) every view says so and no command is
   offered; Sources still shows the module and the providers. Install and Enable stay in Overview › Modules: each is a
   production decision for Matthew, and nothing here changes the module.

   Commands follow the module policy card (eup.js): a reason of 1-500 characters on one line, the revision that was read
   and a fresh key; while one is pending its buttons wait (aria-disabled, still focusable); a documented refusal changed
   nothing and says why; a timeout, a lost answer and any answer this code cannot place are an UNKNOWN outcome, never resent
   by itself: the decision log is read back and searched for the key; found means recorded, absent offers the SAME command
   (same key, same body) by hand, which the store records at most once. Text headings only; no mark. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var PREFIX = '/v1/eup/environment';
  var SLOW_DEADLINE_MS = 45000;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var isObject = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var isInt = function (v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; };
  var VIEWS = [{ id: 'sources', label: 'Sources' }, { id: 'review', label: 'Review' }, { id: 'preview', label: 'Preview' }, { id: 'decisions', label: 'Decisions' }];
  var PROVIDERS = ['usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops'];
  var STORE_PARTS = 'supabase/pending/20261119100000_eup_environment_events_v1_01.sql to _05.sql';

  /* ---------------------------------------------------------------- words (pure; unit-tested through helpers) */
  function when(iso) {
    if (!iso) return 'not recorded';
    var d = new Date(iso); if (isNaN(d.getTime())) return 'invalid time';
    try { return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toISOString(); }
  }
  var STATE_WORD = { off: 'off', outage: 'outage', no_data: 'no data', reporting: 'reporting' };
  var REASON_WORD = {
    timeout: 'the provider did not answer in time', upstream_error: 'the provider refused, failed or answered an error',
    invalid_data: 'the provider answered in a shape that cannot be used', stale: 'the provider is down; the copy kept from its last good answer is what a visitor gets',
    not_configured: 'not configured here', no_answer: 'nothing answered', unreadable: 'the answer could not be read', upstream_busy: 'too many lookups were in flight'
  };
  /* what a signed-out visitor gets for one source now, in one sentence */
  function publicLine(p, items) {
    var s = p && p.state, r = p && p.reason;
    if (s === 'off' && r === 'module_not_installed') return 'Off: the environment module is not installed, so a visitor gets 404 module_disabled.';
    if (s === 'off' && r === 'module_disabled') return 'Off: the environment module is installed but disabled, so a visitor gets 404 module_disabled.';
    if (s === 'off' && r === 'not_configured') return 'Off: this provider is not configured here (FIRMS needs the Worker secret FIRMS_MAP_KEY).';
    if (s === 'outage' && r === 'module_policy_unreadable') return 'Outage: the module policy cannot be read, so a visitor gets 503 module_policy_unavailable.';
    if (s === 'outage') return 'Outage: ' + (REASON_WORD[r] || 'the provider failed') + '.';
    if (s === 'no_data') return 'No data: the provider answered and reported nothing.';
    if (s === 'reporting') return 'Reporting' + (isInt(items) ? ': ' + items + ' item' + (items === 1 ? '' : 's') : '') + '.';
    return 'Unknown: this answer could not be read.';
  }
  function providerLine(p) {
    var s = p && p.state, r = p && p.reason;
    if (s === 'off') return 'Off: ' + (REASON_WORD[r] || 'not configured') + '.';
    if (s === 'outage') return 'Outage: ' + (REASON_WORD[r] || 'the provider failed') + '.';
    if (s === 'no_data') return 'No data: it answered with nothing.';
    if (s === 'reporting') return 'Reporting.';
    return 'Unknown.';
  }
  function surfaceLine(x) {
    var head = (x.label || x.id) + ': ' + (STATE_WORD[x.state] || 'unknown') + (x.reason ? ' (' + (REASON_WORD[x.reason] || x.reason) + ')' : '');
    var items = isInt(x.items) ? ' · ' + x.items + ' item' + (x.items === 1 ? '' : 's') : '';
    var src = (Array.isArray(x.sources) ? x.sources : []).map(function (s) { return (s.label || s.id) + ' ' + s.status + ' · fetched ' + when(s.fetched_at) + ' · last success ' + when(s.last_success_at); }).join('; ');
    return head + items + (src ? ' — ' + src : '');
  }
  function storeLine(st) {
    if (!st) return 'Event store: not read.';
    var last = st.last_run;
    if (st.state === 'not_configured') return 'Event store: no rule set yet, so the ingest records nothing for this provider.';
    if (st.state === 'paused') return 'Event store: ingest paused by the owner (rule rev ' + st.revision + ').';
    if (st.state === 'never_run') return 'Event store: rule rev ' + st.revision + ' set; no ingest run recorded yet (the ingest is a later slice and its flag is off).';
    var at = last ? when(last.fetched_at || last.recorded_at) : 'not recorded';
    if (st.state === 'ok') return 'Event store: last run ' + at + ', ok.';
    if (st.state === 'no_data') return 'Event store: last run ' + at + ', the provider reported nothing (no data, not an outage).';
    return 'Event store: last run ' + at + ', unavailable' + (last && last.reason ? ' (' + last.reason + ')' : '') + '. Last success ' + when(st.last_success_at) + '.';
  }
  function moduleLine(m) {
    if (!m) return 'Environment module: not read.';
    if (m.gate === 'outage') return 'Environment module: its policy cannot be read (' + (m.reason || 'unavailable') + '). The public routes answer 503: an outage, not off.';
    if (!m.installed) return 'Environment module: not installed. The public routes answer 404 module_disabled: off.';
    if (m.state === 'disabled') return 'Environment module: installed, disabled (rev ' + m.revision + '). The public routes answer 404 module_disabled: off.';
    return 'Environment module: ' + m.state + ' (rev ' + m.revision + '). The public routes answer.';
  }
  function storeStatusLine(s) {
    if (!s) return 'Event store: not read.';
    if (s.status === 'applied') return 'Event store: applied.';
    if (s.status === 'not_applied') return 'Event store: not applied. Its five pending parts (' + STORE_PARTS + ') wait for Matthew\'s approval; review, rollback and the rule are unavailable until then and nothing is recorded.';
    return 'Event store: unavailable (' + (s.reason || 'storage_unavailable') + '). The module and the providers are still shown.';
  }
  function reasonProblem(text) {
    var t = typeof text === 'string' ? text.trim() : '';
    if (!t) return 'A reason is required. Say why, then choose the command again; nothing was sent.';
    if (Array.from(t).length > 500) return 'The reason is longer than 500 characters; nothing was sent.';
    if (/[\u0000-\u001f\u007f]/.test(t)) return 'The reason must be a single line without control characters; nothing was sent.';
    return null;
  }
  var COMMAND_LABEL = {
    hold: 'Hold', release: 'Release', retract: 'Withdraw', restore: 'Restore', rollback: 'Restore revision',
    set_rule: 'Set the rule', pause_provider: 'Pause the ingest', resume_provider: 'Resume the ingest', hide_provider: 'Hide from the timeline', show_provider: 'Show on the timeline',
    attach_coverage: 'Attach', reject_coverage: 'Reject', retract_coverage: 'Retract'
  };
  /* the commands an event's state offers (the store refuses the rest; offering them would only invite a refusal) */
  function eventActions(state) {
    if (state === 'published') return ['hold', 'retract'];
    if (state === 'held') return ['release', 'retract'];
    if (state === 'candidate') return ['hold', 'retract'];
    if (state === 'retracted') return ['restore'];
    return [];
  }
  /* the revisions an event can be rolled back to: older than the current one, not a deletion or a merge, not withdrawn */
  function rollbackTargets(ev) {
    if (!isObject(ev) || !isObject(ev.summary)) return [];
    var cur = ev.summary.revision, st = ev.summary.state;
    if (!isInt(cur) || st === 'withdrawn_by_source' || st === 'merged') return [];
    return (Array.isArray(ev.revisions) ? ev.revisions : []).filter(function (r) { return r && isInt(r.revision) && r.revision < cur && r.cause !== 'source_deleted' && r.cause !== 'source_merged'; })
      .map(function (r) { return r.revision; });
  }
  function coverageActions(c, eventRevision) {
    if (!c) return [];
    if (c.state === 'proposed' && c.event_revision === eventRevision) return ['attach_coverage', 'reject_coverage'];
    if (c.state === 'proposed' || c.state === 'stale') return ['reject_coverage'];
    if (c.state === 'attached') return ['retract_coverage'];
    return [];
  }
  /* What a failed command means. `settled`: it certainly changed nothing. `again`: the same key may be sent again. */
  var REFUSED = {
    revision_conflict: 'it changed elsewhere since it was read. This command changed nothing; it is read again below. Decide again.',
    invalid_transition: 'not allowed from the current state. Nothing changed; the current state is read again below.',
    idempotency_conflict: 'this key was already used for a different command. Nothing was changed by this request.',
    provider_not_configured: 'the provider has no rule yet; set its rule first. Nothing changed.',
    provider_not_supported: 'only USGS has an ingest so far. Nothing changed.',
    provider_refused: 'only the seven government providers can be configured; news is never a provider. Nothing changed.',
    not_found: 'the event or coverage is not in the store. Nothing changed.',
    store_not_applied: 'the event store is not applied (' + STORE_PARTS + '). Nothing was recorded.',
    reason_required: 'the Worker refused the reason (1 to 500 characters, one line). Nothing changed.',
    invalid: 'the store refused the command as not valid. Nothing changed.'
  };
  function failureOf(err) {
    var status = err && err.status, reason = err && err.detail && typeof err.detail.reason === 'string' ? err.detail.reason : '';
    var secs = Math.round(((err && err.deadline) || 15000) / 1000);
    if (err && err.timeout) return { kind: 'unknown', settled: false, again: false, text: 'timed out after ' + secs + 's. The outcome is unknown and it was not resent.' };
    if (status === 409 && reason === 'revision_conflict') return { kind: 'conflict', settled: true, again: false, text: REFUSED.revision_conflict };
    if (status === 503 && reason === 'store_busy') return { kind: 'busy', settled: true, again: true, text: 'the store was busy with this record; nothing changed. The same command can be sent again.' };
    if (status === 503 && reason === 'store_not_applied') return { kind: 'not_configured', settled: true, again: false, text: REFUSED.store_not_applied };
    if (REFUSED[reason] && [400, 404, 409, 422].indexOf(status) >= 0) return { kind: reason === 'invalid_transition' ? 'conflict' : 'error', settled: true, again: false, text: REFUSED[reason] };
    if ([400, 404, 405, 409, 413, 415, 422].indexOf(status) >= 0) return { kind: 'error', settled: true, again: false, text: 'refused (HTTP ' + status + (reason ? ' ' + reason : '') + '). Nothing changed.' };
    return { kind: 'unknown', settled: false, again: false, text: (status ? 'answered HTTP ' + status + (reason ? ' ' + reason : '') : 'no readable answer') + '. The outcome is unknown and it was not resent.' };
  }
  /* the USGS rule as the store checks it (part 01, eup_environment_rule_valid), from the form's values, or a problem */
  function ruleFrom(v) {
    var mag = Number(String(v.min_magnitude == null ? '' : v.min_magnitude).trim());
    if (String(v.min_magnitude == null ? '' : v.min_magnitude).trim() === '' || !isFinite(mag) || mag < 0 || mag > 10) return { problem: 'The minimum magnitude must be a number from 0 to 10.' };
    var sigText = String(v.significance_above == null ? '' : v.significance_above).trim(), sig = null;
    if (sigText !== '') { sig = Number(sigText); if (!isInt(sig) || sig < 0 || sig > 10000) return { problem: 'Significance above must be a whole number from 0 to 10000, or empty for none.' }; }
    return { rule: { min_magnitude: mag, include_automatic: !!v.include_automatic, significance_above: sig, pager_alert: !!v.pager_alert, tsunami: !!v.tsunami } };
  }
  function ruleLine(rule) {
    if (!isObject(rule)) return 'none';
    return 'M' + rule.min_magnitude + '+' + (rule.include_automatic ? ' (automatic events included)' : ' (reviewed events only)') +
      (rule.significance_above === null || rule.significance_above === undefined ? '' : ', or significance above ' + rule.significance_above) +
      (rule.pager_alert ? ', or a PAGER alert' : '') + (rule.tsunami ? ', or a tsunami flag' : '');
  }
  function idempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    throw new Error('Secure key generation is unavailable; this browser cannot send environment commands.');
  }

  /* ---------------------------------------------------------------- one view per bound workspace */
  function create(ctx) {
    var request = ctx.request, slow = ctx.slowRequest || ctx.request;
    var note = ctx.note, reasonFor = ctx.reasonFor;
    function fresh() { return { view: 'sources', health: slot(), review: slot(), preview: slot(), event: slot(), eventId: null, cursors: [], reasons: {}, outcomes: {}, rule: null }; }
    function slot() { return { data: null, error: null, loading: false, seq: 0 }; }
    var E = fresh();
    function alive() { return typeof ctx.alive === 'function' ? ctx.alive() : true; }
    function epoch() { return typeof ctx.epoch === 'function' ? ctx.epoch() : 0; }
    function redraw() { if (typeof ctx.redraw === 'function') ctx.redraw(); }
    function say(t) { if (typeof ctx.say === 'function') ctx.say(t); }
    function reset() { E = fresh(); if (slow && typeof slow.abortAll === 'function' && slow !== request) slow.abortAll(); }

    /* one read into one slot: only the newest read of a slot commits, and only while the workspace is the same one */
    function read(name, path, requester) {
      var S = E[name], mine = (S.seq += 1), box = E;
      S.loading = true; redraw();
      var p = (requester || request)(path);
      return p.then(function (d) {
        if (!alive() || p.epoch !== epoch() || box !== E || mine !== S.seq) return;
        if (!d || d.ok !== true) throw Object.assign(new Error('unreadable answer'), { malformed: true });
        S.data = d; S.error = null;
      }).catch(function (err) {
        if (!alive() || p.epoch !== epoch() || box !== E || mine !== S.seq) return;
        if (ctx.concealed && ctx.concealed(err)) return;
        S.error = err;
      }).then(function () { if (box !== E || mine !== S.seq) return; S.loading = false; redraw(); });
    }
    function loadHealth() { return read('health', PREFIX + '/health', slow); }
    function loadReview() { return read('review', PREFIX + '/review'); }
    function loadPreview(cursor) { return read('preview', PREFIX + '/preview' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')); }
    function loadEvent(id, focusIt) {
      if (E.eventId !== id) E.event = slot();
      E.eventId = id;
      return read('event', PREFIX + '/events/' + encodeURIComponent(id)).then(function () { if (focusIt && alive() && E.eventId === id) focus('[data-eup-env-event]'); });
    }
    function load() { if (!alive()) return Promise.resolve(); say('Reading the environmental sources, the review queue and the preview…'); return Promise.all([loadHealth(), loadReview(), loadPreview(E.cursors[E.cursors.length - 1] || null)]).then(function () { if (alive()) say('Environmental events read ' + when(new Date().toISOString()) + '. No changes were made.'); }); }
    function storeOf() { var h = E.health.data, r = E.review.data; return (r && r.store) || (h && h.store) || null; }
    function applied() { var s = storeOf(); return !!(s && s.status === 'applied'); }

    /* ----- commands ----- */
    function outcomeNote(slotId, o) { return '<p class="cr-eup__note cr-eup__note--' + esc(o.kind) + '" data-eup-note="' + esc(o.kind) + '" data-eup-env-outcome="' + esc(slotId + '|' + o.kind) + '">' + esc(o.text) + '</p>'; }
    function nameOf(sent) { return (COMMAND_LABEL[sent.body.command] || sent.body.command) + (sent.body.command === 'rollback' ? ' ' + sent.body.payload.to_revision : '') + ' · ' + sent.body.target; }
    function reconcile() {
      var d = E.review.data, log = d && Array.isArray(d.decisions) ? d.decisions : null;
      Object.keys(E.outcomes).forEach(function (k) {
        var o = E.outcomes[k];
        if (!o || o.kind !== 'unknown' || !o.command) return;
        if (!log) { E.outcomes[k] = { kind: 'unknown', command: o.command, resend: false, text: nameOf(o.command) + ': the outcome is unknown and it was not resent. The decision log could not be read back; read again before deciding.' }; return; }
        var hit = log.filter(function (x) { return x && x.idempotency_key === o.command.body.idempotency_key; })[0];
        E.outcomes[k] = hit ? { kind: 'done', text: nameOf(o.command) + ' was recorded: its key is in the decision log (decision ' + hit.seq + ', ' + (hit.receipt && hit.receipt.changed === false ? 'no change' : 'changed') + '). It was not resent.' }
          : { kind: 'unknown', command: o.command, resend: true, text: nameOf(o.command) + ': the outcome is unknown and it was not resent. Its key is not in the decision log read ' + when(new Date().toISOString()) + '. Send the same command again, or decide again from what is shown.' };
      });
    }
    function readBack(sent) {
      var reads = [loadReview()];
      if (sent.kind === 'provider') reads.push(loadHealth());
      if (sent.kind !== 'provider') reads.push(loadPreview(E.cursors[E.cursors.length - 1] || null));
      if (E.eventId) reads.push(loadEvent(E.eventId));
      return Promise.all(reads).then(function () { if (alive()) { reconcile(); redraw(); } });
    }
    function send(slotId, sent, again) {
      if (!alive()) return;
      var prev = E.outcomes[slotId];
      if (prev && prev.kind === 'pending') return;
      E.outcomes[slotId] = { kind: 'pending', text: nameOf(sent) + ': requested with key ' + sent.body.idempotency_key.slice(0, 8) + '…' + (again ? ' (the same key again)' : '') };
      say(E.outcomes[slotId].text); redraw();
      var box = E, p = request(PREFIX + '/commands', { method: 'POST', body: sent.body });
      var stop = false;
      p.then(function (d) {
        if (!alive() || p.epoch !== epoch() || box !== E) { stop = true; return; }
        var r = d && d.ok === true && isObject(d.receipt) ? d.receipt : null;
        if (!r || typeof r.changed !== 'boolean') throw new Error('unreadable receipt');
        E.reasons[slotId] = '';
        if (sent.kind === 'provider') E.rule = null;
        var res = isObject(r.result) ? r.result : {};
        E.outcomes[slotId] = { kind: 'done', text: nameOf(sent) + ': recorded' + (r.changed ? '' : ' (no change: it was already so)') + (res.state ? ' · state ' + res.state : '') + (isInt(res.revision) ? ' · rev ' + res.revision : '') + ' · ' + when(r.recorded_at) + '. Read back below.' };
      }).catch(function (err) {
        if (stop || !alive() || p.epoch !== epoch() || box !== E) { stop = true; return; }
        if (ctx.concealed && ctx.concealed(err)) { stop = true; return; }
        var f = failureOf(err);
        E.outcomes[slotId] = { kind: f.kind, text: nameOf(sent) + ': ' + f.text + (f.settled ? '' : ' Reading the decision log back…'), command: sent, resend: f.again };
      }).then(function () {
        if (stop || !alive() || box !== E) return;
        say(E.outcomes[slotId].text); redraw();
        return readBack(sent);
      });
    }
    function command(slotId, kind, cmd, target, expected, payload) {
      var o = E.outcomes[slotId];
      if (o && o.kind === 'pending') return;
      var reason = String(E.reasons[slotId] || '').trim(), problem = reasonProblem(reason);
      if (problem) { E.outcomes[slotId] = { kind: 'error', text: problem }; say(problem); redraw(); focus('[data-eup-env-reason="' + slotId + '"]'); return; }
      var key; try { key = idempotencyKey(); } catch (e) { E.outcomes[slotId] = { kind: 'error', text: e.message }; redraw(); return; }
      var body = { command: cmd, target: target, expected_revision: expected, idempotency_key: key, reason: reason };
      if (payload) body.payload = payload;
      send(slotId, { kind: kind, body: body }, false);
    }
    function resend(slotId) { var o = E.outcomes[slotId]; if (o && o.resend && o.command) send(slotId, o.command, true); }
    var paneRef = null;
    function focus(sel) { var el = paneRef && paneRef.querySelector(sel); if (el && el.focus) el.focus(); }

    /* ----- rendering ----- */
    function chip(kind, text, attr) { return '<span class="cr-eup__chip cr-eup__chip--' + esc(kind) + '"' + (attr || '') + '>' + esc(text) + '</span>'; }
    function busy(slotId) { var o = E.outcomes[slotId]; return !!(o && o.kind === 'pending'); }
    function reasonField(slotId, label) {
      var id = 'eupEnvReason-' + slotId.replace(/[^A-Za-z0-9_-]/g, '_');
      return '<label class="cr-eup__field" for="' + esc(id) + '"><span>' + esc(label || 'Reason (required, recorded with the command)') + '</span><input type="text" id="' + esc(id) + '" maxlength="500" autocomplete="off" autocapitalize="sentences" spellcheck="true" value="' + esc(E.reasons[slotId] || '') + '" data-eup-env-reason="' + esc(slotId) + '" data-eup-focus="env-reason:' + esc(slotId) + '"></label>';
    }
    /* a button's focus key is its slot and its position, so a command that replaces its own button (Hold becomes Release) keeps focus there */
    function button(slotId, attr, label, at) { return '<button type="button" class="cr-btn" ' + attr + ' data-eup-focus="env-btn:' + esc(slotId) + ':' + esc(at == null ? label : at) + '"' + (busy(slotId) ? ' aria-disabled="true"' : '') + '>' + esc(label) + '</button>'; }
    function outcomeAndResend(slotId) {
      var o = E.outcomes[slotId];
      if (!o) return '';
      return outcomeNote(slotId, o) + (o.resend && o.command ? '<div class="cr-eup__actions cr-eup-env__actions">' + button(slotId, 'data-eup-env-resend="' + esc(slotId) + '"', 'Send the same command again', 'resend') + '</div><p class="cr-eup-env__hint">Uses the same key, so the store records it at most once.</p>' : '');
    }
    function slotNote(S, what) {
      if (S.loading && !S.data) return note('loading', 'Reading ' + what + '…');
      if (S.error) {
        if (S.error.malformed) return note('error', 'The ' + what + ' answer was not readable; nothing is shown as if it were.');
        var r = reasonFor(S.error);
        return note(r.kind, (what.charAt(0).toUpperCase() + what.slice(1)) + ': ' + r.text);
      }
      return null;
    }
    function render() {
      var tabs = '<div class="cr-eup-env__tabs" role="tablist" aria-label="Environmental events views" data-eup-env-tabs>' + VIEWS.map(function (v) {
        var on = v.id === E.view;
        return '<button type="button" role="tab" id="eupEnvTab-' + v.id + '" aria-controls="eupEnvView" aria-selected="' + on + '" tabindex="' + (on ? '0' : '-1') + '" data-eup-env-tab="' + v.id + '" data-eup-focus="env-tab:' + v.id + '">' + esc(v.label) + '</button>';
      }).join('') + '</div>';
      var body = E.view === 'review' ? viewReview() : E.view === 'preview' ? viewPreview() : E.view === 'decisions' ? viewDecisions() : viewSources();
      return '<section class="cr-eup-env" data-eup-env aria-labelledby="eupEnvTitle"><h3 id="eupEnvTitle">Environmental events</h3>' +
        '<p class="cr-eup-env__lede">The owner\'s side of the E=UP event timeline: source health, review and rollback. Nothing here is public, and nothing here installs or enables the module.</p>' +
        standing() + tabs + '<div class="cr-eup-env__view" id="eupEnvView" role="tabpanel" aria-labelledby="eupEnvTab-' + esc(E.view) + '" data-eup-env-view="' + esc(E.view) + '">' + body + '</div></section>';
    }
    function standing() {
      var h = E.health.data, s = storeOf();
      var m = h ? h.module : (E.preview.data ? E.preview.data.module : null);
      return '<div class="cr-eup-env__standing" data-eup-env-standing>' +
        '<p data-eup-env-module="' + esc(m ? (m.gate || 'unknown') : 'unread') + '">' + esc(moduleLine(m)) + '</p>' +
        '<p data-eup-env-store="' + esc(s ? s.status : 'unread') + '">' + esc(storeStatusLine(s)) + '</p>' +
        '<p class="cr-eup-env__hint">Off: the owner has not turned it on. Outage: something failed. No data: it answered with nothing. Install and Enable are in Overview › Modules; each is Matthew\'s production decision.</p></div>';
    }
    /* Sources */
    function viewSources() {
      var S = E.health, d = S.data, n = slotNote(S, 'source health');
      var head = '<div class="cr-eup__actions cr-eup-env__actions">' + '<button type="button" class="cr-btn" data-eup-env-check data-eup-focus="env-check"' + (S.loading ? ' aria-disabled="true"' : '') + '>Check the providers again</button></div>' +
        '<p class="cr-eup-env__hint" data-eup-env-checked>' + esc(S.loading ? 'Asking every provider (up to 30 s)…' : d ? 'Checked ' + when(d.checked_at) + '. Each provider is read through the public routes\' own kept copies.' : 'Not checked yet.') + '</p>';
      if (!d) return head + (n || '');
      var list = Array.isArray(d.sources) ? d.sources : [];
      return head + (n || '') + '<ul class="cr-eup-env__sources" data-eup-env-sources>' + list.map(sourceItem).join('') + '</ul>' + (d.store && d.store.status === 'applied' ? logBlock(d.log) : '');
    }
    function sourceItem(s) {
      var total = 0, any = false;
      (s.provider_now && Array.isArray(s.provider_now.surfaces) ? s.provider_now.surfaces : []).forEach(function (x) { if (isInt(x.items)) { total += x.items; any = true; } });
      var pub = s.public || {}, now = s.provider_now || {};
      return '<li class="cr-eup-env__source" data-eup-env-source="' + esc(s.provider) + '" data-eup-env-public="' + esc(s.provider + ':' + (pub.state || 'unknown')) + '" data-eup-env-now="' + esc(s.provider + ':' + (now.state || 'unknown')) + '">' +
        '<div class="cr-eup-env__source-head"><strong>' + esc(s.label || s.provider) + '</strong> ' + chip(pub.state || 'unknown', 'public: ' + (STATE_WORD[pub.state] || 'unknown')) + ' ' + chip(now.state || 'unknown', 'provider: ' + (STATE_WORD[now.state] || 'unknown')) + '</div>' +
        '<p class="cr-eup-env__line" data-eup-env-public-line="' + esc(s.provider) + '">Public now: ' + esc(publicLine(pub, any ? total : null)) + '</p>' +
        '<p class="cr-eup-env__line">Provider now: ' + esc(providerLine(now)) + '</p>' +
        '<ul class="cr-eup-env__surfaces">' + (Array.isArray(now.surfaces) ? now.surfaces : []).map(function (x) { return '<li data-eup-env-surface="' + esc(x.id + ':' + x.state) + '">' + esc(surfaceLine(x)) + '</li>'; }).join('') + '</ul>' +
        '<p class="cr-eup-env__line" data-eup-env-store-line="' + esc(s.provider) + '">' + esc(s.store ? storeLine(s.store) : storeStatusLine(storeOf())) + '</p>' +
        (s.provider === 'usgs' ? providerControls(s.store) : (s.store ? '<p class="cr-eup-env__hint">No ingest for this provider yet: USGS is the first complete slice.</p>' : '')) + '</li>';
    }
    function providerControls(st) {
      if (!st || !applied()) return '';
      var slotId = 'provider:usgs', r = E.rule || (st.rule || st.default_rule || {}), rid = function (k) { return 'eupEnvRule-' + k; };
      var field = function (k, label, attrs) { return '<label class="cr-eup__field" for="' + rid(k) + '"><span>' + esc(label) + '</span><input id="' + rid(k) + '" ' + attrs + ' data-eup-env-rule="' + k + '" data-eup-focus="env-rule:' + k + '"></label>'; };
      var check = function (k, label) { return '<label class="cr-eup-env__check" for="' + rid(k) + '"><input type="checkbox" id="' + rid(k) + '" data-eup-env-rule="' + k + '" data-eup-focus="env-rule:' + k + '"' + (r[k] ? ' checked' : '') + '><span>' + esc(label) + '</span></label>'; };
      var switches = [];
      if (st.configured) {
        switches.push(st.ingest === 'paused' ? ['resume_provider', 'Resume the ingest'] : ['pause_provider', 'Pause the ingest']);
        switches.push(st.publication === 'hidden' ? ['show_provider', 'Show on the timeline'] : ['hide_provider', 'Hide from the timeline']);
      }
      return '<div class="cr-eup-env__controls" data-eup-env-provider="usgs">' +
        '<p class="cr-eup-env__line" data-eup-env-rule-now>' + esc(st.configured ? 'Rule rev ' + st.revision + ': ' + ruleLine(st.rule) + '. Ingest ' + st.ingest + ', timeline ' + st.publication + '.' : 'No rule yet. The default (D7, adopted pending Matthew\'s confirmation): ' + ruleLine(st.default_rule) + '.') + '</p>' +
        '<fieldset class="cr-eup-env__rule"><legend>USGS publication rule</legend>' +
        field('min_magnitude', 'Minimum magnitude (0 to 10)', 'type="number" inputmode="decimal" min="0" max="10" step="0.1" value="' + esc(r.min_magnitude == null ? '' : r.min_magnitude) + '"') +
        check('include_automatic', 'Include automatic events (shown as not yet reviewed by USGS)') +
        field('significance_above', 'Or USGS significance above (empty for none)', 'type="number" inputmode="numeric" min="0" max="10000" step="1" value="' + esc(r.significance_above == null ? '' : r.significance_above) + '"') +
        check('pager_alert', 'Or a PAGER alert') + check('tsunami', 'Or a tsunami flag') + '</fieldset>' +
        reasonField(slotId) +
        '<div class="cr-eup__actions cr-eup-env__actions">' + button(slotId, 'data-eup-env-setrule="rule"', 'Set this rule', 'rule') + button(slotId, 'data-eup-env-setrule="default"', 'Set the default rule', 'default') +
        switches.map(function (w, i) { return button(slotId, 'data-eup-env-provider-command="' + w[0] + '"', w[1], 'switch' + i); }).join('') + '</div>' +
        '<p class="cr-eup-env__hint">A rule change applies from each event\'s next ingest; a published event is never unpublished by it. Pause stops the ingest; hide takes USGS events out of the public timeline.</p>' +
        outcomeAndResend(slotId) + '</div>';
    }
    function logBlock(log) {
      var rows = Array.isArray(log) ? log : [];
      return '<h4>Ingest log (durable, 30 days)</h4>' + (rows.length ? '<ul class="cr-eup__list" data-eup-env-log>' + rows.slice(0, 20).map(function (h) { return '<li>' + esc(h.provider + ' · ' + h.status + (h.reason ? ' (' + h.reason + ')' : '') + ' · ' + when(h.fetched_at || h.recorded_at)) + '</li>'; }).join('') + '</ul>' : note('empty', 'No ingest run recorded yet.'));
    }
    /* Review */
    function eventLine(e) {
      if (!isObject(e)) return '';
      var mag = typeof e.magnitude === 'number' ? 'M' + e.magnitude + (e.magnitude_type ? ' ' + e.magnitude_type : '') + ' · ' : '';
      return mag + (e.place || e.provider_event_id || e.id) + ' · ' + e.id + ' · rev ' + e.revision + ' · ' + e.state + ' · observed ' + when(e.observed_at) + (e.review_status ? ' · ' + e.review_status : '') + (e.qualifies === false && e.state === 'candidate' ? ' · does not qualify under the current rule' : '');
    }
    var QUEUE = [['candidates', 'Candidates (stored, not public)'], ['held', 'Held by the owner (hidden)'], ['retracted', 'Withdrawn by the owner'], ['withdrawn', 'Withdrawn by USGS (tombstones)'], ['merged', 'Merged into another event (redirects)'], ['corrected', 'Corrected (revision 2 or later)']];
    function viewReview() {
      var S = E.review, d = S.data, n = slotNote(S, 'the review queue');
      if (n && !d) return n;
      if (!d) return note('loading', 'Not read yet.');
      if (d.store && d.store.status !== 'applied') return note('not_configured', storeStatusLine(d.store));
      var q = isObject(d.review) ? d.review : {};
      var html = (n || '') + reloadButton() + (E.eventId ? eventBlock() : '');
      html += QUEUE.map(function (pair) {
        var rows = Array.isArray(q[pair[0]]) ? q[pair[0]] : [];
        return '<h4>' + esc(pair[1]) + ' <small>(' + rows.length + ')</small></h4>' + (rows.length ? '<ul class="cr-eup__list" data-eup-env-queue="' + pair[0] + '">' + rows.map(function (e) {
          return '<li data-eup-env-item="' + esc(e.id) + '"><span>' + esc(eventLine(e)) + '</span><div class="cr-eup__actions cr-eup-env__actions"><button type="button" class="cr-btn" data-eup-env-open="' + esc(e.id) + '" data-eup-focus="env-open:' + esc(e.id) + '">Open ' + esc(e.id) + '</button></div></li>';
        }).join('') + '</ul>' : '<p class="cr-eup-env__hint">None.</p>');
      }).join('');
      var cov = Array.isArray(q.coverage) ? q.coverage : [];
      html += '<h4>Coverage waiting for a decision <small>(' + cov.length + ')</small></h4>' + (cov.length ? '<ul class="cr-eup__list" data-eup-env-queue="coverage">' + cov.map(function (c) {
        return '<li><span>' + esc(c.title + ' · ' + c.domain + ' · ' + c.state + ' · basis ' + c.basis + ' · for ' + c.event_id + ' rev ' + c.event_revision) + '</span><div class="cr-eup__actions cr-eup-env__actions"><button type="button" class="cr-btn" data-eup-env-open="' + esc(c.event_id) + '" data-eup-focus="env-open-cov:' + esc(c.id) + '">Open ' + esc(c.event_id) + ' to decide</button></div></li>';
      }).join('') + '</ul>' : '<p class="cr-eup-env__hint">None.</p>');
      return html;
    }
    function eventBlock() {
      var S = E.event, d = S.data, n = slotNote(S, 'the event');
      var close = '<div class="cr-eup__actions cr-eup-env__actions"><button type="button" class="cr-btn" data-eup-env-close data-eup-focus="env-close">Back to the queue</button></div>';
      if (!d || !isObject(d.event)) return '<article class="cr-eup-env__event" data-eup-env-event="' + esc(E.eventId) + '">' + (n || note('loading', 'Reading ' + E.eventId + '…')) + close + '</article>';
      var ev = d.event, s = ev.summary || {}, slotId = 'event:' + s.id, acts = eventActions(s.state), back = rollbackTargets(ev);
      var pub = ev.public;
      return '<article class="cr-eup-env__event" tabindex="-1" data-eup-env-event="' + esc(s.id) + '" data-eup-env-event-state="' + esc(s.state + ':' + s.revision) + '" data-eup-focus="env-event">' +
        '<h4>' + esc(s.id) + '</h4><p class="cr-eup-env__line">' + esc(eventLine(s)) + '</p>' +
        '<p class="cr-eup-env__line">USGS updated ' + esc(when(s.source_updated_at)) + ' · retrieved ' + esc(when(s.fetched_at)) + ' · first published ' + esc(when(s.first_published_at)) + ' · revised ' + esc(when(s.revised_at)) + '</p>' +
        '<p class="cr-eup-env__line" data-eup-env-public-shape>' + esc(pub ? 'The public sees it as ' + pub.state + ' at revision ' + pub.revision + '.' : 'The public sees nothing of it (not published, held or merged).') + '</p>' +
        (acts.length || back.length ? reasonField(slotId) : '') +
        (acts.length ? '<div class="cr-eup__actions cr-eup-env__actions">' + acts.map(function (c, i) { return button(slotId, 'data-eup-env-event-command="' + c + '"', COMMAND_LABEL[c], 'act' + i); }).join('') + '</div>' : '<p class="cr-eup-env__hint">No owner command applies to this state.</p>') +
        '<h5>Revisions</h5><ol class="cr-eup-env__revisions" data-eup-env-revisions>' + (Array.isArray(ev.revisions) ? ev.revisions : []).map(function (r) {
          var can = back.indexOf(r.revision) >= 0;
          return '<li data-eup-env-revision="' + esc(r.revision) + '"><span>' + esc('rev ' + r.revision + ' · ' + r.cause + ' · ' + when(r.recorded_at) + (r.changes && Object.keys(r.changes).length ? ' · ' + Object.keys(r.changes).map(function (k) { var c = r.changes[k]; return k + ' ' + JSON.stringify(c.from) + ' → ' + JSON.stringify(c.to); }).join(', ') : '')) + '</span>' +
            (can ? '<div class="cr-eup__actions cr-eup-env__actions">' + button(slotId, 'data-eup-env-rollback="' + esc(r.revision) + '"', 'Restore revision ' + r.revision + ' as revision ' + (s.revision + 1), 'rollback' + r.revision) + '</div>' : '') + '</li>';
        }).join('') + '</ol>' +
        (back.length ? '<p class="cr-eup-env__hint">Restoring makes that revision\'s content the new current revision; the history keeps every revision. If USGS itself is wrong, pause the ingest first, or the next ingest revises it again.</p>' : '') +
        coverageBlock(ev, s) +
        '<h5>Decisions on this event</h5>' + decisionList(ev.decisions) +
        outcomeAndResend(slotId) + close + '</article>';
    }
    function coverageBlock(ev, s) {
      var rows = Array.isArray(ev.coverage) ? ev.coverage : [];
      if (!rows.length) return '<h5>News coverage</h5><p class="cr-eup-env__hint">None proposed. Coverage never creates or publishes an event.</p>';
      return '<h5>News coverage</h5><ul class="cr-eup__list" data-eup-env-coverage>' + rows.map(function (c) {
        var slotId = 'coverage:' + c.id, acts = coverageActions(c, s.revision);
        return '<li data-eup-env-cov="' + esc(c.id + ':' + c.state) + '"><span>' + esc(c.title + ' · ' + c.domain + ' · ' + c.state + ' · basis ' + c.basis + ' · rev ' + c.event_revision) + '</span>' +
          (acts.length ? reasonField(slotId) + '<div class="cr-eup__actions cr-eup-env__actions">' + acts.map(function (a, i) { return button(slotId, 'data-eup-env-coverage-command="' + esc(c.id + '|' + a) + '"', COMMAND_LABEL[a], 'act' + i); }).join('') + '</div>' + outcomeAndResend(slotId) : '') + '</li>';
      }).join('') + '</ul>';
    }
    function decisionList(rows) {
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) return '<p class="cr-eup-env__hint">No decisions recorded.</p>';
      return '<ul class="cr-eup__list" data-eup-env-decisions>' + rows.map(function (x) {
        return '<li>' + esc('#' + x.seq + ' · ' + (COMMAND_LABEL[x.command] || x.command) + ' · ' + x.target_kind + ' ' + x.target_id + ' · expected rev ' + x.expected_revision + ' · ' + (x.receipt && x.receipt.changed === false ? 'no change' : 'changed') + ' · reason: ' + x.reason + ' · ' + when(x.created_at)) + '</li>';
      }).join('') + '</ul>';
    }
    /* Preview */
    function viewPreview() {
      var S = E.preview, d = S.data, n = slotNote(S, 'the preview');
      var intro = '<p class="cr-eup-env__hint">Owner preview (decision D11, adopted pending Matthew\'s confirmation; it ships only with his approval of the pull request): the page the public timeline would show, read while the module is off. Visitors cannot read it.</p>';
      if (n && !d) return intro + n;
      if (!d) return intro + note('loading', 'Not read yet.');
      if (d.store && d.store.status !== 'applied') return intro + note('not_configured', storeStatusLine(d.store));
      var events = Array.isArray(d.events) ? d.events : [];
      var html = intro + (n || '') + '<p class="cr-eup-env__line" data-eup-env-preview-public>' + esc('The public now: ' + (d.module ? (d.module.gate === 'on' ? 'answers' : d.module.gate === 'off' ? 'off (404)' : 'outage (503)') : 'unknown') + '.') + '</p>';
      html += events.length ? '<ul class="cr-eup__list" data-eup-env-preview>' + events.map(function (e) {
        var corr = e.correction && e.correction.changes ? ' · corrected: ' + Object.keys(e.correction.changes).join(', ') : '';
        var tomb = e.state === 'withdrawn_by_source' ? ' · withdrawn by USGS ' + when(e.withdrawn_at) : e.state === 'retracted' ? ' · withdrawn by the owner ' + when(e.retracted_at) : '';
        return '<li data-eup-env-preview-item="' + esc(e.id + ':' + e.revision + ':' + e.state) + '">' + esc((typeof e.magnitude === 'number' ? 'M' + e.magnitude + ' · ' : '') + (e.place || e.title || e.id) + ' · ' + e.id + ' · rev ' + e.revision + ' · ' + e.state + ' · observed ' + when(e.observed_at) + (e.review_status ? ' · ' + e.review_status : '') + corr + tomb + (Array.isArray(e.news_coverage) && e.news_coverage.length ? ' · coverage ' + e.news_coverage.length : '')) + '</li>';
      }).join('') + '</ul>' : note('empty', 'The page is empty: no published event in the store yet.');
      html += '<div class="cr-eup__actions cr-eup-env__actions">' + (E.cursors.length ? '<button type="button" class="cr-btn" data-eup-env-page="first" data-eup-focus="env-page-first">First page</button>' : '') + (d.next_cursor ? '<button type="button" class="cr-btn" data-eup-env-page="next" data-eup-focus="env-page-next">Next page</button>' : '') + '</div>';
      return html;
    }
    function viewDecisions() {
      var S = E.review, d = S.data, n = slotNote(S, 'the decision log');
      if (n && !d) return n;
      if (!d) return note('loading', 'Not read yet.');
      if (d.store && d.store.status !== 'applied') return note('not_configured', storeStatusLine(d.store));
      return (n || '') + reloadButton() + decisionList(d.decisions);
    }
    function reloadButton() {
      return '<div class="cr-eup__actions cr-eup-env__actions"><button type="button" class="cr-btn" data-eup-env-reload data-eup-focus="env-reload"' + (E.review.loading ? ' aria-disabled="true"' : '') + '>Read the queue and the log again</button></div>';
    }

    /* ----- wiring ----- */
    function wire(pane) {
      paneRef = pane;
      var tabs = pane.querySelectorAll('[data-eup-env-tab]');
      tabs.forEach(function (b) {
        b.onclick = function () { select(b.getAttribute('data-eup-env-tab')); };
        b.onkeydown = function (e) {
          var ids = VIEWS.map(function (v) { return v.id; }), i = ids.indexOf(E.view);
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length], true); }
          if (e.key === 'Home') { e.preventDefault(); select(ids[0], true); } if (e.key === 'End') { e.preventDefault(); select(ids[ids.length - 1], true); }
        };
      });
      pane.querySelectorAll('[data-eup-env-reason]').forEach(function (i) { var k = i.getAttribute('data-eup-env-reason'); i.oninput = function () { E.reasons[k] = String(i.value || ''); }; });
      pane.querySelectorAll('[data-eup-env-rule]').forEach(function (i) { i.oninput = i.onchange = function () { E.rule = ruleValues(pane); }; });
      pane.querySelectorAll('[data-eup-env-check]').forEach(function (b) { b.onclick = function () { if (!E.health.loading) loadHealth(); }; });
      pane.querySelectorAll('[data-eup-env-reload]').forEach(function (b) { b.onclick = function () { if (E.review.loading) return; loadReview().then(function () { if (alive()) { reconcile(); redraw(); } }); if (E.eventId) loadEvent(E.eventId); }; });
      pane.querySelectorAll('[data-eup-env-open]').forEach(function (b) { b.onclick = function () { loadEvent(b.getAttribute('data-eup-env-open'), true); }; });
      pane.querySelectorAll('[data-eup-env-close]').forEach(function (b) { b.onclick = function () { E.eventId = null; E.event = slot(); redraw(); }; });
      pane.querySelectorAll('[data-eup-env-page]').forEach(function (b) {
        b.onclick = function () {
          var d = E.preview.data;
          if (b.getAttribute('data-eup-env-page') === 'next' && d && d.next_cursor) E.cursors.push(d.next_cursor); else E.cursors = [];
          loadPreview(E.cursors[E.cursors.length - 1] || null);
        };
      });
      pane.querySelectorAll('[data-eup-env-event-command]').forEach(function (b) {
        b.onclick = function () { var s = E.event.data && E.event.data.event && E.event.data.event.summary; if (s) command('event:' + s.id, 'event', b.getAttribute('data-eup-env-event-command'), s.id, s.revision, null); };
      });
      pane.querySelectorAll('[data-eup-env-rollback]').forEach(function (b) {
        b.onclick = function () { var s = E.event.data && E.event.data.event && E.event.data.event.summary; if (s) command('event:' + s.id, 'event', 'rollback', s.id, s.revision, { to_revision: Number(b.getAttribute('data-eup-env-rollback')) }); };
      });
      pane.querySelectorAll('[data-eup-env-coverage-command]').forEach(function (b) {
        b.onclick = function () {
          var v = b.getAttribute('data-eup-env-coverage-command').split('|'), s = E.event.data && E.event.data.event && E.event.data.event.summary;
          if (s) command('coverage:' + v[0], 'coverage', v[1], v[0], s.revision, null);
        };
      });
      pane.querySelectorAll('[data-eup-env-setrule]').forEach(function (b) {
        b.onclick = function () {
          var st = providerStore();
          if (!st) return;
          if (b.getAttribute('data-eup-env-setrule') === 'default') { command('provider:usgs', 'provider', 'set_rule', 'usgs', st.revision, {}); return; }
          var r = ruleFrom(ruleValues(pane));
          if (r.problem) { E.outcomes['provider:usgs'] = { kind: 'error', text: r.problem + ' Nothing was sent.' }; redraw(); focus('[data-eup-env-rule="min_magnitude"]'); return; }
          command('provider:usgs', 'provider', 'set_rule', 'usgs', st.revision, { rule: r.rule });
        };
      });
      pane.querySelectorAll('[data-eup-env-provider-command]').forEach(function (b) {
        b.onclick = function () { var st = providerStore(); if (st) command('provider:usgs', 'provider', b.getAttribute('data-eup-env-provider-command'), 'usgs', st.revision, null); };
      });
      pane.querySelectorAll('[data-eup-env-resend]').forEach(function (b) { b.onclick = function () { resend(b.getAttribute('data-eup-env-resend')); }; });
    }
    function providerStore() {
      var r = E.review.data, h = E.health.data;
      var fromReview = r && Array.isArray(r.providers) ? r.providers.filter(function (p) { return p && p.provider === 'usgs'; })[0] : null;
      if (fromReview) return fromReview;
      var s = h && Array.isArray(h.sources) ? h.sources.filter(function (x) { return x && x.provider === 'usgs'; })[0] : null;
      return s && s.store ? s.store : null;
    }
    function ruleValues(pane) {
      var v = {};
      ['min_magnitude', 'significance_above'].forEach(function (k) { var i = pane.querySelector('[data-eup-env-rule="' + k + '"]'); v[k] = i ? i.value : ''; });
      ['include_automatic', 'pager_alert', 'tsunami'].forEach(function (k) { var i = pane.querySelector('[data-eup-env-rule="' + k + '"]'); v[k] = !!(i && i.checked); });
      return v;
    }
    function select(view, focusTab) {
      if (!VIEWS.some(function (v) { return v.id === view; })) return;
      E.view = view; redraw();
      if (focusTab) focus('[data-eup-env-tab="' + view + '"]');
    }

    return {
      render: render, wire: wire, load: load, reset: reset, leave: function () {},
      inspect: function () { return { view: E.view, outcomes: E.outcomes, eventId: E.eventId, cursors: E.cursors.slice(), health: E.health, review: E.review, preview: E.preview, event: E.event }; }
    };
  }

  window.CR.eupEnvironment = {
    create: create,
    helpers: { when: when, publicLine: publicLine, providerLine: providerLine, storeLine: storeLine, moduleLine: moduleLine, storeStatusLine: storeStatusLine,
      reasonProblem: reasonProblem, eventActions: eventActions, rollbackTargets: rollbackTargets, coverageActions: coverageActions, failureOf: failureOf,
      ruleFrom: ruleFrom, ruleLine: ruleLine, VIEWS: VIEWS, PROVIDERS: PROVIDERS, SLOW_DEADLINE_MS: SLOW_DEADLINE_MS }
  };
})();
