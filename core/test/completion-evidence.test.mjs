import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLETION_EVIDENCE_SCHEMA,
  assertCompletionEvidence,
  buildCompletionEvidence,
} from '../src/completion-evidence.mjs';
import { lyricsAlign } from '../src/executors/lyrics-align.mjs';
import { stemsSeparate } from '../src/executors/stems-separate.mjs';
import { storeStems } from '../src/lyrics/stems.mjs';

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
  [job('lead_rescore'), { executor: 'lead_rescore:v1', summary: 'Lead scores refreshed for organization org-1', recomputed_count: 7, target_score: null }],
  [job('host_health'), { executor: 'host_health:v2', checked_at: now, host: { hostname: 'mccluster-ovh' }, services: { core_runner: 'active' }, deployment: { deployed_sha: A } }],
  [job('sms_assistant_turn'), { executor: 'sms_assistant_turn:v1', action: 'reply', thread_id: 'thread-1', inbound_message_id: 'in-1', outbound_message_id: 'out-1', outbox_transport: 'android-sim-relay' }],
  [job('resident_ai_turn'), { executor: 'resident_ai_turn:v1', thread_id: 'thread-1', user_message_id: 'user-1', assistant_message_id: 'assistant-1', model: 'qwen3:8b', implementation: 'mccluster-owned', replayed: false }],
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

test('lead_rescore cannot claim completion without a bounded recompute count', () => {
  const currentJob = job('lead_rescore');
  assert.throws(() => buildCompletionEvidence(currentJob, {
    executor: 'lead_rescore:v1',
    summary: 'claimed refresh',
    target_score: null,
  }), /recomputed_count/);
  assert.throws(() => buildCompletionEvidence(currentJob, {
    executor: 'lead_rescore:v1',
    summary: 'claimed refresh',
    recomputed_count: -1,
    target_score: null,
  }), /cannot be negative/);
});

test('future executor types fail closed until an evidence policy is added', () => {
  const currentJob = job('future_dangerous_executor');
  assert.throws(() => buildCompletionEvidence(currentJob, { executor: 'future:v1', result: 'claimed done' }), /no completion evidence policy exists/);
});

// Shared music-platform support: exercise actual executor receipts without
// claiming that these injected audio/storage fixtures prove a deployed runtime.
const TRACK = '123e4567-e89b-42d3-a456-426614174000';
const REV = '0123456789abcdef0123456789abcdef';
const RUN = 'r20261124083000-123abc';
const lyricJob = { id: 'lyrics-job', job_type: 'lyrics_align', target_type: 'creator_track', target_id: TRACK, input: { track_id: TRACK } };
const lyricDoc = () => ({
  source: 'aligned', reviewed: false, plain: 'Synthetic words',
  timed: { line: [{ begin: 0, end: 1, content: 'Synthetic words' }] },
  machine: { mismatched_lines: 0 },
});
function lyricDeps({ lyrics = null, revision = REV, stale = false, remote = null, storeError = false } = {}) {
  const calls = [];
  const deps = {
    rest: async (path, init = {}) => {
      calls.push({ path, method: init.method || 'GET', body: init.body && JSON.parse(init.body) });
      return init.method ? { body: stale ? [] : [{ id: TRACK }] } : { body: [{
        id: TRACK, title: 'Synthetic track', master_bucket: 'creator-masters', master_path: 'synthetic/master.wav',
        lyrics, lyrics_sheet: 'Synthetic words', lyrics_input_rev: revision,
      }] };
    },
    offload: async () => remote,
    download: async () => { assert.equal(remote, null, 'an offloaded result must not download locally'); },
    transcribe: async () => ({ doc: lyricDoc(), ...(storeError ? { stems: {}, stemsDir: '/synthetic' } : {}) }),
    storeStems: async () => { throw new Error('synthetic optional stems failure'); },
  };
  return { calls, deps };
}
function checkedEvidence(currentJob, output) {
  const evidenced = buildCompletionEvidence(currentJob, output, { startedAt: now, completedAt: now });
  assert.equal(assertCompletionEvidence(currentJob, evidenced), true);
  return evidenced.completion_evidence.records.slice(1);
}

