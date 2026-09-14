import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPortfolioPlan,
  buildWorldState,
  groupInitiatives,
  inferDepartment,
  normalizeObjectiveRecord,
  scoreInitiative,
} from '../src/initiative-os.mjs';

test('normalizes heterogeneous objective rows without assuming one schema generation', () => {
  const item = normalizeObjectiveRecord({ id: 'obj-1', name: 'Ship mobile Halo fix', target_id: 'Hitmans Halo', priority: 90, metadata: { initiative: 'Mobile performance', expected_impact: 0.9 } });
  assert.equal(item.id, 'obj-1');
  assert.equal(item.project, 'Hitmans Halo');
  assert.equal(item.initiative, 'Mobile performance');
  assert.equal(item.department, 'engineering');
  assert.equal(item.priority, 90);
});

test('department inference routes common portfolio work to a stable owner lane', () => {
  assert.equal(inferDepartment('fix Supabase deployment regression'), 'engineering');
  assert.equal(inferDepartment('PRIM3 episode and music asset pass'), 'creative');
  assert.equal(inferDepartment('OEM manufacturer partnership outreach'), 'business_development');
  assert.equal(inferDepartment('nonprofit grant funding application'), 'funding');
  assert.equal(inferDepartment('calendar deadline and follow-up'), 'operations');
});

test('inactive and paused work cannot win the nightly priority auction', () => {
  assert.equal(scoreInitiative(normalizeObjectiveRecord({ title: 'Old thing', status: 'done', priority: 100 })), -Infinity);
  assert.equal(scoreInitiative(normalizeObjectiveRecord({ title: 'Paused thing', status: 'paused', priority: 100 })), -Infinity);
});

test('urgent blocked high-impact work outranks routine work', () => {
  const now = Date.parse('2026-09-12T21:00:00Z');
  const grouped = groupInitiatives([
    { id: 'urgent', title: 'Repair production Halo', project: 'Halo', initiative: 'Stability', priority: 80, urgency: 0.95, expected_impact: 0.95, confidence: 0.8, blocked: true, deadline: '2026-09-13T00:00:00Z' },
    { id: 'routine', title: 'Routine research', project: 'Research', initiative: 'Backlog', priority: 70, urgency: 0.3, expected_impact: 0.4, confidence: 0.8 },
  ], { now }).sort((a, b) => b.score - a.score);
  assert.equal(grouped[0].initiative, 'Stability');
  assert.ok(grouped[0].score > grouped[1].score);
});

test('groups multiple objectives into one initiative so the system advances outcomes, not disconnected tasks', () => {
  const grouped = groupInitiatives([
    { id: 'a', project: 'PRIM3', initiative: 'Mission 14', title: 'Research geography' },
    { id: 'b', project: 'PRIM3', initiative: 'Mission 14', title: 'Validate curriculum' },
    { id: 'c', project: 'Whip Equipped', initiative: 'OEM', title: 'Compare manufacturer specs' },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped.find((item) => item.project === 'PRIM3').objectives.length, 2);
});

test('group ids are JSONB-safe and never contain U+0000', () => {
  const grouped = groupInitiatives([{ id: 'a', project: 'McCluster', initiative: 'Autonomy', title: 'Plan overnight work' }]);
  assert.equal(grouped[0].id.includes('\u0000'), false);
  assert.doesNotThrow(() => JSON.stringify(grouped));
});

test('world state exposes ranked unprocessed reality without fabricating objectives', () => {
  const world = buildWorldState([
    { id: 1, source: 'sms', signal_type: 'message', severity: 70, status: 'new', fingerprint: 'a'.repeat(64), payload: { content: 'Urgent customer request' }, observed_at: '2026-09-14T20:00:00Z' },
    { id: 2, source: 'email', signal_type: 'message', severity: 30, status: 'consumed', fingerprint: 'b'.repeat(64), payload: { content: 'Already handled' }, processed_at: '2026-09-14T21:00:00Z', observed_at: '2026-09-14T19:00:00Z' },
  ]);
  assert.equal(world.signal_count, 2);
  assert.equal(world.unprocessed_count, 1);
  assert.equal(world.high_severity_count, 1);
  assert.equal(world.synthesis_candidates[0].id, '1');
  assert.equal(world.by_source.sms, 1);
});

test('builds a v2 executive portfolio plan with jobs plus world state', () => {
  const plan = buildPortfolioPlan({
    maxInitiatives: 2,
    now: Date.parse('2026-09-12T21:00:00Z'),
    objectives: [
      { id: 'a', project: 'Halo', initiative: 'Performance', title: 'Optimize mobile renderer', priority: 95, expected_impact: 0.9 },
      { id: 'b', project: 'PRIM3', initiative: 'Campaign', title: 'Complete next mission', priority: 80, expected_impact: 0.8 },
      { id: 'c', project: 'Funding', initiative: 'Grants', title: 'Research grant', priority: 50 },
    ],
    recentJobs: [{ status: 'done' }, { status: 'failed' }, { status: 'queued' }],
    signals: [{ id: 9, source: 'fabric', signal_type: 'calendar.event', severity: 60, status: 'new', fingerprint: 'c'.repeat(64), payload: { content: 'Deadline changed' }, observed_at: '2026-09-12T20:00:00Z' }],
  });
  assert.equal(plan.version, 'initiative-os:v2');
  assert.equal(plan.initiative_count, 2);
  assert.equal(plan.top_initiatives.length, 2);
  assert.equal(plan.recent_job_summary.done, 1);
  assert.equal(plan.recent_job_summary.failed, 1);
  assert.equal(plan.recent_job_summary.queued, 1);
  assert.equal(plan.world_state.unprocessed_count, 1);
  assert.ok(plan.departments.engineering.length >= 1);
});
