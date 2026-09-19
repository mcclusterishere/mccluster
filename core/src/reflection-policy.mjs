const SAFE_JOB_TYPES = new Set(['local_analysis', 'repo_health', 'code_patch']);
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ALLOWED_REPOS = new Set(
  String(process.env.MCCLUSTER_CODE_REPOS || 'mcclusterishere/mccluster')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

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
  let codePatchCount = 0;

  for (const candidate of requested) {
    if (nextJobs.length >= limit) break;
    if (!candidate || typeof candidate !== 'object') continue;

    const jobType = boundedString(candidate.job_type, 80);
    if (!SAFE_JOB_TYPES.has(jobType)) continue;

    const task = boundedString(candidate.task || candidate.prompt, 12_000);
    if (!task) continue;

    let targetType = boundedString(candidate.target_type || 'portfolio', 120) || 'portfolio';
    let targetId = boundedString(candidate.target_id || 'McCluster', 500) || 'McCluster';
    let priority = clampInteger(candidate.priority, 0, 100, 25);

    /* A REPO JOB WITHOUT A REAL REPO USED TO BE A DAILY FAILURE, AND THEN A
       DAILY NOTHING.

       The reflection model names its own targets, and for repo_health it kept
       naming the OBJECTIVE instead of a repository: 'McCluster',
       'McCluster/autonomous-data-center-pipeline', once the literal
       'owner/repo'. Every one of those failed on the node — "repository not
       cloned" — every night from the 14th onward. The allowlist check that
       was added to stop that turned the failure into a silent skip, which is
       quieter but no more useful: repo_health simply stopped running.

       So an unusable target now falls back to the canonical repo rather than
       dropping the job. The allowlist still decides what may be touched; it
       just is not the model's job to remember the exact string. A target that
       IS in the allowlist is always honoured as given. */
    if (jobType === 'repo_health' || jobType === 'code_patch') {
      if (!REPO.test(targetId) || !ALLOWED_REPOS.has(targetId)) {
        if (jobType === 'code_patch') continue;   /* patching still demands an explicit repo */
        const fallback = [...ALLOWED_REPOS][0];
        if (!fallback) continue;
        targetId = fallback;
      }
      targetType = 'repository';
    }

    if (jobType === 'code_patch') {
      if (codePatchCount >= 1) continue;
      if (!REPO.test(targetId)) continue;
      targetType = 'repository';
      priority = Math.min(priority, 40);
      codePatchCount += 1;
    }

    nextJobs.push({
      job_type: jobType,
      target_type: targetType,
      target_id: targetId,
      priority,
      input: {
        task,
        evidence: candidate.evidence && typeof candidate.evidence === 'object'
          ? candidate.evidence
          : {},
        reflection_origin: true,
        ...(jobType === 'code_patch' ? {
          title: boundedString(candidate.title || `Autonomous maintenance: ${task}`, 160),
          autonomous_draft_only: true,
        } : {}),
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
