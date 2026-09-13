function normalizeTerminal(run = {}) {
  return {
    status: run.terminal?.status || 'unknown',
    completed_goals: [...(run.terminal?.completed_goals || [])].sort(),
    failed_goals: [...(run.terminal?.failed_goals || [])].sort(),
  };
}

function actionSignature(run = {}) {
  return (run.actions || []).map((action) => ({
    type: action.type || '',
    target: action.target || '',
    params: action.params || {},
    result: action.result || '',
  }));
}

export function compareSeededRuns(before = {}, after = {}) {
  const sameScenario = before.scenario?.id === after.scenario?.id;
  const sameSeed = before.scenario?.seed === after.scenario?.seed;
  const beforeTerminal = normalizeTerminal(before);
  const afterTerminal = normalizeTerminal(after);
  const beforeActions = actionSignature(before);
  const afterActions = actionSignature(after);
  const deterministicReplay = sameScenario && sameSeed && JSON.stringify(beforeActions) === JSON.stringify(afterActions) && JSON.stringify(beforeTerminal) === JSON.stringify(afterTerminal);

  const beforeGoals = Number(before.metrics?.goals_completed || 0);
  const afterGoals = Number(after.metrics?.goals_completed || 0);
  const beforeCrashes = Number(before.metrics?.crashes || 0);
  const afterCrashes = Number(after.metrics?.crashes || 0);
  const beforeSteps = Number(before.metrics?.steps || 0);
  const afterSteps = Number(after.metrics?.steps || 0);

  return {
    schema_version: '0.1',
    same_scenario: sameScenario,
    same_seed: sameSeed,
    deterministic_replay: deterministicReplay,
    deltas: {
      goals_completed: afterGoals - beforeGoals,
      crashes: afterCrashes - beforeCrashes,
      steps: afterSteps - beforeSteps,
    },
    improved: sameScenario && sameSeed && afterGoals >= beforeGoals && afterCrashes <= beforeCrashes && (afterGoals > beforeGoals || afterCrashes < beforeCrashes || afterSteps < beforeSteps),
    regression: !sameScenario || !sameSeed || afterGoals < beforeGoals || afterCrashes > beforeCrashes,
  };
}
