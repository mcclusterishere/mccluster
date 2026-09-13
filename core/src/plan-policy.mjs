const SAFE_PLAN_JOB_TYPES = new Set(['local_analysis', 'repo_health']);

function boundedString(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function validKey(value) {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
}

export function allowedPlanJobTypes() {
  return [...SAFE_PLAN_JOB_TYPES];
}

export function normalizeObjectivePlan(value, { maxSteps = 8 } = {}) {
  const limit = clampInteger(maxSteps, 1, 12, 8);
  const plan = value && typeof value === 'object' ? value : {};
  const requested = Array.isArray(plan.steps) ? plan.steps : [];
  const steps = [];
  const acceptedKeys = new Set();
  let dropped = 0;

  for (const candidate of requested) {
    if (steps.length >= limit) {
      dropped += 1;
      continue;
    }
    if (!candidate || typeof candidate !== 'object') {
      dropped += 1;
      continue;
    }

    const key = boundedString(candidate.key, 64);
    const jobType = boundedString(candidate.job_type, 80);
    const task = boundedString(candidate.task || candidate.prompt, 12_000);
    if (!validKey(key) || acceptedKeys.has(key) || !SAFE_PLAN_JOB_TYPES.has(jobType) || !task) {
      dropped += 1;
      continue;
    }

    const dependencies = [];
    let invalidDependency = false;
    for (const raw of Array.isArray(candidate.depends_on) ? candidate.depends_on : []) {
      const dep = boundedString(raw, 64);
      if (!dep || !acceptedKeys.has(dep) || dependencies.includes(dep)) {
        invalidDependency = true;
        break;
      }
      dependencies.push(dep);
    }
    if (invalidDependency) {
      dropped += 1;
      continue;
    }

    steps.push({
      key,
      job_type: jobType,
      target_type: boundedString(candidate.target_type || 'portfolio', 120) || 'portfolio',
      target_id: boundedString(candidate.target_id || 'McCluster', 500) || 'McCluster',
      priority: clampInteger(candidate.priority, 0, 100, 25),
      depends_on: dependencies,
      input: {
        task,
        evidence: candidate.evidence && typeof candidate.evidence === 'object' ? candidate.evidence : {},
        plan_origin: true,
      },
    });
    acceptedKeys.add(key);
  }

  return {
    summary: boundedString(plan.summary || 'Objective plan created.', 4000),
    rationale: boundedString(plan.rationale || '', 8000),
    steps,
    dropped_step_count: dropped,
  };
}
