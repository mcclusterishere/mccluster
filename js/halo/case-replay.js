/* HALO CASE REPLAY: what was known about a dated case at a cutoff, and nothing that was learned later.

   A case (core/data/halo/cases/*.json, schema "halo-case/v1") is a list of EVIDENCE, each from one original source at one
   revision, and the STATEMENTS that evidence supports. This file answers one question about it:
   "standing at this instant, what could have been known?" It is pure: no network, no clock, no storage, no DOM.

   THREE TIMES, never merged (docs/control-plane/HALO-CASE-FUKUSHIMA-RENESAS.md):
     observed_at    when the thing happened or was measured (event time). May be null.
     published_at   when the source says it published: { value, precision: 'instant' | 'date', tz }.
     ingested_at    when McCluster stored it. null in a case file that has not been ingested.
   and the one this file computes from them:
     available_at   the earliest instant the evidence may be USED in a replay.
       - precision 'instant': the published instant.
       - precision 'date': the END of that publication day in the source's own zone (a notice that prints only
         "March 17, 2022" in Tokyo enters at 2022-03-17T15:00:00Z, which is midnight ending the 17th in Japan).
         Conservative on purpose: a replay never knows something earlier than the source can be shown to have said it.
       - retrospective: true (a current catalogue or page read long after the event, with no dated earlier release
         verified): the retrieval time. It informs today's reading and never an earlier cutoff.
   Moving the cutoff backwards can only remove evidence, statements and conclusions. It can never add one.

   EVIDENCE IDENTITY is (source, source_record_id, revision), plus content_sha256 where the bytes were captured. Two
   revisions of one record are two pieces of evidence; the later one never rewrites the earlier.

   A DECISION is 'proposed' unless the case carries an authorization that names a real recorded event (a decision id,
   an actor and a time from the canonical decision store). A status field that says "approved" is not an approval. */
