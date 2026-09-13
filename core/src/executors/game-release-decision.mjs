import { enqueueJob, addSignal } from '../supabase.mjs';

function text(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

export async function gameReleaseDecision(job) {
  const input = job.input || {};
  const orgId = job.org_id || input.org_id;
  const decision = text(input.decision, 30).toLowerCase();
  const evidence = input.validation_evidence || {};
  const repository = text(input.repository || evidence.repository, 500);
  const branch = text(input.branch || evidence.branch, 240);
  const campaign = text(input.campaign || 'PRIM3', 200);
  const notes = text(input.notes, 4000);

  if (!orgId) throw new Error('game_release_decision requires org_id');
  if (!['approve', 'reject'].includes(decision)) throw new Error('game_release_decision decision must be approve or reject');
  if (!repository || !branch) throw new Error('game_release_decision requires repository and validated branch');

  if (decision === 'approve') {
    const preview = await enqueueJob({
      orgId,
      jobType: 'preview_deploy',
      targetType: 'repository',
      targetId: repository,
      priority: 90,
      maxAttempts: 2,
      input: {
        repository,
        ref: branch,
        directory: text(input.directory || '.', 1000),
        campaign,
        validation_evidence: evidence,
      },
    });
    await addSignal({
      orgId,
      kind: 'game_studio.preview_approved',
      severity: 'info',
      body: `${campaign} validated branch ${branch} approved for non-production preview deployment.`,
      metadata: { repository, branch, preview_job_id: preview.id, notes, validation_evidence: evidence },
    });
    return {
      executor: 'game_release_decision:v1',
      state: 'preview_queued',
      decision,
      preview_job_id: preview.id,
      repository,
      branch,
    };
  }

  const revision = await enqueueJob({
    orgId,
    jobType: 'code_patch',
    targetType: 'repository',
    targetId: repository,
    priority: 85,
    maxAttempts: 2,
    input: {
      title: `${campaign}: revise validated autonomous build`,
      task: [
        `Revise the ${campaign} Godot implementation after owner rejection.`,
        `Start from the current repository main state but use the prior validated branch ${branch} and its evidence as reference; do not merge or deploy.`,
        notes ? `Owner revision notes: ${notes}` : 'Owner rejected the validated build; materially improve the implementation while preserving approved canon and provenance.',
        'Prior validation evidence:',
        JSON.stringify(evidence, null, 2),
        'Run relevant Godot/static checks and return a new draft branch for validation.'
      ].join('\n\n'),
      campaign,
      prior_branch: branch,
      validation_evidence: evidence,
    },
  });

  const watcher = await enqueueJob({
    orgId,
    jobType: 'game_implementation_collect',
    targetType: 'repository',
    targetId: repository,
    priority: 80,
    runAfter: new Date(Date.now() + 60_000).toISOString(),
    maxAttempts: 3,
    input: {
      code_job_id: revision.id,
      campaign,
      iteration: input.iteration || null,
      approval_packet: input.approval_packet || null,
      poll_count: 0,
    },
  });

  await addSignal({
    orgId,
    kind: 'game_studio.preview_rejected',
    severity: 'info',
    body: `${campaign} validated branch ${branch} rejected; queued autonomous revision and revalidation.`,
    metadata: { repository, branch, revision_job_id: revision.id, watcher_job_id: watcher.id, notes, validation_evidence: evidence },
  });

  return {
    executor: 'game_release_decision:v1',
    state: 'revision_queued',
    decision,
    revision_job_id: revision.id,
    watcher_job_id: watcher.id,
    repository,
    branch,
  };
}
