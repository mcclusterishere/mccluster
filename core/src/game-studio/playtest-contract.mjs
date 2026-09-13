function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizePlaytestScenario(input = {}) {
  const id = text(input.id, 200);
  if (!id) throw new Error('playtest scenario requires id');
  const goals = Array.isArray(input.goals) ? input.goals.map((x) => text(x, 500)).filter(Boolean).slice(0, 50) : [];
  if (!goals.length) throw new Error('playtest scenario requires at least one goal');

  return {
    id,
    build_ref: text(input.build_ref, 500),
    engine: text(input.engine, 100) || 'godot',
    map: text(input.map, 500) || 'TEST_MISSION_000',
    seed: Math.trunc(finite(input.seed, 0)),
    max_steps: Math.max(1, Math.min(100000, Math.trunc(finite(input.max_steps, 2000)))),
    max_seconds: Math.max(1, Math.min(21600, Math.trunc(finite(input.max_seconds, 600)))),
    goals,
    required_observations: ['frame', 'game_state', 'event_log'],
    required_evidence: ['telemetry', 'screenshots', 'action_trace', 'completion_state'],
  };
}

export function createPlaytestRun(scenario, extra = {}) {
  const s = normalizePlaytestScenario(scenario);
  return {
    schema_version: '0.1',
    scenario: s,
    run_id: text(extra.run_id, 200) || `${s.id}-${Date.now()}`,
    started_at: text(extra.started_at, 100) || new Date().toISOString(),
    observations: [],
    actions: [],
    events: [],
    metrics: {
      steps: 0,
      elapsed_ms: 0,
      crashes: 0,
      softlocks: 0,
      goals_completed: 0,
      goals_total: s.goals.length,
    },
    terminal: null,
  };
}

export function recordObservation(run, observation = {}) {
  const item = {
    t_ms: Math.max(0, Math.trunc(finite(observation.t_ms, 0))),
    frame_ref: text(observation.frame_ref, 1000),
    state_ref: text(observation.state_ref, 1000),
    summary: text(observation.summary, 2000),
  };
  run.observations.push(item);
  return item;
}

export function recordAction(run, action = {}) {
  const item = {
    t_ms: Math.max(0, Math.trunc(finite(action.t_ms, 0))),
    type: text(action.type, 200),
    target: text(action.target, 500),
    params: action.params && typeof action.params === 'object' ? action.params : {},
    result: text(action.result, 1000),
  };
  if (!item.type) throw new Error('playtest action requires type');
  run.actions.push(item);
  run.metrics.steps = run.actions.length;
  return item;
}

export function finishPlaytest(run, terminal = {}) {
  run.terminal = {
    status: text(terminal.status, 100) || 'unknown',
    reason: text(terminal.reason, 2000),
    completed_goals: Array.isArray(terminal.completed_goals) ? terminal.completed_goals.map((x) => text(x, 500)).filter(Boolean) : [],
    failed_goals: Array.isArray(terminal.failed_goals) ? terminal.failed_goals.map((x) => text(x, 500)).filter(Boolean) : [],
  };
  run.metrics.goals_completed = run.terminal.completed_goals.length;
  run.metrics.elapsed_ms = Math.max(0, Math.trunc(finite(terminal.elapsed_ms, run.metrics.elapsed_ms)));
  return run;
}