test('lyrics completion records the real fenced write and tolerates an optional stems failure', async () => {
  const { calls, deps } = lyricDeps({ storeError: true });
  const output = await lyricsAlign(lyricJob, deps);
  assert.equal(output.input_rev, REV);
  assert.match(calls.find(call => call.method === 'PATCH').path, new RegExp(`lyrics_input_rev=eq\\.${REV}`));
  assert.match(output.stems.error, /optional stems failure/);
  const [receipt] = checkedEvidence(lyricJob, output);
  assert.equal(receipt.kind, 'lyrics_write');
  assert.equal(receipt.track_id, TRACK);
  assert.equal(receipt.input_rev, REV);
  assert.equal(receipt.lines, 1);
  assert.deepEqual(receipt.ran_on, { route: 'local', node_id: null, task_id: null });
  assert.equal(receipt.stems, undefined, 'lyrics success does not invent a successful stem manifest');
});

test('lyrics completion preserves a fabric receipt without claiming local execution', async () => {
  const { deps } = lyricDeps({ remote: { doc: lyricDoc(), node_id: 'node_fixture', task_id: 'task_fixture' } });
  const [receipt] = checkedEvidence(lyricJob, await lyricsAlign(lyricJob, deps));
  assert.deepEqual(receipt.ran_on, { route: 'fabric', node_id: 'node_fixture', task_id: 'task_fixture' });
});

test('protected lyrics produce a bounded no-op without running or writing', async () => {
  for (const lyrics of [{ source: 'aligned', reviewed: true }, { source: 'owner', reviewed: false, timed: { line: [] } }]) {
    const { calls, deps } = lyricDeps({ lyrics });
    deps.offload = deps.download = deps.transcribe = async () => { throw new Error('protected lyrics must not run'); };
    const output = await lyricsAlign(lyricJob, deps);
    assert.equal(output.reason, 'protected_lyrics');
    assert.deepEqual(calls.map(call => call.method), ['GET']);
    const [receipt] = checkedEvidence(lyricJob, output);
    assert.deepEqual(receipt, { kind: 'bounded_noop', operation: 'lyrics_align', reason: 'protected_lyrics', track_id: TRACK });
  }
});

test('a lyrics write matching zero rows is a bounded stale-input no-op, never a write receipt', async () => {
  const { deps } = lyricDeps({ stale: true });
  const output = await lyricsAlign(lyricJob, deps);
  assert.equal(output.reason, 'inputs_or_review_changed');
  const [receipt] = checkedEvidence(lyricJob, output);
  assert.deepEqual(receipt, { kind: 'bounded_noop', operation: 'lyrics_align', reason: 'inputs_or_review_changed', track_id: TRACK, input_rev: REV });
});

test('the pre-migration master-path fence does not invent a revision receipt', async () => {
  const { calls, deps } = lyricDeps({ revision: null });
  const output = await lyricsAlign(lyricJob, deps);
  assert.match(calls.find(call => call.method === 'PATCH').path, /master_path=eq\.synthetic%2Fmaster\.wav/);
  assert.equal(output.input_rev, null);
  assert.equal(checkedEvidence(lyricJob, output)[0].input_rev, null);
});

test('lyrics evidence refuses mismatched identity, invented no-ops and invalid write receipts', async () => {
  const output = await lyricsAlign(lyricJob, lyricDeps().deps);
  for (const [changes, message] of [
    [{ track_id: '123e4567-e89b-42d3-a456-426614174001' }, /track/],
    [{ executor: 'other:v1' }, /executor/],
    [{ written: undefined }, /written/],
    [{ input_rev: undefined }, /revision/],
    [{ input_rev: 'invented' }, /revision/],
    [{ source: 'owner' }, /source/],
    [{ lines: -1 }, /line/],
    [{ lines: 1.5 }, /line/],
    [{ mismatched_lines: 2 }, /line/],
    [{ ran_on: { route: 'fabric', node_id: 'node_fixture', task_id: null } }, /fabric/],
    [{ ran_on: { route: 'local', node_id: 'node_fixture', task_id: null } }, /local/],
    [{ written: false }, /reason/],
    [{ written: false, reason: 'runtime_failed' }, /reason/],
    [{ reason: 'protected_lyrics' }, /no-op/],
  ]) assert.throws(() => buildCompletionEvidence(lyricJob, { ...output, ...changes }), message, JSON.stringify(changes));
});

