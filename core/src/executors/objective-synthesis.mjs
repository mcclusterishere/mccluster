import { createHash } from 'node:crypto';
import { fetchConversationContext } from '../context-client.mjs';
import { checkpointJobInput, enqueueJob, recentObjectives } from '../supabase.mjs';
import { createObjective, updateObjective } from '../objective-store.mjs';
import { extractJsonObject } from '../reflection-policy.mjs';
import { normalizeObjectiveSynthesis } from '../objective-synthesis-policy.mjs';

const OLLAMA = String(process.env.MCCLUSTER_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';

function deterministicUuid(seed) {
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function sourceScope(job) {
  const source = job.input?.source && typeof job.input.source === 'object' ? job.input.source : {};
  return {
    provider: String(source.provider || 'unknown').slice(0, 120),
    conversation_id: String(source.conversation_id || job.target_id || '').slice(0, 200),
    receipt_id: String(source.receipt_id || '').slice(0, 200),
    external_conversation_id: String(source.external_conversation_id || '').slice(0, 500),
    idempotency_key: String(source.idempotency_key || '').slice(0, 500),
    fingerprint: String(source.fingerprint || '').slice(0, 128),
    source_url: String(source.source_url || '').slice(0, 2000) || null,
    observed_at: String(source.observed_at || '').slice(0, 80) || null,
  };
}

function mergeScope(existing, source, synthesis, jobId) {
  const current = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const prior = Array.isArray(current?.synthesis?.sources) ? current.synthesis.sources : [];
  const sources = [...prior, source]
    .filter((item, index, list) => item?.fingerprint && list.findIndex((candidate) => candidate?.fingerprint === item.fingerprint) === index)
    .slice(-12);
  return {
    ...current,
    synthesis: {
      ...(current.synthesis && typeof current.synthesis === 'object' ? current.synthesis : {}),
      sources,
      last_confidence: synthesis.confidence,
      last_reason: synthesis.reason,
      last_job_id: jobId,
      updated_at: new Date().toISOString(),
    },
  };
}

function validDecisionCheckpoint(value) {
  return value && typeof value === 'object'
    && value.schema_version === '2'
    && value.source && typeof value.source === 'object'
    && value.synthesis && typeof value.synthesis === 'object';
}

export async function objectiveSynthesis(job) {
  if (!job.org_id) throw new Error('objective_synthesis requires org_id');
  const source = sourceScope(job);
  if (!source.conversation_id || !source.fingerprint) throw new Error('objective_synthesis requires a private context reference and source fingerprint');

  const activeObjectives = (await recentObjectives({ orgId: job.org_id, limit: 50 }))
    .filter((objective) => objective?.status === 'active');

  let checkpoint = job.input?.objective_synthesis_checkpoint;
  let synthesis;
  let usage = checkpoint?.usage || null;
  let evidenceMeta = checkpoint?.evidence || null;

  if (validDecisionCheckpoint(checkpoint)) {
    synthesis = checkpoint.synthesis;
  } else {
    const context = await fetchConversationContext({
      orgId: job.org_id,
      conversationId: source.conversation_id,
      maxMessages: 40,
      maxChars: 96_000,
    });
    const messages = Array.isArray(context.messages) ? context.messages : [];
    if (!messages.length) throw new Error('private context conversation contained no messages');

    const system = [
      'You are the McCluster Core objective synthesis engine.',
      'Determine whether the supplied conversation contains a durable user objective that should enter or update the canonical objective registry.',
      'An objective is a sustained outcome the user intends to pursue, not a one-off factual question, casual thought, transient status update, or assistant suggestion the user did not adopt.',
      'Prefer updating an existing active canonical objective over creating a near-duplicate.',
      'Never mark objectives completed or cancelled. Never create jobs, plans, communications, purchases, legal actions, deployments, auth changes, or destructive actions.',
      'Use only the supplied private conversation and active canonical objectives. Do not claim external facts that are not present.',
      'Return JSON only with action ignore|create|update, confidence 0..1, reason, and for create/update: name, description, priority, success_metric. For update also return objective_id from the supplied active objective set.',
    ].join(' ');

    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ canonical_objectives: activeObjectives, conversation: messages, source }) },
        ],
        options: {
          temperature: 0,
          num_ctx: Number(process.env.MCCLUSTER_OLLAMA_CONTEXT || 16384),
        },
      }),
      signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_TIMEOUT_MS || 10 * 60_000)),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `Ollama returned ${response.status}`);
    const raw = String(data?.message?.content || '').trim();
    if (!raw) throw new Error('Ollama returned an empty objective synthesis');

    synthesis = normalizeObjectiveSynthesis(extractJsonObject(raw), {
      existingObjectiveIds: activeObjectives.map((objective) => objective.id),
    });
    usage = {
      prompt_eval_count: data?.prompt_eval_count ?? null,
      eval_count: data?.eval_count ?? null,
      total_duration_ns: data?.total_duration ?? null,
    };
    evidenceMeta = {
      private_context: true,
      conversation_id: source.conversation_id,
      message_count: messages.length,
      returned_chars: context?.limits?.returned_chars ?? null,
      transcript_persisted_in_public_job: false,
    };

    checkpoint = {
      schema_version: '2',
      source,
      synthesis,
      usage,
      evidence: evidenceMeta,
    };
    await checkpointJobInput(job, {
      ...(job.input && typeof job.input === 'object' ? job.input : {}),
      objective_synthesis_checkpoint: checkpoint,
    });
  }

  if (synthesis.action === 'ignore') {
    return {
      executor: 'objective_synthesis:v2',
      model: MODEL,
      action: 'ignore',
      confidence: synthesis.confidence,
      reason: synthesis.reason,
      source,
      evidence: evidenceMeta,
      retry_safe: true,
    };
  }

  let objective;
  const mutationCheckpoint = job.input?.objective_synthesis_mutation;
  if (mutationCheckpoint?.objective_id) {
    objective = activeObjectives.find((item) => String(item.id) === String(mutationCheckpoint.objective_id)) || {
      id: mutationCheckpoint.objective_id,
      name: mutationCheckpoint.name,
      priority: mutationCheckpoint.priority,
      status: mutationCheckpoint.status || 'active',
    };
  } else if (synthesis.action === 'update') {
    const existing = activeObjectives.find((item) => String(item.id) === synthesis.objective_id);
    if (!existing) throw new Error(`Active objective ${synthesis.objective_id} was not found for synthesis update`);
    objective = await updateObjective({
      orgId: job.org_id,
      objectiveId: synthesis.objective_id,
      name: synthesis.name,
      description: synthesis.description,
      priority: synthesis.priority,
      successMetric: synthesis.success_metric,
      scope: mergeScope(existing.scope, source, synthesis, job.id),
    });
  } else {
    const objectiveId = deterministicUuid(`objective-synthesis:${job.id}:${source.fingerprint}`);
    objective = await createObjective({
      objectiveId,
      orgId: job.org_id,
      name: synthesis.name,
      description: synthesis.description,
      priority: synthesis.priority,
      successMetric: synthesis.success_metric,
      scope: mergeScope({}, source, synthesis, job.id),
    });
  }

  const mutation = {
    objective_id: objective.id,
    name: objective.name,
    priority: objective.priority,
    status: objective.status,
    action: synthesis.action,
  };
  if (!mutationCheckpoint?.objective_id) {
    await checkpointJobInput(job, {
      ...(job.input && typeof job.input === 'object' ? job.input : {}),
      objective_synthesis_checkpoint: checkpoint,
      objective_synthesis_mutation: mutation,
    });
  }

  let reflectionJob = null;
  const shouldReflect = job.input?.schedule_reflection !== false;
  if (shouldReflect && objective?.id) {
    const reflectionJobId = deterministicUuid(`objective-synthesis-reflection:${job.id}:${objective.id}`);
    reflectionJob = await enqueueJob({
      jobId: reflectionJobId,
      orgId: job.org_id,
      jobType: 'objective_reflection',
      targetType: 'objective',
      targetId: String(objective.id),
      priority: Math.min(75, Math.max(10, Number(objective.priority || 50))),
      input: {
        objective: objective.description || objective.name,
        objective_id: objective.id,
        synthesis_parent_job_id: job.id,
        max_next_jobs: 2,
      },
      maxAttempts: 2,
    });
  }

  return {
    executor: 'objective_synthesis:v2',
    model: MODEL,
    action: synthesis.action,
    confidence: synthesis.confidence,
    reason: synthesis.reason,
    source,
    objective: objective ? { id: objective.id, name: objective.name, priority: objective.priority, status: objective.status } : null,
    reflection_job_id: reflectionJob?.id || null,
    usage,
    evidence: evidenceMeta,
    retry_safe: true,
  };
}
