import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAnalyticsRequest } from '../src/analytics/router.js';
import { summarizeAudienceScience } from '../src/analytics/audience-science.js';

const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'owner@example.com' };
const STRANGER = { id: '523e4567-e89b-42d3-a456-426614174444', email: 'stranger@example.com' };
const ORG = '123e4567-e89b-42d3-a456-426614174000';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const t = (day, sec = 0) => `2026-10-${String(day).padStart(2, '0')}T12:00:${String(sec).padStart(2, '0')}Z`;
const start = (device, session, track, day, sec = 0) => ({
  device_id: device, session_id: session, track, at: t(day, sec), name: 'album_play', is_bot: false
});

test('audience science measures concentration, entropy, effective catalog and repetition', () => {
  const rows = [
    start('d1', 's1', 'shock song', 1, 1),
    start('d1', 's1', 'shock song', 1, 2),
    start('d1', 's1', 'shock song', 1, 3),
    start('d1', 's2', 'shock song', 2, 4),
    start('d1', 's2', 'other song', 2, 5),
    { device_id: 'd1', session_id: 's2', at: t(2, 6), name: 'mission_join', is_bot: false },
    { device_id: 'd1', session_id: 's2', at: t(2, 7), name: 'music_complete', track: 'shock song', is_bot: false }
  ];
  const out = summarizeAudienceScience(rows, [{ device_id: 'd1', uid: 'u1', at: t(2, 9) }]);
  assert.equal(out.profiles.length, 1);
  const p = out.profiles[0];
  assert.equal(p.visitor_key, 'u:u1');
  assert.equal(p.music_starts, 5);
  assert.equal(p.distinct_tracks, 2);
  assert.equal(p.dominant_track, 'shock song');
  assert.equal(p.dominant_share, 0.8);
  assert.equal(p.hhi, 0.68);
  assert.equal(p.repeat_ratio, 0.6);
  assert.ok(p.shannon_entropy > 0 && p.shannon_entropy < 1);
  assert.ok(p.effective_catalog_size > 1 && p.effective_catalog_size < 2);
  assert.deepEqual(p.behavior_signals.sort(), ['action_engaged','concentrated_attention','repeat_listening','returning'].sort());
  assert.equal(out.methodology.inference_policy, 'behavior_only');
  assert.equal(out.model_readiness.latent_class_enabled, false);
});

test('broad exploration is separate from concentrated attention', () => {
  const tracks = ['a','b','c','d','a','b','c','d'];
  const rows = tracks.map((track, i) => start('d2', 's' + (i < 4 ? '1' : '2'), track, i < 4 ? 3 : 4, i));
  const p = summarizeAudienceScience(rows).profiles[0];
  assert.equal(p.dominant_share, 0.25);
  assert.equal(p.hhi, 0.25);
  assert.equal(p.normalized_entropy, 1);
  assert.equal(p.effective_catalog_size, 4);
  assert.ok(p.behavior_signals.includes('broad_exploration'));
  assert.ok(!p.behavior_signals.includes('concentrated_attention'));
});

test('a single play is not promoted into a motive or concentration claim', () => {
  const p = summarizeAudienceScience([start('d3', 's1', 'one song', 5, 1)]).profiles[0];
  assert.equal(p.dominant_share, 1);
  assert.equal(p.evidence.enough_for_distribution_signal, false);
  assert.ok(!p.behavior_signals.includes('concentrated_attention'));
});

function backend({ role = 'owner', lean = [], events = [] } = {}) {
  const calls = [];
  const handler = async (url) => {
    const u = new URL(String(url));
    const path = u.pathname.replace('/rest/v1/', '');
    calls.push({ path, query: u.searchParams });
    if (path === 'orgs') return reply([{ id: ORG, slug: 'mccluster' }]);
    if (path === 'org_members') return reply(role ? [{ org_id: ORG, profile_id: u.searchParams.get('profile_id').slice(3), role }] : []);
    if (path === 'events_lean') return reply(lean);
    if (path === 'events') return reply(events);
    return reply({ message: `unexpected ${path}` }, 500);
  };
  return { calls, handler };
}
function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}
const get = (path, user = OWNER) => handleAnalyticsRequest(new Request(`https://api.mccluster.org${path}`), env, user);

test('audience science route is owner-only and reads no telemetry before the gate', async () => {
  const { handler, calls } = backend({ role: 'member' });
  await withFetch(handler, async () => {
    await assert.rejects(() => get('/v1/analytics/audience-science', STRANGER), (err) => err.status === 403);
  });
  assert.ok(!calls.some((c) => c.path === 'events' || c.path === 'events_lean'));
});

test('audience science route clamps to 31 days and reads narrow first-party evidence', async () => {
  const lean = [start('d4', 's1', 'x', 6, 1)];
  const { handler, calls } = backend({ lean, events: [{ device_id: 'd4', uid: 'u4', session_id: 's1', at: t(6, 2) }] });
  await withFetch(handler, async () => {
    const res = await get('/v1/analytics/audience-science?since=2026-01-01T00:00:00Z&until=2026-10-06T20:00:00Z');
    const out = await res.json();
    assert.equal(out.ok, true);
    assert.equal(out.range.max_days, 31);
    assert.equal(out.profiles[0].uid, 'u4');
  });
  const leanCall = calls.find((c) => c.path === 'events_lean');
  assert.ok(leanCall);
  assert.equal(leanCall.query.get('site_id'), 'is.null');
  assert.equal(leanCall.query.get('is_bot'), 'is.false');
  assert.match(leanCall.query.get('select'), /track/);
  assert.match(leanCall.query.get('name'), /^in\.\(/);
  const idCall = calls.find((c) => c.path === 'events');
  assert.equal(idCall.query.get('uid'), 'not.is.null');
});
