function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

const ALLOWED_MATURITY = new Set(['build-now', 'experiment-now', 'watch-closely', 'research-only']);

export function normalizeExperiment(input = {}) {
  const id = text(input.id, 200);
  const hypothesis = text(input.hypothesis, 3000);
  if (!id) throw new Error('experiment requires id');
  if (!hypothesis) throw new Error('experiment requires hypothesis');
  const maturity = text(input.maturity, 100) || 'experiment-now';
  if (!ALLOWED_MATURITY.has(maturity)) throw new Error(`invalid experiment maturity: ${maturity}`);

  return {
    id,
    title: text(input.title, 500) || id,
    hypothesis,
    maturity,
    capability: text(input.capability, 200),
    provider: text(input.provider, 200) || 'provider-independent',
    source_refs: Array.isArray(input.source_refs) ? input.source_refs.map((x) => text(x, 1000)).filter(Boolean).slice(0, 100) : [],
    benchmark: {
      baseline: text(input.benchmark?.baseline, 1000),
      metric: text(input.benchmark?.metric, 500),
      target: input.benchmark?.target ?? null,
    },
    constraints: {
      max_budget_cents: Math.max(0, Number(input.constraints?.max_budget_cents || 0)),
      max_gpu_minutes: Math.max(0, Number(input.constraints?.max_gpu_minutes || 0)),
      isolated: input.constraints?.isolated !== false,
      production_data: false,
      automatic_merge: false,
      production_deploy: false,
    },
  };
}

export function createFrontierExperimentBacklog() {
  return [
    normalizeExperiment({
      id: 'embodied-vision-playtester',
      title: 'Vision-first embodied playtester',
      hypothesis: 'A multimodal agent operating only from frames plus bounded game-state telemetry can discover navigation, objective, UI and combat failures that deterministic smoke tests miss.',
      maturity: 'build-now',
      capability: 'game.playtest',
      benchmark: { baseline: 'scripted smoke test', metric: 'unique actionable defects per run', target: 2 },
    }),
    normalizeExperiment({
      id: 'seeded-self-repair',
      title: 'Seeded autonomous repair loop',
      hypothesis: 'Keeping the same scenario seed across build-play-evaluate-repair iterations will make regressions measurable and let autonomous repair converge instead of chasing stochastic behavior.',
      maturity: 'build-now',
      capability: 'game.repair',
      benchmark: { baseline: 'single pass generation', metric: 'evaluation score delta after repair', target: 10 },
    }),
    normalizeExperiment({
      id: 'cesium-to-tactical-blockout',
      title: 'Cesium context to tactical blockout',
      hypothesis: 'A provenance-preserving geospatial context package can generate a fictionalized tactical layout that retains useful terrain, road and urban morphology without copying live world state directly into game canon.',
      maturity: 'experiment-now',
      capability: 'world.generate',
      benchmark: { baseline: 'manual graybox', metric: 'designer acceptance plus geo-consistency score', target: 0.8 },
    }),
    normalizeExperiment({
      id: 'splat-collision-proxy',
      title: 'Gaussian splat to playable collision proxy',
      hypothesis: 'A reconstructed splat scene plus derived mesh/collision proxy can serve as rapid environment reference for autonomous level generation and visual comparison.',
      maturity: 'experiment-now',
      capability: 'world.reconstruct',
      benchmark: { baseline: 'photogrammetry mesh workflow', metric: 'time-to-playable-reference', target: 0.5 },
    }),
    normalizeExperiment({
      id: 'persistent-npc-society',
      title: 'Persistent NPC society simulation',
      hypothesis: 'Separating deterministic world state from LLM interpretation can support long-lived NPC memory, schedules, faction relationships and emergent incidents without letting language models become authoritative simulation state.',
      maturity: 'experiment-now',
      capability: 'world.simulate',
      benchmark: { baseline: 'scripted ambient NPCs', metric: 'coherent stateful interactions over long horizon', target: 0.9 },
    }),
    normalizeExperiment({
      id: 'world-model-level-dreaming',
      title: 'World-model level dreaming',
      hypothesis: 'Generative interactive world models may become useful as a proposal engine for encounters, motion and visual previsualization even before they are reliable enough to author canonical game state.',
      maturity: 'watch-closely',
      capability: 'world.generate',
      benchmark: { baseline: 'procedural proposal generation', metric: 'accepted novel proposals per GPU hour', target: 1 },
    }),
  ];
}
