import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRecharacterizePlan } from '../src/media/recharacterize-plan.js';

const base = () => ({
  duration_ms: 15000,
  target_track_id: 'track-1',
  model_window_ms: 10000,
  overlap_ms: 500,
  approved_cost_cents: 100,
  estimated_cents_per_second: 6,
  shots: [{ id: 'shot-a', start_ms: 0, end_ms: 15000, track_ids: ['track-1'] }]
});

const refused = (fragment) => (e) => e?.status === 422 && e.message.includes(fragment);

test('15-second clip is split into two bounded, overlapping segments and charges for both overlaps', () => {
  const plan = buildRecharacterizePlan(base());
  assert.equal(plan.segments.length, 2);
  assert.deepEqual(plan.segments.map(({start_ms,end_ms}) => [start_ms,end_ms]), [[0,7750],[7250,15000]]);
  assert.equal(plan.total_render_ms, 15500);
  assert.equal(plan.estimated_cost_cents, 93);
  assert.equal(plan.source_duration_ms, 15000);
  assert.equal(plan.renderer_ready, false);
  assert.equal(plan.external_publish_allowed, false);
  assert.equal(plan.requires_manual_review, true);
  assert.equal(plan.requires_rights_check, true);
});

test('short clip in one model window is rendered once without overlap tax', () => {
  const input = base();
  input.duration_ms = 5000;
  input.shots[0].end_ms = 5000;
  const plan = buildRecharacterizePlan(input);
  assert.equal(plan.segments.length, 1);
  assert.equal(plan.segments[0].seam_overlap_ms, 0);
  assert.equal(plan.estimated_cost_cents, 30);
});

test('cross-shot generation is forbidden, even if both shots fit into the model window', () => {
  const input = base();
  input.duration_ms = 7000;
  input.shots = [
    { id: 'one', start_ms: 0, end_ms: 3500, track_ids: ['track-1'] },
    { id: 'two', start_ms: 3500, end_ms: 7000, track_ids: ['track-1'] }
  ];
  const plan = buildRecharacterizePlan(input);
  assert.deepEqual(plan.segments.map((s) => [s.shot_id,s.start_ms,s.end_ms]), [
    ['one',0,3500],['two',3500,7000]
  ]);
  assert.equal(plan.total_render_ms, 7000);
});

test('multiple longer shots remain ordered and model bounded with no gaps', () => {
  const input = base();
  input.duration_ms = 25000;
  input.approved_cost_cents = 200;
  input.shots = [
    { id: 'one', start_ms: 0, end_ms: 9000, track_ids: ['track-1'] },
    { id: 'two', start_ms: 9000, end_ms: 25000, track_ids: ['track-1'] }
  ];
  const plan = buildRecharacterizePlan(input);
  assert.equal(plan.segments[0].end_ms, 9000);
  assert.equal(plan.segments[1].start_ms, 9000);
  assert.equal(plan.segments.at(-1).end_ms, 25000);
  assert.ok(plan.segments.every((s) => (s.end_ms-s.start_ms) <= 10000));
});

test('missing person track in any shot fails before a paid plan can exist', () => {
  const input = base();
  input.shots[0].track_ids = ['someone-else'];
  assert.throws(() => buildRecharacterizePlan(input), refused('missing or tracking is ambiguous'));
});

test('ambiguous person tracking fails closed', () => {
  const input = base();
  input.shots[0].ambiguous_tracks = ['track-1'];
  assert.throws(() => buildRecharacterizePlan(input), refused('missing or tracking is ambiguous'));
});

test('gaps, overlaps, reversed timestamps, and uncovered footage reject the plan', () => {
  const input = base();
  input.shots = [{ id: 'shot-a', start_ms: 1, end_ms: 15000, track_ids: ['track-1'] }];
  assert.throws(() => buildRecharacterizePlan(input), refused('complete, ordered'));
  input.shots = [
    { id: 'a', start_ms: 0, end_ms: 8000, track_ids: ['track-1'] },
    { id: 'b', start_ms: 7000, end_ms: 15000, track_ids: ['track-1'] }
  ];
  assert.throws(() => buildRecharacterizePlan(input), refused('complete, ordered'));
  input.shots[1].start_ms = 8000;
  input.shots[1].end_ms = 8000;
  assert.throws(() => buildRecharacterizePlan(input), refused('complete, ordered'));
  input.shots = [{ id: 'shot-a', start_ms: 0, end_ms: 14999, track_ids: ['track-1'] }];
  assert.throws(() => buildRecharacterizePlan(input), refused('not fully covered'));
});

test('duplicate shot IDs and absent or invalid source track reject the plan', () => {
  const input = base();
  input.shots = [
    { id: 'x', start_ms: 0, end_ms: 5000, track_ids: ['track-1'] },
    { id: 'x', start_ms: 5000, end_ms: 15000, track_ids: ['track-1'] }
  ];
  assert.throws(() => buildRecharacterizePlan(input), refused('unique nonblank'));
  input.shots[1].id = 'y';
  input.target_track_id = '';
  assert.throws(() => buildRecharacterizePlan(input), refused('target_track_id'));
});

test('budget is enforced with overlap cost, not just source runtime', () => {
  const input = base();
  input.approved_cost_cents = 90;
  assert.throws(() => buildRecharacterizePlan(input), (e) =>
    e.status === 422 && e.detail.estimated_cost_cents === 93 && e.detail.approved_cost_cents === 90);
});

test('unknown, zero, negative and NaN provider prices reject the plan before spend', () => {
  for (const price of [undefined,0,-1,NaN,Infinity,'2']) {
    const input = base();
    input.estimated_cents_per_second = price;
    assert.throws(() => buildRecharacterizePlan(input), refused('price must be verified'));
  }
});

test('overlap and window limits cannot be bypassed', () => {
  const input = base();
  input.overlap_ms = 10000;
  assert.throws(() => buildRecharacterizePlan(input), refused('Overlap must'));
  input.overlap_ms = 500;
  input.model_window_ms = 60001;
  assert.throws(() => buildRecharacterizePlan(input), refused('exceeds the permitted'));
});

test('does not change source shot metadata supplied by the server', () => {
  const input = base();
  const before = structuredClone(input);
  buildRecharacterizePlan(input);
  assert.deepEqual(input,before);
});

test('long clips are split into bounded parts but guarded by segment capacity and budget', () => {
  const input = base();
  input.duration_ms = 300000;
  input.shots[0].end_ms = 300000;
  input.model_window_ms = 6000;
  input.overlap_ms = 300;
  input.approved_cost_cents = 10000;
  const plan = buildRecharacterizePlan(input);
  assert.ok(plan.segments.length >= 51);
  assert.ok(plan.segments.every((s) => s.end_ms-s.start_ms <= 6000));
  assert.equal(plan.segments.at(-1).end_ms, 300000);
  assert.ok(plan.total_render_ms > 300000);
  assert.ok(plan.estimated_cost_cents <= input.approved_cost_cents);
});
