const DEFAULT_ENGINE = 'godot';

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 50) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 500)).filter(Boolean).slice(0, max);
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export const GAME_STUDIO_STAGES = Object.freeze([
  'spec',
  'world_context',
  'level_plan',
  'asset_plan',
  'implementation',
  'build',
  'embodied_playtest',
  'telemetry_eval',
  'review',
  'repair',
  'preview',
]);

export function normalizeGameBuildInput(input = {}) {
  const brief = text(input.brief, 12000);
  if (!brief) throw new Error('game build plan requires brief');

  return {
    brief,
    repository: text(input.repository, 500) || 'mcclusterishere/hitmans-halo',
    engine: text(input.engine, 100) || DEFAULT_ENGINE,
    campaign: text(input.campaign, 500) || 'PRIM3',
    operation_ids: list(input.operation_ids, 100),
    world_refs: list(input.world_refs, 100),
    canon_refs: list(input.canon_refs, 100),
    target_platforms: list(input.target_platforms, 20).length ? list(input.target_platforms, 20) : ['desktop'],
    quality_profile: text(input.quality_profile, 100) || 'frontier',
    budget_cents: Number.isFinite(Number(input.budget_cents)) ? Math.max(0, Number(input.budget_cents)) : 0,
  };
}

export function buildGameStudioPlan(input = {}) {
  const spec = normalizeGameBuildInput(input);
  const requiredCapabilities = uniq([
    'repo.inspect',
    'research.web',
    'code.build',
    'world.generate',
    'model3d.generate',
    'image.generate',
    'audio.generate',
    'video.generate',
    'deploy.preview',
  ]);

  const stages = [
    {
      id: 'spec',
      owner: 'studio.director',
      mode: 'deterministic+agent',
      objective: 'Convert canon, campaign, operation and product constraints into a versioned machine-readable game specification.',
      outputs: ['game-spec.json', 'acceptance-criteria.json', 'provenance.json'],
      capabilities: ['repo.inspect'],
      gate: 'spec validates and every requirement has provenance',
    },
    {
      id: 'world_context',
      owner: 'world.intelligence',
      mode: 'evidence',
      objective: 'Gather bounded real-world geospatial and current public evidence needed by the selected operation without treating the open web as canonical game state.',
      outputs: ['world-context.json', 'source-manifest.json'],
      capabilities: ['research.web'],
      gate: 'sources timestamped, geocoded where applicable, confidence scored',
    },
    {
      id: 'level_plan',
      owner: 'level.architect',
      mode: 'agent',
      objective: 'Produce encounter graph, traversal, objectives, tactical spaces, spawn logic and Cesium/Halo anchors before touching engine content.',
      outputs: ['level-plan.json', 'encounter-graph.json', 'world-anchors.json'],
      capabilities: ['world.generate'],
      gate: 'playable path and tactical constraints pass static validation',
    },
    {
      id: 'asset_plan',
      owner: 'asset.director',
      mode: 'agent',
      objective: 'Resolve reusable, generated and reconstructed assets with licensing/provenance and hardware-aware generation routes.',
      outputs: ['asset-manifest.json', 'license-manifest.json'],
      capabilities: ['model3d.generate', 'image.generate', 'audio.generate', 'video.generate'],
      gate: 'every asset has source, license, budget and target format',
    },
    {
      id: 'implementation',
      owner: 'game.engineer',
      mode: 'isolated-write',
      objective: 'Modify game code, scenes, data and tools in a disposable worktree only.',
      outputs: ['patch', 'build-manifest.json'],
      capabilities: ['code.build'],
      gate: 'static checks and unit/integration tests pass',
    },
    {
      id: 'build',
      owner: 'build.engineer',
      mode: 'sandbox',
      objective: 'Create a reproducible playable artifact with deterministic build metadata.',
      outputs: ['playable-build', 'build-log.json'],
      capabilities: ['code.build'],
      gate: 'artifact launches and health probe succeeds',
    },
    {
      id: 'embodied_playtest',
      owner: 'playtest.agent',
      mode: 'observe+act',
      objective: 'Enter the running build, perceive frames/state, execute goals, explore failure paths and collect synchronized telemetry, screenshots and video.',
      outputs: ['playtest-run.json', 'telemetry.ndjson', 'screenshots', 'video'],
      capabilities: [],
      gate: 'minimum scenario coverage and crash-free session achieved',
    },
    {
      id: 'telemetry_eval',
      owner: 'qa.evaluator',
      mode: 'deterministic+vision',
      objective: 'Score completion, navigation, combat/tactical behavior, performance, regressions, visual defects and canon consistency.',
      outputs: ['evaluation.json', 'regressions.json'],
      capabilities: [],
      gate: 'thresholds met or repair tasks generated',
    },
    {
      id: 'review',
      owner: 'independent.reviewer',
      mode: 'read-only',
      objective: 'Review evidence independently from the builder and reject unsupported success claims.',
      outputs: ['review.json'],
      capabilities: ['repo.inspect'],
      gate: 'reviewer accepts evidence package',
    },
    {
      id: 'repair',
      owner: 'repair.agent',
      mode: 'isolated-write',
      objective: 'Convert failed metrics and reviewer findings into bounded changes, then repeat build and playtest.',
      outputs: ['repair-plan.json', 'patch'],
      capabilities: ['code.build'],
      gate: 'repair loop converges or escalation budget reached',
    },
    {
      id: 'preview',
      owner: 'release.manager',
      mode: 'approval-gated',
      objective: 'Publish a non-production preview only after evidence gates pass.',
      outputs: ['preview-url', 'release-evidence.json'],
      capabilities: ['deploy.preview'],
      gate: 'human/reviewer approval according to governance policy',
    },
  ];

  return {
    schema_version: '0.1',
    system: 'mccluster-autonomous-game-studio',
    spec,
    required_capabilities: requiredCapabilities,
    stages,
    loop: {
      sequence: GAME_STUDIO_STAGES,
      repeat_from: 'implementation',
      stop_conditions: ['acceptance criteria satisfied', 'repair budget exhausted', 'human stop', 'safety gate'],
    },
    evidence_contract: {
      required: ['provenance', 'build logs', 'playtest telemetry', 'visual captures', 'evaluation', 'independent review'],
      claim_policy: 'No stage may claim success without attached machine-readable evidence.',
    },
    execution_policy: {
      production_deploy: false,
      automatic_merge: false,
      automatic_spend: false,
      disposable_worktrees: true,
      builder_reviewer_separation: true,
      provider_independent_capabilities: true,
    },
  };
}
