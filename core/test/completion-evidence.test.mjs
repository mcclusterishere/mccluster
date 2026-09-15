import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLETION_EVIDENCE_SCHEMA,
  assertCompletionEvidence,
  buildCompletionEvidence,
} from '../src/completion-evidence.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const now = '2026-09-14T18:00:00.000Z';

function job(jobType, input = {}) {
  return {
    id: `job-${jobType}`,
    job_type: jobType,
    target_type: 'repository',
    target_id: 'mcclusterishere/mccluster',
    input,
  };
}

const validSamples = [
  [job('repo_health'), { executor: 'repo_health:v1', repo: 'mcclusterishere/mccluster', head: A, origin_main: B, clean: true, tests: { requested: false, ran: false, ok: null } }],
  [job('local_analysis'), { executor: 'local_analysis:v1', model: 'qwen3:8b', evidence_scope: 'job_input_only', analysis: { summary: 'ok' } }],
  [job('code_patch'), { executor: 'code_patch:v1', repo: 'mcclusterishere/mccluster', branch: 'core/job-123', base_commit: A, commit: B, changed: true, pushed: true, draft_pr: 'https://github.com/mcclusterishere/mccluster/pull/123', verification: { git_diff_check: true } }],
  [job('objective_reflection'), { executor: 'objective_reflection:v2', queued_jobs: [{ id: 'child-1' }], source_counts: { objectives: 2, recent_jobs: 4 } }],
  [job('objective_plan'), { executor: 'objective_plan:v1', plan_id: 'plan-1', queued_steps: [{ id: 'child-1' }], retry_safe: true }],
  [job('objective_synthesis'), { executor: 'objective_synthesis:v2', action: 'create', source: { conversation_id: 'conv-1', fingerprint: 'fp-1' }, objective: { id: 'objective-1' }, reflection_job_id: 'child-1' }],
  [job('portfolio_plan'), { executor: 'portfolio_plan:v1', plan: { generated_at: now, initiative_count: 3 }, queued_reflections: [{ id: 'child-1' }] }],
  [job('game_build_plan'), { executor: 'game_build_plan:v0.1', plan: { spec: { campaign: 'PRIM3' }, stages: [{ id: 1 }] } }],
  [job('game_playtest'), { executor: 'game_playtest:v0.1', evidence: { artifact_dir: '/tmp/evidence', timed_out: false, run: { terminal: { status: 'complete' } } }, evaluation: { score: 91 } }],
  [job('game_studio_cycle'), { executor: 'game_studio_cycle:v1.2', state: 'generating', submissions: [{ media_job_id: 'media-1' }], collector_job_id: 'collector-1' }],
  [job('game_media_collect'), { executor: 'game_media_collect:v1.2', state: 'awaiting_owner_review', approval_packet: { candidates: [{ media_job_id: 'media-1', assets: [{ id: 'asset-1' }] }] } }],
  [job('game_owner_decision'), { executor: 'game_owner_decision:v1.2', state: 'implementation_queued', decision: 'approve', next_job_id: 'code-1', watcher_job_id: 'watch-1' }],
  [job('game_implementation_collect'), { executor: 'game_implementation_collect:v1', state: 'validation_queued', branch: 'core/job-1', code_job_id: 'code-1', smoke_job_id: 'smoke-1' }],
  [job('game_branch_smoke'), { executor: 'game_branch_smoke:v1', evidence: { repository: 'mcclusterishere/hitmans-halo', branch: 'core/job-1', commit: A, import: { ok: true }, launch: { ok: true } } }],
  [job('game_release_decision'), { executor: 'game_release_decision:v1', state: 'preview_queued', decision: 'approve', preview_job_id: 'preview-1', repository: 'mcclusterishere/hitmans-halo', branch: 'core/job-1' }],
  [job('preview_deploy'), { executor: 'preview_deploy:v1', production: false, provider: 'vercel', preview_url: 'https://example.vercel.app', repository: 'mcclusterishere/mccluster', ref: 'core/job-1' }],
  [job('host_health'), { executor: 'host_health:v2', checked_at: now, host: { hostname: 'mccluster-ovh' }, services: { core_runner: 'active' }, deployment: { deployed_sha: A } }],
  [job('sms_assistant_turn'), { executor: 'sms_assistant_turn:v1', action: 'reply', thread_id: 'thread-1', inbound_message_id: 'in-1', outbound_message_id: 'out-1', outbox_transport: 'android-sim-relay' }],
];

test('every currently supported Core job type can produce and verify evidence', () => {
  for (const [currentJob, output] of validSamples) {
    const evidenced = buildCompletionEvidence(currentJob, output, { startedAt: now, completedAt: now });
    assert.equal(evidenced.completion_evidence.schema_version, COMPLETION_EVIDENCE_SCHEMA);
    assert.match(evidenced.completion_evidence.result_sha256, /^[0-9a-f]{64}$/);
    assert.equal(evidenced.completion_evidence.records[0].kind, 'result_digest');
    assert.equal(assertCompletionEvidence(currentJob, evidenced), true);
  }
});

test('tampering with executor output after evidence generation is rejected', () => {
  const currentJob = job('preview_deploy');
  const evidenced = buildCompletionEvidence(currentJob, validSamples.find(([candidate]) => candidate.job_type === 'preview_deploy')[1], { startedAt: now, completedAt: now });
  evidenced.preview_url = 'https://different.vercel.app';
  assert.throws(() => assertCompletionEvidence(currentJob, evidenced), /result digest does not match/);
});

test('code_patch cannot complete a changed job without an exact commit and diff proof', () => {
  const currentJob = job('code_patch');
  assert.throws(() => buildCompletionEvidence(currentJob, {
    executor: 'code_patch:v1', repo: 'mcclusterishere/mccluster', branch: 'core/job-1', base_commit: A, changed: true,
  }), /exact commit SHA/);
});

test('repo_health cannot claim completion when requested tests did not run', () => {
  const currentJob = job('repo_health', { tests: true });
  assert.throws(() => buildCompletionEvidence(currentJob, {
    executor: 'repo_health:v1', repo: 'mcclusterishere/mccluster', head: A, clean: true, tests: { requested: true, ran: false, ok: null },
  }), /requested repository tests did not run/);
});

test('preview deployment cannot claim production mutation as preview evidence', () => {
  const currentJob = job('preview_deploy');
  assert.throws(() => buildCompletionEvidence(currentJob, {
    executor: 'preview_deploy:v1', production: true, provider: 'vercel', preview_url: 'https://example.vercel.app', repository: 'mcclusterishere/mccluster', ref: 'main',
  }), /production=false/);
});

test('SMS reply must carry a durable outbound message identifier', () => {
  const currentJob = job('sms_assistant_turn');
  assert.throws(() => buildCompletionEvidence(currentJob, {
    executor: 'sms_assistant_turn:v1', action: 'reply', thread_id: 'thread-1', inbound_message_id: 'in-1', outbox_transport: 'android-sim-relay',
  }), /outbound message id/);
});

test('completion writes cannot accept a raw executor result without evidence', () => {
  const currentJob = job('local_analysis');
  assert.throws(() => assertCompletionEvidence(currentJob, { executor: 'local_analysis:v1', model: 'qwen3:8b', analysis: {} }), /completion_evidence envelope is required/);
});

test('future executor types fail closed until an evidence policy is added', () => {
  const currentJob = job('future_dangerous_executor');
  assert.throws(() => buildCompletionEvidence(currentJob, { executor: 'future:v1', result: 'claimed done' }), /no completion evidence policy exists/);
});
