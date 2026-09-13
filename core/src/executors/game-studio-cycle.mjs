import { addSignal, enqueueJob } from '../supabase.mjs';
import { callCoreCapability, unwrapCapabilityResult } from '../game-studio/capability-client.mjs';

const DEFAULT_DELIVERABLES = Object.freeze([
  { id: 'environment-keyframe', label: 'Environment keyframe', capability: 'text-to-image', prompt_suffix: 'cinematic environment concept art, navigable tactical space, no text, production design sheet quality' },
  { id: 'hero-loadout', label: 'Hero/loadout concept', capability: 'text-to-image', prompt_suffix: 'full-body character and equipment concept, neutral presentation, game production concept art, no text' },
  { id: 'tactical-prop-3d', label: 'Tactical prop 3D asset', capability: 'text-to-3d', prompt_suffix: 'single modular tactical interactable or environmental prop, fully textured, realistic game-production asset, clean silhouette, suitable for Godot import as GLB' },
]);

function text(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDeliverables(value) {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_DELIVERABLES;
  return source.slice(0, 6).map((item, index) => ({
    id: text(item?.id || `deliverable-${index + 1}`, 120),
    label: text(item?.label || item?.id || `Deliverable ${index + 1}`, 200),
    capability: text(item?.capability || 'text-to-image', 100),
    prompt_suffix: text(item?.prompt_suffix || '', 1500),
  }));
}

function candidatesFrom(value) {
  const unwrapped = unwrapCapabilityResult(value);
  if (Array.isArray(unwrapped?.candidates)) return unwrapped.candidates;
  if (Array.isArray(unwrapped?.result?.candidates)) return unwrapped.result.candidates;
  return [];
}

function jobFrom(value) {
  const unwrapped = unwrapCapabilityResult(value);
  return unwrapped?.job || unwrapped?.result?.job || unwrapped || null;
}

function mediaJobId(value) {
  const job = jobFrom(value);
  return text(job?.id || job?.job_id || job?.media_job_id || '', 200);
}

function mediaStatus(value) {
  const job = jobFrom(value);
  return text(job?.status || value?.status || '', 80).toLowerCase();
}

function mediaAssets(value) {
  const job = jobFrom(value);
  const candidates = [job?.assets, job?.asset_lineage, job?.provider_result?.assets, job?.result?.assets, job?.outputs];
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate;
  return [];
}

function terminal(status) {
  return ['done', 'complete', 'completed', 'succeeded', 'success', 'failed', 'cancelled', 'canceled'].includes(status);
}

function success(status) {
  return ['done', 'complete', 'completed', 'succeeded', 'success'].includes(status);
}

function buildPrompt({ brief, campaign, deliverable, revisionNotes, iteration }) {
  return [
    `${campaign} autonomous game studio production candidate, iteration ${iteration}.`,
    brief,
    deliverable.prompt_suffix,
    revisionNotes ? `Owner revision notes: ${revisionNotes}` : '',
    'Preserve established canon and avoid adding logos, typography, or UI unless explicitly requested.',
  ].filter(Boolean).join('\n\n');
}

function approvedAssetSummary(packet) {
  return (Array.isArray(packet?.candidates) ? packet.candidates : []).map((candidate) => ({
    deliverable_id: candidate.deliverable_id,
    label: candidate.label,
    media_job_id: candidate.media_job_id,
    model_id: candidate.model_id,
    assets: candidate.assets,
  }));
}

export function createGameStudioExecutors({
  callCapability = callCoreCapability,
  enqueue = enqueueJob,
  signal = addSignal,
} = {}) {
  async function gameStudioCycle(job) {
    const input = job.input || {};
    const orgId = job.org_id || input.org_id;
    if (!orgId) throw new Error('game_studio_cycle requires org_id');

    const brief = text(input.brief);
    if (!brief) throw new Error('game_studio_cycle requires brief');

    const campaign = text(input.campaign || 'PRIM3', 200);
    const iteration = Math.max(1, Math.trunc(number(input.iteration, 1)));
    const revisionNotes = text(input.revision_notes, 4000);
    const deliverables = normalizeDeliverables(input.deliverables);
    const budgetCents = Math.max(0, number(input.budget_cents, 0));

    if (budgetCents <= 0) {
      await signal({
        orgId,
        kind: 'game_studio.budget_required',
        severity: 'warning',
        body: `${campaign} studio is ready to generate ${deliverables.length} review candidates but no generation budget was authorized.`,
        metadata: { campaign, iteration, deliverables, requested_job_id: job.id },
      });
      return {
        executor: 'game_studio_cycle:v1.1',
        summary: `Paused ${campaign} production batch pending a generation budget.`,
        state: 'blocked_budget',
        campaign,
        iteration,
        deliverables,
      };
    }

    const perItemBudget = Math.max(1, Math.floor(budgetCents / deliverables.length));
    const submissions = [];

    for (const deliverable of deliverables) {
      const recommendation = await callCapability('media.model.recommend', {
        capability: deliverable.capability,
        preference: input.preference || 'quality',
        required: { commercial_use: true },
        top_k: 1,
      });
      const [choice] = candidatesFrom(recommendation);
      const modelId = choice?.model?.id || choice?.model?.model_id;
      if (!modelId) throw new Error(`No enabled ${deliverable.capability} model available for ${deliverable.id}`);

      const prompt = buildPrompt({ brief, campaign, deliverable, revisionNotes, iteration });
      const generated = await callCapability('media.generate', {
        org_id: orgId,
        model_id: modelId,
        prompt,
        input: {
          prompt,
          studio: 'mccluster-autonomous-game-studio',
          campaign,
          deliverable_id: deliverable.id,
          iteration,
          source_job_id: job.id,
        },
        budget_cents: perItemBudget,
      });
      const jobId = mediaJobId(generated);
      if (!jobId) throw new Error(`media.generate did not return a job id for ${deliverable.id}`);
      submissions.push({
        deliverable,
        media_job_id: jobId,
        model_id: modelId,
        provider: generated?.provider || null,
        prompt,
      });
    }

    const collector = await enqueue({
      orgId,
      jobType: 'game_media_collect',
      targetType: 'campaign',
      targetId: campaign,
      priority: 70,
      runAfter: new Date(Date.now() + 60_000).toISOString(),
      maxAttempts: 3,
      input: {
        campaign,
        brief,
        iteration,
        revision_notes: revisionNotes,
        budget_cents: budgetCents,
        repository: text(input.repository, 500) || 'mcclusterishere/hitmans-halo',
        submissions,
        poll_count: 0,
      },
    });

    return {
      executor: 'game_studio_cycle:v1.1',
      summary: `Submitted ${submissions.length} ${campaign} production candidates, including 3D where requested, and queued collection.`,
      state: 'generating',
      campaign,
      iteration,
      submissions,
      collector_job_id: collector.id,
    };
  }

  async function gameMediaCollect(job) {
    const input = job.input || {};
    const orgId = job.org_id || input.org_id;
    const submissions = Array.isArray(input.submissions) ? input.submissions : [];
    if (!orgId || !submissions.length) throw new Error('game_media_collect requires org_id and submissions');

    const collected = [];
    let allTerminal = true;
    for (const submission of submissions) {
      const result = await callCapability('media.job.get', { org_id: orgId, job_id: submission.media_job_id });
      const status = mediaStatus(result);
      if (!terminal(status)) allTerminal = false;
      collected.push({ ...submission, status, assets: mediaAssets(result), media: jobFrom(result) });
    }

    const pollCount = Math.max(0, Math.trunc(number(input.poll_count, 0)));
    if (!allTerminal) {
      if (pollCount >= 20) throw new Error('game media collection exceeded bounded polling window');
      const next = await enqueue({
        orgId,
        jobType: 'game_media_collect',
        targetType: 'campaign',
        targetId: input.campaign || 'PRIM3',
        priority: 70,
        runAfter: new Date(Date.now() + 60_000).toISOString(),
        maxAttempts: 3,
        input: { ...input, poll_count: pollCount + 1 },
      });
      return {
        executor: 'game_media_collect:v1.1',
        summary: `Generation still running; scheduled collection poll ${pollCount + 1}.`,
        state: 'waiting_generation',
        next_collector_job_id: next.id,
        collected: collected.map(({ media, ...rest }) => rest),
      };
    }

    const passed = collected.filter((item) => success(item.status));
    if (!passed.length) throw new Error('All game studio generation candidates failed');

    const packet = {
      schema_version: '1.1',
      decision_type: 'game_studio_batch',
      campaign: input.campaign || 'PRIM3',
      repository: input.repository || 'mcclusterishere/hitmans-halo',
      iteration: input.iteration || 1,
      source_job_id: job.id,
      brief: input.brief || '',
      revision_notes: input.revision_notes || '',
      candidates: passed.map((item) => ({
        deliverable_id: item.deliverable?.id,
        label: item.deliverable?.label,
        capability: item.deliverable?.capability,
        media_job_id: item.media_job_id,
        model_id: item.model_id,
        provider: item.provider,
        assets: item.assets,
        status: item.status,
      })),
      allowed_decisions: ['approve', 'reject'],
      decision_instruction: 'Approve to hand these assets and direction to the isolated Godot implementation agent. Reject with notes to regenerate a materially revised batch.',
    };

    await signal({
      orgId,
      kind: 'game_studio.owner_review_required',
      severity: 'info',
      body: `${packet.campaign} iteration ${packet.iteration} has ${packet.candidates.length} generated candidates ready for owner yes/no review.`,
      metadata: packet,
    });

    return {
      executor: 'game_media_collect:v1.1',
      summary: `${packet.campaign} iteration ${packet.iteration} is ready for owner review.`,
      state: 'awaiting_owner_review',
      approval_packet: packet,
    };
  }

  async function gameOwnerDecision(job) {
    const input = job.input || {};
    const orgId = job.org_id || input.org_id;
    const decision = text(input.decision, 30).toLowerCase();
    const packet = input.approval_packet || {};
    const notes = text(input.notes, 4000);
    if (!orgId) throw new Error('game_owner_decision requires org_id');
    if (!['approve', 'reject'].includes(decision)) throw new Error('game_owner_decision decision must be approve or reject');
    if (!packet.campaign || !packet.brief) throw new Error('game_owner_decision requires approval_packet from game_media_collect');

    let next;
    if (decision === 'approve') {
      const approved = approvedAssetSummary(packet);
      next = await enqueue({
        orgId,
        jobType: 'code_patch',
        targetType: 'repository',
        targetId: packet.repository || 'mcclusterishere/hitmans-halo',
        priority: 85,
        maxAttempts: 2,
        input: {
          title: `${packet.campaign}: implement approved studio batch ${packet.iteration}`,
          task: [
            `Implement the owner-approved ${packet.campaign} game-studio batch in the Godot project.`,
            `Campaign brief: ${packet.brief}`,
            notes ? `Owner notes: ${notes}` : '',
            'Approved media/assets with lineage:',
            JSON.stringify(approved, null, 2),
            'Import usable GLB/image/audio assets into the project where appropriate, preserve provenance in a machine-readable manifest, wire them into a bounded playable scene or existing level, and run available Godot/static tests. Do not deploy or merge.',
          ].filter(Boolean).join('\n\n'),
          approved_assets: approved,
          campaign: packet.campaign,
          studio_iteration: packet.iteration,
        },
      });
    } else {
      const nextIteration = Math.max(1, Math.trunc(number(packet.iteration, 1))) + 1;
      next = await enqueue({
        orgId,
        jobType: 'game_studio_cycle',
        targetType: 'campaign',
        targetId: packet.campaign,
        priority: 75,
        input: {
          campaign: packet.campaign,
          repository: packet.repository || 'mcclusterishere/hitmans-halo',
          brief: packet.brief,
          iteration: nextIteration,
          budget_cents: Math.max(0, number(input.budget_cents, 0)),
          revision_notes: notes || 'Owner rejected prior batch; produce a materially different revision.',
          phase: 'revise',
        },
      });
    }

    await signal({
      orgId,
      kind: `game_studio.owner_${decision}`,
      severity: 'info',
      body: decision === 'approve'
        ? `${packet.campaign} iteration ${packet.iteration} approved; queued isolated Godot implementation.`
        : `${packet.campaign} iteration ${packet.iteration} rejected; queued revised generation batch.`,
      metadata: { decision, notes, prior_packet: packet, next_job_id: next.id },
    });

    return {
      executor: 'game_owner_decision:v1.1',
      summary: decision === 'approve'
        ? `${packet.campaign} owner approval recorded; queued implementation job.`
        : `${packet.campaign} owner rejection recorded; queued revised studio batch.`,
      state: decision === 'approve' ? 'implementation_queued' : 'revision_queued',
      decision,
      next_job_id: next.id,
    };
  }

  return { gameStudioCycle, gameMediaCollect, gameOwnerDecision };
}

const defaults = createGameStudioExecutors();
export const gameStudioCycle = defaults.gameStudioCycle;
export const gameMediaCollect = defaults.gameMediaCollect;
export const gameOwnerDecision = defaults.gameOwnerDecision;
