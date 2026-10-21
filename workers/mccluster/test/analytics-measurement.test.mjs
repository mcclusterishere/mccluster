import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedRows, measurementContext } from '../src/analytics/measurement.js';
import { summarizeAudienceScience } from '../src/analytics/audience-science.js';
import { summarizeExperience } from '../src/analytics/experience.js';
import { AUDIENCE_EVENT_NAMES } from '../src/analytics/audience-science.js';
import { EVENT_DICTIONARY, METRIC_DICTIONARY } from '../src/analytics/measurement-dictionary.js';
import { DATASETS } from '../src/analytics/coverage.js';
import { handleAnalyticsRequest } from '../src/analytics/router.js';

test('measurement dictionary covers audience events and all coverage datasets with explicit evidence gaps', () => {
  const names = new Set(EVENT_DICTIONARY.map((x) => x.event_name));
  for (const name of AUDIENCE_EVENT_NAMES) assert.ok(names.has(name), `Missing audience event ${name}`);
  assert.equal(DATASETS.length, 24);
  for (const row of [...EVENT_DICTIONARY, ...METRIC_DICTIONARY, ...DATASETS]) {
    for (const field of ['producer','unit','identity_basis','numerator','denominator','permitted_dimensions',
      'deduplication_key','event_time_basis','lateness_policy','retention','privacy_class','owner','reporting_destination']) {
      assert.ok(Object.hasOwn(row, field), `Missing ${field} on ${row.event_name || row.key}`);
    }
  }
  assert.equal(EVENT_DICTIONARY.find((x) => x.event_name === 'offer_buy_click').verified_outcome, false);
});

test('measurement dictionary route retains the house-owner gate and performs no telemetry reads', async () => {
  const prior = globalThis.fetch;
  const paths = [];
  const env = { SUPABASE_URL:'https://db.test', SUPABASE_SERVICE_ROLE_KEY:'test' };
  const req = new Request('https://api.mccluster.org/v1/analytics/measurement-contract');
  let role = 'member';
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    paths.push(path);
    return Response.json(path.endsWith('/orgs') ? [{id:'org',slug:'mccluster'}] : [{org_id:'org',profile_id:'user',role}]);
  };
  try {
    await assert.rejects(handleAnalyticsRequest(req,env,{id:'user'}), (err) => err.status === 403);
    role = 'owner';
    const body = await (await handleAnalyticsRequest(req,env,{id:'user'})).json();
    assert.equal(body.unknown_event_policy,'unclassified');
    assert.equal(body.datasets.length,24);
    assert.ok(body.events.length >= 116);
    assert.ok(paths.every((x) => x.endsWith('/orgs') || x.endsWith('/org_members')));
  } finally { globalThis.fetch = prior; }
});

test('bounded reads distinguish empty, exhausted and cap reached without claiming exact totals', async () => {
  const empty = await readBoundedRows(async () => [], 3, 2);
  assert.deepEqual(empty, []);
  assert.equal(empty.readMetadata.status, 'complete');
  const calls = [];
  const source = [1, 2, 3, 4];
  const capped = await readBoundedRows(async (start, end) => {
    calls.push([start, end]); return source.slice(start, end + 1);
  }, 3, 2);
  assert.deepEqual(capped, [1, 2, 3]);
  assert.deepEqual(calls, [[0, 1], [2, 2]]);
  assert.equal(capped.readMetadata.status, 'limit_reached');
  assert.equal(capped.readMetadata.total_rows, null);
  const exactCap = await readBoundedRows(async () => [1, 2], 2, 2);
  assert.equal(exactCap.readMetadata.status, 'limit_reached');
  const complete = await readBoundedRows(async (start, end) => source.slice(start, end + 1), 8, 2);
  assert.equal(complete.readMetadata.status, 'complete');
  assert.equal(complete.readMetadata.total_rows, 4);
  await assert.rejects(readBoundedRows(async () => ({}), 3, 2), /must be an array/);
});