const stemManifest = {
  separator: 'demucs', model: 'htdemucs', format: 'mp3', seconds: 1,
  stems: ['vocals', 'instrumental'].map(stem => ({ stem, file: `${stem}.mp3`, bytes: 3, sha256: 'a'.repeat(64), seconds: 1 })),
};
function stemDeps({ failManifest = false } = {}) {
  const calls = [];
  return { calls, deps: {
    fetchTo: async () => {},
    rest: async () => ({ body: [{ id: TRACK, title: 'Synthetic track', master_bucket: 'creator-masters', master_path: 'synthetic/master.wav' }] }),
    separator: { run: async () => ({ manifest: stemManifest }) },
    storeStems: args => storeStems({ ...args, runId: RUN }, {
      env: { url: 'https://storage.invalid', key: 'synthetic-test-key' },
      readFile: async () => Buffer.from('abc'),
      fetch: async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET', body: init.body });
        if (!init.method) return { ok: true, json: async () => [] };
        if (failManifest && url.includes('/rest/v1/music_stem_sets')) return { ok: false, status: 503 };
        return { ok: true, status: 201 };
      },
    }),
  } };
}
const stemJob = { id: 'stems-job', job_type: 'stems_separate', input: { source: 'shelf', track_key: 'synthetic-track' } };

test('stems completion carries the run actually persisted in the private manifest', async () => {
  const { calls, deps } = stemDeps();
  const output = await stemsSeparate(stemJob, deps);
  const persisted = JSON.parse(calls.find(call => call.method === 'POST' && call.url.includes('/rest/v1/music_stem_sets')).body);
  assert.equal(output.run_id, persisted.manifest.run_id);
  const [receipt] = checkedEvidence(stemJob, output);
  assert.deepEqual(receipt, { kind: 'stem_manifest', table: 'music_stem_sets', track_key: 'synthetic-track', run_id: RUN, model: 'htdemucs', stems: 2, bytes: 6 });
});

test('creator stem evidence binds the manifest key to the job creator-track identity', async t => {
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.SUPABASE_URL = 'https://storage.invalid';
  process.env.SUPABASE_SECRET_KEY = 'synthetic-fixture-key';
  const currentJob = { ...stemJob, input: { source: 'creator', track_id: TRACK } };
  const output = await stemsSeparate(currentJob, stemDeps().deps);
  assert.equal(checkedEvidence(currentJob, output)[0].track_key, `ct-${TRACK}`);
  assert.throws(() => buildCompletionEvidence({ ...currentJob, input: { ...currentJob.input, track_id: '123e4567-e89b-42d3-a456-426614174001' } }, output), /track/);
});

test('failed stem persistence never reaches completion evidence', async () => {
  let reachedCompletion = false;
  await assert.rejects(async () => {
    const output = await stemsSeparate(stemJob, stemDeps({ failManifest: true }).deps);
    reachedCompletion = true;
    buildCompletionEvidence(stemJob, output);
  }, /stems manifest write refused/);
  assert.equal(reachedCompletion, false);
});

test('stems evidence refuses missing run receipts, false no-ops and invalid artifact counts', async () => {
  const output = await stemsSeparate(stemJob, stemDeps().deps);
  for (const [changes, message] of [
    [{ track_key: 'different-track' }, /track/],
    [{ executor: 'other:v1' }, /executor/],
    [{ run_id: undefined }, /run/],
    [{ run_id: '../elsewhere' }, /run/],
    [{ model: '' }, /model/],
    [{ stems: 0 }, /stem/],
    [{ stems: 1.5 }, /stem/],
    [{ bytes: 0 }, /bytes/],
    [{ bytes: '6' }, /bytes/],
    [{ written: false }, /no-op/],
  ]) assert.throws(() => buildCompletionEvidence(stemJob, { ...output, ...changes }), message, JSON.stringify(changes));
});

test('music receipts reject tampering after evidence generation', async () => {
  for (const [currentJob, output, key, changed] of [
    [lyricJob, await lyricsAlign(lyricJob, lyricDeps().deps), 'input_rev', 'a'.repeat(32)],
    [stemJob, await stemsSeparate(stemJob, stemDeps().deps), 'run_id', 'r20261124083001-123abc'],
  ]) {
    const evidenced = buildCompletionEvidence(currentJob, output, { startedAt: now, completedAt: now });
    evidenced[key] = changed;
    assert.throws(() => assertCompletionEvidence(currentJob, evidenced), /result digest does not match/);
  }
});
