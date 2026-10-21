import test from 'node:test';
import assert from 'node:assert/strict';
import {EVENT_COUNT_FIELDS, loadBusinessEventCounts, parseBusinessEventCounts} from '../src/analytics/business-event-counts.js';

const row = () => Object.fromEntries(EVENT_COUNT_FIELDS.map(field => [field, field.endsWith('_window') ? 3 : 8]));

test('one RPC returns eighteen exact counters with bounded window parameters', async () => {
  let called = 0;
  const result = await loadBusinessEventCounts(async (path, init) => {
    called++;
    assert.equal(path, 'rpc/analytics_business_event_counts');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), {p_since:'2026-10-20T00:00:00Z', p_until:'2026-10-21T00:00:00Z'});
    return [row()];
  }, {since:'2026-10-20T00:00:00Z', until:'2026-10-21T00:00:00Z'});
  assert.equal(called, 1);
  assert.equal(Object.keys(result).length, 18);
  assert.equal(result.events_total,8);
  assert.equal(result.clicks_window,3);
});

test('no window preserves unknown window counts rather than inventing zeroes', async () => {
  const value = row();
  for(const key of EVENT_COUNT_FIELDS) if(key.endsWith('_window')) value[key] = null;
  const result = await loadBusinessEventCounts(async () => [value]);
  assert.equal(result.events_window,null);
  assert.equal(result.music_plays_window,null);
});

test('failed or truncated RPC responses remain errors, never successful zeroes', async () => {
  const windowSpec = {since:'2026-10-20T00:00:00Z', until:'2026-10-21T00:00:00Z'};
  await assert.rejects(() => loadBusinessEventCounts(async () => [], windowSpec),/unavailable/);
  await assert.rejects(() => loadBusinessEventCounts(async () => [{events_total:1}], windowSpec),/Invalid event counter/);
  await assert.rejects(() => loadBusinessEventCounts(async () => [{...row(),clicks_total:'9007199254740993'}], windowSpec),/Invalid event counter/);
  await assert.rejects(() => loadBusinessEventCounts(async () => [{...row(),clicks_total:-1}], windowSpec),/Invalid event counter/);
  await assert.rejects(() => loadBusinessEventCounts(async () => [row()], {since:'2026-10-20'}),/Both window bounds/);
});

test('string PostgREST bigint values are accepted only when exactly safe nonnegative integers', () => {
  const v = row(); v.events_total='123';
  assert.equal(parseBusinessEventCounts([v]).events_total,123);
  v.events_total='1.2'; assert.throws(() => parseBusinessEventCounts([v]),/Invalid event counter/);
});
