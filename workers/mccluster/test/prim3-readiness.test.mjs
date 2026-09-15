import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionReadiness, PRIM_READINESS_LEVELS } from '../src/prim3/readiness.js';

const mission = Object.freeze({
  id: 'TR02-NETWORK-PATH',
  targetConceptIds: ['network.ip', 'network.gateway', 'network.dns'],
  targetObjectiveIds: ['N10-009 1.3', 'N10-009 1.4'],
  minimumRequiredToolset: ['topology-view', 'endpoint-console', 'packet-path-view'],
  allowedPreparationAdvantages: ['reveal-known-good-interface', 'reveal-service-dependency'],
  transferOptionalObjectiveIds: ['explain-packet-path']
});

test('strong Principles evidence earns preparation and transfer challenge without changing the required tool floor', () => {
  const profile = buildMissionReadiness({
    mission,
    requestedTacticalChallenge: 'STORY',
    learner: {
      conceptMastery: {
        'network.ip': 96,
        'network.gateway': 94,
        'network.dns': 95
      },
      objectiveMastery: {
        'N10-009 1.3': 94,
        'N10-009 1.4': 96
      },
      independence: 91,
      transfer: 88,
      independenceEvidenceCount: 6,
      transferEvidenceCount: 4,
      changedScenariosCompleted: 3
    }
  });

  assert.equal(profile.principles_readiness, 95);
  assert.equal(profile.recommendation.tactical_challenge, 'STORY');
  assert.equal(profile.recommendation.technical_challenge, 'TRANSFER');
  assert.equal(profile.recommendation.scaffolding, 'NONE');
  assert.equal(profile.recommendation.preparation_credits, 2);
  assert.deepEqual(profile.recommendation.preparation_advantage_ids, mission.allowedPreparationAdvantages);
  assert.deepEqual(profile.recommendation.optional_objective_ids, mission.transferOptionalObjectiveIds);
  assert.deepEqual(profile.fairness.minimum_required_toolset, mission.minimumRequiredToolset);
  assert.deepEqual(profile.fairness.granted_toolset, mission.minimumRequiredToolset);
  assert.equal(profile.fairness.required_tools_removed_for_low_mastery, false);
});

test('developing learner receives more scaffolding while retaining every required tool', () => {
  const profile = buildMissionReadiness({
    mission,
    requestedTacticalChallenge: 'VETERAN',
    learner: {
      conceptMastery: {
        'network.ip': 58,
        'network.gateway': 42,
        'network.dns': 61
      },
      objectiveMastery: {
        'N10-009 1.3': 55,
        'N10-009 1.4': 50
      },
      independence: 45,
      transfer: 40
    }
  });

  assert.equal(profile.recommendation.tactical_challenge, 'VETERAN');
  assert.equal(profile.recommendation.technical_challenge, 'FOUNDATION');
  assert.equal(profile.recommendation.scaffolding, 'HIGH');
  assert.equal(profile.recommendation.preparation_credits, 0);
  assert.deepEqual(profile.fairness.granted_toolset, mission.minimumRequiredToolset);
  assert.equal(profile.fairness.required_tools_removed_for_low_mastery, false);
  assert.ok(profile.recommendation.targeted_review_concept_ids.includes('network.gateway'));
});

test('Rhythm and Immersion create support resources but never inflate Principles readiness', () => {
  const baseLearner = {
    conceptMastery: {
      'network.ip': 70,
      'network.gateway': 70,
      'network.dns': 70
    },
    objectiveMastery: {
      'N10-009 1.3': 70,
      'N10-009 1.4': 70
    },
    independence: 70,
    transfer: 70
  };

  const withoutReinforcement = buildMissionReadiness({ mission, learner: baseLearner });
  const withReinforcement = buildMissionReadiness({
    mission,
    learner: {
      ...baseLearner,
      rhythm: {
        reinforcedConceptIds: ['network.dns', 'not-in-this-mission']
      },
      immersion: {
        contextConceptIds: ['network.gateway'],
        contextIntelIds: ['story-known-service-owner']
      }
    }
  });

  assert.equal(withReinforcement.principles_readiness, withoutReinforcement.principles_readiness);
  assert.deepEqual(withReinforcement.rhythm.reinforced_concept_ids, ['network.dns']);
  assert.equal(withReinforcement.rhythm.recall_tokens, 1);
  assert.equal(withReinforcement.rhythm.recall_cannot_reveal_solution, true);
  assert.deepEqual(withReinforcement.immersion.context_concept_ids, ['network.gateway']);
  assert.deepEqual(withReinforcement.immersion.context_intel_ids, ['story-known-service-owner']);
  assert.equal(withReinforcement.immersion.context_cannot_reveal_unearned_solution, true);
});

test('tactical challenge stays independent from technical challenge', () => {
  const learner = {
    conceptMastery: {'network.ip': 98, 'network.gateway': 98, 'network.dns': 98},
    objectiveMastery: {'N10-009 1.3': 98, 'N10-009 1.4': 98},
    independence: 95,
    transfer: 95
  };

  const story = buildMissionReadiness({ mission, learner, requestedTacticalChallenge: 'STORY' });
  const ghost = buildMissionReadiness({ mission, learner, requestedTacticalChallenge: 'GHOST' });

  assert.equal(story.recommendation.technical_challenge, 'TRANSFER');
  assert.equal(ghost.recommendation.technical_challenge, 'TRANSFER');
  assert.equal(story.recommendation.tactical_challenge, 'STORY');
  assert.equal(ghost.recommendation.tactical_challenge, 'GHOST');
});

test('readiness engine rejects a mission that does not declare a fair minimum toolset', () => {
  assert.throws(
    () => buildMissionReadiness({ mission: { id: 'broken' }, learner: {} }),
    /minimumRequiredToolset/
  );
});

test('published readiness level vocabulary stays stable', () => {
  assert.deepEqual(PRIM_READINESS_LEVELS.tactical, ['STORY', 'STANDARD', 'VETERAN', 'GHOST']);
  assert.deepEqual(PRIM_READINESS_LEVELS.technical, ['FOUNDATION', 'APPLIED', 'ADVANCED', 'TRANSFER']);
  assert.deepEqual(PRIM_READINESS_LEVELS.scaffolding, ['HIGH', 'STANDARD', 'LOW', 'NONE']);
});
