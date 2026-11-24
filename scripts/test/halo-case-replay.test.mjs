/* The Fukushima-oki / Renesas case (core/data/halo/cases/fukushima-oki-2022-renesas.json) and the replay that reads it
   (js/halo/case-replay.js). Nothing here touches the network or any store: the case file is the record of what was
   read from the original sources on 2026-11-24, with the hash of each page as served then.

   What is held:
     - event time, published time, ingested time and available time are separate, and available_at is the rule's
       answer (a date-only notice enters at the end of its publication day in Japan);
     - evidence is keyed by source, record and revision, with a content hash or a stated reason for none;
     - known site location, observed shaking, modeled shaking, confirmed halt, partial restart, forecast and
       operator-confirmed recovery are different classes and are never promoted into one another;
     - moving the cutoff backwards removes later evidence, statements and conclusions, and never adds one;
     - no facility shaking is claimed from a nearby station or a map-wide model value;
     - the decision is a proposal: it is not approved without an authorized, recorded event. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../../js/halo/case-replay.js');
const H = globalThis.HaloCase;
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const CASE = JSON.parse(read('core/data/halo/cases/fukushima-oki-2022-renesas.json'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const ev = (id) => CASE.evidence.find((e) => e.id === id);
const site = (r, id) => r.sites.find((s) => s.id === id);
const states = (r) => Object.fromEntries(r.sites.map((s) => [s.id.replace('renesas-', ''), s.state]));
const ids = (r) => r.evidence.map((e) => e.id);

test('the case file is valid, and every evidence item has its own identity, times and hash', () => {
  assert.deepEqual(H.validate(CASE), []);
  assert.equal(CASE.schema, 'halo-case/v1'); assert.equal(CASE.kind, 'historical_replay_exercise');
  const keys = CASE.evidence.map(H.evidenceKey);
  assert.equal(new Set(keys).size, keys.length, '(source, record, revision) is unique');
  for (const e of CASE.evidence) {
    assert.match(e.url, /^https:\/\/(www\.jma\.go\.jp|www\.data\.jma\.go\.jp|www\.renesas\.com|earthquake\.usgs\.gov)\//, e.id + ' links the original source');
    assert.equal(e.ingested_at, null, e.id + ': not ingested, and not pretended to be');
    assert.equal(e.available_at, H.availableAt(e), e.id + ': available_at is the rule\'s answer');
    if (e.content_sha256 === null) assert.ok(e.content_hash_note.length > 20, e.id + ' says why it has no hash'); else assert.match(e.content_sha256, /^[0-9a-f]{64}$/, e.id);
    assert.ok(e.verified_by.length > 10, e.id);
  }
  assert.equal(CASE.evidence.filter((e) => e.content_sha256).length, 8, 'eight pages were hashed as served');
  /* two revisions of one record are two pieces of evidence */
  assert.deepEqual(CASE.evidence.filter((e) => e.source === 'renesas-newsroom').map((e) => e.revision), ['1', '2', '3', '4']);
  assert.deepEqual(CASE.evidence.filter((e) => e.source === 'usgs-shakemap').map((e) => e.revision), ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(CASE.evidence.filter((e) => e.source === 'jma-press').map((e) => e.revision), ['1', '2']);
});

test('the dated sources: the event-day JMA bulletin and the Renesas notices of March 17, 18, 23 and 26, 2022', () => {
  assert.equal(ev('jma-press-20220317').published_at.value, '2022-03-17');
  assert.deepEqual(['1', '2', '3', '4'].map((n) => ev('renesas-notice-' + n).printed_date), ['March 17, 2022', 'March 18, 2022', 'March 23, 2022', 'March 26, 2022']);
  assert.deepEqual(['1', '2', '3', '4'].map((n) => ev('renesas-notice-' + n).published_at), ['2022-03-17', '2022-03-18', '2022-03-23', '2022-03-26'].map((value) => ({ value, precision: 'date', tz: 'Asia/Tokyo' })));
});

