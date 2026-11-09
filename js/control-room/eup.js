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
   loss (403) bump the epoch and clear every private pane synchronously. */
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
    if (['stale', 'partial', 'unavailable', 'corrected', 'held', 'paused', 'error', 'pending', 'unknown'].indexOf(s) >= 0) return s;
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
  var model = { section: 'overview', geo: { country: null, state: null }, data: {}, errors: {}, loading: {}, query: '', civic: { jurisdiction: null, office: null, bill: null }, company: null, outcomes: {} };
  function resetModel() { model.data = {}; model.errors = {}; model.loading = {}; model.civic = { jurisdiction: null, office: null, bill: null }; model.company = null; model.outcomes = {}; }

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
  function paneOverview() {
    var s = state('overview'); if (s) return s;
    var d = model.data.overview; if (!d || d.ok !== true) return note('error', 'The overview answered without ok:true; nothing is shown.');
    var mods = Array.isArray(d.modules) ? d.modules : [];
    var geo = d.geography && d.geography.selected;
    return '<div class="cr-eup__grid">' +
      '<article class="cr-eup__card"><h3>Modules</h3>' + (mods.length ? '<ul class="cr-eup__list">' + mods.map(function (m) { return '<li><strong>' + esc(m.label || m.id) + '</strong> <span class="cr-eup__chip cr-eup__chip--' + esc(m.state || 'unknown') + '">' + esc(m.state || 'unknown') + '</span>' + (m.detail ? '<br><small>' + esc(m.detail) + '</small>' : '') + '</li>'; }).join('') + '</ul>' : note('empty', 'The Worker returned no module records (0) at ' + when(new Date().toISOString()) + '.')) + '</article>' +
      '<article class="cr-eup__card"><h3>Geography</h3><p>' + esc(geo ? [geo.country, geo.state, geo.municipality].filter(Boolean).join(' › ') : 'None selected server-side.') + '</p><p class="cr-muted">Globe selection: ' + esc(model.geo.country ? model.geo.country + (model.geo.state ? ' › ' + model.geo.state : '') : 'none') + '</p></article>' +
      '<article class="cr-eup__card"><h3>Campaigns</h3><p>Drafts: ' + count(d.campaigns && d.campaigns.drafts) + ' · Released: ' + count(d.campaigns && d.campaigns.released) + '</p></article>' +
      '<article class="cr-eup__card"><h3>Queues</h3><p>Applications: ' + count(d.queues && d.queues.applications) + ' · Proofs: ' + count(d.queues && d.queues.proofs) + ' · Reviews: ' + count(d.queues && d.queues.reviews) + '</p></article>' +
      '<article class="cr-eup__card"><h3>Freshness</h3>' + (Array.isArray(d.freshness) && d.freshness.length ? '<ul class="cr-eup__list">' + d.freshness.map(function (f) { return '<li>' + esc(f.source) + ' ' + freshnessChip(f) + '<br><small>fetched ' + esc(when(f.fetched_at)) + ' · upstream updated ' + esc(when(f.upstream_updated_at)) + '</small></li>'; }).join('') + '</ul>' : note('empty', 'No freshness records returned.')) + '</article>' +
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
      var focused = document.activeElement, keep = focused && focused.getAttribute ? focused.getAttribute('data-eup-focus') : null;
      pane.setAttribute('aria-labelledby', 'eupTab-' + model.section);
      pane.innerHTML = denied ? note('denied', reasonFor({ status: 403 }).text) : (PANES[model.section] || paneOverview)();
      wirePane();
      if (keep) { var again = pane.querySelector('[data-eup-focus="' + keep + '"]'); if (again && again.focus) again.focus(); }
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
      if (section === 'overview') return settle('overview', null, request('/v1/eup/overview'), function (d) { model.data.overview = d; }).then(done);
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

  window.CR.eup = { render: render, bind: bind, helpers: { when: when, freshnessLabel: freshnessLabel, provenanceLine: provenanceLine, reasonFor: reasonFor, makeRequester: makeRequester, SECTIONS: SECTIONS, DEADLINE_MS: DEADLINE_MS, model: function () { return model; }, epoch: function () { return epoch; }, resetModel: resetModel } };
})();
