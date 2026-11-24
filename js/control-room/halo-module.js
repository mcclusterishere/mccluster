/* Control · Hitman's Halo: the module card and the direct Control entry (NAV leaf "#system:halo", mount point
   "haloModule").

   Hitman's Halo is the owner's real-world intelligence and decision workspace: World, Missions, People and
   Intelligence on the full-screen globe (action-globe.html?explore=1&halo=1). This file opens nothing new. It is the
   one place Control says what is true about the MODULE before the owner opens it, and it is drawn in two places from
   the same function:
     - Control → System → E=Up → Overview → Modules (js/control-room/eup.js calls card()), and
     - Control → System → Hitman's Halo (render / bind below).

   Three facts, never merged into one "on":
     access    who can open Halo today. The house-owner release guard on every Halo route decides; this card does not.
     policy    the persisted 'halo' policy unit from GET /v1/eup/halo or GET /v1/eup/modules: not in the store yet,
               not installed, disabled, enabled, draining, or unknown when the read failed. No Halo route reads the
               unit yet, so a state here never means "open" or "ready", and the card says so.
     backend   whether the Worker answered for the module at all, and which declared feeds lack what their route
               needs. An unreachable backend is said; it does not hide the card or the door.

   The door (the link to the Halo page) is always drawn for whoever can see this card, because that is the actual
   behaviour: the page and every feed re-check the house owner themselves. Nothing here is authorization, and a
   401 / 403 answer removes everything this file read.

   It creates no permission and stores nothing. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var API = 'https://api.mccluster.org';
  var HALO_PAGE = 'action-globe.html?explore=1&halo=1';
  var VIEWS = [
    { id: 'world', label: 'World', href: HALO_PAGE },
    { id: 'missions', label: 'Missions', href: 'action-globe.html?explore=1&halo=missions' },
    { id: 'people', label: 'People', href: 'action-globe.html?explore=1&halo=people' },
    { id: 'intel', label: 'Intelligence', href: 'action-globe.html?explore=1&halo=intel' }
  ];
  var PENDING_SQL = 'supabase/pending/eup_module_policy_halo_v1.sql';
  var DEADLINE_MS = 15000;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function page() { return (window.CR.workspaceCore && window.CR.workspaceCore.HALO_PAGE) || HALO_PAGE; }
  function when(iso) {
    if (!iso) return 'not recorded';
    var d = new Date(iso); if (isNaN(d.getTime())) return 'invalid time';
    try { return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toISOString(); }
  }
  function revisionOk(v) { return Number.isInteger(v) && v >= 0; }

  /* ---------- pure: what the three facts say ---------- */
  /* One of unregistered / not_installed / disabled / enabled / draining / unknown, from a module row of
     /v1/eup/modules or the policy block of /v1/eup/halo. Anything this code cannot read is unknown, never enabled. */
  function policyState(row) {
    if (!row || typeof row !== 'object') return 'unknown';
    if (row.status === 'unregistered' || row.registered === false) return 'unregistered';
    if (row.status && row.status !== 'available') return 'unknown';
    if (row.installed === false) return 'not_installed';
    if (row.installed === true && (row.state === 'enabled' || row.state === 'draining' || row.state === 'disabled') && revisionOk(row.revision)) return row.state;
    return 'unknown';
  }
  var POLICY_TEXT = { unregistered: 'not in the store yet', not_installed: 'not installed', disabled: 'disabled', enabled: 'enabled', draining: 'draining', unknown: 'unknown' };
  var NOT_ENFORCED = 'No Halo route reads this unit yet, so it does not open or close Halo.';
  function policyLine(st, row, reading) {
    if (reading) return 'Reading the policy unit…';
    if (st === 'unregistered') return 'The policy store does not know the Halo unit yet: ' + PENDING_SQL + ' is staged and not applied. It cannot be installed or enabled from Control until the owner promotes that file.';
    if (st === 'not_installed') return 'Registered, not installed. Install creates it disabled at revision 0 (Module policy, in E=Up › Overview). ' + NOT_ENFORCED;
    if (st === 'disabled') return 'Installed and disabled, rev ' + row.revision + '. ' + NOT_ENFORCED;
    if (st === 'draining') return 'Installed and draining, rev ' + row.revision + '. ' + NOT_ENFORCED;
    if (st === 'enabled') return 'Installed and enabled, rev ' + row.revision + '. Enabled is the recorded policy, not a readiness check. ' + NOT_ENFORCED;
    return 'The policy unit could not be read. Nothing is assumed and no command is offered here.';
  }
  /* The Worker's answer for the module, as one kind and one sentence.
     b: { loading, data, error } where data is the body of GET /v1/eup/halo. */
  function backendView(b) {
    if (!b || (!b.data && !b.error && !b.loading)) return { kind: 'unknown', text: 'The Halo backend has not been asked yet.' };
    if (b.loading && !b.data) return { kind: 'loading', text: 'Asking the Worker for the Halo module…' };
    var e = b.error;
    if (e) {
      var reason = e.detail && typeof e.detail.reason === 'string' ? e.detail.reason : '';
      if (e.timeout) return { kind: 'unavailable', text: 'The Worker did not answer for the Halo module in ' + Math.round((e.deadline || DEADLINE_MS) / 1000) + 's. Backend state is unknown.' };
      if (e.status === 404) return { kind: 'not_deployed', text: 'The deployed Worker does not serve the Halo module section yet (404' + (reason ? ' ' + reason : '') + '). Module state is unknown; the Halo page itself is unchanged.' };
      if (e.status === 503) return { kind: 'unavailable', text: 'The Halo module backend is unavailable (503' + (reason ? ' ' + reason : '') + '). Backend state is unknown.' };
      if (e.malformed) return { kind: 'unavailable', text: 'The Worker’s answer for the Halo module was not readable. Backend state is unknown.' };
      return { kind: 'unavailable', text: 'The Halo module backend did not answer (' + (e.status ? 'HTTP ' + e.status : 'no connection') + '). Backend state is unknown.' };
    }
    var feeds = Array.isArray(b.data.feeds) ? b.data.feeds : [];
    var missing = feeds.filter(function (f) { return f && f.configured === false; });
    var unchecked = feeds.filter(function (f) { return f && f.configured !== true && f.configured !== false; });
    var text = 'The Worker answered ' + when(b.data.generated_at) + '. ' + feeds.length + ' declared feeds: ' + (feeds.length - missing.length - unchecked.length) + ' configured, ' + missing.length + ' missing a key or binding' + (unchecked.length ? ', ' + unchecked.length + ' not checked here' : '') + '.';
    if (missing.length) text += ' Missing: ' + missing.map(function (f) { return f.label + ' (' + (Array.isArray(f.requires) && f.requires.length ? f.requires.join(' + ') : 'requirement not named') + ')'; }).join('; ') + '.';
    text += ' Configured is not a count: each feed reports what it holds inside Halo.';
    return { kind: missing.length ? 'partial' : 'answered', text: text, feeds: feeds };
  }
  function readable(d) {
    return !!d && d.ok === true && !!d.module && d.module.id === 'halo' && !!d.policy && typeof d.policy === 'object' && Array.isArray(d.feeds);
  }

  /* ---------- pure: the card ---------- */
  /* view: { policyRow, policyReading, backend: {loading,data,error}, moduleHref, policyHref }
     policyRow is null when the policy could not be read. Every line names its own state in words. */
  function card(view) {
    view = view || {};
    var row = view.policyRow || null, st = view.policyReading && !row ? 'unknown' : policyState(row), bv = backendView(view.backend);
    var h = page();
    var links = VIEWS.map(function (v) { return '<a class="cr-btn' + (v.id === 'world' ? ' cr-btn--primary' : '') + '" href="' + esc(v.id === 'world' ? h : v.href) + '" data-halo-open="' + v.id + '">' + (v.id === 'world' ? 'Open Hitman’s Halo' : esc(v.label)) + '</a>'; }).join('');
    return '<article class="cr-eup__card cr-eup__card--wide cr-halo-module" data-halo-module data-halo-policy="' + esc(st) + '" data-halo-backend="' + esc(bv.kind) + '">' +
      '<div class="cr-eup__unit-head"><h3>Hitman’s Halo</h3> <span class="cr-eup__chip" data-halo-audience>owner only</span></div>' +
      '<p class="cr-eup__unit-line">The real-world intelligence and decision workspace: what happened, what it affects, what the system recommends and why. Four screens on the full-screen globe: World, Missions, People, Intelligence.</p>' +
      '<ul class="cr-eup__list cr-halo-module__facts">' +
      '<li data-halo-fact="access"><strong>Access</strong> <span class="cr-eup__chip cr-eup__chip--current">house owner</span><br><small>Decided by the release guard on every Halo route and each route’s own owner check, not by this card. Guests and members are refused before any feed is read.</small></li>' +
      '<li data-halo-fact="policy"><strong>Module policy</strong> <span class="cr-eup__chip cr-eup__chip--' + esc(st === 'unregistered' ? 'not_installed' : st) + '" data-halo-policy-chip="' + esc(st) + '">' + esc(view.policyReading && !row ? 'reading' : POLICY_TEXT[st]) + '</span><br><small data-halo-policy-line>' + esc(policyLine(st, row, view.policyReading && !row)) + '</small></li>' +
      '<li data-halo-fact="backend"><strong>Backend</strong> <span class="cr-eup__chip cr-eup__chip--' + esc(bv.kind === 'answered' ? 'current' : bv.kind === 'partial' ? 'partial' : bv.kind === 'loading' || bv.kind === 'unknown' ? 'unknown' : 'unavailable') + '" data-halo-backend-chip="' + esc(bv.kind) + '">' + esc({ answered: 'answered', partial: 'answered, feeds missing keys', loading: 'checking', unknown: 'not asked', not_deployed: 'not deployed', unavailable: 'unavailable' }[bv.kind]) + '</span><br><small data-halo-backend-line>' + esc(bv.text) + '</small></li>' +
      '</ul>' +
      '<div class="cr-eup__actions cr-halo-module__doors" data-halo-doors>' + links + '</div>' +
      '<p class="cr-eup__unit-line" data-halo-door-note>The door is always here for the owner: Halo and each of its feeds check the house owner again, and show their own state (loading, fresh, stale, empty, unavailable) inside.</p>' +
      ((view.moduleHref || view.policyHref) ? '<div class="cr-eup__actions">' + (view.moduleHref ? '<a class="cr-btn" href="' + esc(view.moduleHref) + '" data-halo-module-link>Module page</a>' : '') + (view.policyHref ? '<a class="cr-btn" href="' + esc(view.policyHref) + '" data-halo-policy-link>Module policy (E=Up › Overview)</a>' : '') + '</div>' : '') +
      '</article>';
  }
  /* The declared feeds and what each route needs. Configuration only: no counts are known outside Halo. */
  function feedTable(feeds) {
    if (!Array.isArray(feeds) || !feeds.length) return '';
    return '<article class="cr-eup__card cr-eup__card--wide" data-halo-feeds><h3>Declared feeds</h3>' +
      '<p class="cr-eup__unit-line">Every feed the Halo view declares, whether or not it draws. This is configuration, not data: returned and shown counts, provider time and stale or failed states are reported by each feed inside Halo.</p>' +
      '<ul class="cr-eup__list">' + feeds.map(function (f) {
        var c = f.configured === true ? ['current', 'configured'] : f.configured === false ? ['not_configured', 'missing ' + (Array.isArray(f.requires) && f.requires.length ? f.requires.join(' + ') : 'a requirement')] : ['unknown', 'not checked here'];
        return '<li data-halo-feed="' + esc(f.id) + '" data-halo-feed-configured="' + esc(String(f.configured)) + '"><strong>' + esc(f.label || f.id) + '</strong> <small>' + esc(f.group || '') + '</small> <span class="cr-eup__chip cr-eup__chip--' + c[0] + '">' + esc(c[1]) + '</span>' +
          '<br><small>' + esc(f.route ? 'Route ' + f.route : 'Drawn by the globe itself, no Halo route') + (f.credit ? ' · ' + esc(f.credit) : '') + (f.needs_map ? ' · needs the map to show anything' : ' · lists without the map') + '</small></li>';
      }).join('') + '</ul></article>';
  }

  /* ---------- the Control entry: one bounded owner read, cleared on any account change ---------- */
  var model = { loading: false, data: null, error: null, denied: null }, epoch = 0, bound = null;
  function reset() { model = { loading: false, data: null, error: null, denied: null }; }
  function body() {
    if (model.denied) return '<p class="cr-eup__note cr-eup__note--' + esc(model.denied.kind) + '" data-halo-note="' + esc(model.denied.kind) + '">' + esc(model.denied.text) + '</p>';
    return '<div class="cr-eup__grid">' + card({ policyRow: model.data ? model.data.policy : null, policyReading: model.loading, backend: model, policyHref: 'control.html#system:eup' }) + (model.data ? feedTable(model.data.feeds) : '') + '</div>' +
      '<div class="cr-eup__actions"><button type="button" class="cr-btn" data-halo-reload' + (model.loading ? ' aria-disabled="true"' : '') + '>Read the Halo module again</button></div>';
  }
  function render() {
    return '<section class="cr-eup cr-halo-page" data-halo-page aria-labelledby="haloModuleTitle">' +
      '<header class="cr-eup__head"><div><p class="cr-eup__kicker">Products · admin only</p><h2 id="haloModuleTitle">Hitman’s Halo</h2>' +
      '<p class="cr-muted">The module’s state and its door. Halo itself opens on its own full-screen page; nothing here changes the public Globe.</p></div></header>' +
      '<div class="cr-eup__status" role="status" aria-live="polite" data-halo-status>Opening Hitman’s Halo…</div>' +
      '<div data-halo-body>' + body() + '</div></section>';
  }
  function fallbackRequest(path, opts) {
    var tok = window.MCC_SUPA && window.MCC_SUPA.token ? window.MCC_SUPA.token() : Promise.resolve(null);
    return tok.then(function (t) {
      if (!t) throw Object.assign(new Error('signed out'), { status: 401 });
      return fetch(API + path, { method: 'GET', headers: { authorization: 'Bearer ' + t }, cache: 'no-store', signal: opts && opts.signal })
        .then(function (r) { return r.text().then(function (text) { var data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (!r.ok) { var err = new Error('HTTP ' + r.status); err.status = r.status; err.detail = data; throw err; } return data; }); });
    });
  }
  function bind(root, opts) {
    opts = opts || {};
    var host = root && root.querySelector('[data-halo-page]');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = 'true';
    var request = typeof opts.request === 'function' ? opts.request : fallbackRequest;
    var deadline = opts.deadlineMs > 0 ? opts.deadlineMs : DEADLINE_MS;
    var status = host.querySelector('[data-halo-status]'), pane = host.querySelector('[data-halo-body]');
    var ctl = { destroyed: false, epoch: (epoch += 1) };
    bound = ctl; reset();
    function alive() { return !ctl.destroyed && ctl.epoch === epoch && host.isConnected !== false; }
    function say(t) { if (status) status.textContent = t || ''; }
    function draw() {
      if (!pane) return;
      pane.innerHTML = body();
      var again = pane.querySelector('[data-halo-reload]');
      if (again) again.onclick = function () { if (!model.loading) load(); };
    }
    function load() {
      if (!alive()) return Promise.resolve();
      model.loading = true; model.error = null; draw(); say('Reading the Halo module…');
      var ac = typeof AbortController === 'function' ? new AbortController() : null, timedOut = false, timer;
      var p = new Promise(function (resolve, reject) {
        timer = setTimeout(function () { timedOut = true; if (ac) { try { ac.abort(); } catch (e) {} } reject(Object.assign(new Error('deadline'), { timeout: true, deadline: deadline })); }, deadline);
        Promise.resolve().then(function () { return request('/v1/eup/halo', { signal: ac ? ac.signal : undefined }); }).then(function (d) { if (!timedOut) resolve(d); }, function (e) { if (!timedOut) reject(e); });
      });
      return p.then(function (d) {
        clearTimeout(timer); if (!alive()) return;
        if (!readable(d)) throw Object.assign(new Error('unreadable Halo module answer'), { malformed: true });
        model.data = d; model.error = null;
        say('Hitman’s Halo · module read ' + when(new Date().toISOString()) + '. No changes were made.');
      }).catch(function (err) {
        clearTimeout(timer); if (!alive()) return;
        /* an answer that says this account may not read the module removes everything that was read */
        if (err && (err.status === 401 || /signed out/i.test(err.message || ''))) { reset(); model.denied = { kind: 'signed_out', text: 'Signed out. Sign in again to see the Halo module.' }; say(model.denied.text); return; }
        if (err && err.status === 403) { reset(); model.denied = { kind: 'denied', text: 'House owner access required. Hitman’s Halo is admin-only; nothing is shown to other roles.' }; say(model.denied.text); return; }
        /* any other failure keeps the card and the door, and says the backend state is unknown; nothing remembered is shown as current */
        model.data = null; model.error = err; say(backendView(model).text);
      }).then(function () { if (!alive()) return; model.loading = false; draw(); });
    }
    ctl.invalidate = function (reason) { ctl.destroyed = true; reset(); model.denied = { kind: 'signed_out', text: reason || 'Account changed. Reopen Hitman’s Halo to verify access again.' }; if (pane) pane.innerHTML = body(); say(model.denied.text); };
    draw();
    return load();
  }
  function invalidate(reason) { epoch += 1; if (bound && bound.invalidate) bound.invalidate(reason); }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('mcc:auth-changed', function () { invalidate(); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted) invalidate('Page restored. Reopen Hitman’s Halo to verify access again.'); });
  }

  window.CR.haloModule = { render: render, bind: bind, card: card, feedTable: feedTable, helpers: { policyState: policyState, policyLine: policyLine, backendView: backendView, readable: readable, VIEWS: VIEWS, HALO_PAGE: HALO_PAGE, PENDING_SQL: PENDING_SQL, model: function () { return model; } } };
})();