test('three times are kept apart, and a date-only notice enters at the end of its local publication day', () => {
  assert.equal(H.endOfLocalDay('2022-03-17', 'Asia/Tokyo'), '2022-03-17T15:00:00.000Z', 'midnight ending the 17th in Japan');
  assert.equal(H.endOfLocalDay('2022-03-17', 'UTC'), '2022-03-18T00:00:00.000Z');
  assert.equal(H.endOfLocalDay('2022-02-30', 'Asia/Tokyo'), null, 'a date that does not exist is refused');
  assert.equal(H.endOfLocalDay('2022-03-17', 'America/New_York'), null, 'an unknown zone is refused, not assumed');
  const n1 = ev('renesas-notice-1');
  assert.equal(n1.available_at, '2022-03-17T15:00:00.000Z');
  assert.equal(n1.publisher_metadata_time, '2022-03-17T11:46:33+09:00', 'the page metadata is recorded');
  assert.ok(Date.parse(n1.available_at) > Date.parse(n1.publisher_metadata_time), 'and is not used: the notice prints only a date, so the replay waits for the end of that day');
  const sm = ev('usgs-shakemap-v1');
  assert.equal(sm.observed_at, '2022-03-16T14:36:30.997Z'); assert.equal(sm.published_at.precision, 'instant'); assert.equal(sm.available_at, '2022-03-16T14:59:37.938Z');
  assert.notEqual(sm.observed_at, sm.available_at); assert.notEqual(sm.available_at, sm.retrieved_at);
  /* a retrospective source is usable only from when it was read */
  for (const id of ['jma-intensity-db', 'usgs-event-detail', 'renesas-global-operations']) { assert.equal(ev(id).retrospective, true, id); assert.equal(ev(id).available_at, new Date(ev(id).retrieved_at).toISOString(), id); }
  /* an item that cannot be placed in time is an error, never "always available" */
  const broken = clone(CASE); delete broken.evidence[2].published_at;
  assert.ok(H.validate(broken).some((m) => /renesas-notice-1: cannot be placed in time/.test(m)));
  const moved = clone(CASE); moved.evidence[2].available_at = '2022-03-17T02:46:33.000Z';
  assert.ok(H.validate(moved).some((m) => /renesas-notice-1: available_at .* is not what the rule gives/.test(m)), 'available_at cannot be typed earlier than the rule allows');
});

test('the replay, cutoff by cutoff: unknown, halted, partial, forecast, missed, recovered', () => {
  /* 30 minutes after the earthquake: one automatic ShakeMap exists; nothing is known about any factory */
  let r = H.asOf(CASE, '2022-03-16T15:06:00Z');
  assert.deepEqual(ids(r), ['usgs-shakemap-v1']); assert.deepEqual(states(r), { naka: 'unknown', takasaki: 'unknown', yonezawa: 'unknown' });
  assert.equal(r.regional_shaking.length, 1); assert.equal(r.withheld, 15);
  /* the afternoon of 17 March in Japan (06:00Z): Renesas's page metadata says the first notice was already up, but it prints
     only a date, so the replay still shows nothing from it */
  r = H.asOf(CASE, '2022-03-17T06:00:00Z');
  assert.deepEqual(ids(r), ['usgs-shakemap-v1', 'usgs-shakemap-v2']); assert.deepEqual(states(r), { naka: 'unknown', takasaki: 'unknown', yonezawa: 'unknown' });
  /* end of 17 March in Japan: the JMA first report and the first notice */
  r = H.asOf(CASE, '2022-03-17T15:00:00Z');
  assert.deepEqual(ids(r), ['usgs-shakemap-v1', 'usgs-shakemap-v2', 'usgs-shakemap-v3', 'jma-press-20220317', 'renesas-notice-1']);
  assert.deepEqual(states(r), { naka: 'halted', takasaki: 'halted', yonezawa: 'partial' });
  assert.deepEqual(site(r, 'renesas-naka').state_basis, ['renesas-notice-1']); assert.equal(site(r, 'renesas-naka').forecasts.length, 0, 'no forecast existed yet');
  /* end of 18 March: partial restart everywhere, and three forecasts, all open */
  r = H.asOf(CASE, '2022-03-18T15:00:00Z');
  assert.deepEqual(states(r), { naka: 'partial', takasaki: 'partial', yonezawa: 'partial' });
  assert.deepEqual(r.sites.map((s) => s.forecasts.map((f) => [f.forecast_for, f.outcome])), [[['2022-03-23', 'open']], [['2022-03-23', 'open']], [['2022-03-20', 'open']]]);
  /* 21 March: Yonezawa's forecast date has passed, and it is still a forecast: no source has confirmed it yet */
  r = H.asOf(CASE, '2022-03-21T12:00:00Z');
  assert.equal(site(r, 'renesas-yonezawa').state, 'partial', 'a forecast date passing does not make a recovery');
  assert.equal(site(r, 'renesas-yonezawa').forecasts[0].outcome, 'open');
  /* end of 23 March: two recoveries confirmed by the operator, Naka's forecast missed and a new one made */
  r = H.asOf(CASE, '2022-03-23T15:00:00Z');
  assert.deepEqual(states(r), { naka: 'partial', takasaki: 'recovered_operator_confirmed', yonezawa: 'recovered_operator_confirmed' });
  assert.deepEqual(site(r, 'renesas-naka').forecasts.map((f) => [f.forecast_for, f.outcome, f.outcome_basis]), [['2022-03-23', 'missed', 'renesas-notice-3'], ['2022-03-26', 'open', null]]);
  assert.deepEqual(site(r, 'renesas-takasaki').forecasts.map((f) => f.outcome), ['met']); assert.deepEqual(site(r, 'renesas-yonezawa').forecasts.map((f) => f.outcome), ['met']);
  assert.equal(site(r, 'renesas-naka').losses.length, 1);
  /* end of 26 March: all three recovered, on the operator's word */
  r = H.asOf(CASE, '2022-03-26T15:00:00Z');
  assert.deepEqual(states(r), { naka: 'recovered_operator_confirmed', takasaki: 'recovered_operator_confirmed', yonezawa: 'recovered_operator_confirmed' });
  assert.deepEqual(site(r, 'renesas-naka').forecasts.map((f) => f.outcome), ['missed', 'met']); assert.deepEqual(site(r, 'renesas-naka').state_basis, ['renesas-notice-4']);
  assert.ok(!ids(r).includes('usgs-shakemap-v7'), 'the May ShakeMap is not in a March replay');
});

