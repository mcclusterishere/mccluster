/* Control · System · E=Up: the admin-only product workspace (NAV mount point "eup").

   Owner, 2026-11-09: "an admin only experience … the E=Up tab in the admin
   experience". This module is presentation over the owner-only Worker contract
   at /v1/eup (workers/mccluster/src/eup/router.js). It creates no permission:
   every section reads the same house-owner-gated routes, a 403 conceals the
   whole workspace, and a section the Worker has not implemented yet says so
   ("Not implemented yet") instead of drawing an empty success.

   Five LOCAL tabs inside the one Control destination: Overview, Environmental
   Justice League, Civic League, Companies & Finance, Sources & Review. One
   globe (the retained Analytics scene, window.CR.analyticsGlobe) is mounted
   once per bind and survives every tab switch; its selection is the shared
   geography for Overview and the Civic breadcrumb.

   Lifecycle (audit A1/A6, 2026-11-09): every request carries an AbortSignal
   with a bounded deadline, results are stamped with the authority epoch at
   start and discarded if the account changed meanwhile, and a timed-out
   write is reported as "outcome unknown" with a read-back, never replayed.
   mcc:auth-changed, a session storage change, a restored page and an owner
   loss (403) bump the epoch and clear every private pane synchronously.

   Module policy (Overview › Modules card): the owner installs, enables, drains
   and disables the three persisted policy units through /v1/eup/modules
   (workers/mccluster/src/eup/modules.js). What a chip or a button says comes
   only from the last successful GET /v1/eup/modules; a failed read shows
   "unknown" and offers no command. Every command carries a reason, the
   revision that was read and a fresh key, and is followed by a read-back. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var API = 'https://api.mccluster.org';
  var SECTIONS = [
    { id: 'overview', label: 'Overview', blurb: 'Module state, selected geography, drafts, queues, freshness and blockers.' },
    { id: 'league', label: 'Environmental Justice League', blurb: 'Campaigns, missions, applications, assignments, private proof and separately consented publication.' },
    { id: 'civic', label: 'Civic League', blurb: 'Offices, terms, legislation and elections by geography. Public records with their sources; no scoring.' },
    { id: 'companies', label: 'Companies & Finance', blurb: 'Company identity, sourced locations, filings and federal awards. A quote appears only when a licensed quote succeeded.' },
    { id: 'sources', label: 'Sources & Review', blurb: 'Connector configuration, rights, health, imports, unresolved records and bounded refresh or pause.' }
  ];
  var DEADLINE_MS = 15000;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var epoch = 0, bound = null;

  /* ---------- pure helpers (unit-tested through window.CR.eup.helpers) ---------- */
  function when(iso) {
    if (!iso) return 'not recorded';
    var d = new Date(iso); if (isNaN(d.getTime())) return 'invalid time';
    try { return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toISOString(); }
  }
  /* A card's freshness is what the contract says it is. Nothing here turns a
     missing value into "fresh" or a missing count into zero. */
  function freshnessLabel(row) {
    var s = row && typeof row.status === 'string' ? row.status.toLowerCase() : '';
    if (['fresh', 'current', 'ok', 'available'].indexOf(s) >= 0) return 'current';
    if (['stale', 'partial', 'unavailable', 'corrected', 'held', 'paused', 'error', 'pending', 'unknown', 'empty'].indexOf(s) >= 0) return s;
    return 'unknown';
  }
  function provenanceLine(p) {
    if (!p || typeof p !== 'object') return 'Provenance not supplied.';
    var parts = [];
    if (p.source_id) parts.push('Source ' + p.source_id + (p.source_record_id ? ' · record ' + p.source_record_id : ''));
    parts.push('observed ' + when(p.observed_at));
    if (p.effective_from || p.effective_to) parts.push('effective ' + when(p.effective_from) + (p.effective_to ? ' → ' + when(p.effective_to) : ' → open'));
    parts.push('upstream updated ' + when(p.upstream_updated_at));
    parts.push('fetched ' + when(p.fetched_at));
    if (p.parser_version) parts.push('parser ' + p.parser_version);
    parts.push('review ' + (p.review_state || 'unknown'));
    if (p.coverage) parts.push('coverage ' + p.coverage);
    return parts.join(' · ');
  }
  /* The reason an answer is not a usable pane, for the operator. */
  function reasonFor(err) {
    if (!err) return null;
    var status = err.status, reason = err.detail && err.detail.reason;
    if (err.name === 'AbortError' || err.timeout) return { kind: 'timeout', text: 'Timed out after ' + Math.round((err.deadline || DEADLINE_MS) / 1000) + 's. The outcome is unknown; read back before retrying.' };
    if (status === 401 || /signed out/i.test(err.message || '')) return { kind: 'signed_out', text: 'Signed out. Sign in again to open E=Up.' };
    if (status === 403) return { kind: 'denied', text: 'House owner access required. This workspace is admin-only; nothing is shown to other roles.' };
    if (status === 503 && reason === 'not_implemented') return { kind: 'not_implemented', text: 'Not implemented yet. The Worker answers this section with 503 not_implemented; nothing is shown until it is real.' };
    if (status === 503 && reason === 'not_configured') return { kind: 'not_configured', text: 'Not configured. The source, key or module policy for this section is absent; no data was fetched.' };
    if (status === 503) return { kind: 'unavailable', text: 'Unavailable (503' + (reason ? ' ' + reason : '') + '). Prior data, if any, is kept and marked stale.' };
    if (status === 404) return { kind: 'not_found', text: 'Not found (404).' };
    return { kind: 'error', text: (err.message || 'Request failed') + (status ? ' (HTTP ' + status + ')' : '') + '.' };
  }
  function idempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    throw new Error('Secure key generation is unavailable; this browser cannot send E=Up commands.');
  }

  /* ---------- module policy: pure helpers ---------- */
  /* The three persisted policy units, in the order the Worker answers them. */
  var POLICY_UNITS = [{ id: 'environment', label: 'Environment' }, { id: 'league', label: 'League' }, { id: 'intake', label: 'Intake' }];
  var POLICY_TEXT = { not_installed: 'not installed', disabled: 'disabled', enabled: 'enabled', draining: 'draining', unknown: 'unknown' };
  var POLICY_ACTIONS = {
    not_installed: [{ verb: 'install', label: 'Install' }],
    disabled: [{ verb: 'enabled', label: 'Enable' }],
    enabled: [{ verb: 'draining', label: 'Drain' }],
    draining: [{ verb: 'disabled', label: 'Disable' }, { verb: 'enabled', label: 'Re-enable' }],
    unknown: []
  };
  function revisionOk(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v; }
  /* One of not_installed / disabled / enabled / draining, or unknown for anything this code cannot read.
     A row that is not exactly an installed row with a state and a revision is never read as enabled. */
  function policyStateOf(row) {
    if (!row || typeof row !== 'object') return 'unknown';
    if (row.installed === false) return 'not_installed';
    if (row.installed === true && (row.state === 'enabled' || row.state === 'draining' || row.state === 'disabled') && revisionOk(row.revision)) return row.state;
    return 'unknown';
  }
  /* The commands a state offers: not installed → Install; disabled → Enable; enabled → Drain; draining → Disable, Re-enable. */
  function policyActions(state) { return (Object.prototype.hasOwnProperty.call(POLICY_ACTIONS, state) ? POLICY_ACTIONS[state] : []).slice(); }
  /* The Worker's rule for a reason, said before anything is sent: 1 to 500 characters after trimming, one line. */
  function reasonProblem(text) {
    var t = typeof text === 'string' ? text.trim() : '';
    if (!t) return 'A reason is required. Say why, then choose the command again; nothing was sent.';
    if (Array.from(t).length > 500) return 'The reason is longer than 500 characters; nothing was sent.';
    if (/[\u0000-\u001f\u007f]/.test(t)) return 'The reason must be a single line without control characters; nothing was sent.';
    return null;
  }
  /* The statuses the Worker's module routes use to refuse a command before or inside its one transaction. */
  var POLICY_REFUSALS = [400, 404, 405, 409, 413, 415, 422];
  /* What a failed policy command means. `settled` says the command certainly changed nothing; without it the
     outcome is unknown and the caller reads back and looks for the key. `again` allows the same key to be resent.
     A timeout, any 503 other than drain_busy and any answer this code cannot place are unknown, never "failed".
     Each text follows the command's name and a colon. */
  function policyFailure(err) {
    var status = err && err.status, reason = err && err.detail && typeof err.detail.reason === 'string' ? err.detail.reason : '';
    var secs = Math.round(((err && err.deadline) || DEADLINE_MS) / 1000);
    if (err && (err.name === 'AbortError' || err.timeout)) return { kind: 'unknown', settled: false, again: false, text: 'timed out after ' + secs + 's. The outcome is unknown and it was not resent.' };
    if (status === 409 && reason === 'revision_conflict') return { kind: 'conflict', settled: true, again: false, text: 'the module policy changed elsewhere since it was read. This command changed nothing. The current state is read again below; decide again.' };
    if (status === 503 && reason === 'drain_busy') return { kind: 'busy', settled: true, again: true, text: 'writes are still in flight; nothing changed. The same command can be sent again.' };
    if (status === 409 && reason === 'drain_required') return { kind: 'error', settled: true, again: false, text: 'an enabled module must be drained before it is disabled. Nothing changed.' };
    if (status === 409 && reason === 'idempotency_conflict') return { kind: 'error', settled: true, again: false, text: 'this key was already used for a different command, or by another owner; only the account that first sent a command can send it again. Nothing was changed by this request.' };
    if (status === 409 && reason === 'module_already_installed') return { kind: 'conflict', settled: true, again: false, text: 'the module is already installed. Nothing changed; the current state is read again below.' };
    if (status === 404 && reason === 'module_not_installed') return { kind: 'conflict', settled: true, again: false, text: 'the module is not installed. Nothing changed; the current state is read again below.' };
    if (status === 422 && reason === 'reason_required') return { kind: 'error', settled: true, again: false, text: 'the Worker refused the reason (1 to 500 characters, one line). Nothing changed.' };
    if (POLICY_REFUSALS.indexOf(status) >= 0) return { kind: 'error', settled: true, again: false, text: 'refused (HTTP ' + status + (reason ? ' ' + reason : '') + '). Nothing changed.' };
    return { kind: 'unknown', settled: false, again: false, text: (status ? 'answered HTTP ' + status + (reason ? ' ' + reason : '') : 'no readable answer') + '. The outcome is unknown and it was not resent.' };
  }
  /* Why the owner read of module policy is not usable. */
  function policyReadFailure(err) {
    var reason = err && err.detail && err.detail.reason;
    if (err && err.status === 503 && reason === 'schema_not_applied') return { kind: 'not_configured', text: 'Module policy schema is not applied. No module is installed and none is reported enabled; commands are unavailable until the owner applies it.' };
    if (err && err.malformed) return { kind: 'error', text: 'The module policy answer was not readable. State is unknown and no command is offered.' };
    var r = reasonFor(err);
    return { kind: r.kind, text: 'Module policy: ' + r.text + ' State is unknown and no command is offered.' };
  }

  /* ---------- requests: bounded, epoch-stamped, abortable ---------- */
  function fallbackRequest(path, opts) {
    opts = opts || {};
    var tok = window.MCC_SUPA && window.MCC_SUPA.token ? window.MCC_SUPA.token() : Promise.resolve(null);
    return tok.then(function (t) {
      if (!t) throw Object.assign(new Error('signed out'), { status: 401 });
      var headers = { authorization: 'Bearer ' + t };
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      return fetch(API + path, { method: opts.method || 'GET', headers: headers, cache: 'no-store', signal: opts.signal, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
        .then(function (r) { return r.text().then(function (body) { var data = null; try { data = body ? JSON.parse(body) : null; } catch (e) { data = { raw: body }; }
          if (!r.ok) { var err = new Error(data && (data.error || data.message) || ('HTTP ' + r.status)); err.status = r.status; err.detail = data; throw err; } return data; }); });
    });
  }
  /* request(path, opts) → promise. Rejects with {timeout:true} when the
     deadline passes; the caller decides whether that is an unknown outcome. */
  function makeRequester(opts) {
    var base = opts && typeof opts.request === 'function' ? opts.request : fallbackRequest;
    var deadline = opts && opts.deadlineMs > 0 ? opts.deadlineMs : DEADLINE_MS;
    var inflight = [];
    function run(path, o) {
      o = o || {};
      var ac = typeof AbortController === 'function' ? new AbortController() : null, timer = null, timedOut = false;
      if (ac) inflight.push(ac);
      var started = epoch;
      var p = new Promise(function (resolve, reject) {
        timer = setTimeout(function () { timedOut = true; if (ac) { try { ac.abort(); } catch (e) {} } reject(Object.assign(new Error('deadline'), { timeout: true, deadline: deadline })); }, deadline);
        Promise.resolve().then(function () { return base(path, { method: o.method, body: o.body, signal: ac ? ac.signal : undefined }); })
          .then(function (data) { if (!timedOut) resolve(data); }, function (err) { if (!timedOut) reject(err); });
      });
      p.epoch = started;
      var done = function () { clearTimeout(timer); if (ac) inflight = inflight.filter(function (x) { return x !== ac; }); };
      p.then(done, done);
      return p;
    }
    run.abortAll = function () { inflight.forEach(function (ac) { try { ac.abort(); } catch (e) {} }); inflight = []; };
    return run;
  }

  /* ---------- state ---------- */
  /* policy: the last owner read of /v1/eup/modules (control), why it failed (error), the reason being typed per
     unit, and a counter so only the newest read is committed. Reset with everything private. */
  function freshPolicy() { return { control: null, error: null, loading: false, readAt: null, reasons: {}, seq: 0 }; }
  var model = { section: 'overview', geo: { country: null, state: null }, data: {}, errors: {}, loading: {}, query: '', civic: { jurisdiction: null, office: null, bill: null }, company: null, outcomes: {}, policy: freshPolicy() };
  function resetModel() { model.data = {}; model.errors = {}; model.loading = {}; model.civic = { jurisdiction: null, office: null, bill: null }; model.company = null; model.outcomes = {}; model.policy = freshPolicy(); }

  /* ---------- rendering (strings only; bind() wires them) ---------- */
  function render() {
    return '<section class="cr-eup" data-eup aria-labelledby="eupTitle">' +
      '<header class="cr-eup__head"><div><p class="cr-eup__kicker">Products · admin only</p><h2 id="eupTitle">E=Up</h2>' +
      '<p class="cr-muted">The deeper E=Up experience, released first to the verified house owner only. Every pane reads the owner-gated Worker; a hidden tab is not authorization, and nothing here changes the consumer globe.</p></div></header>' +
      '<div class="cr-eup__status" role="status" aria-live="polite" data-eup-status>Opening E=Up…</div>' +
      '<div class="cr-eup__tabs" role="tablist" aria-label="E=Up sections" data-eup-tabs>' + SECTIONS.map(function (s, i) {
        return '<button type="button" role="tab" id="eupTab-' + s.id + '" aria-controls="eupPane" aria-selected="' + (s.id === model.section) + '" tabindex="' + (s.id === model.section ? '0' : '-1') + '" data-eup-tab="' + s.id + '">' + esc(s.label) + '</button>';
      }).join('') + '</div>' +
      '<div class="cr-eup__stage"><div class="cr-eup__globe" data-eup-globe data-eup-globe-mounts="0" aria-label="Geography"></div>' +
      '<p class="cr-eup__geo" data-eup-geo>No geography selected. Tap a country on the globe, or a state inside it.</p></div>' +
      '<div class="cr-eup__pane" id="eupPane" role="tabpanel" aria-labelledby="eupTab-' + esc(model.section) + '" data-eup-pane></div>' +
      '</section>';
  }
  function note(kind, text) { return '<p class="cr-eup__note cr-eup__note--' + esc(kind) + '" data-eup-note="' + esc(kind) + '">' + esc(text) + '</p>'; }
  function cardMeta(p) { return '<p class="cr-eup__prov">' + esc(provenanceLine(p)) + '</p>'; }
  function freshnessChip(row) { var f = freshnessLabel(row); return '<span class="cr-eup__chip cr-eup__chip--' + esc(f) + '" data-eup-fresh="' + esc(f) + '">' + esc(f) + '</span>'; }
  function state(section) {
    if (model.loading[section]) return note('loading', 'Loading ' + section + '…');
    var r = reasonFor(model.errors[section]);
    if (r) return note(r.kind, r.text);
    return null;
  }
  function count(v) { return typeof v === 'number' && isFinite(v) ? String(v) : 'unknown'; }
  /* ----- Modules card: release posture and persisted policy are two facts and are never merged ----- */
  function unitRow(id) {
    var c = model.policy.control;
    if (!c || !Array.isArray(c.modules)) return null;
    return c.modules.filter(function (m) { return m && m.moduleId === id; })[0] || null;
  }
  function policyChip(st) { return '<span class="cr-eup__chip cr-eup__chip--' + esc(st) + '" data-eup-policy-chip="' + esc(st) + '">policy: ' + esc(POLICY_TEXT[st] || 'unknown') + '</span>'; }
  function outcomeNote(unit, o) { return '<p class="cr-eup__note cr-eup__note--' + esc(o.kind) + '" data-eup-note="' + esc(o.kind) + '" data-eup-policy-outcome="' + esc(unit + ':' + o.kind) + '">' + esc(o.text) + '</p>'; }
  /* One module of the overview: its release posture, and for a governed module the policy of its unit. The policy
     comes from the owner read when there is one, is unknown when that read failed, and falls back to the
     overview's own read only while the owner read is still on its way. */
  function moduleRow(m) {
    var posture = m.state || 'unknown', unit = typeof m.policy_module === 'string' ? m.policy_module : null;
    var html = '<li data-eup-module="' + esc(m.id) + '"><strong>' + esc(m.label || m.id) + '</strong> <span class="cr-eup__chip cr-eup__chip--' + esc(posture) + '" data-eup-posture="' + esc(posture) + '">release: ' + esc(posture) + '</span>';
    if (unit) {
      var P = model.policy, row = P.control ? unitRow(unit) : (P.error ? null : m.policy), st = policyStateOf(row);
      html += ' ' + policyChip(st) + ' <small>' + (st !== 'unknown' && st !== 'not_installed' ? 'rev ' + esc(row.revision) + ' · ' : '') + 'unit ' + esc(unit) + '</small>';
    } else if (m.policy_module === null) html += ' <small>no policy unit</small>';
    return html + (m.detail ? '<br><small>' + esc(m.detail) + '</small>' : '') + '</li>';
  }
  function lastCommandLine(last, st) {
    if (!last || typeof last !== 'object') return st === 'not_installed' ? 'No command recorded for this unit.' : 'Last command: not returned.';
    var what = last.command === 'install' ? 'install (created disabled)' : (last.requested_state || 'unknown state');
    var same = last.receipt && last.receipt.changed === false ? ' · no state change' : '';
    return 'Last command: ' + what + same + ' · reason: ' + (last.reason || 'not returned') + ' · ' + when(last.created_at);
  }
  /* What the page can truthfully say while a unit drains. It is not told how much work is still in flight. */
  var DRAIN_TEXT = 'Draining: new writes are refused and reads still answer. This page is not told how much work is still in flight. Disable when that work is done, or re-enable.';
  /* What enabling a unit does, where one plain sentence can say it. */
  var UNIT_EFFECT = { environment: 'The consumer E=Up tab answers nothing until this unit is installed and enabled.' };
  function unitCard(u, d) {
    var P = model.policy, row = unitRow(u.id), st = policyStateOf(row), o = model.outcomes['policy:' + u.id];
    var busy = !!(o && o.kind === 'pending') || P.loading, off = busy ? ' aria-disabled="true"' : '';
    var mods = d && Array.isArray(d.modules) ? d.modules : [];
    var governs = mods.filter(function (m) { return m && m.policy_module === u.id; }).map(function (m) { return m.label || m.id; });
    var acts = policyActions(st), rid = 'eupPolicyReason-' + u.id;
    return '<li class="cr-eup__unit" tabindex="-1" data-eup-policy="' + u.id + '" data-eup-policy-state="' + u.id + ':' + st + '" data-eup-focus="policy:' + u.id + '">' +
      '<div class="cr-eup__unit-head"><strong>' + esc(u.label) + '</strong> ' + policyChip(st) + (st !== 'unknown' && st !== 'not_installed' ? ' <small data-eup-policy-rev="' + u.id + ':' + esc(row.revision) + '">rev ' + esc(row.revision) + '</small>' : '') + '</div>' +
      (governs.length ? '<p class="cr-eup__unit-line">Governs: ' + esc(governs.join(', ')) + '</p>' : '') +
      '<p class="cr-eup__unit-line" data-eup-policy-last="' + u.id + '">' + esc(lastCommandLine(row && row.last_command, st)) + '</p>' +
      (UNIT_EFFECT[u.id] ? '<p class="cr-eup__unit-line" data-eup-policy-effect="' + u.id + '">' + esc(UNIT_EFFECT[u.id]) + '</p>' : '') +
      (st === 'draining' ? '<p class="cr-eup__drain" data-eup-policy-drain="' + u.id + '">' + esc(DRAIN_TEXT) + '</p>' : '') +
      (st === 'not_installed' ? '<p class="cr-eup__unit-line">Install creates this unit disabled at revision 0. Nothing it governs can write until it is enabled.</p>' : '') +
      (acts.length ? '<label class="cr-eup__field" for="' + rid + '"><span>Reason (required, recorded with the command)</span><input type="text" id="' + rid + '" maxlength="500" autocomplete="off" autocapitalize="sentences" spellcheck="true" value="' + esc(P.reasons[u.id] || '') + '" data-eup-policy-reason="' + u.id + '" data-eup-focus="policy:' + u.id + ':reason"></label>' +
        '<div class="cr-eup__actions cr-eup__actions--policy">' + acts.map(function (a) { return '<button type="button" class="cr-btn" data-eup-policy-command="' + u.id + ':' + a.verb + '" data-eup-focus="policy:' + u.id + ':' + a.verb + '"' + off + '>' + esc(a.label) + '</button>'; }).join('') + '</div>'
        : '<p class="cr-eup__unit-line">The state of this unit could not be read; no command is offered.</p>') +
      (o ? outcomeNote(u.id, o) : '') +
      (o && o.resend && o.command ? '<div class="cr-eup__actions cr-eup__actions--policy"><button type="button" class="cr-btn" data-eup-policy-resend="' + u.id + '" data-eup-focus="policy:' + u.id + ':resend"' + off + '>Send the same command again</button></div><p class="cr-eup__unit-line">Uses the same key, so it is recorded at most once. Only the account that sent it can; another owner is refused.</p>' : '') +
      '</li>';
  }
  function policyBlock(d) {
    var P = model.policy, body;
    if (P.control) body = '<ul class="cr-eup__units">' + POLICY_UNITS.map(function (u) { return unitCard(u, d); }).join('') + '</ul><p class="cr-eup__prov" data-eup-policy-read>Module policy read ' + esc(when(P.readAt)) + (P.loading ? ' · reading again…' : '') + '</p>';
    else if (P.error) { var f = policyReadFailure(P.error); body = note(f.kind, f.text); }
    else body = note('loading', P.loading ? 'Reading module policy…' : 'Module policy has not been read yet.');
    return '<h4 id="eupPolicyTitle">Module policy</h4>' +
      '<p class="cr-eup__unit-line">Persisted per unit: install, enable, drain, disable. A drain refuses new writes while reads still answer. Every command needs a reason, carries the revision read here and a new key, and is read back.</p>' +
      body +
      '<div class="cr-eup__actions cr-eup__actions--policy"><button type="button" class="cr-btn" data-eup-policy-reload data-eup-focus="policy-reload"' + (P.loading ? ' aria-disabled="true"' : '') + '>Read module policy again</button></div>';
  }
  /* When the overview itself could not be read: the policy controls still appear if the policy WAS read (drain
     and disable must not depend on an unrelated read). If it was not, one plain line says so under the
     overview's own note; nothing is offered. */
  function policyOnly() {
    var P = model.policy;
    if (!P.control) return P.error ? '<p class="cr-eup__unit-line" data-eup-policy-unread>' + esc(policyReadFailure(P.error).text + ' Select Overview again to read both again.') + '</p>' : '';
    return '<div class="cr-eup__grid"><article class="cr-eup__card cr-eup__card--wide" data-eup-modules><h3>Modules</h3><p class="cr-eup__unit-line">The overview was not read, so release posture is not shown.</p>' + policyBlock(null) + '</article></div>';
  }
  function paneOverview() {
    if (model.loading.overview) return note('loading', 'Loading overview…');
    var r = reasonFor(model.errors.overview);
    if (r) return note(r.kind, r.text) + (r.kind === 'signed_out' || r.kind === 'denied' ? '' : policyOnly());
    var d = model.data.overview; if (!d || d.ok !== true) return note('error', 'The overview answered without ok:true; nothing is shown.') + policyOnly();
    var mods = Array.isArray(d.modules) ? d.modules : [];
    var geo = d.geography && d.geography.selected;
    return '<div class="cr-eup__grid">' +
      '<article class="cr-eup__card cr-eup__card--wide" data-eup-modules><h3>Modules</h3>' + (mods.length ? '<ul class="cr-eup__list">' + mods.map(moduleRow).join('') + '</ul>' : note('empty', 'The Worker returned no module records (0) at ' + when(new Date().toISOString()) + '.')) + policyBlock(d) + '</article>' +
      '<article class="cr-eup__card"><h3>Geography</h3><p>' + esc(geo ? [geo.country, geo.state, geo.municipality].filter(Boolean).join(' › ') : 'None selected server-side.') + '</p><p class="cr-muted">Globe selection: ' + esc(model.geo.country ? model.geo.country + (model.geo.state ? ' › ' + model.geo.state : '') : 'none') + '</p></article>' +
      '<article class="cr-eup__card"><h3>Campaigns</h3><p>Drafts: ' + count(d.campaigns && d.campaigns.drafts) + ' · Released: ' + count(d.campaigns && d.campaigns.released) + '</p></article>' +
      '<article class="cr-eup__card"><h3>Queues</h3><p>Applications: ' + count(d.queues && d.queues.applications) + ' · Proofs: ' + count(d.queues && d.queues.proofs) + ' · Reviews: ' + count(d.queues && d.queues.reviews) + '</p></article>' +
      '<article class="cr-eup__card"><h3>Freshness</h3>' + (Array.isArray(d.freshness) && d.freshness.length ? '<ul class="cr-eup__list">' + d.freshness.map(function (f) { /* the Worker names a row {id,label,state,updated_at}; a connector row {source,status,fetched_at,upstream_updated_at} */ var row = { status: f.status || f.state }; return '<li>' + esc(f.source || f.label || f.id) + ' ' + freshnessChip(row) + '<br><small>fetched ' + esc(when(f.fetched_at || f.updated_at)) + ' · upstream updated ' + esc(when(f.upstream_updated_at)) + '</small></li>'; }).join('') + '</ul>' : note('empty', 'No freshness records returned.')) + '</article>' +
      '<article class="cr-eup__card"><h3>Blockers</h3>' + (Array.isArray(d.blockers) && d.blockers.length ? '<ul class="cr-eup__list">' + d.blockers.map(function (b) { return '<li><strong>' + esc(b.id) + '</strong> ' + esc(b.text) + (b.gate ? ' <small>(gate: ' + esc(b.gate) + ')</small>' : '') + '</li>'; }).join('') + '</ul>' : note('empty', 'No blockers returned.')) + '</article>' +
      '</div>';
  }
  function paneLeague() {
    var s = state('league'); if (s) return s;
    var c = model.data.league || {};
    var campaigns = c.campaigns && c.campaigns.ok === true && Array.isArray(c.campaigns.campaigns) ? c.campaigns.campaigns : null;
    var apps = c.applications && c.applications.ok === true && Array.isArray(c.applications.applications) ? c.applications.applications : null;
    var proofs = c.proofs && c.proofs.ok === true && Array.isArray(c.proofs.proofs) ? c.proofs.proofs : null;
    function block(title, rows, draw, err) {
      var r = reasonFor(err);
      return '<article class="cr-eup__card"><h3>' + esc(title) + '</h3>' + (r ? note(r.kind, r.text) : rows && rows.length ? '<ul class="cr-eup__list">' + rows.map(draw).join('') + '</ul>' : note('empty', 'The Worker returned 0 ' + title.toLowerCase() + '.')) + '</article>';
    }
    return '<div class="cr-eup__grid">' +
      block('Campaigns', campaigns, function (k) { return '<li><strong>' + esc(k.title) + '</strong> <span class="cr-eup__chip cr-eup__chip--' + esc(k.state || 'unknown') + '">' + esc(k.state || 'unknown') + '</span> <small>rev ' + esc(k.revision) + '</small>' + (Array.isArray(k.missions) && k.missions.length ? '<ul>' + k.missions.map(function (m) { return '<li>' + esc(m.title || m.id) + (m.state ? ' · ' + esc(m.state) : '') + '</li>'; }).join('') + '</ul>' : '<br><small>No missions on this campaign.</small>') + '</li>'; }, c.campaignsError) +
      block('Applications', apps, function (a) { return '<li>' + esc(a.applicant || a.applicant_id || 'applicant') + ' → ' + esc(a.mission_title || a.mission_id) + ' · ' + esc(a.status || 'unknown') + '</li>'; }, c.applicationsError) +
      block('Private proofs', proofs, function (p) { return '<li>' + esc(p.assignment_id || p.id) + ' · rev ' + esc(p.revision) + ' · ' + esc(p.review_state || 'unreviewed') + ' · publication ' + esc(p.publication_consent ? 'consented (exact revision ' + p.publication_consent.revision + ')' : 'not consented') + '</li>'; }, c.proofsError) +
      '</div><p class="cr-muted">Decisions, reviews and publication consent are separate commands that carry an expected revision and an idempotency key; they are not available in this shell until the Worker section exists.</p>';
  }
  function civicCrumb() {
    var g = model.geo, j = model.civic.jurisdiction;
    var crumbs = [{ label: 'Country', value: g.country }, { label: 'State', value: g.state }, { label: 'County / municipality', value: j && j.kind !== 'district' ? j.name : null }, { label: 'District / ward', value: j && j.kind === 'district' ? j.name : null }];
    return '<nav class="cr-eup__crumb" aria-label="Civic geography" data-eup-crumb>' + crumbs.map(function (c) { return '<span data-eup-crumb-level="' + esc(c.label) + '"><small>' + esc(c.label) + '</small> ' + esc(c.value || '—') + '</span>'; }).join('<span aria-hidden="true">›</span>') + '</nav>';
  }
  function paneCivic() {
    var s = state('civic');
    var d = model.data.civic || {};
    var rows = function (k) { return d[k] && d[k].ok === true && Array.isArray(d[k][k]) ? d[k][k] : null; };
    var jur = rows('jurisdictions'), offices = rows('offices'), terms = rows('terms'), bills = rows('bills'), elections = rows('elections');
    function list(title, items, draw, err) {
      var r = reasonFor(err);
      return '<article class="cr-eup__card"><h3>' + esc(title) + '</h3>' + (r ? note(r.kind, r.text) : items === null ? note('empty', 'Not loaded for this selection.') : items.length ? '<ul class="cr-eup__list">' + items.map(draw).join('') + '</ul>' : note('empty', 'The Worker returned 0 ' + title.toLowerCase() + ' for this selection; coverage may be absent, not zero.')) + '</article>';
    }
    return civicCrumb() + (s ? s : '<div class="cr-eup__grid">' +
      list('Jurisdictions', jur, function (j) { return '<li><button type="button" class="cr-eup__link" data-eup-jurisdiction="' + esc(j.id) + '" data-eup-jurisdiction-name="' + esc(j.name) + '" data-eup-jurisdiction-kind="' + esc(j.kind || '') + '">' + esc(j.name) + '</button> <small>' + esc(j.kind || '') + '</small>' + cardMeta(j.provenance) + '</li>'; }, d.jurisdictionsError) +
      list('Offices', offices, function (o) { return '<li><button type="button" class="cr-eup__link" data-eup-office="' + esc(o.id) + '">' + esc(o.title || o.name) + '</button>' + (o.vacant ? ' <span class="cr-eup__chip cr-eup__chip--held">vacant</span>' : '') + cardMeta(o.provenance) + '</li>'; }, d.officesError) +
      list('Terms', terms, function (t) { return '<li>' + esc(t.person || t.person_name || 'person') + ' · ' + esc(when(t.start_at)) + ' → ' + esc(t.end_at ? when(t.end_at) : 'current') + (t.certification ? ' · ' + esc(t.certification) : '') + cardMeta(t.provenance) + '</li>'; }, d.termsError) +
      list('Legislation', bills, function (b) { return '<li><strong>' + esc(b.identifier || b.id) + '</strong> ' + esc(b.title || '') + ' · ' + esc(b.stage || b.status || 'stage unknown') + (b.enacted ? ' · enacted' : ' · proposed, not law') + (b.text_version ? ' · text ' + esc(b.text_version) : '') + cardMeta(b.provenance) + '</li>'; }, d.billsError) +
      list('Elections', elections, function (e) { return '<li>' + esc(e.contest || e.title || e.id) + ' · ' + esc(e.date ? when(e.date) : 'date unknown') + ' · ' + esc(e.certified ? 'certified' : 'not certified') + cardMeta(e.provenance) + '</li>'; }, d.electionsError) +
      '</div>');
  }
  function paneCompanies() {
    var d = model.data.companies || {}, s = state('companies');
    var results = d.search && d.search.ok === true && Array.isArray(d.search.results) ? d.search.results : null;
    var c = model.company;
    var head = '<form class="cr-eup__search" data-eup-company-form><label><span class="sr-only">Company search</span><input type="search" name="q" value="' + esc(model.query) + '" placeholder="Search companies (CIK, LEI or name)" autocomplete="off" data-eup-company-q></label><button type="button" class="cr-btn" data-eup-company-search>Search</button></form>';
    if (s) return head + s;
    var body = results === null ? note('empty', 'Search to list companies. Nothing is fetched until you do.') : results.length ? '<ul class="cr-eup__list">' + results.map(function (r) { return '<li><button type="button" class="cr-eup__link" data-eup-company="' + esc(r.id) + '">' + esc(r.name || r.id) + '</button> <small>' + (Array.isArray(r.identifiers) ? r.identifiers.map(function (i) { return esc(i.scheme + ' ' + i.value); }).join(' · ') : '') + '</small></li>'; }).join('') + '</ul>' : note('empty', 'The Worker returned 0 results for “' + model.query + '”.');
    var detail = '';
    if (c && c.ok === true && c.entity) {
      var quote = c.quote && typeof c.quote === 'object' && c.quote.licensed === true && c.quote.value != null ? c.quote : null;
      detail = '<article class="cr-eup__card" data-eup-company-detail><h3>' + esc(c.entity.name || c.entity.id) + '</h3>' +
        '<p><small>' + (Array.isArray(c.identifiers) ? c.identifiers.map(function (i) { return esc(i.scheme + ' ' + i.value); }).join(' · ') : 'no identifiers') + '</small></p>' +
        '<h4>Locations</h4>' + (Array.isArray(c.locations) && c.locations.length ? '<ul class="cr-eup__list">' + c.locations.map(function (l) { return '<li><strong>' + esc(l.kind) + '</strong>' + (l.geocode ? ' · ' + esc(l.geocode.lat) + ', ' + esc(l.geocode.lon) + ' (' + esc(l.geocode.precision || 'precision unknown') + ')' : ' · no coordinates') + cardMeta(l.provenance) + '</li>'; }).join('') + '</ul>' : note('empty', 'No sourced locations. A headquarters is not inferred from an exchange or a mailing address.')) +
        '<h4>Facts</h4>' + (Array.isArray(c.facts) && c.facts.length ? '<ul class="cr-eup__list">' + c.facts.map(function (f) { return '<li>' + esc(f.concept) + ' · ' + esc(f.period) + ' · ' + esc(f.value) + ' ' + esc(f.unit) + cardMeta(f.provenance) + '</li>'; }).join('') + '</ul>' : note('empty', 'No filings or fundamentals returned.')) +
        '<h4>Federal awards</h4>' + (Array.isArray(c.awards) && c.awards.length ? '<ul class="cr-eup__list">' + c.awards.map(function (a) { return '<li>' + esc(a.id || a.award_id) + ' · ' + esc(a.agency || '') + ' · ' + esc(a.amount != null ? a.amount + ' ' + (a.currency || '') : 'amount unknown') + ' · place of performance ' + esc(a.place_of_performance || 'unknown') + cardMeta(a.provenance) + '</li>'; }).join('') + '</ul>' : note('empty', 'No reported federal awards. Nearby awards are not attributed to any official.')) +
        '<h4>Market quote</h4>' + (quote ? '<p data-eup-quote>' + esc(quote.value) + ' ' + esc(quote.currency || '') + ' · ' + esc(quote.venue || 'venue unknown') + ' · ' + esc(quote.delayed ? 'delayed' : 'as labelled by provider') + ' · ' + esc(when(quote.as_of)) + '</p>' : note('not_configured', 'No licensed quote. A price is shown only when a licensed provider quote succeeded for this instrument.')) +
        '</article>';
    }
    return head + body + detail;
  }
  function paneSources() {
    var s = state('sources'); if (s) return s;
    var d = model.data.sources || {};
    var sources = d.list && d.list.ok === true && Array.isArray(d.list.sources) ? d.list.sources : null;
    var review = d.review && d.review.ok === true && Array.isArray(d.review.items) ? d.review.items : null;
    var rr = reasonFor(d.reviewError);
    return '<div class="cr-eup__grid">' +
      '<article class="cr-eup__card cr-eup__card--wide"><h3>Connectors</h3>' + (sources === null ? note('error', 'The source list answered without ok:true.') : sources.length ? '<ul class="cr-eup__list">' + sources.map(function (x) {
        var o = model.outcomes[x.id];
        return '<li data-eup-source="' + esc(x.id) + '"><strong>' + esc(x.label || x.id) + '</strong> <small>' + esc(x.provider || '') + '</small> ' +
          '<span class="cr-eup__chip cr-eup__chip--' + (x.configured ? 'current' : 'not_configured') + '">' + (x.configured ? 'configured' : 'not configured') + '</span> ' +
          '<span class="cr-eup__chip cr-eup__chip--' + esc(x.access || 'unknown') + '">access ' + esc(x.access || 'unknown') + '</span> ' +
          '<span class="cr-eup__chip cr-eup__chip--' + esc(x.availability || 'unknown') + '">' + esc(x.availability || 'unknown') + '</span>' +
          '<br><small>last attempt ' + esc(when(x.last_attempt_at)) + ' · last success ' + esc(when(x.last_success_at)) + ' · records ' + esc(count(x.records)) + ' · unresolved ' + esc(count(x.unresolved)) + ' · next run ' + esc(when(x.next_run_at)) + ' · quota resets ' + esc(when(x.quota_reset_at)) + ' · rights ' + esc(x.rights || 'unknown') + (x.url ? ' · <a href="' + esc(x.url) + '" rel="noopener" target="_blank">source</a>' : '') + '</small>' +
          '<div class="cr-eup__actions"><button type="button" class="cr-btn" data-eup-source-action="refresh" data-eup-source-id="' + esc(x.id) + '"' + (o && o.kind === 'pending' ? ' disabled' : '') + '>Refresh (bounded)</button><button type="button" class="cr-btn" data-eup-source-action="pause" data-eup-source-id="' + esc(x.id) + '"' + (o && o.kind === 'pending' ? ' disabled' : '') + '>Pause</button></div>' +
          (o ? note(o.kind, o.text) : '') + '</li>';
      }).join('') + '</ul>' : note('empty', 'The Worker returned 0 connectors.')) + '</article>' +
      '<article class="cr-eup__card"><h3>Review queue</h3>' + (rr ? note(rr.kind, rr.text) : review === null ? note('empty', 'Not loaded.') : review.length ? '<ul class="cr-eup__list">' + review.map(function (i) { return '<li>' + esc(i.kind || 'item') + ' · ' + esc(i.summary || i.id) + cardMeta(i.provenance) + '</li>'; }).join('') + '</ul>' : note('empty', 'The review queue returned 0 items.')) + '</article>' +
      '</div>';
  }
  var PANES = { overview: paneOverview, league: paneLeague, civic: paneCivic, companies: paneCompanies, sources: paneSources };

  /* ---------- bind ---------- */
  function bind(root, opts) {
    opts = opts || {};
    var host = root && root.querySelector('[data-eup]');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = 'true';
    var request = makeRequester(opts);
    var status = host.querySelector('[data-eup-status]'), pane = host.querySelector('[data-eup-pane]'), tabs = host.querySelector('[data-eup-tabs]'), geoText = host.querySelector('[data-eup-geo]'), globeHost = host.querySelector('[data-eup-globe]');
    var globe = null, denied = false, myEpoch = epoch;
    var ctl = { host: host, request: request, globe: null, invalidate: invalidate, destroyed: false };
    bound = ctl;
    function say(t) { if (status) status.textContent = t || ''; }
    function reduced() { try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
    function alive() { return !ctl.destroyed && host.isConnected !== false && myEpoch === epoch && !denied; }
    function drawPane() {
      if (!pane) return;
      var focused = document.activeElement, keep = focused && focused.getAttribute ? focused.getAttribute('data-eup-focus') : null, caret = null;
      try { if (keep && typeof focused.selectionStart === 'number') caret = [focused.selectionStart, focused.selectionEnd]; } catch (e) { caret = null; }
      pane.setAttribute('aria-labelledby', 'eupTab-' + model.section);
      pane.innerHTML = denied ? note('denied', reasonFor({ status: 403 }).text) : (PANES[model.section] || paneOverview)();
      wirePane();
      if (keep) {
        var again = pane.querySelector('[data-eup-focus="' + keep + '"]');
        /* a policy command replaces its own button (Enable becomes Drain): focus stays on that unit, not on the page top */
        if (!again && keep.indexOf('policy:') === 0) again = pane.querySelector('[data-eup-focus="policy:' + keep.split(':')[1] + '"]');
        if (again && again.focus) { again.focus(); if (caret && again.setSelectionRange) { try { again.setSelectionRange(caret[0], caret[1]); } catch (e) {} } }
      }
    }
    function drawTabs() {
      if (!tabs) return;
      tabs.querySelectorAll('[data-eup-tab]').forEach(function (b) { var on = b.getAttribute('data-eup-tab') === model.section; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.setAttribute('tabindex', on ? '0' : '-1'); });
    }
    function drawGeo() { if (geoText) geoText.textContent = model.geo.country ? 'Selected: ' + model.geo.country + (model.geo.state ? ' › ' + model.geo.state : '') + '. Civic League follows this selection.' : 'No geography selected. Tap a country on the globe, or a state inside it.'; }
    /* an answer is committed only if the workspace is still the same one that asked */
    function settle(section, key, p, apply) {
      model.loading[section] = true; drawPane();
      return p.then(function (data) {
        if (!alive() || p.epoch !== epoch) return;
        if (data && data.ok !== true && data.reason) throw Object.assign(new Error(data.error || data.reason), { status: 503, detail: data });
        apply(data);
      }).catch(function (err) {
        if (!alive() || p.epoch !== epoch) return;
        if (err && err.status === 403) { denied = true; resetModel(); say(reasonFor(err).text); drawPane(); return; }
        if (err && err.status === 401) { conceal('Signed out. Sign in again to open E=Up.'); model.errors[section] = err; return; }
        if (key) { model.data[section] = model.data[section] || {}; model.data[section][key + 'Error'] = err; } else model.errors[section] = err;
      }).then(function () { if (!alive()) return; model.loading[section] = false; drawPane(); });
    }
    function load(section) {
      if (!alive()) return Promise.resolve();
      delete model.errors[section];
      say('Reading ' + section + '…');
      var done = function () { if (alive()) say('E=Up · ' + (SECTIONS.filter(function (s) { return s.id === section; })[0] || {}).label + ' · read ' + when(new Date().toISOString()) + '. No changes were made.'); };
      if (section === 'overview') return settle('overview', null, request('/v1/eup/overview'), function (d) { model.data.overview = d; }).then(function () {
        /* module policy is read after the overview has settled, and also when the overview failed (but not after a 401 or a 403) */
        var e = model.errors.overview;
        if (!alive() || (e && reasonFor(e).kind === 'signed_out')) return;
        return loadPolicy();
      }).then(done);
      if (section === 'league') {
        model.data.league = model.data.league || {};
        return Promise.all([
          settle('league', 'campaigns', request('/v1/eup/league/campaigns'), function (d) { model.data.league.campaigns = d; }),
          settle('league', 'applications', request('/v1/eup/league/applications'), function (d) { model.data.league.applications = d; }),
          settle('league', 'proofs', request('/v1/eup/league/proofs'), function (d) { model.data.league.proofs = d; })
        ]).then(done);
      }
      if (section === 'civic') return loadCivic().then(done);
      if (section === 'companies') { drawPane(); done(); return Promise.resolve(); }
      if (section === 'sources') {
        model.data.sources = model.data.sources || {};
        return Promise.all([
          settle('sources', 'list', request('/v1/eup/sources'), function (d) { model.data.sources.list = d; }),
          settle('sources', 'review', request('/v1/eup/sources/review'), function (d) { model.data.sources.review = d; })
        ]).then(done);
      }
      return Promise.resolve();
    }
    function loadCivic() {
      model.data.civic = model.data.civic || {};
      var c = model.data.civic, j = model.civic.jurisdiction;
      var parent = j ? j.id : 'none';
      var reads = [settle('civic', 'jurisdictions', request('/v1/eup/civic/jurisdictions?parent=' + encodeURIComponent(parent)), function (d) { c.jurisdictions = d; })];
      if (j) {
        var q = '?jurisdiction=' + encodeURIComponent(j.id);
        reads.push(settle('civic', 'offices', request('/v1/eup/civic/offices' + q), function (d) { c.offices = d; }));
        reads.push(settle('civic', 'bills', request('/v1/eup/civic/bills' + q), function (d) { c.bills = d; }));
        reads.push(settle('civic', 'elections', request('/v1/eup/civic/elections' + q), function (d) { c.elections = d; }));
      } else { c.offices = null; c.bills = null; c.elections = null; c.terms = null; }
      if (model.civic.office) reads.push(settle('civic', 'terms', request('/v1/eup/civic/terms?office=' + encodeURIComponent(model.civic.office)), function (d) { c.terms = d; }));
      return Promise.all(reads);
    }
    function select(section) {
      if (!SECTIONS.some(function (s) { return s.id === section; })) return;
      model.section = section; drawTabs(); drawPane();
      var tab = tabs && tabs.querySelector('[data-eup-tab="' + section + '"]'); if (tab && tab.focus) tab.focus();
      if (!model.data[section] && !model.errors[section]) load(section); else if (section === 'overview' || section === 'sources' || section === 'league' || section === 'civic') load(section);
    }
    function conceal(reason) {
      request.abortAll(); resetModel(); denied = false;
      if (pane) pane.innerHTML = note('signed_out', reason);
      say(reason);
    }
    function invalidate(reason) { epoch += 1; conceal(reason || 'Account changed. Reopen E=Up to verify access again.'); }
    /* ----- module policy: read, command, read-back ----- */
    /* 403 and 401 end the workspace whoever asked. True when the answer was one of them. */
    function concealed(err) {
      if (err && err.status === 403) { denied = true; resetModel(); say(reasonFor(err).text); drawPane(); return true; }
      if (err && reasonFor(err).kind === 'signed_out') { conceal('Signed out. Sign in again to open E=Up.'); model.errors.overview = err; return true; }
      return false;
    }
    function policyName(sent) {
      var unit = POLICY_UNITS.filter(function (u) { return u.id === sent.unit; })[0], acts = { install: 'Install', enabled: 'Enable', draining: 'Drain', disabled: 'Disable' };
      return (acts[sent.verb] || sent.verb) + ' ' + (unit ? unit.label : sent.unit);
    }
    /* After a successful read: an outcome that was unknown is looked up by its key in the returned command log.
       Found → it was recorded (and was not resent). Absent → the same key may be sent again. */
    function reconcile(d) {
      var said = null, log = Array.isArray(d.commands) ? d.commands : [], at = when(model.policy.readAt);
      POLICY_UNITS.forEach(function (u) {
        var slot = 'policy:' + u.id, o = model.outcomes[slot];
        if (!o || o.kind !== 'unknown' || !o.command) return;
        var hit = log.filter(function (c) { return c && c.idempotency_key === o.command.key; })[0];
        var pol = hit && hit.receipt && hit.receipt.policy;
        if (hit) model.outcomes[slot] = { kind: 'done', text: policyName(o.command) + ' was recorded: its key is in the command log read ' + at + (pol && typeof pol.state === 'string' ? ' (state ' + pol.state + ', rev ' + pol.revision + ')' : '') + '. It was not resent.' };
        else model.outcomes[slot] = { kind: 'unknown', command: o.command, resend: true, text: policyName(o.command) + ': the outcome is unknown and it was not resent. Its key is not in the command log read ' + at + '. Send the same command again, or decide again from the state shown here.' };
        said = model.outcomes[slot].text;
      });
      return said;
    }
    function controlReadable(d) {
      if (!d || d.ok !== true || !Array.isArray(d.modules)) return false;
      return POLICY_UNITS.every(function (u) { return d.modules.filter(function (m) { return m && m.moduleId === u.id; }).length === 1; });
    }
    function loadPolicy(announce) {
      if (!alive()) return Promise.resolve();
      var P = model.policy, stop = false, mine = (P.seq += 1);
      /* a read that was overtaken by a newer one, or whose model was cleared, commits nothing */
      function stale() { return !alive() || p.epoch !== epoch || P !== model.policy || mine !== P.seq; }
      P.loading = true; drawPane();
      var p = request('/v1/eup/modules');
      return p.then(function (d) {
        if (stale()) { stop = true; return; }
        if (d && d.ok !== true && d.reason) throw Object.assign(new Error(d.error || d.reason), { status: 503, detail: d });
        if (!controlReadable(d)) throw Object.assign(new Error('unreadable module policy'), { malformed: true });
        P.control = d; P.error = null; P.readAt = new Date().toISOString();
        var said = reconcile(d);
        if (said) say(said); else if (announce) say('Module policy read ' + when(P.readAt) + '. No changes were made.');
      }).catch(function (err) {
        if (stop || stale()) { stop = true; return; }
        if (concealed(err)) { stop = true; return; }
        /* a failed read drops what was known: nothing remembered is shown as the current state */
        P.control = null; P.error = err;
        POLICY_UNITS.forEach(function (u) { var o = model.outcomes['policy:' + u.id]; if (o && o.kind === 'unknown' && o.command) model.outcomes['policy:' + u.id] = { kind: 'unknown', command: o.command, resend: false, text: policyName(o.command) + ': the outcome is unknown and it was not resent. The read-back failed; read module policy again before deciding.' }; });
        if (announce) say(policyReadFailure(err).text);
      }).then(function () {
        if (stop || stale()) return;
        P.loading = false; drawPane();
      });
    }
    /* One owner command on one unit. verb: install | enabled | draining | disabled. `again` resends the stored
       command with its stored key and body (never a new key, never a re-read revision). */
    function policyCommand(unit, verb, again) {
      if (!alive()) return;
      var P = model.policy, slot = 'policy:' + unit, prev = model.outcomes[slot], sent;
      if ((prev && prev.kind === 'pending') || P.loading) return;
      if (again) {
        if (!prev || !prev.resend || !prev.command) return;
        sent = prev.command;
      } else {
        var row = unitRow(unit), st = policyStateOf(row);
        if (!policyActions(st).some(function (a) { return a.verb === verb; })) return;
        var input = pane ? pane.querySelector('[data-eup-policy-reason="' + unit + '"]') : null;
        var reason = String(input ? input.value : (P.reasons[unit] || '')).trim();
        P.reasons[unit] = reason;
        var problem = reasonProblem(reason);
        if (problem) { model.outcomes[slot] = { kind: 'error', text: problem }; say(problem); drawPane(); var back = pane && pane.querySelector('[data-eup-policy-reason="' + unit + '"]'); if (back && back.focus) back.focus(); return; }
        var key; try { key = idempotencyKey(); } catch (e) { model.outcomes[slot] = { kind: 'error', text: e.message }; drawPane(); return; }
        sent = { unit: unit, verb: verb, key: key, body: verb === 'install' ? { idempotency_key: key, reason: reason } : { idempotency_key: key, expected_revision: row.revision, state: verb, reason: reason } };
      }
      var name = policyName(sent), stop = false;
      model.outcomes[slot] = { kind: 'pending', text: name + ': requested with key ' + sent.key.slice(0, 8) + '…' + (again ? ' (the same key again)' : '') };
      say(model.outcomes[slot].text); drawPane();
      var p = request('/v1/eup/modules/' + encodeURIComponent(unit) + '/' + (sent.verb === 'install' ? 'install' : 'state'), { method: 'POST', body: sent.body });
      p.then(function (d) {
        if (!alive() || p.epoch !== epoch || P !== model.policy) { stop = true; return; }
        if (d && d.ok !== true && d.reason) throw Object.assign(new Error(d.error || d.reason), { status: 503, detail: d });
        var pol = d && d.ok === true && d.receipt && d.receipt.policy;
        if (!pol || typeof pol.state !== 'string' || !revisionOk(pol.revision)) throw new Error('unreadable receipt');
        P.reasons[unit] = '';
        model.outcomes[slot] = { kind: 'done', text: name + ': recorded · state ' + pol.state + ' · rev ' + pol.revision + (d.receipt.changed === false ? ' · the state was already ' + pol.state + ', the revision did not move' : '') + ' · ' + when(d.receipt.recorded_at || new Date().toISOString()) + '. Read back below.' };
      }).catch(function (err) {
        if (stop || !alive() || p.epoch !== epoch || P !== model.policy) { stop = true; return; }
        if (concealed(err)) { stop = true; return; }
        var f = policyFailure(err);
        model.outcomes[slot] = { kind: f.kind, text: name + ': ' + f.text + (f.settled ? '' : ' Reading module policy back…'), command: f.settled && !f.again ? null : sent, resend: f.again };
      }).then(function () {
        if (stop || !alive() || P !== model.policy) return;
        say(model.outcomes[slot].text); drawPane();
        return loadPolicy();
      });
    }
    function command(sourceId, action) {
      if (!alive()) return;
      var key; try { key = idempotencyKey(); } catch (e) { model.outcomes[sourceId] = { kind: 'error', text: e.message }; drawPane(); return; }
      model.outcomes[sourceId] = { kind: 'pending', text: action + ' requested with key ' + key.slice(0, 8) + '…' }; drawPane();
      var p = request('/v1/eup/sources/' + encodeURIComponent(sourceId) + '/' + action, { method: 'POST', body: { idempotency_key: key } });
      p.then(function (d) {
        if (!alive() || p.epoch !== epoch) return;
        if (d && d.ok !== true && d.reason) throw Object.assign(new Error(d.error || d.reason), { status: 503, detail: d });
        model.outcomes[sourceId] = { kind: 'done', text: action + ' accepted' + (d && d.state ? ' · ' + d.state : '') + ' · ' + when(new Date().toISOString()) + '. Read back below.' };
      }).catch(function (err) {
        if (!alive() || p.epoch !== epoch) return;
        var r = reasonFor(err);
        model.outcomes[sourceId] = r.kind === 'timeout' ? { kind: 'unknown', text: 'The ' + action + ' request timed out: its outcome is unknown. It was not resent. Read back before deciding.' } : r;
      }).then(function () { if (!alive()) return; drawPane(); return load('sources'); });
    }
    function wirePane() {
      if (!pane) return;
      pane.querySelectorAll('[data-eup-jurisdiction]').forEach(function (b) { b.setAttribute('data-eup-focus', 'j-' + b.getAttribute('data-eup-jurisdiction')); b.onclick = function () { model.civic.jurisdiction = { id: b.getAttribute('data-eup-jurisdiction'), name: b.getAttribute('data-eup-jurisdiction-name'), kind: b.getAttribute('data-eup-jurisdiction-kind') }; model.civic.office = null; loadCivic(); }; });
      pane.querySelectorAll('[data-eup-office]').forEach(function (b) { b.setAttribute('data-eup-focus', 'o-' + b.getAttribute('data-eup-office')); b.onclick = function () { model.civic.office = b.getAttribute('data-eup-office'); loadCivic(); }; });
      pane.querySelectorAll('[data-eup-company]').forEach(function (b) { b.setAttribute('data-eup-focus', 'c-' + b.getAttribute('data-eup-company')); b.onclick = function () { var id = b.getAttribute('data-eup-company'); model.data.companies = model.data.companies || {}; settle('companies', 'detail', request('/v1/eup/companies/' + encodeURIComponent(id)), function (d) { model.company = d; }); }; });
      var form = pane.querySelector('[data-eup-company-form]'), q = pane.querySelector('[data-eup-company-q]'), go = pane.querySelector('[data-eup-company-search]');
      if (q) q.setAttribute('data-eup-focus', 'company-q');
      function search() { model.query = q ? String(q.value || '').trim().slice(0, 120) : ''; if (!model.query) return; model.data.companies = model.data.companies || {}; model.company = null; settle('companies', 'search', request('/v1/eup/companies/search?q=' + encodeURIComponent(model.query)), function (d) { model.data.companies.search = d; }); }
      if (go) go.onclick = search;
      if (form) form.onsubmit = function (e) { if (e && e.preventDefault) e.preventDefault(); search(); };
      pane.querySelectorAll('[data-eup-source-action]').forEach(function (b) { b.setAttribute('data-eup-focus', b.getAttribute('data-eup-source-action') + '-' + b.getAttribute('data-eup-source-id')); b.onclick = function () { command(b.getAttribute('data-eup-source-id'), b.getAttribute('data-eup-source-action')); }; });
      /* module policy: the reason being typed survives a redraw; a waiting button stays focusable and does nothing */
      pane.querySelectorAll('[data-eup-policy-reason]').forEach(function (i) { var u = i.getAttribute('data-eup-policy-reason'); i.oninput = function () { model.policy.reasons[u] = String(i.value || ''); }; });
      pane.querySelectorAll('[data-eup-policy-command]').forEach(function (b) { var v = b.getAttribute('data-eup-policy-command').split(':'); b.onclick = function () { policyCommand(v[0], v[1], false); }; });
      pane.querySelectorAll('[data-eup-policy-resend]').forEach(function (b) { b.onclick = function () { policyCommand(b.getAttribute('data-eup-policy-resend'), null, true); }; });
      pane.querySelectorAll('[data-eup-policy-reload]').forEach(function (b) { b.onclick = function () { if (!model.policy.loading) loadPolicy(true); }; });
    }
    if (tabs) {
      tabs.querySelectorAll('[data-eup-tab]').forEach(function (b) {
        b.onclick = function () { select(b.getAttribute('data-eup-tab')); };
        b.onkeydown = function (e) {
          var ids = SECTIONS.map(function (s) { return s.id; }), i = ids.indexOf(model.section);
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]); }
          if (e.key === 'Home') { e.preventDefault(); select(ids[0]); } if (e.key === 'End') { e.preventDefault(); select(ids[ids.length - 1]); }
        };
      });
    }
    /* one globe, mounted once; a tab switch redraws only the pane */
    if (globeHost && window.CR.analyticsGlobe && typeof window.CR.analyticsGlobe.mount === 'function') {
      globeHost.dataset.eupGlobeMounts = String(Number(globeHost.dataset.eupGlobeMounts || 0) + 1);
      try {
        globe = ctl.globe = window.CR.analyticsGlobe.mount(globeHost, {
          onSelect: function (next) {
            if (!alive()) return;
            model.geo = { country: next && next.country || null, state: next && next.state || null };
            model.civic = { jurisdiction: null, office: null, bill: null };
            if (globe) globe.select(model.geo, !reduced());
            drawGeo(); if (model.section === 'civic') loadCivic(); else if (model.section === 'overview') drawPane();
          }
        });
      } catch (e) { globe = null; if (globeHost) globeHost.textContent = 'The globe did not start. Every record is still in the cards.'; }
    } else if (globeHost) globeHost.textContent = 'Globe module not loaded. Every record is still in the cards.';
    drawTabs(); drawGeo();
    select(model.section);
  }
  function invalidate(reason) { if (bound) bound.invalidate(reason); else epoch += 1; }
  window.addEventListener('mcc:auth-changed', function () { invalidate(); });
  window.addEventListener('storage', function (e) { if (!e || e.key === null || e.key === 'mccdb_session') invalidate(); });
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) invalidate('Page restored. Reopen E=Up to verify access again.'); });

  window.CR.eup = { render: render, bind: bind, helpers: { when: when, freshnessLabel: freshnessLabel, provenanceLine: provenanceLine, reasonFor: reasonFor, makeRequester: makeRequester, policyStateOf: policyStateOf, policyActions: policyActions, reasonProblem: reasonProblem, policyFailure: policyFailure, POLICY_UNITS: POLICY_UNITS, SECTIONS: SECTIONS, DEADLINE_MS: DEADLINE_MS, model: function () { return model; }, epoch: function () { return epoch; }, resetModel: resetModel } };
})();