test('measurement carries the exact half-open window and partial/unknown source status', async () => {
  const rows = await readBoundedRows(async () => [{ id: 1 }], 1);
  const context = measurementContext({ metricVersion: 'test/v1', since: '2026-03-08T05:00:00Z',
    until: '2026-03-09T04:00:00Z', datasets: { events: rows, identity: [] }, unit: 'devices', identityBasis: 'device_id' });
  assert.equal(context.completeness.status, 'partial');
  assert.equal(context.completeness.datasets.identity.status, 'unknown');
  assert.equal(context.window.bounds, '[since,until)');
  assert.equal(context.window.until, '2026-03-09T04:00:00Z');
  assert.equal(context.snapshot.frozen, false);
  assert.equal(context.snapshot.watermark, null);
});

test('checkout intent and browser completion never become verified conversions', () => {
  const rows = ['checkout_view', 'checkout_go', 'offer_buy_click', 'account_created', 'action_complete']
    .map((name, i) => ({ id: `${i}`, device_id: 'd1', name, at: `2026-10-20T10:00:0${i}Z` }));
  const p = summarizeAudienceScience(rows).profiles[0];
  assert.equal(p.intent_events, 3);
  assert.equal(p.client_completion_events, 2);
  assert.equal(p.conversion_events, null);
  assert.ok(!p.behavior_signals.includes('converted'));
  assert.ok(p.behavior_signals.includes('purchase_intent'));
  assert.ok(p.behavior_signals.includes('client_completion_reported'));
});

test('shared device identity does not overwrite all activity with the last account', () => {
  const out = summarizeAudienceScience([{ device_id: 'shared', name: 'page_view' }], [
    { device_id: 'shared', uid: 'u1' }, { device_id: 'shared', uid: 'u2' }
  ]);
  assert.equal(out.profiles[0].uid, null);
  assert.equal(out.profiles[0].visitor_key, 'd:shared');
  assert.equal(out.methodology.ambiguous_identity_devices, 1);
});

test('profile display cap does not silently drop long-tail track affinity', () => {
  const out = summarizeAudienceScience(Array.from({length:15},(_,i)=>({
    device_id:'d',name:'song_start',track:`track ${String(i).padStart(2,'0')}`
  })));
  assert.equal(out.profiles[0].track_distribution.length,12);
  assert.equal(out.profiles[0].track_distribution_completeness.status,'display_limited');
  assert.equal(out.track_affinity.length,15);
});

test('experience excludes outcomes outside decision cohort and reports intersected populations', () => {
  const decisions = [1, 2, 3].map((id) => ({ id: `d${id}`, surface_id: 's', policy_id: 'p' }));
  const events = [
    { decision_id: 'old', name: 'experience_outcome' },
    { decision_id: 'd1', name: 'experience_impression' },
    { decision_id: 'd1', name: 'experience_outcome' },
    { decision_id: 'd1', name: 'experience_outcome' },
    { decision_id: 'd2', name: 'experience_visible' },
    { decision_id: 'd2', name: 'experience_interaction' },
    { decision_id: 'd3', name: 'experience_outcome' }
  ];
  const out = summarizeExperience(decisions, events, [], [], []);
  assert.equal(out.totals.decisions, 3);
  assert.equal(out.totals.outcomes, 2);
  assert.equal(out.totals.outcome_rate_pct, 100);
  assert.equal(out.totals.visible_rate_pct, 0);
  assert.equal(out.totals.interaction_rate_pct, 100);
  assert.equal(out.methodology.unmatched_event_rows, 1);
  assert.equal(out.methodology.outcome_kind, 'client_reported');
  assert.equal(out.by_surface[0].outcome_rate_pct, 100);
  const empty = summarizeExperience([], [], [], [], []);
  assert.equal(empty.totals.outcome_rate_pct, null);
});