test('moving the cutoff backwards only removes: evidence, statements and conclusions never appear by going back', () => {
  const cuts = ['2026-11-25T00:00:00Z', '2022-05-17T00:00:00Z', '2022-03-26T15:00:00Z', '2022-03-23T15:00:00Z', '2022-03-18T15:00:00Z', '2022-03-17T15:00:00Z', '2022-03-17T14:59:59Z', '2022-03-16T15:00:00Z', '2022-03-16T14:36:31Z', '2022-03-16T00:00:00Z'];
  const RANK = { unknown: 0, halted: 1, partial: 2, recovered_operator_confirmed: 3 };
  let later = null;
  for (const cut of cuts) {
    const r = H.asOf(CASE, cut);
    assert.equal(r.evidence.length + r.withheld, CASE.evidence.length, cut);
    assert.ok(r.evidence.every((e) => Date.parse(e.available_at) <= Date.parse(cut)), cut + ': nothing later than the cutoff is returned');
    if (later) {
      const had = new Set(ids(later)), said = new Set(later.statements.map((s) => s.evidence_id + '/' + s.statement_id));
      assert.ok(ids(r).every((id) => had.has(id)), cut + ': an earlier cutoff holds a subset of the evidence');
      assert.ok(r.statements.every((s) => said.has(s.evidence_id + '/' + s.statement_id)), cut + ': and a subset of the statements');
      assert.ok(r.evidence.length <= later.evidence.length && r.withheld >= later.withheld, cut);
      for (const s of r.sites) assert.ok(RANK[s.state] <= RANK[site(later, s.id).state], cut + ' ' + s.id + ': a site never knows more by going back');
    }
    later = r;
  }
  assert.equal(H.asOf(CASE, cuts[0]).withheld, 0); assert.deepEqual(ids(H.asOf(CASE, cuts[cuts.length - 1])), []);
  /* one second either side of the first notice: it is the cutoff, not the page metadata, that decides */
  assert.ok(!ids(H.asOf(CASE, '2022-03-17T14:59:59Z')).includes('renesas-notice-1'));
  assert.ok(ids(H.asOf(CASE, '2022-03-17T15:00:00Z')).includes('renesas-notice-1'));
  /* the withheld evidence is counted and not returned in any form */
  const early = JSON.stringify(H.asOf(CASE, '2022-03-17T15:00:00Z'));
  for (const leak of ['50%', '200-mm', 'renesas-notice-3', 'renesas-notice-4', 'usgs-shakemap-v7', 'Horiguchi']) assert.ok(!early.includes(leak), leak + ' is later knowledge and is absent');
  assert.throws(() => H.asOf(CASE, '2022-03-17'), /cutoff must be an ISO instant/);
  assert.throws(() => H.asOf(CASE, 'yesterday'), /cutoff must be an ISO instant/);
});

