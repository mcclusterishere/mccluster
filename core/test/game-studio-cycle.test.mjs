import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStudioExecutors } from '../src/executors/game-studio-cycle.mjs';

function harness() {
  const enqueued = [];
  const signals = [];
  const calls = [];
  const media = new Map();
  const jobs = new Map();
  let sequence = 0;

  async function callCapability(name, args) {
    calls.push({ name, args });
    if (name === 'media.model.recommend') return { result: { candidates: [{ model: { id: `model-${args.capability}` } }] } };
    if (name === 'media.generate') {
      const id = `media-${++sequence}`;
      const ext = args.model_id.includes('text-to-3d') ? 'glb' : 'png';
      media.set(id, { id, status: 'completed', assets: [{ url: `https://assets.invalid/${id}.${ext}` }] });
      return { provider: 'test', result: { job: { id, status: 'queued' } } };
    }
    if (name === 'media.job.get') return { result: { job: media.get(args.job_id) } };
    throw new Error(`unexpected capability ${name}`);
  }

  async function enqueue(input) {
    const job = { id: `queued-${enqueued.length + 1}`, status: 'queued', ...input };
    enqueued.push(job);
    jobs.set(job.id, job);
    return job;
  }
  async function signal(input) { signals.push(input); return input; }
  async function lookupJob(id) { return jobs.get(id) || null; }

  return { ...createGameStudioExecutors({ callCapability, enqueue, signal, lookupJob }), enqueued, signals, calls, jobs };
}

test('production cycle submits image and 3D jobs and schedules collection', async () => {
  const h = harness();
  const result = await h.gameStudioCycle({ id: 'studio-1', org_id: 'org-1', input: { campaign: 'PRIM3', brief: 'Build Site 0 tactical arrival zone.', budget_cents: 300 } });
  assert.equal(result.state, 'generating');
  assert.equal(result.submissions.length, 3);
  assert.equal(h.enqueued.at(-1).jobType, 'game_media_collect');
  assert.equal(h.calls.filter((x) => x.name === 'media.generate').length, 3);
  assert.ok(h.calls.some((x) => x.name === 'media.model.recommend' && x.args.capability === 'text-to-3d'));
  assert.deepEqual(h.calls.find((x) => x.name === 'media.generate').args.input, { prompt: h.calls.find((x) => x.name === 'media.generate').args.prompt });
});

test('collector emits owner review packet with generated assets', async () => {
  const h = harness();
  await h.gameStudioCycle({ id: 'studio-1', org_id: 'org-1', input: { campaign: 'PRIM3', repository: 'mcclusterishere/hitmans-halo', brief: 'Build Site 0 tactical arrival zone.', budget_cents: 300 } });
  const collectorInput = h.enqueued.at(-1).input;
  const result = await h.gameMediaCollect({ id: 'collect-1', org_id: 'org-1', input: collectorInput });
  assert.equal(result.state, 'awaiting_owner_review');
  assert.equal(result.approval_packet.candidates.length, 3);
  assert.equal(result.approval_packet.repository, 'mcclusterishere/hitmans-halo');
  assert.equal(h.signals.at(-1).kind, 'game_studio.owner_review_required');
});

test('owner approval queues implementation and durable validation watcher', async () => {
  const h = harness();
  const packet = { campaign: 'PRIM3', repository: 'mcclusterishere/hitmans-halo', brief: 'Site 0', iteration: 2, candidates: [{ deliverable_id: 'tactical-prop-3d', label: 'Tactical prop', assets: [{ url: 'https://assets.invalid/prop.glb' }] }] };
  const result = await h.gameOwnerDecision({ id: 'decision-approve', org_id: 'org-1', input: { decision: 'approve', notes: 'Use this near the arrival ramp.', approval_packet: packet } });
  assert.equal(result.state, 'implementation_queued');
  const implementation = h.enqueued.find((job) => job.jobType === 'code_patch');
  const watcher = h.enqueued.find((job) => job.jobType === 'game_implementation_collect');
  assert.ok(implementation);
  assert.ok(watcher);
  assert.equal(implementation.targetId, 'mcclusterishere/hitmans-halo');
  assert.match(implementation.input.task, /prop\.glb/);
  assert.match(implementation.input.task, /Godot/i);
  assert.equal(watcher.input.code_job_id, implementation.id);
  assert.equal(result.watcher_job_id, watcher.id);
});

test('implementation collector queues exact branch for Godot smoke validation', async () => {
  const h = harness();
  h.jobs.set('code-1', {
    id: 'code-1', status: 'done',
    output: { changed: true, branch: 'core/job-deadbeef', draft_pr: 'https://github.com/mcclusterishere/hitmans-halo/pull/1' }
  });
  const result = await h.gameImplementationCollect({ id: 'watch-1', org_id: 'org-1', target_id: 'mcclusterishere/hitmans-halo', input: { code_job_id: 'code-1', campaign: 'PRIM3', iteration: 2, approval_packet: { campaign: 'PRIM3' } } });
  assert.equal(result.state, 'validation_queued');
  assert.equal(result.branch, 'core/job-deadbeef');
  assert.equal(h.enqueued.at(-1).jobType, 'game_branch_smoke');
  assert.equal(h.enqueued.at(-1).input.branch, 'core/job-deadbeef');
});

test('owner rejection queues revised next iteration', async () => {
  const h = harness();
  const packet = { campaign: 'PRIM3', repository: 'mcclusterishere/hitmans-halo', brief: 'Site 0', iteration: 2, candidates: [{ deliverable_id: 'environment-keyframe' }] };
  const result = await h.gameOwnerDecision({ id: 'decision-1', org_id: 'org-1', input: { decision: 'reject', notes: 'Make it darker and more industrial.', budget_cents: 300, approval_packet: packet } });
  assert.equal(result.decision, 'reject');
  assert.equal(result.state, 'revision_queued');
  assert.equal(h.enqueued.at(-1).jobType, 'game_studio_cycle');
  assert.equal(h.enqueued.at(-1).input.iteration, 3);
  assert.match(h.enqueued.at(-1).input.revision_notes, /darker/i);
});

test('zero budget pauses safely instead of spending', async () => {
  const h = harness();
  const result = await h.gameStudioCycle({ id: 'studio-1', org_id: 'org-1', input: { campaign: 'PRIM3', brief: 'Site 0' } });
  assert.equal(result.state, 'blocked_budget');
  assert.equal(h.calls.length, 0);
  assert.equal(h.signals.at(-1).kind, 'game_studio.budget_required');
});
