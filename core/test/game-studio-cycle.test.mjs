import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStudioExecutors } from '../src/executors/game-studio-cycle.mjs';

function harness() {
  const enqueued = [];
  const signals = [];
  const calls = [];
  const media = new Map();
  let sequence = 0;

  async function callCapability(name, args) {
    calls.push({ name, args });
    if (name === 'media.model.recommend') {
      return { result: { candidates: [{ model: { id: 'model-image-1' } }] } };
    }
    if (name === 'media.generate') {
      const id = `media-${++sequence}`;
      media.set(id, { id, status: 'completed', assets: [{ url: `https://assets.invalid/${id}.png` }] });
      return { provider: 'test', result: { job: { id, status: 'queued' } } };
    }
    if (name === 'media.job.get') {
      return { result: { job: media.get(args.job_id) } };
    }
    throw new Error(`unexpected capability ${name}`);
  }

  async function enqueue(input) {
    const job = { id: `queued-${enqueued.length + 1}`, ...input };
    enqueued.push(job);
    return job;
  }

  async function signal(input) {
    signals.push(input);
    return input;
  }

  return { ...createGameStudioExecutors({ callCapability, enqueue, signal }), enqueued, signals, calls };
}

test('production cycle submits tracked media jobs and schedules collection', async () => {
  const h = harness();
  const result = await h.gameStudioCycle({
    id: 'studio-1', org_id: 'org-1', input: { campaign: 'PRIM3', brief: 'Build Site 0 tactical arrival zone.', budget_cents: 300 },
  });
  assert.equal(result.state, 'generating');
  assert.equal(result.submissions.length, 3);
  assert.equal(h.enqueued.at(-1).jobType, 'game_media_collect');
  assert.equal(h.calls.filter((x) => x.name === 'media.generate').length, 3);
});

test('collector emits owner review packet with generated assets', async () => {
  const h = harness();
  const cycle = await h.gameStudioCycle({
    id: 'studio-1', org_id: 'org-1', input: { campaign: 'PRIM3', brief: 'Build Site 0 tactical arrival zone.', budget_cents: 300 },
  });
  const collectorInput = h.enqueued.at(-1).input;
  const result = await h.gameMediaCollect({ id: 'collect-1', org_id: 'org-1', input: collectorInput });
  assert.equal(result.state, 'awaiting_owner_review');
  assert.equal(result.approval_packet.candidates.length, 3);
  assert.equal(h.signals.at(-1).kind, 'game_studio.owner_review_required');
});

test('owner rejection queues revised next iteration', async () => {
  const h = harness();
  const packet = { campaign: 'PRIM3', brief: 'Site 0', iteration: 2, candidates: [{ deliverable_id: 'environment-keyframe' }] };
  const result = await h.gameOwnerDecision({
    id: 'decision-1', org_id: 'org-1', input: { decision: 'reject', notes: 'Make it darker and more industrial.', budget_cents: 300, approval_packet: packet },
  });
  assert.equal(result.decision, 'reject');
  assert.equal(result.next_iteration, 3);
  assert.equal(h.enqueued.at(-1).jobType, 'game_studio_cycle');
  assert.match(h.enqueued.at(-1).input.revision_notes, /darker/i);
});

test('zero budget pauses safely instead of spending', async () => {
  const h = harness();
  const result = await h.gameStudioCycle({ id: 'studio-1', org_id: 'org-1', input: { campaign: 'PRIM3', brief: 'Site 0' } });
  assert.equal(result.state, 'blocked_budget');
  assert.equal(h.calls.length, 0);
  assert.equal(h.signals.at(-1).kind, 'game_studio.budget_required');
});