test('the classes stay apart: location, observed and modeled shaking, halt, partial restart, forecast, operator-confirmed recovery', () => {
  const all = CASE.evidence.flatMap((e) => e.statements.map((s) => ({ ...s, source: e.source })));
  const by = (c) => all.filter((s) => s.class === c);
  assert.deepEqual([...new Set(all.map((s) => s.class))].sort(), ['context', 'forecast', 'forecast_missed', 'halt_confirmed', 'loss_reported', 'recovery_confirmed_by_operator', 'restart_partial', 'shaking_modeled', 'shaking_observed', 'site_location']);
  assert.ok(by('halt_confirmed').concat(by('restart_partial'), by('forecast'), by('forecast_missed'), by('recovery_confirmed_by_operator'), by('loss_reported')).every((s) => s.source === 'renesas-newsroom'), 'every operating state is the operator\'s own statement');
  assert.ok(by('shaking_modeled').every((s) => s.source === 'usgs-shakemap' && s.site === null && s.scope === 'map_wide'));
  assert.ok(by('shaking_observed').every((s) => s.scope === 'municipal_stations'));
  assert.ok(by('site_location').every((s) => s.source === 'renesas-profile' && /Japan$/.test(s.address)));
  assert.deepEqual(by('forecast').map((s) => [s.site.replace('renesas-', ''), s.forecast_for]), [['naka', '2022-03-23'], ['takasaki', '2022-03-23'], ['yonezawa', '2022-03-20'], ['naka', '2022-03-26']]);
  /* a forecast never moves a site's state: remove every confirmation and the forecasts alone leave all three where they were */
  const onlyForecasts = clone(CASE);
  for (const e of onlyForecasts.evidence) e.statements = e.statements.filter((s) => !['recovery_confirmed_by_operator', 'forecast_missed'].includes(s.class));
  assert.deepEqual(states(H.asOf(onlyForecasts, '2026-11-25T00:00:00Z')), { naka: 'partial', takasaki: 'partial', yonezawa: 'partial' });
  assert.ok(H.asOf(onlyForecasts, '2026-11-25T00:00:00Z').sites.every((s) => s.forecasts.every((f) => f.outcome === 'open')), 'and an unconfirmed forecast stays open, whatever today\'s date');
});

test('no facility shaking is claimed from a nearby station or from the model', () => {
  const now = H.asOf(CASE, '2026-11-25T00:00:00Z');
  assert.ok(now.sites.every((s) => s.shaking_at_facility === null), 'with every source read, shaking at a facility is still unknown');
  assert.equal(now.regional_shaking.length, 11, 'the JMA bulletin, three city-station statements and seven ShakeMap versions are regional');
  assert.ok(CASE.sites.every((s) => s.coordinates === null), 'no site is geocoded, so no GIS join is implied');
  assert.ok(CASE.evidence.filter((e) => e.source === 'usgs-shakemap').every((e) => e.geometry_verified === false && e.content_sha256 === null));
  /* the case file cannot be edited into such a claim */
  const claim = clone(CASE); claim.evidence.find((e) => e.id === 'jma-intensity-db').statements[0].applies_to_site = true;
  assert.ok(H.validate(claim).some((m) => /db-hitachinaka: a regional, municipal or map-wide value is not a facility reading/.test(m)));
  const model = clone(CASE); model.evidence.find((e) => e.id === 'usgs-shakemap-v7').statements[0].site = 'renesas-naka';
  assert.ok(H.validate(model).some((m) => /a regional, municipal or map-wide value is not a facility reading/.test(m)));
  /* and the site addresses arrive only with the page that was actually read */
  assert.equal(site(H.asOf(CASE, '2022-03-26T15:00:00Z'), 'renesas-naka').address, null, 'the 2026 listing is not March 2022 knowledge');
  assert.match(site(now, 'renesas-naka').address, /^751, Horiguchi/); assert.equal(site(now, 'renesas-naka').address_basis, 'renesas-global-operations');
});

test('what is not claimed and what is unknown are written down', () => {
  const text = JSON.stringify(CASE);
  assert.equal(CASE.not_claimed.length, 5); assert.ok(CASE.unknowns.length >= 8);
  assert.ok(CASE.not_claimed.some((s) => /supplier or customer relationship/.test(s)));
  assert.ok(CASE.not_claimed.some((s) => /revenue, earnings, a share price, an index or GDP/.test(s)));
  assert.ok(CASE.not_claimed.some((s) => /Shaking at any factory/.test(s)));
  /* no customer, ticker or price is in the file */
  assert.doesNotMatch(text, /\b(Toyota|Nissan|Honda|Denso|Apple|TSE:|6723|stock price fell|shares fell|GDP fell)\b/i);
  assert.ok(CASE.unknowns.some((s) => /front-end wafer processing restarted/.test(s)));
});