(function (root) {
  'use strict';

  var ZONES = { 'Asia/Tokyo': 540, 'UTC': 0 };   /* minutes east of UTC; fixed-offset zones only, on purpose */
  var CLASSES = ['site_location', 'shaking_observed', 'shaking_modeled', 'halt_confirmed', 'restart_partial', 'forecast', 'forecast_missed', 'recovery_confirmed_by_operator', 'loss_reported', 'context'];
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
  var DATE = /^\d{4}-\d{2}-\d{2}$/;

  function instant(v) {
    if (typeof v !== 'string' || !INSTANT.test(v)) return null;
    var t = Date.parse(v);
    return isFinite(t) ? t : null;
  }
  /* the end of a local calendar day, as a UTC instant (ms): the following local midnight */
  function endOfLocalDay(date, tz) {
    if (typeof date !== 'string' || !DATE.test(date) || !Object.prototype.hasOwnProperty.call(ZONES, tz)) return null;
    var p = date.split('-').map(Number), t = Date.UTC(p[0], p[1] - 1, p[2] + 1, 0, 0, 0) - ZONES[tz] * 60000;
    /* a date that does not exist (2022-02-30) rolls over; refuse it instead of guessing */
    var back = new Date(t + ZONES[tz] * 60000 - 86400000);
    return back.getUTCFullYear() === p[0] && back.getUTCMonth() === p[1] - 1 && back.getUTCDate() === p[2] ? t : null;
  }
  /* The earliest instant a piece of evidence may be used (ms), or null when it cannot be placed at all. */
  function availableAt(e) {
    if (!e || typeof e !== 'object') return null;
    if (e.retrospective === true) return instant(e.retrieved_at);
    var p = e.published_at;
    if (!p || typeof p !== 'object') return null;
    if (p.precision === 'instant') return instant(p.value);
    if (p.precision === 'date') return endOfLocalDay(p.value, p.tz);
    return null;
  }
  function iso(t) { return t === null ? null : new Date(t).toISOString(); }
  function key(e) { return [e.source, e.source_record_id, e.revision].join('|'); }

  /* Everything wrong with a case file, as plain sentences. An empty list means the file can be replayed. */
  function validate(c) {
    var errors = [];
    if (!c || c.schema !== 'halo-case/v1') return ['schema must be halo-case/v1'];
    var sites = {}, seen = {}, ids = {};
    (c.sites || []).forEach(function (s) { if (!s || typeof s.id !== 'string') errors.push('a site has no id'); else sites[s.id] = true; });
    (c.evidence || []).forEach(function (e) {
      var name = e && e.id ? e.id : '(no id)';
      if (!e || typeof e.id !== 'string') { errors.push('evidence without an id'); return; }
      if (ids[e.id]) errors.push(name + ': duplicate evidence id'); ids[e.id] = true;
      ['source', 'source_record_id', 'url', 'publisher', 'retrieved_at', 'verified_by'].forEach(function (f) { if (typeof e[f] !== 'string' || !e[f]) errors.push(name + ': ' + f + ' is required'); });
      if (!(typeof e.revision === 'string' || typeof e.revision === 'number')) errors.push(name + ': revision is required');
      if (seen[key(e)]) errors.push(name + ': (source, record, revision) repeats ' + seen[key(e)]); seen[key(e)] = name;
      if (typeof e.url === 'string' && !/^https:\/\//.test(e.url)) errors.push(name + ': url must be the original https source');
      if (instant(e.retrieved_at) === null) errors.push(name + ': retrieved_at must be an instant');
      if (e.content_sha256 !== null && !(typeof e.content_sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.content_sha256))) errors.push(name + ': content_sha256 is 64 hex characters, or null when the bytes were not captured');
      if (e.content_sha256 === null && typeof e.content_hash_note !== 'string') errors.push(name + ': a missing content hash needs content_hash_note saying why');
      if (e.observed_at !== null && e.observed_at !== undefined && instant(e.observed_at) === null) errors.push(name + ': observed_at must be an instant or null');
      if (e.ingested_at !== null && e.ingested_at !== undefined && instant(e.ingested_at) === null) errors.push(name + ': ingested_at must be an instant or null');
      var at = availableAt(e);
      if (at === null) errors.push(name + ': cannot be placed in time (published_at with a precision and zone, or retrospective with retrieved_at)');
      else if (e.available_at !== iso(at)) errors.push(name + ': available_at ' + e.available_at + ' is not what the rule gives (' + iso(at) + ')');
      if (at !== null && instant(e.observed_at) !== null && instant(e.observed_at) > at) errors.push(name + ': observed after it became available');
      (e.statements || []).forEach(function (s) {
        var sn = name + '/' + (s && s.id ? s.id : '(no id)');
        if (!s || typeof s.id !== 'string') { errors.push(sn + ': statement without an id'); return; }
        if (CLASSES.indexOf(s['class']) < 0) errors.push(sn + ': unknown class ' + s['class']);
        if (s.site !== null && s.site !== undefined && !sites[s.site]) errors.push(sn + ': unknown site ' + s.site);
        if (typeof s.text !== 'string' || !s.text) errors.push(sn + ': text is required');
        if (s['class'] === 'forecast' && !(typeof s.forecast_for === 'string' && DATE.test(s.forecast_for))) errors.push(sn + ': a forecast names the date it is for');
        /* shaking at a facility may not be claimed from a map-wide value or a station that is not the facility's own */
        if ((s['class'] === 'shaking_observed' || s['class'] === 'shaking_modeled') && s.site && s.scope !== 'facility_instrument' && s.applies_to_site !== false) errors.push(sn + ': a regional, municipal or map-wide value is not a facility reading; set applies_to_site false or scope facility_instrument');
      });
    });
    var d = c.proposed_decision;
    if (d) {
      if (decisionStatus(c) !== 'approved' && d.status !== 'proposed') errors.push('proposed_decision.status is ' + d.status + ' without an authorization: only "proposed" is allowed');
      (d.evidence_ids || []).forEach(function (id) { if (!ids[id]) errors.push('proposed_decision cites unknown evidence ' + id); });
      if (!Array.isArray(d.options) || d.options.length < 2) errors.push('proposed_decision needs at least two options');
    }
    return errors;
  }

  /* 'approved' only when an authorization names the recorded event; anything else is 'proposed'. */
  function decisionStatus(c) {
    var a = c && c.proposed_decision && c.proposed_decision.authorization;
    var ok = a && typeof a === 'object' && a.store === 'ai_context.decisions' && typeof a.decision_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.decision_id)
      && typeof a.approved_by === 'string' && a.approved_by && instant(a.approved_at) !== null;
    return ok ? 'approved' : 'proposed';
  }

  var RANK = { unknown: 0, halted: 1, partial: 2, recovered_operator_confirmed: 3 };
  /* What is known at `cutoff` (an ISO instant). Returns the evidence usable by then, the statements they carry, a state
     per site with the evidence it rests on, the forecasts standing or settled, and what is withheld (a count only: the
     later evidence itself is not returned). */
  function asOf(c, cutoff) {
    var cut = instant(cutoff);
    if (cut === null) throw new Error('cutoff must be an ISO instant with a zone');
    var usable = [], withheld = 0;
    (c.evidence || []).forEach(function (e) { var at = availableAt(e); if (at !== null && at <= cut) usable.push({ e: e, at: at }); else withheld += 1; });
    usable.sort(function (a, b) { return a.at - b.at || (a.e.id < b.e.id ? -1 : 1); });
    var sites = {};
    (c.sites || []).forEach(function (s) { sites[s.id] = { id: s.id, name: s.name, state: 'unknown', state_since: null, state_basis: [], address: null, address_basis: null, forecasts: [], losses: [], shaking_at_facility: null }; });
    var statements = [], regional = [];
    usable.forEach(function (u) {
      (u.e.statements || []).forEach(function (s) {
        var row = { evidence_id: u.e.id, statement_id: s.id, 'class': s['class'], site: s.site || null, text: s.text, available_at: iso(u.at) };
        statements.push(row);
        var site = s.site ? sites[s.site] : null;
        if (s['class'] === 'shaking_observed' || s['class'] === 'shaking_modeled') {
          if (site && s.scope === 'facility_instrument') site.shaking_at_facility = { text: s.text, evidence_id: u.e.id };
          else regional.push(row);
          return;
        }
        if (!site) return;
        if (s['class'] === 'site_location') { site.address = s.address || s.text; site.address_basis = u.e.id; }
        var next = s['class'] === 'halt_confirmed' ? 'halted' : s['class'] === 'restart_partial' ? 'partial' : s['class'] === 'recovery_confirmed_by_operator' ? 'recovered_operator_confirmed' : null;
        /* a state only moves forward on the operator's own confirmation; a forecast never moves it */
        if (next && RANK[next] >= RANK[site.state]) { if (next !== site.state) { site.state = next; site.state_since = iso(u.at); site.state_basis = []; } site.state_basis.push(u.e.id); }
        if (s['class'] === 'forecast') site.forecasts.push({ statement_id: s.id, evidence_id: u.e.id, forecast_for: s.forecast_for, text: s.text, made_available_at: iso(u.at), outcome: 'open', outcome_basis: null });
        if (s['class'] === 'forecast_missed' || s['class'] === 'recovery_confirmed_by_operator') {
          site.forecasts.forEach(function (f) {
            if (f.outcome !== 'open' || f.evidence_id === u.e.id) return;
            if (s['class'] === 'forecast_missed' && s.settles === f.statement_id) { f.outcome = 'missed'; f.outcome_basis = u.e.id; }
            if (s['class'] === 'recovery_confirmed_by_operator' && s.settles === f.statement_id) { f.outcome = 'met'; f.outcome_basis = u.e.id; }
          });
        }
        if (s['class'] === 'loss_reported') site.losses.push({ text: s.text, evidence_id: u.e.id });
      });
    });
    return {
      case_id: c.id, cutoff: iso(cut),
      evidence: usable.map(function (u) { return { id: u.e.id, source: u.e.source, source_record_id: u.e.source_record_id, revision: u.e.revision, title: u.e.title, url: u.e.url, available_at: iso(u.at), observed_at: u.e.observed_at || null, published_at: u.e.published_at || null, ingested_at: u.e.ingested_at || null, content_sha256: u.e.content_sha256, retrospective: u.e.retrospective === true }; }),
      withheld: withheld,
      statements: statements,
      regional_shaking: regional,
      sites: Object.keys(sites).map(function (k) { return sites[k]; }),
      decision: c.proposed_decision ? { status: decisionStatus(c), title: c.proposed_decision.title } : null
    };
  }

  root.HaloCase = { CLASSES: CLASSES.slice(), availableAt: function (e) { return iso(availableAt(e)); }, endOfLocalDay: function (d, tz) { return iso(endOfLocalDay(d, tz)); }, validate: validate, asOf: asOf, decisionStatus: decisionStatus, evidenceKey: key };
})(typeof window === 'undefined' ? globalThis : window);
