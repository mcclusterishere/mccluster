const APPROVED_PRIMITIVES = Object.freeze([
  'CREATE_ISOLATED_ENVIRONMENT',
  'CLONE_APPROVED_TEMPLATE',
  'CREATE_PRIVATE_NETWORK',
  'SET_APPROVED_CONFIGURATION_STATE',
  'SEED_SYNTHETIC_LOG',
  'PLACE_SYNTHETIC_EVIDENCE',
  'CREATE_TRAINING_IDENTITY',
  'SET_TRAINING_ACL',
  'START_APPROVED_SERVICE',
  'STOP_APPROVED_SERVICE',
  'RESTORE_SNAPSHOT',
  'DESTROY_ENVIRONMENT'
]);

const APPROVED_ADAPTERS = Object.freeze([
  'SIMULATION',
  'TERMINAL',
  'REMOTE_DESKTOP',
  'NETWORK_RANGE',
  'PACKET_ANALYSIS',
  'SIEM',
  'HARDWARE_SIM',
  'DOCUMENT_EVIDENCE'
]);

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function sanitizeOperation(operation, index) {
  if (!operation || typeof operation !== 'object') throw new TypeError(`operation ${index} must be an object`);
  const type = requireString(operation.type, `operation ${index} type`);
  if (!APPROVED_PRIMITIVES.includes(type)) throw new Error(`Unapproved PRIM lab primitive: ${type}`);

  if (Object.prototype.hasOwnProperty.call(operation, 'command')
      || Object.prototype.hasOwnProperty.call(operation, 'shell')
      || Object.prototype.hasOwnProperty.call(operation, 'script')) {
    throw new Error(`Freeform execution is forbidden in PRIM lab recipes: ${type}`);
  }

  return {
    type,
    target: typeof operation.target === 'string' ? operation.target.trim() : null,
    template: typeof operation.template === 'string' ? operation.template.trim() : null,
    state_id: typeof operation.state_id === 'string' ? operation.state_id.trim() : null,
    artifact_id: typeof operation.artifact_id === 'string' ? operation.artifact_id.trim() : null,
    service_id: typeof operation.service_id === 'string' ? operation.service_id.trim() : null,
    parameters: operation.parameters && typeof operation.parameters === 'object'
      ? {...operation.parameters}
      : {}
  };
}

function validateTemplates(operations, approvedTemplates) {
  const allowed = new Set(approvedTemplates);
  for (const operation of operations) {
    if (operation.type !== 'CLONE_APPROVED_TEMPLATE') continue;
    if (!operation.template || !allowed.has(operation.template)) {
      throw new Error(`Template is not approved for this Mission: ${operation.template || 'missing'}`);
    }
  }
}

/**
 * Compile a bounded lab recipe into a deterministic orchestration plan.
 *
 * The recipe intentionally has no freeform command primitive. Infrastructure
 * adapters consume named, reviewed operations only. The first implementation
 * also forbids public network egress entirely. Allowlisted egress can be added
 * later behind an explicit policy review without changing the Mission model.
 */
export function compileLabRecipe({ missionId, variantId, recipe, approvedTemplates = [] }) {
  requireString(missionId, 'missionId');
  requireString(variantId, 'variantId');
  if (!recipe || typeof recipe !== 'object') throw new TypeError('recipe is required');

  const adapter = requireString(recipe.adapter, 'recipe.adapter');
  if (!APPROVED_ADAPTERS.includes(adapter)) throw new Error(`Unsupported PRIM lab adapter: ${adapter}`);

  const environmentClass = requireString(recipe.environmentClass, 'recipe.environmentClass');
  const ttlMinutes = Number(recipe.ttlMinutes || 45);
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 240) {
    throw new Error('PRIM lab ttlMinutes must be an integer from 5 through 240');
  }

  const networkEgress = String(recipe.networkEgress || 'NONE').toUpperCase();
  if (networkEgress !== 'NONE') {
    throw new Error('PRIM lab recipes currently require networkEgress NONE');
  }

  if (!Array.isArray(recipe.operations) || recipe.operations.length === 0) {
    throw new TypeError('recipe.operations must contain at least one approved primitive');
  }

  const operations = recipe.operations.map(sanitizeOperation);
  const templates = uniqueStrings(approvedTemplates);
  validateTemplates(operations, templates);

  if (operations[0].type !== 'CREATE_ISOLATED_ENVIRONMENT') {
    throw new Error('PRIM lab recipe must begin with CREATE_ISOLATED_ENVIRONMENT');
  }
  if (operations[operations.length - 1].type !== 'DESTROY_ENVIRONMENT') {
    throw new Error('PRIM lab recipe must end with DESTROY_ENVIRONMENT');
  }

  return {
    recipe_version: '1.0.0',
    mission_id: missionId,
    variant_id: variantId,
    adapter,
    environment_class: environmentClass,
    isolation_required: true,
    ephemeral: true,
    ttl_minutes: ttlMinutes,
    network_egress: 'NONE',
    approved_templates: templates,
    operations,
    invariants: {
      freeform_execution_allowed: false,
      public_network_egress_allowed: false,
      third_party_targeting_allowed: false,
      deterministic_verifier_required: true,
      destroy_environment_required: true
    }
  };
}

export const PRIM_LAB_RECIPE_POLICY = Object.freeze({
  approvedPrimitives: [...APPROVED_PRIMITIVES],
  approvedAdapters: [...APPROVED_ADAPTERS],
  networkEgress: 'NONE'
});