test('the decision is a proposal: nothing but an authorized, recorded event makes it approved', () => {
  const d = CASE.proposed_decision;
  assert.equal(d.status, 'proposed'); assert.equal(d.authorization, null); assert.equal(d.outcome, null);
  assert.equal(H.decisionStatus(CASE), 'proposed'); assert.equal(H.asOf(CASE, '2026-11-25T00:00:00Z').decision.status, 'proposed');
  assert.deepEqual(d.options.map((o) => o.id), ['A', 'B', 'C']); assert.ok(d.uncertainty.length > 40); assert.equal(d.what_would_change_it.length, 3);
  assert.ok(d.evidence_ids.every((id) => ev(id)), 'it cites evidence in this file');
  /* saying "approved" is not an approval */
  const said = clone(CASE); said.proposed_decision.status = 'approved';
  assert.equal(H.decisionStatus(said), 'proposed'); assert.equal(H.asOf(said, '2026-11-25T00:00:00Z').decision.status, 'proposed');
  assert.ok(H.validate(said).some((m) => /status is approved without an authorization/.test(m)));
  for (const fake of [{}, { approved_by: 'owner' }, { store: 'ai_context.decisions', decision_id: 'not-a-uuid', approved_by: 'x', approved_at: '2026-11-24T00:00:00Z' }, { store: 'somewhere', decision_id: '11111111-1111-4111-8111-111111111111', approved_by: 'x', approved_at: '2026-11-24T00:00:00Z' }, { store: 'ai_context.decisions', decision_id: '11111111-1111-4111-8111-111111111111', approved_by: 'x', approved_at: '2026-11-24' }, { store: 'ai_context.decisions', decision_id: '11111111-1111-4111-8111-111111111111', approved_by: '', approved_at: '2026-11-24T00:00:00Z' }]) {
    const c = clone(CASE); c.proposed_decision.status = 'approved'; c.proposed_decision.authorization = fake;
    assert.equal(H.decisionStatus(c), 'proposed', JSON.stringify(fake));
  }
  /* the shape a real one would have (a fixture id; no such decision exists) */
  const real = clone(CASE); real.proposed_decision.status = 'approved';
  real.proposed_decision.authorization = { store: 'ai_context.decisions', decision_id: '11111111-1111-4111-8111-111111111111', approved_by: 'house-owner-fixture', approved_at: '2026-11-24T12:00:00Z' };
  assert.equal(H.decisionStatus(real), 'approved'); assert.deepEqual(H.validate(real), []);
  for (const [cutoff, expected] of [
    ['2022-03-01T00:00:00Z', null],
    ['2026-11-24T11:59:59.999Z', null],
    ['2026-11-24T12:00:00Z', 'approved'],
    ['2026-11-24T12:00:00.001Z', 'approved']
  ]) {
    const decision = H.asOf(real, cutoff).decision;
    assert.deepEqual(decision, expected ? { status: expected, title: d.title } : null, cutoff);
  }
  const midnight = '2026-11-25T00:00:00Z';
  assert.equal(H.asOf(CASE, '2026-11-24T23:59:59.999Z').decision, null);
  assert.deepEqual(H.asOf(CASE, midnight).decision, { status: 'proposed', title: d.title });
  assert.equal(H.asOf(said, '2022-03-16T15:06:00Z').decision, null);
  assert.equal(H.asOf(said, midnight).decision.status, 'proposed');
  real.proposed_decision.authorization.approved_at = '2026-11-26T10:00:00Z';
  assert.equal(H.asOf(real, midnight).decision.status, 'proposed');
  assert.equal(H.asOf(real, '2026-11-26T10:00:00Z').decision.status, 'approved');
  const preciselyDated = clone(CASE);
  preciselyDated.written = '2026-11-24T09:00:00Z';
  assert.equal(H.asOf(preciselyDated, '2026-11-24T08:59:59.999Z').decision, null);
  assert.equal(H.asOf(preciselyDated, preciselyDated.written).decision.status, 'proposed');
  for (const bad of [null, '2026-02-30', 'undated']) {
    const undated = clone(said); undated.written = bad;
    assert.equal(H.asOf(undated, midnight).decision, null);
  }
});

test('the case is not published: it lives under core/, which the Pages deploy strips, and no page links it', () => {
  const deploy = read('.github/workflows/deploy-pages.yml');
  assert.match(deploy, /rm -rf [^\n]*\bcore\b/, 'core/ is removed from the public site');
  assert.doesNotMatch(deploy, /core\/data\/halo/);
  for (const page of ['action-globe.html', 'mnet.html', 'control.html', 'js/halo/halo.js', 'js/halo/data.js', 'js/action-globe.js']) assert.doesNotMatch(read(page), /fukushima-oki-2022-renesas|halo\/cases/, page);
});

test('the replay file is pure: no network, clock, storage or DOM', () => {
  const src = read('js/halo/case-replay.js');
  assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.|Date\.now\(|new Date\(\)/);
  assert.match(src, /typeof window === 'undefined' \? globalThis : window/);
});
