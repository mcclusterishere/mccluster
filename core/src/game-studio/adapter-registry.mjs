function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

const ENGINES = Object.freeze({
  godot: {
    id: 'godot',
    class: 'game-engine',
    status: 'build-now',
    open_source: true,
    headless: true,
    strengths: ['fast iteration', 'CLI automation', 'open source', 'deterministic test scenes'],
    roles: ['vertical-slice', 'autonomous-playtest-lab', 'simulation-harness'],
  },
  unreal: {
    id: 'unreal',
    class: 'game-engine',
    status: 'experiment-now',
    open_source: false,
    source_available: true,
    headless: true,
    strengths: ['AAA rendering', 'world partition', 'mass AI', 'PCG', 'cinematics', 'large worlds'],
    roles: ['production-target', 'high-fidelity-worlds', 'cinematics'],
  },
  web_cesium: {
    id: 'web_cesium',
    class: 'world-runtime',
    status: 'build-now',
    open_source: true,
    headless: true,
    strengths: ['real-world geospatial context', 'browser automation', 'Halo integration'],
    roles: ['world-context', 'mission-recon', 'geo-validation'],
  },
});

const WORLD_ADAPTERS = Object.freeze({
  halo: {
    id: 'halo',
    status: 'build-now',
    authority: 'context-source',
    emits: ['world-context-package', 'geospatial-anchors', 'source-provenance'],
  },
  cesium: {
    id: 'cesium',
    status: 'build-now',
    authority: 'geospatial-renderer',
    emits: ['terrain-anchor', '3d-tiles-reference', 'camera-pose'],
  },
  gaussian_splats: {
    id: 'gaussian_splats',
    status: 'experiment-now',
    authority: 'scene-representation',
    emits: ['splat-scene', 'capture-provenance', 'lod-metadata'],
  },
  synthetic_world_model: {
    id: 'synthetic_world_model',
    status: 'watch-closely',
    authority: 'non-canonical-generator',
    emits: ['candidate-scene', 'latent-rollout', 'uncertainty'],
  },
});

export function getEngineAdapter(id) {
  const key = text(id, 100).toLowerCase();
  const adapter = ENGINES[key];
  if (!adapter) throw new Error(`unsupported game engine adapter: ${key || '<empty>'}`);
  return structuredClone(adapter);
}

export function getWorldAdapter(id) {
  const key = text(id, 100).toLowerCase();
  const adapter = WORLD_ADAPTERS[key];
  if (!adapter) throw new Error(`unsupported world adapter: ${key || '<empty>'}`);
  return structuredClone(adapter);
}

export function listStudioAdapters() {
  return {
    engines: Object.values(ENGINES).map((x) => structuredClone(x)),
    worlds: Object.values(WORLD_ADAPTERS).map((x) => structuredClone(x)),
  };
}
