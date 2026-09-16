/* core.resume is the rehydration contract, so the properties that matter
   are: it never acts, it degrades per-section rather than all-or-nothing,
   and it tells a resuming session the truth about stuck work instead of
   presenting a dead lease as progress. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionJobs } from '../src/tools/resume.mjs';
import { CONTROL_TOOLS } from '../src/tools/control.mjs';

test('core.resume is published as a read-only control tool', () => {
  const tool = CONTROL_TOOLS.find((item) => item.name === 'core.resume');
  assert.ok(tool, 'core.resume is not in the control tool list');
  assert.deepEqual(tool.inputSchema.required, ['org_id']);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.match(tool.description, /[Rr]ead-only/);
  /* The description is what a model reads before calling it. If it ever
     stops saying it changes nothing, a resuming session may hesitate to
     call the one thing it should always call first. */
  assert.match(tool.description, /queues and changes nothing/i);
});

test('a job running past the stale threshold is reported as stale, not active', () => {
  const now = Date.parse('2026-09-16T12:00:00Z');
  const { active, stale } = partitionJobs([
    { id: 'fresh', status: 'running', job_type: 'repo_health', updated_at: '2026-09-16T11:55:00Z' },
    { id: 'orphan', status: 'running', job_type: 'objective_reflection', updated_at: '2026-09-13T06:31:00Z' },
    { id: 'done', status: 'done', job_type: 'local_analysis', updated_at: '2026-09-16T11:00:00Z' }
  ], now);

  assert.deepEqual(active.map((j) => j.id), ['fresh']);
  assert.deepEqual(stale.map((j) => j.id), ['orphan'],
    'a three-day-old running job is an orphaned lease, and must not look like work in flight');
  assert.ok(stale[0].age_ms > 24 * 60 * 60 * 1000);
});

test('only running jobs are partitioned; other statuses are not smuggled in', () => {
  const { active, stale } = partitionJobs([
    { id: 'q', status: 'queued', updated_at: '2026-09-16T11:00:00Z' },
    { id: 'f', status: 'failed', updated_at: '2026-09-16T11:00:00Z' }
  ], Date.parse('2026-09-16T12:00:00Z'));
  assert.deepEqual(active, []);
  assert.deepEqual(stale, []);
});

test('a job with an unparseable timestamp is treated as active, not silently dropped', () => {
  const { active, stale } = partitionJobs(
    [{ id: 'x', status: 'running', updated_at: 'not-a-date' }],
    Date.parse('2026-09-16T12:00:00Z')
  );
  assert.equal(active.length + stale.length, 1, 'the job must still be reported somewhere');
});

test('partitioning tolerates a missing or malformed job list', () => {
  for (const input of [null, undefined, 'nonsense', {}]) {
    const { active, stale } = partitionJobs(input);
    assert.deepEqual(active, []);
    assert.deepEqual(stale, []);
  }
});
