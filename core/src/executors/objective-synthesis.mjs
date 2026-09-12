import { enqueueJob, hasPendingJob, recentObjectives } from '../supabase.mjs';
import { createObjective, updateObjective } from '../objective-store.mjs';
import { extractJsonObject } from '../reflection-policy.mjs';
import { normalizeObjectiveSynthesis } from '../objective-synthesis-policy.mjs';

const OLLAMA = String(process.env.MCCLUSTER_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';

function sourceScope(job) {
  const source = job.input?.source && typeof job.input.source === 'object' ? job.input.source : {};
  return {
    provider: String(source.provider || 'unknown').slice(0, 120),
    conversation_id: String(source.conversation_id || job.target_id || '').slice(0, 200),
    external_conversation_id: String(source.external_conversation_id || '').slice(0, 500),
    idempotency_key: String(source.idempotency_key || '').slice(0, 500),
    fingerprint: String(source.fingerprint || '').slice(0, 128),
    source_url: String(source.source_url || '').slice(0, 2000) || null,
    observed_at: String(source.observed_at || new Date().toISOString()).slice(0, 80),
  };
}

function mergeScope(existing, source, synthesis) {
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
      last_job_id: synthesis.job_id,
      updated_at: new Date().toISOString(),
    },
  };
}

export async function objectiveSynthesis(job) {
  if (!job.org_id) throw new Error('objective_synthesis requires org_id');
  const messages = Array.isArray(job.input?.messages) ? job.input.messages : [];
  if (!messages.length) throw new Error('objective_synthesis requires bounded conversation messages');

  const objectives = await recentObjectives({ orgId: job.org_id, limit: 40 });
  const source = sourceScope(job);
  const system = [
    'You are the McCluster Core objective synthesis engine.',
    'Determine whether the supplied conversation contains a durable user objective that should enter or update the canonical objective registry.',
    'An objective is a sustained outcome the user intends to pursue, not a one-off factual question, casual thought, transient status update, or assistant suggestion the user did not adopt.',
    'Prefer updating an existing canonical objective over creating a near-duplicate.',
    'Never mark objectives completed or cancelled. Never create jobs, plans, communications, purchases, legal actions, deployments, auth changes, or destructive actions.',
    'Use only the supplied conversation and canonical objectives. Do not claim external facts that are not present.',
    'Return JSON only with action ignore|create|update, confidence 0..1, reason, and for create/update: name, description, priority, success_metric. For update also return objective_id from the supplied objective set.',
  ].join(' ');

  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ canonical_objectives: objectives, conversation: messages, source }) },
      ],
      options: {
        temperature: 0.05,
        num_ctx: Number(process.env.MCCLUSTER_OLLAMA_CONTEXT || 16384),
      },
    }),
    signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_TIMEOUT_MS || 10 * 60_000)),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Ollama returned ${response.status}`);
  const raw = String(data?.message?.content || '').trim();
  if (!raw) throw new Error('Ollama returned an empty objective synthesis');

  const synthesis = normalizeObjectiveSynthesis(extractJsonObject(raw), {
    existingObjectiveIds: objectives.map((objective) => objective.id),
  });
  synthesis.job_id = job.id;

  if (synthesis.action === 'ignore') {
    return {
      executor: 'objective_synthesis:v1',
      model: MODEL,
      action: 'ignore',
      confidence: synthesis.confidence,
      reason: synthesis.reason,
      source,
    };
  }

  let objective;
  if (synthesis.action === 'update') {
    const existing = objectives.find((item) => String(item.id) === synthesis.objective_id);
    objective = await updateObjective({
      orgId: job.org_id,
      objectiveId: synthesis.objective_id,
      name: synthesis.name,
      description: synthesis.description,
      priority: synthesis.priority,
      successMetric: synthesis.success_metric,
      scope: mergeScope(existing?.scope, source, synthesis),
    });
  } else {
    objective = await createObjective({
      orgId: job.org_id,
      name: synthesis.name,
      description: synthesis.description,
      priority: synthesis.priority,
      successMetric: synthesis.success_metric,
      scope: mergeScope({}, source, synthesis),
    });
  }

  let reflectionJob = null;
  const shouldReflect = job.input?.schedule_reflection !== false;
  if (shouldReflect && objective?.id) {
    const pending = await hasPendingJob({ orgId: job.org_id, jobType: 'objective_reflection', targetId: String(objective.id) });
    if (!pending) {
      reflectionJob = await enqueueJob({
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
  }

  return {
    executor: 'objective_synthesis:v1',
    model: MODEL,
    action: synthesis.action,
    confidence: synthesis.confidence,
    reason: synthesis.reason,
    source,
    objective: objective ? { id: objective.id, name: objective.name, priority: objective.priority, status: objective.status } : null,
    reflection_job_id: reflectionJob?.id || null,
    usage: {
      prompt_eval_count: data?.prompt_eval_count ?? null,
      eval_count: data?.eval_count ?? null,
      total_duration_ns: data?.total_duration ?? null,
    },
  };
}
