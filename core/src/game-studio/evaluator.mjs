function ratio(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 0;
  return Math.max(0, Math.min(1, a / b));
}

function boolScore(value) {
  return value ? 1 : 0;
}

export function evaluatePlaytest(run = {}, policy = {}) {
  const metrics = run.metrics || {};
  const terminal = run.terminal || {};
  const weights = {
    completion: Number(policy.completion_weight ?? 0.35),
    stability: Number(policy.stability_weight ?? 0.25),
    evidence: Number(policy.evidence_weight ?? 0.20),
    efficiency: Number(policy.efficiency_weight ?? 0.10),
    determinism: Number(policy.determinism_weight ?? 0.10),
  };

  const goalRatio = ratio(Number(metrics.goals_completed || 0), Number(metrics.goals_total || 0));
  const crashFree = Number(metrics.crashes || 0) === 0;
  const softlockFree = Number(metrics.softlocks || 0) === 0;
  const evidenceTypes = [
    Array.isArray(run.observations) && run.observations.length > 0,
    Array.isArray(run.actions) && run.actions.length > 0,
    Array.isArray(run.events),
    Boolean(terminal.status),
  ];
  const evidenceScore = evidenceTypes.reduce((a, b) => a + boolScore(b), 0) / evidenceTypes.length;
  const maxSteps = Number(run.scenario?.max_steps || 1);
  const steps = Number(metrics.steps || 0);
  const efficiencyScore = goalRatio === 0 ? 0 : Math.max(0, Math.min(1, 1 - (steps / Math.max(maxSteps, 1)) * 0.5));
  const deterministic = run.scenario?.seed !== undefined && run.scenario?.seed !== null;

  const dimensions = {
    completion: goalRatio,
    stability: (boolScore(crashFree) + boolScore(softlockFree)) / 2,
    evidence: evidenceScore,
    efficiency: efficiencyScore,
    determinism: boolScore(deterministic),
  };

  const weighted = Object.entries(weights).reduce((sum, [key, weight]) => sum + dimensions[key] * weight, 0);
  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const score = Math.round((weighted / weightTotal) * 1000) / 10;
  const threshold = Number(policy.pass_score ?? 80);

  const blockers = [];
  if (!crashFree) blockers.push('crash');
  if (!softlockFree) blockers.push('softlock');
  if (goalRatio < Number(policy.minimum_completion_ratio ?? 1)) blockers.push('incomplete-goals');
  if (evidenceScore < Number(policy.minimum_evidence_ratio ?? 0.75)) blockers.push('insufficient-evidence');

  return {
    schema_version: '0.1',
    score,
    pass_score: threshold,
    passed: score >= threshold && blockers.length === 0,
    dimensions,
    blockers,
    repair_required: blockers.length > 0 || score < threshold,
    claim_policy: 'A playtest may only be called successful when evaluation passes and the evidence package is retained.',
  };
}

export function repairTasksFromEvaluation(evaluation = {}) {
  const tasks = [];
  for (const blocker of evaluation.blockers || []) {
    if (blocker === 'crash') tasks.push({ priority: 100, kind: 'stability', objective: 'Reproduce and eliminate the crash before feature work continues.' });
    if (blocker === 'softlock') tasks.push({ priority: 95, kind: 'progression', objective: 'Identify the softlock state and restore a valid progression path.' });
    if (blocker === 'incomplete-goals') tasks.push({ priority: 90, kind: 'gameplay', objective: 'Determine why the agent could not complete required scenario goals and repair mechanics, navigation, AI, or objective logic.' });
    if (blocker === 'insufficient-evidence') tasks.push({ priority: 80, kind: 'instrumentation', objective: 'Add missing synchronized observations, action traces, terminal state, or telemetry.' });
  }
  if (!tasks.length && evaluation.repair_required) {
    tasks.push({ priority: 70, kind: 'quality', objective: 'Improve the lowest-scoring evaluation dimensions and rerun the identical seeded scenario.' });
  }
  return tasks;
}
