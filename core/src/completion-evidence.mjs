import { createHash } from 'node:crypto';

export const COMPLETION_EVIDENCE_SCHEMA = 'mccluster-completion-evidence/v1';

const SHA40 = /^[0-9a-f]{40}$/i;

function fail(job, message) {
  throw new Error(`completion evidence rejected for ${job?.job_type || 'unknown'}: ${message}`);
}

function requireValue(job, condition, message) {
  if (!condition) fail(job, message);
}

function text(value) {
  return String(value ?? '').trim();
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function validDate(value) {
  return Boolean(value) && Number.isFinite(Date.parse(String(value)));
}

function validHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => canonicalize(item === undefined ? null : item));
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
    }
    return result;
  }
  if (value === undefined) return null;
  return String(value);
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function resultDigest(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function rawOutput(output) {
  requireValue({ job_type: 'completion_boundary' }, output && typeof output === 'object' && !Array.isArray(output), 'executor output must be an object');
  const { completion_evidence: _ignored, ...raw } = output;
  return raw;
}

function childJobs(job, ids, relation) {
  const normalized = ids.map((id) => text(id)).filter(Boolean);
  requireValue(job, normalized.length === ids.length, `${relation} contains an empty job id`);
  return { kind: 'child_jobs', relation, job_ids: normalized };
}

function policyEvidence(job, output) {
  const type = text(job?.job_type);
  const records = [];

  switch (type) {
    case 'repo_health': {
      requireValue(job, SHA40.test(text(output.head)), 'repo_health must report an exact 40-character HEAD SHA');
      if (output.origin_main) requireValue(job, SHA40.test(text(output.origin_main)), 'origin_main must be an exact 40-character SHA when present');
      if (job?.input?.tests === true || output?.tests?.requested === true) {
        requireValue(job, output?.tests?.ran === true, 'requested repository tests did not run');
        requireValue(job, output?.tests?.ok === true, 'requested repository tests did not pass');
      }
      records.push({
        kind: 'git_snapshot',
        repository: text(output.repo),
        head_sha: text(output.head),
        origin_main_sha: output.origin_main ? text(output.origin_main) : null,
        clean: output.clean === true,
      });
      if (output?.tests?.ran === true) records.push({ kind: 'test_run', suite: 'repo_health', ok: output.tests.ok === true, duration_ms: output.tests.duration_ms ?? null });
      break;
    }

    case 'local_analysis': {
      requireValue(job, Boolean(text(output.model)), 'local analysis must identify the model used');
      requireValue(job, output.analysis && typeof output.analysis === 'object', 'local analysis must return structured analysis');
      records.push({ kind: 'model_result', model: text(output.model), evidence_scope: text(output.evidence_scope || 'job_input_only') });
      break;
    }

    case 'code_patch': {
      requireValue(job, Boolean(text(output.repo)) && Boolean(text(output.branch)), 'code patch must identify repository and branch');
      requireValue(job, SHA40.test(text(output.base_commit)), 'code patch must report the exact base commit compared');
      if (output.changed === true) {
        requireValue(job, SHA40.test(text(output.commit)), 'changed code patch must report an exact commit SHA');
        requireValue(job, output?.verification?.git_diff_check === true, 'changed code patch must pass git diff --check');
        records.push({
          kind: 'git_commit',
          repository: text(output.repo),
          branch: text(output.branch),
          base_sha: text(output.base_commit),
          commit_sha: text(output.commit),
          pushed: output.pushed === true,
          draft_pr: output.draft_pr ? text(output.draft_pr) : null,
        });
      } else {
        requireValue(job, output.changed === false, 'code patch must explicitly report changed=true|false');
        requireValue(job, output?.verification?.git_status_clean === true, 'no-change code patch must prove a clean Git status');
        records.push({ kind: 'git_no_change', repository: text(output.repo), branch: text(output.branch), base_sha: text(output.base_commit) });
      }
      break;
    }

    case 'objective_reflection': {
      requireValue(job, Array.isArray(output.queued_jobs), 'objective reflection must report queued_jobs');
      requireValue(job, output.source_counts && finite(output.source_counts.objectives) && finite(output.source_counts.recent_jobs), 'objective reflection must report source counts');
      records.push({ kind: 'source_snapshot', objectives: Number(output.source_counts.objectives), recent_jobs: Number(output.source_counts.recent_jobs) });
      records.push(childJobs(job, output.queued_jobs.map((item) => item?.id), 'reflection_children'));
      break;
    }

    case 'objective_plan': {
      requireValue(job, Boolean(text(output.plan_id)), 'objective plan must report plan_id');
      requireValue(job, Array.isArray(output.queued_steps), 'objective plan must report queued_steps');
      records.push({ kind: 'objective_plan', plan_id: text(output.plan_id), step_count: output.queued_steps.length, retry_safe: output.retry_safe === true });
      records.push(childJobs(job, output.queued_steps.map((item) => item?.id), 'plan_children'));
      break;
    }

    case 'objective_synthesis': {
      requireValue(job, ['ignore', 'create', 'update'].includes(output.action), 'objective synthesis must report ignore|create|update');
      requireValue(job, Boolean(text(output?.source?.conversation_id)) && Boolean(text(output?.source?.fingerprint)), 'objective synthesis must retain its private context reference and source fingerprint');
      records.push({
        kind: 'private_context_reference',
        conversation_id: text(output.source.conversation_id),
        fingerprint: text(output.source.fingerprint),
        action: output.action,
      });
      if (output.action === 'create' || output.action === 'update') {
        requireValue(job, Boolean(text(output?.objective?.id)), `${output.action} synthesis must report the mutated objective id`);
        records.push({ kind: 'database_mutation', table: 'ops_objectives', record_id: text(output.objective.id), action: output.action });
      }
      if (output.reflection_job_id) records.push(childJobs(job, [output.reflection_job_id], 'synthesis_reflection'));
      break;
    }

    case 'portfolio_plan': {
      requireValue(job, output.plan && typeof output.plan === 'object', 'portfolio plan must return its ranked plan');
      requireValue(job, validDate(output.plan.generated_at), 'portfolio plan must report a valid generated_at timestamp');
      requireValue(job, Array.isArray(output.queued_reflections), 'portfolio plan must report queued_reflections');
      records.push({ kind: 'portfolio_snapshot', generated_at: output.plan.generated_at, initiative_count: Number(output.plan.initiative_count || 0) });
      records.push(childJobs(job, output.queued_reflections.map((item) => item?.id), 'portfolio_reflections'));
      break;
    }

    case 'game_build_plan': {
      requireValue(job, output.plan && Array.isArray(output.plan.stages), 'game build plan must report stages');
      records.push({ kind: 'game_plan', campaign: text(output?.plan?.spec?.campaign || job?.target_id), stage_count: output.plan.stages.length });
      break;
    }

    case 'game_playtest': {
      requireValue(job, Boolean(text(output?.evidence?.artifact_dir)), 'game playtest must report its artifact directory');
      requireValue(job, output?.evidence?.run && typeof output.evidence.run === 'object', 'game playtest must return structured run evidence');
      requireValue(job, output.evaluation && finite(output.evaluation.score), 'game playtest must return a numeric evaluation score');
      records.push({
        kind: 'playtest',
        artifact_dir: text(output.evidence.artifact_dir),
        terminal_status: text(output?.evidence?.run?.terminal?.status || 'unknown'),
        score: Number(output.evaluation.score),
        timed_out: output.evidence.timed_out === true,
      });
      break;
    }

    case 'game_studio_cycle': {
      requireValue(job, Boolean(text(output.state)), 'game studio cycle must report state');
      if (output.state === 'blocked_budget') {
        requireValue(job, Array.isArray(output.deliverables), 'blocked game studio cycle must report requested deliverables');
        records.push({ kind: 'authorization_gate', gate: 'generation_budget', state: 'blocked', deliverable_count: output.deliverables.length });
      } else if (output.state === 'generating') {
        requireValue(job, nonEmptyArray(output.submissions), 'generating game studio cycle must report media submissions');
        const mediaIds = output.submissions.map((item) => text(item?.media_job_id));
        requireValue(job, mediaIds.every(Boolean), 'every game studio submission must report media_job_id');
        requireValue(job, Boolean(text(output.collector_job_id)), 'game studio cycle must report collector job id');
        records.push({ kind: 'media_jobs', media_job_ids: mediaIds });
        records.push(childJobs(job, [output.collector_job_id], 'media_collector'));
      } else {
        fail(job, `unsupported game_studio_cycle state ${text(output.state)}`);
      }
      break;
    }

    case 'game_media_collect': {
      requireValue(job, Boolean(text(output.state)), 'game media collector must report state');
      if (output.state === 'waiting_generation') {
        requireValue(job, Boolean(text(output.next_collector_job_id)), 'waiting media collector must report next collector job');
        records.push(childJobs(job, [output.next_collector_job_id], 'media_repoll'));
      } else if (output.state === 'awaiting_owner_review') {
        const candidates = output?.approval_packet?.candidates;
        requireValue(job, nonEmptyArray(candidates), 'owner review packet must contain successful media candidates');
        for (const candidate of candidates) {
          requireValue(job, Boolean(text(candidate?.media_job_id)), 'owner review candidate is missing media_job_id');
          requireValue(job, nonEmptyArray(candidate?.assets), `media job ${candidate?.media_job_id || 'unknown'} has no asset evidence`);
        }
        records.push({ kind: 'media_assets', media_job_ids: candidates.map((item) => text(item.media_job_id)), asset_count: candidates.reduce((sum, item) => sum + item.assets.length, 0) });
      } else {
        fail(job, `unsupported game_media_collect state ${text(output.state)}`);
      }
      break;
    }

    case 'game_owner_decision': {
      requireValue(job, ['approve', 'reject'].includes(output.decision), 'game owner decision must report approve|reject');
      requireValue(job, Boolean(text(output.state)), 'game owner decision must report state');
      if (output.state === 'implementation_queued') {
        requireValue(job, Boolean(text(output.next_job_id)) && Boolean(text(output.watcher_job_id)), 'approved game batch must report implementation and watcher jobs');
        records.push(childJobs(job, [output.next_job_id, output.watcher_job_id], 'owner_approved_children'));
      } else if (output.state === 'revision_queued') {
        requireValue(job, Boolean(text(output.next_job_id)), 'rejected game batch must report revision job');
        records.push(childJobs(job, [output.next_job_id], 'owner_rejected_revision'));
      } else {
        fail(job, `unsupported game_owner_decision state ${text(output.state)}`);
      }
      records.push({ kind: 'owner_decision', decision: output.decision, state: output.state });
      break;
    }

    case 'game_implementation_collect': {
      requireValue(job, Boolean(text(output.state)), 'game implementation collector must report state');
      if (output.state === 'waiting_implementation') {
        requireValue(job, Boolean(text(output.next_collector_job_id)), 'waiting implementation collector must report next collector job');
        records.push(childJobs(job, [output.next_collector_job_id], 'implementation_repoll'));
      } else if (output.state === 'validation_queued') {
        requireValue(job, Boolean(text(output.branch)) && Boolean(text(output.code_job_id)) && Boolean(text(output.smoke_job_id)), 'validation queue must identify branch, code job, and smoke job');
        records.push({ kind: 'implementation_branch', branch: text(output.branch), source_job_id: text(output.code_job_id) });
        records.push(childJobs(job, [output.smoke_job_id], 'implementation_validation'));
      } else {
        fail(job, `unsupported game_implementation_collect state ${text(output.state)}`);
      }
      break;
    }

    case 'game_branch_smoke': {
      requireValue(job, SHA40.test(text(output?.evidence?.commit)), 'game branch smoke must report exact commit SHA');
      requireValue(job, output?.evidence?.import?.ok === true, 'Godot import verification did not pass');
      requireValue(job, output?.evidence?.launch?.ok === true, 'Godot launch verification did not pass');
      records.push({
        kind: 'game_runtime_validation',
        repository: text(output.evidence.repository),
        branch: text(output.evidence.branch),
        commit_sha: text(output.evidence.commit),
        import_ok: true,
        launch_ok: true,
      });
      break;
    }

    case 'game_release_decision': {
      requireValue(job, ['approve', 'reject'].includes(output.decision), 'game release decision must report approve|reject');
      if (output.state === 'preview_queued') {
        requireValue(job, Boolean(text(output.preview_job_id)), 'approved release must report preview job id');
        records.push(childJobs(job, [output.preview_job_id], 'release_preview'));
      } else if (output.state === 'revision_queued') {
        requireValue(job, Boolean(text(output.revision_job_id)) && Boolean(text(output.watcher_job_id)), 'rejected release must report revision and watcher jobs');
        records.push(childJobs(job, [output.revision_job_id, output.watcher_job_id], 'release_revision'));
      } else {
        fail(job, `unsupported game_release_decision state ${text(output.state)}`);
      }
      records.push({ kind: 'owner_decision', decision: output.decision, state: output.state, repository: text(output.repository), branch: text(output.branch) });
      break;
    }

    case 'preview_deploy': {
      requireValue(job, output.production === false, 'preview deployment must explicitly prove production=false');
      requireValue(job, validHttpsUrl(output.preview_url), 'preview deployment must report a valid HTTPS URL');
      requireValue(job, Boolean(text(output.provider)), 'preview deployment must identify provider');
      records.push({ kind: 'deployment', environment: 'preview', provider: text(output.provider), url: text(output.preview_url), production: false, repository: text(output.repository), ref: text(output.ref) });
      break;
    }

    case 'lead_rescore': {
      requireValue(job, finite(output.recomputed_count), 'lead rescore must report recomputed_count');
      requireValue(job, Number(output.recomputed_count) >= 0, 'lead rescore recomputed_count cannot be negative');
      requireValue(job, Boolean(text(output.summary)), 'lead rescore must report a summary');
      if (output.target_score !== null && output.target_score !== undefined) {
        requireValue(
          job,
          output.target_score && typeof output.target_score === 'object' && !Array.isArray(output.target_score),
          'lead rescore target_score must be an object when present',
        );
      }
      records.push({
        kind: 'database_recompute',
        operation: 'ops_recompute_lead_scores',
        recomputed_count: Number(output.recomputed_count),
        target_company_id: job?.target_type === 'company' ? text(job?.target_id) : null,
        target_score_present: Boolean(output.target_score),
      });
      break;
    }

    case 'host_health': {
      requireValue(job, validDate(output.checked_at), 'host health must report checked_at');
      requireValue(job, Boolean(text(output?.host?.hostname)), 'host health must report hostname');
      requireValue(job, output.services && typeof output.services === 'object', 'host health must report service states');
      if (output?.deployment?.deployed_sha) requireValue(job, SHA40.test(text(output.deployment.deployed_sha)), 'deployed_sha must be an exact commit SHA when present');
      records.push({
        kind: 'health_probe',
        hostname: text(output.host.hostname),
        checked_at: output.checked_at,
        deployed_sha: output?.deployment?.deployed_sha ? text(output.deployment.deployed_sha) : null,
        service_states: canonicalize(output.services),
      });
      break;
    }

    case 'sms_assistant_turn': {
      requireValue(job, ['reply', 'escalate', 'ignore'].includes(output.action), 'SMS assistant must report reply|escalate|ignore');
      requireValue(job, Boolean(text(output.thread_id)) && Boolean(text(output.inbound_message_id)), 'SMS assistant must identify thread and inbound message');
      if (output.action === 'reply') {
        requireValue(job, Boolean(text(output.outbound_message_id)), 'SMS reply must report durable outbound message id');
        requireValue(job, Boolean(text(output.outbox_transport)), 'SMS reply must identify outbox transport');
        records.push({ kind: 'message_queued', thread_id: text(output.thread_id), inbound_message_id: text(output.inbound_message_id), outbound_message_id: text(output.outbound_message_id), transport: text(output.outbox_transport) });
      } else {
        records.push({ kind: 'communications_decision', action: output.action, thread_id: text(output.thread_id), inbound_message_id: text(output.inbound_message_id), reason: text(output.reason) });
      }
      break;
    }

    default:
      fail(job, `no completion evidence policy exists for job type ${type || 'unknown'}`);
  }

  return records;
}

function expectedRecords(job, raw) {
  return [
    { kind: 'result_digest', algorithm: 'sha256', sha256: resultDigest(raw) },
    ...policyEvidence(job, raw),
  ];
}

export function buildCompletionEvidence(job, output, { startedAt = new Date().toISOString(), completedAt = new Date().toISOString() } = {}) {
  const raw = rawOutput(output);
  requireValue(job, validDate(startedAt), 'startedAt must be a valid timestamp');
  requireValue(job, validDate(completedAt), 'completedAt must be a valid timestamp');
  const records = expectedRecords(job, raw);
  return {
    ...raw,
    completion_evidence: {
      schema_version: COMPLETION_EVIDENCE_SCHEMA,
      job_id: text(job?.id),
      job_type: text(job?.job_type),
      executor: text(raw.executor),
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
      verified_at: new Date().toISOString(),
      result_sha256: records[0].sha256,
      records,
    },
  };
}

export function assertCompletionEvidence(job, output) {
  const evidence = output?.completion_evidence;
  requireValue(job, evidence && typeof evidence === 'object', 'completion_evidence envelope is required');
  requireValue(job, evidence.schema_version === COMPLETION_EVIDENCE_SCHEMA, `schema_version must be ${COMPLETION_EVIDENCE_SCHEMA}`);
  requireValue(job, text(evidence.job_id) === text(job?.id), 'evidence job_id does not match claimed job');
  requireValue(job, text(evidence.job_type) === text(job?.job_type), 'evidence job_type does not match claimed job');
  requireValue(job, validDate(evidence.started_at) && validDate(evidence.completed_at) && validDate(evidence.verified_at), 'evidence timestamps are invalid');
  requireValue(job, Array.isArray(evidence.records), 'evidence records must be an array');

  const raw = rawOutput(output);
  const expected = expectedRecords(job, raw);
  requireValue(job, evidence.result_sha256 === expected[0].sha256, 'result digest does not match executor output');
  requireValue(job, stableStringify(evidence.records) === stableStringify(expected), 'evidence records do not match the current job policy');
  requireValue(job, text(evidence.executor) === text(raw.executor), 'evidence executor does not match executor output');
  return true;
}
