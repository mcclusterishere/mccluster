import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPortfolioPlan,
  groupInitiatives,
  inferDepartment,
  normalizeObjectiveRecord,
  scoreInitiative,
} from '../src/initiative-os.mjs';

test('normalizes heterogeneous objective rows without assuming one schema generation', () => {
  const item = normalizeObjectiveRecord({
    id: 'obj-1',
    name: 'Ship mobile Halo fix',
    target_id: 'Hitmans Halo',
    priority: 90,
    metadata: { initiative: 'Mobile performance', expected_impact: 0.9 },
  });
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
  const inactive = normalizeObjectiveRecord({ title: 'Old thing', status: 'done', priority: 100 });
  const paused = normalizeObjectiveRecord({ title: 'Paused thing', status: 'paused', priority: 100 });
  assert.equal(scoreInitiative(inactive), -Infinity);
  assert.equal(scoreInitiative(paused), -Infinity);
});

test('urgent blocked high-impact work outranks routine work', () => {
  const now = Date.parse('2026-09-12T21:00:00Z');
  const grouped = groupInitiatives([
    {
      id: 'urgent',
      title: 'Repair production Halo',
      project: 'Halo',
      initiative: 'Stability',
      priority: 80,
      urgency: 0.95,
      expected_impact: 0.95,
      confidence: 0.8,
      blocked: true,
      deadline: '2026-09-13T00:00:00Z',
    },
    {
      id: 'routine',
      title: 'Routine research',
      project: 'Research',
      initiative: 'Backlog',
      priority: 70,
      urgency: 0.3,
      expected_impact: 0.4,
      confidence: 0.8,
    },
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
  const mission = grouped.find((item) => item.project === 'PRIM3');
  assert.equal(grouped.length, 2);
  assert.equal(mission.objectives.length, 2);
});

test('group ids are JSONB-safe and never contain U+0000', () => {
  const grouped = groupInitiatives([
    { id: 'a', project: 'McCluster', initiative: 'Autonomy', title: 'Plan overnight work' },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id.includes('\u0000'), false);
  assert.doesNotThrow(() => JSON.stringify(grouped));
});

test('builds an executive portfolio plan with bounded ranked initiatives and job telemetry', () => {
  const plan = buildPortfolioPlan({
    maxInitiatives: 2,
    now: Date.parse('2026-09-12T21:00:00Z'),
    objectives: [
      { id: 'a', project: 'Halo', initiative: 'Performance', title: 'Optimize mobile renderer', priority: 95, expected_impact: 0.9 },
      { id: 'b', project: 'PRIM3', initiative: 'Campaign', title: 'Complete next mission', priority: 80, expected_impact: 0.8 },
      { id: 'c', project: 'Funding', initiative: 'Grants', title: 'Research grant', priority: 50 },
    ],
    recentJobs: [
      { status: 'done' },
      { status: 'failed' },
      { status: 'queued' },
    ],
  });

  assert.equal(plan.version, 'initiative-os:v1');
  assert.equal(plan.initiative_count, 2);
  assert.equal(plan.top_initiatives.length, 2);
  assert.equal(plan.recent_job_summary.done, 1);
  assert.equal(plan.recent_job_summary.failed, 1);
  assert.equal(plan.recent_job_summary.queued, 1);
  assert.ok(plan.departments.engineering.length >= 1);
});
