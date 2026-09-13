function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function array(value, max = 100) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const GAME_SPEC_VERSION = '0.1';

export function normalizeGameSpec(input = {}) {
  const id = text(input.id, 200);
  const title = text(input.title, 500);
  if (!id) throw new Error('game spec requires id');
  if (!title) throw new Error('game spec requires title');

  const mission = input.mission || {};
  const playtest = input.playtest || {};
  const world = input.world || {};

  return {
    schema_version: GAME_SPEC_VERSION,
    id,
    title,
    campaign: text(input.campaign, 200) || 'PRIM3',
    engine: text(input.engine, 100) || 'godot',
    repository: text(input.repository, 500) || 'mcclusterishere/hitmans-halo',
    canon_refs: array(input.canon_refs).map((v) => text(v, 500)).filter(Boolean),
    mission: {
      operation_id: text(mission.operation_id, 100) || id,
      mastery_stage: text(mission.mastery_stage, 50) || 'sandbox',
      objectives: array(mission.objectives, 20).map((v) => text(v, 500)).filter(Boolean),
      required_mechanics: array(mission.required_mechanics, 50).map((v) => text(v, 200)).filter(Boolean),
      failure_conditions: array(mission.failure_conditions, 20).map((v) => text(v, 500)).filter(Boolean),
      completion_conditions: array(mission.completion_conditions, 20).map((v) => text(v, 500)).filter(Boolean),
    },
    world: {
      mode: text(world.mode, 50) || 'synthetic',
      halo_context: Boolean(world.halo_context),
      latitude: world.latitude == null ? null : finite(world.latitude, null),
      longitude: world.longitude == null ? null : finite(world.longitude, null),
      radius_m: Math.max(0, finite(world.radius_m, 0)),
      context_refs: array(world.context_refs, 50).map((v) => text(v, 500)).filter(Boolean),
    },
    playtest: {
      seed: Number.isInteger(Number(playtest.seed)) ? Number(playtest.seed) : 1337,
      max_steps: Math.max(1, Math.min(10000, Math.floor(finite(playtest.max_steps, 500)))),
      max_seconds: Math.max(1, Math.min(3600, finite(playtest.max_seconds, 300))),
      scenarios: array(playtest.scenarios, 50).map((v) => text(v, 500)).filter(Boolean),
      required_evidence: array(playtest.required_evidence, 20).map((v) => text(v, 100)).filter(Boolean),
    },
    acceptance: {
      min_completion_rate: Math.max(0, Math.min(1, finite(input.acceptance?.min_completion_rate, 1))),
      max_crashes: Math.max(0, Math.floor(finite(input.acceptance?.max_crashes, 0))),
      deterministic_replay_required: input.acceptance?.deterministic_replay_required !== false,
      max_regressions: Math.max(0, Math.floor(finite(input.acceptance?.max_regressions, 0))),
    },
    provenance: {
      created_from: array(input.provenance?.created_from, 100).map((v) => text(v, 500)).filter(Boolean),
      assumptions: array(input.provenance?.assumptions, 100).map((v) => text(v, 1000)).filter(Boolean),
    },
  };
}

export function validateGameSpec(input = {}) {
  let spec;
  try {
    spec = normalizeGameSpec(input);
  } catch (error) {
    return { ok: false, errors: [error.message], spec: null };
  }

  const errors = [];
  if (!spec.mission.objectives.length) errors.push('mission.objectives must not be empty');
  if (!spec.mission.required_mechanics.length) errors.push('mission.required_mechanics must not be empty');
  if (!spec.mission.completion_conditions.length) errors.push('mission.completion_conditions must not be empty');
  if (!spec.playtest.scenarios.length) errors.push('playtest.scenarios must not be empty');
  if (!spec.playtest.required_evidence.includes('telemetry')) errors.push('playtest.required_evidence must include telemetry');
  if (!spec.playtest.required_evidence.includes('visual')) errors.push('playtest.required_evidence must include visual');
  if (spec.world.halo_context && (spec.world.latitude == null || spec.world.longitude == null)) {
    errors.push('Halo world context requires latitude and longitude');
  }

  return { ok: errors.length === 0, errors, spec };
}
