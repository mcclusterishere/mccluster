const SAFE_JOB_TYPES = new Set(['local_analysis', 'repo_health', 'objective_plan']);

function boundedString(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function extractJsonObject(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  return null;
}

export function normalizeReflectionPlan(value, { maxJobs = 2 } = {}) {
  const limit = clampInteger(maxJobs, 0, 3, 2);
  const plan = value && typeof value === 'object' ? value : {};
  const requested = Array.isArray(plan.next_jobs) ? plan.next_jobs : [];
  const nextJobs = [];

  for (const candidate of requested) {
    if (nextJobs.length >= limit) break;
    if (!candidate || typeof candidate !== 'object') continue;

    const jobType = boundedString(candidate.job_type, 80);
    if (!SAFE_JOB_TYPES.has(jobType)) continue;

    const task = boundedString(candidate.task || candidate.prompt, 12_000);
    if (!task) continue;

    const targetType = boundedString(candidate.target_type || 'portfolio', 120) || 'portfolio';
    const targetId = boundedString(candidate.target_id || 'McCluster', 500) || 'McCluster';
    const priority = clampInteger(candidate.priority, 0, 100, 25);

    nextJobs.push({
      job_type: jobType,
      target_type: targetType,
      target_id: targetId,
      priority,
      input: {
        task,
        objective: jobType === 'objective_plan' ? task : undefined,
        evidence: candidate.evidence && typeof candidate.evidence === 'object' ? candidate.evidence : {},
        reflection_origin: true,
      },
    });
  }

  return {
    summary: boundedString(plan.summary || 'Reflection completed.', 4000),
    rationale: boundedString(plan.rationale || '', 8000),
    next_jobs: nextJobs,
    dropped_job_count: Math.max(0, requested.length - nextJobs.length),
  };
}

export function allowedReflectionJobTypes() {
  return [...SAFE_JOB_TYPES];
}
