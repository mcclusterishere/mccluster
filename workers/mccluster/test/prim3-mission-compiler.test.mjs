import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMissionVariant } from '../src/prim3/mission-variant.js';
import { compileLabRecipe } from '../src/prim3/lab-recipe.js';

const mission = {
  id: 'TR02-NETWORK-PATH',
  approvedVariants: [
    {
      id: 'TR02-DNS',
      minTechnicalChallenge: 'FOUNDATION',
      maxTechnicalChallenge: 'TRANSFER',
      targetConceptIds: ['network.dns'],
      faultPrimitiveIds: ['incorrect-dns-record'],
      distractorPrimitiveIds: ['healthy-secondary-interface', 'unrelated-closed-port'],
      labAdapter: 'NETWORK_RANGE',
      optionalObjectiveIds: ['explain-dns-path']
    },
    {
      id: 'TR02-GATEWAY',
      minTechnicalChallenge: 'FOUNDATION',
      maxTechnicalChallenge: 'TRANSFER',
      targetConceptIds: ['network.gateway'],
      faultPrimitiveIds: ['wrong-default-gateway'],
      distractorPrimitiveIds: ['healthy-secondary-interface'],
      labAdapter: 'NETWORK_RANGE',
      optionalObjectiveIds: ['explain-packet-path']
    }
  ]
};

function readiness(overrides = {}) {
  return {
    recommendation: {
      tactical_challenge: 'STANDARD',
      technical_challenge: 'APPLIED',
      scaffolding: 'STANDARD',
      preparation_credits: 1,
      preparation_advantage_ids: ['reveal-known-good-interface'],
      targeted_review_concept_ids: ['network.dns'],
      ...overrides.recommendation
    },
    fairness: {
      minimum_required_toolset: ['topology-view', 'endpoint-console'],
      granted_toolset: ['topology-view', 'endpoint-console'],
      required_tools_removed_for_low_mastery: false,
      ...overrides.fairness
    }
  };
}

test('Mission Variant Compiler prefers a valid variant targeting the learner review concept', () => {
  const compiled = compileMissionVariant({
    mission,
    readinessProfile: readiness(),
    seed: 'learner-session-1'
  });

  assert.equal(compiled.variant_id, 'TR02-DNS');
  assert.deepEqual(compiled.fault_primitive_ids, ['incorrect-dns-record']);
  assert.equal(compiled.invariants.technical_truth_locked_at_compile, true);
  assert.equal(compiled.invariants.mission_director_may_mutate_technical_answer, false);
  assert.equal(compiled.invariants.threat_ai_may_access_learner_model, false);
  assert.equal(compiled.invariants.learning_evaluator_separate_from_compiler, true);
});

test('Scaffolding changes distractor budget without changing technical truth', () => {
  const high = compileMissionVariant({
    mission,
    readinessProfile: readiness({recommendation: {scaffolding: 'HIGH'}}),
    seed: 'same'
  });
  const none = compileMissionVariant({
    mission,
    readinessProfile: readiness({recommendation: {scaffolding: 'NONE'}}),
    seed: 'same'
  });

  assert.equal(high.variant_id, none.variant_id);
  assert.deepEqual(high.fault_primitive_ids, none.fault_primitive_ids);
  assert.equal(high.distractor_primitive_ids.length, 0);
  assert.ok(none.distractor_primitive_ids.length >= high.distractor_primitive_ids.length);
});

test('Transfer challenge can expose authored optional objectives', () => {
  const compiled = compileMissionVariant({
    mission,
    readinessProfile: readiness({recommendation: {technical_challenge: 'TRANSFER'}}),
    seed: 'transfer'
  });
  assert.deepEqual(compiled.optional_objective_ids, ['explain-dns-path']);
});

test('Variant Compiler rejects any readiness profile that removed a required tool', () => {
  assert.throws(
    () => compileMissionVariant({
      mission,
      readinessProfile: readiness({
        fairness: {
          minimum_required_toolset: ['topology-view', 'endpoint-console'],
          granted_toolset: ['topology-view']
        }
      })
    }),
    /required tool floor/
  );
});

test('Lab recipe compiler accepts only bounded isolated primitives and approved templates', () => {
  const plan = compileLabRecipe({
    missionId: 'TR02-NETWORK-PATH',
    variantId: 'TR02-DNS',
    approvedTemplates: ['training-network-foundations-v1'],
    recipe: {
      adapter: 'NETWORK_RANGE',
      environmentClass: 'isolated-foundation-topology',
      ttlMinutes: 45,
      networkEgress: 'NONE',
      operations: [
        {type: 'CREATE_ISOLATED_ENVIRONMENT', target: 'session'},
        {type: 'CLONE_APPROVED_TEMPLATE', target: 'topology', template: 'training-network-foundations-v1'},
        {type: 'CREATE_PRIVATE_NETWORK', target: 'training-lan'},
        {type: 'SET_APPROVED_CONFIGURATION_STATE', target: 'dns', state_id: 'incorrect-dns-record'},
        {type: 'DESTROY_ENVIRONMENT', target: 'session'}
      ]
    }
  });

  assert.equal(plan.isolation_required, true);
  assert.equal(plan.ephemeral, true);
  assert.equal(plan.network_egress, 'NONE');
  assert.equal(plan.invariants.freeform_execution_allowed, false);
  assert.equal(plan.invariants.public_network_egress_allowed, false);
  assert.equal(plan.invariants.third_party_targeting_allowed, false);
  assert.equal(plan.invariants.deterministic_verifier_required, true);
});

test('Lab recipe compiler rejects freeform command execution', () => {
  assert.throws(
    () => compileLabRecipe({
      missionId: 'TR02-NETWORK-PATH',
      variantId: 'TR02-DNS',
      recipe: {
        adapter: 'NETWORK_RANGE',
        environmentClass: 'isolated-foundation-topology',
        operations: [
          {type: 'CREATE_ISOLATED_ENVIRONMENT', target: 'session'},
          {type: 'SET_APPROVED_CONFIGURATION_STATE', target: 'dns', command: 'arbitrary command'},
          {type: 'DESTROY_ENVIRONMENT', target: 'session'}
        ]
      }
    }),
    /Freeform execution is forbidden/
  );
});

test('Lab recipe compiler rejects public or unrestricted egress', () => {
  assert.throws(
    () => compileLabRecipe({
      missionId: 'TR02-NETWORK-PATH',
      variantId: 'TR02-DNS',
      recipe: {
        adapter: 'NETWORK_RANGE',
        environmentClass: 'isolated-foundation-topology',
        networkEgress: 'PUBLIC',
        operations: [
          {type: 'CREATE_ISOLATED_ENVIRONMENT', target: 'session'},
          {type: 'DESTROY_ENVIRONMENT', target: 'session'}
        ]
      }
    }),
    /networkEgress NONE/
  );
});

test('Lab recipe compiler requires deterministic teardown at both ends of the recipe', () => {
  assert.throws(
    () => compileLabRecipe({
      missionId: 'TR01-RISK-AND-CONTROLS',
      variantId: 'TR01-A',
      recipe: {
        adapter: 'SIMULATION',
        environmentClass: 'risk-board',
        operations: [
          {type: 'CREATE_ISOLATED_ENVIRONMENT', target: 'session'},
          {type: 'SEED_SYNTHETIC_LOG', target: 'risk-board'}
        ]
      }
    }),
    /end with DESTROY_ENVIRONMENT/
  );
});
