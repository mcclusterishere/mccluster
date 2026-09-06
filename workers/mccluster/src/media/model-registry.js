// McCluster generative-media model registry.
// This file is intentionally provider-agnostic and is not wired into production routing yet.

const registry = new Map();

function normalizeCapabilities(capabilities = []) {
  return [...new Set(capabilities.map((value) => String(value).trim()).filter(Boolean))].sort();
}

export function registerModel(definition) {
  if (!definition?.id) throw new Error('model definition requires id');
  if (!definition?.provider) throw new Error('model definition requires provider');

  const normalized = {
    enabled: true,
    health: 'unknown',
    capabilities: [],
    tags: [],
    ...definition,
    capabilities: normalizeCapabilities(definition.capabilities),
  };

  registry.set(normalized.id, normalized);
  return normalized;
}

export function getModel(id) {
  return registry.get(id) || null;
}

export function listModels({ capability, provider, enabled = true } = {}) {
  return [...registry.values()].filter((model) => {
    if (enabled !== undefined && Boolean(model.enabled) !== Boolean(enabled)) return false;
    if (provider && model.provider !== provider) return false;
    if (capability && !model.capabilities.includes(capability)) return false;
    return true;
  });
}

export function rankModels(job, models = listModels()) {
  const requested = normalizeCapabilities(job?.requiredCapabilities || []);
  const weights = {
    quality: Number(job?.weights?.quality ?? 1),
    speed: Number(job?.weights?.speed ?? 0.5),
    cost: Number(job?.weights?.cost ?? 0.5),
    control: Number(job?.weights?.control ?? 1),
  };

  return models
    .map((model) => {
      const missing = requested.filter((capability) => !model.capabilities.includes(capability));
      if (missing.length) return { model, score: Number.NEGATIVE_INFINITY, missing };

      const profile = model.profile || {};
      const score =
        weights.quality * Number(profile.quality ?? 0) +
        weights.speed * Number(profile.speed ?? 0) +
        weights.control * Number(profile.control ?? 0) -
        weights.cost * Number(profile.relativeCost ?? 0);

      return { model, score, missing: [] };
    })
    .sort((a, b) => b.score - a.score);
}

export function clearRegistry() {
  registry.clear();
}
