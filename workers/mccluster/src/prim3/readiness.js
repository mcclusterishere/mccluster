const TACTICAL_LEVELS = ['STORY', 'STANDARD', 'VETERAN', 'GHOST'];
const TECHNICAL_LEVELS = ['FOUNDATION', 'APPLIED', 'ADVANCED', 'TRANSFER'];
const SCAFFOLDING_LEVELS = ['HIGH', 'STANDARD', 'LOW', 'NONE'];

function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function normalizeScoreMap(value) {
  if (!value) return {};
  if (Array.isArray(value)) {
    return Object.fromEntries(value
      .filter((entry) => entry && typeof entry.id === 'string')
      .map((entry) => [entry.id, clampScore(entry.score)]));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([id, score]) => [id, clampScore(score)]));
  }
  return {};
}

function averageForIds(scoreMap, ids) {
  const values = (ids || [])
    .filter((id) => Object.prototype.hasOwnProperty.call(scoreMap, id))
    .map((id) => scoreMap[id]);
  if (!values.length) return null;
  return values.reduce((sum, score) => sum + score, 0) / values.length;
}

function meanKnown(values, fallback = 0) {
  const known = values.filter((value) => Number.isFinite(value));
  if (!known.length) return fallback;
  return known.reduce((sum, value) => sum + value, 0) / known.length;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function intersection(values, allowed) {
  const allow = new Set(allowed);
  return uniqueStrings(values).filter((value) => allow.has(value));
}

function technicalChallenge(readinessScore, transferScore) {
  if (readinessScore >= 90 && transferScore >= 80) return 'TRANSFER';
  if (readinessScore >= 82) return 'ADVANCED';
  if (readinessScore >= 70) return 'APPLIED';
  return 'FOUNDATION';
}

function scaffoldingLevel(readinessScore, independenceScore) {
  if (readinessScore < 65 || independenceScore < 60) return 'HIGH';
  if (readinessScore < 80 || independenceScore < 75) return 'STANDARD';
  if (readinessScore < 92 || independenceScore < 90) return 'LOW';
  return 'NONE';
}

function preparationCredits(readinessScore, independenceScore) {
  if (readinessScore >= 94 && independenceScore >= 85) return 2;
  if (readinessScore >= 84 && independenceScore >= 75) return 1;
  return 0;
}

function confidenceForEvidence(count) {
  if (count >= 3) return 'HIGH';
  if (count >= 1) return 'MEDIUM';
  return 'LOW';
}

function readinessRows(scoreMap, ids, evidence = {}) {
  return ids.map((id) => {
    const count = Math.max(0, Number(evidence[id] || 0));
    return {
      id,
      score: Object.prototype.hasOwnProperty.call(scoreMap, id) ? scoreMap[id] : 0,
      evidence_count: Number.isFinite(count) ? count : 0,
      confidence: confidenceForEvidence(Number.isFinite(count) ? count : 0)
    };
  });
}

function validateMission(mission) {
  if (!mission || typeof mission !== 'object') throw new TypeError('mission is required');
  if (!mission.id || typeof mission.id !== 'string') throw new TypeError('mission.id is required');
  if (!Array.isArray(mission.minimumRequiredToolset) || mission.minimumRequiredToolset.length === 0) {
    throw new TypeError('mission.minimumRequiredToolset must contain at least one required tool');
  }
}

/**
 * Build a deterministic PRIM Mission Readiness Profile.
 *
 * Principles evidence controls technical preparedness. Rhythm and Immersion can
 * create Recall and Context resources, but they never increase the Principles
 * readiness score. Tactical challenge is an independent player or campaign
 * choice and is never inferred from technical mastery.
 */
export function buildMissionReadiness({ mission, learner = {}, requestedTacticalChallenge = 'STANDARD' }) {
  validateMission(mission);

  const targetConceptIds = uniqueStrings(mission.targetConceptIds);
  const targetObjectiveIds = uniqueStrings(mission.targetObjectiveIds);
  const conceptScores = normalizeScoreMap(learner.conceptMastery);
  const objectiveScores = normalizeScoreMap(learner.objectiveMastery);

  const conceptAverage = averageForIds(conceptScores, targetConceptIds);
  const objectiveAverage = averageForIds(objectiveScores, targetObjectiveIds);
  const principlesReadiness = Math.round(meanKnown([conceptAverage, objectiveAverage], 0));

  const independence = clampScore(learner.independence, 50);
  const transfer = clampScore(learner.transfer, 50);
  const technical = technicalChallenge(principlesReadiness, transfer);
  const scaffolding = scaffoldingLevel(principlesReadiness, independence);
  const credits = preparationCredits(principlesReadiness, independence);

  const tactical = TACTICAL_LEVELS.includes(requestedTacticalChallenge)
    ? requestedTacticalChallenge
    : 'STANDARD';

  const preparationAdvantages = uniqueStrings(mission.allowedPreparationAdvantages).slice(0, credits);
  const minimumRequiredToolset = uniqueStrings(mission.minimumRequiredToolset);

  const rhythmConcepts = intersection(
    learner.rhythm && learner.rhythm.reinforcedConceptIds,
    targetConceptIds
  );
  const immersionConcepts = intersection(
    learner.immersion && learner.immersion.contextConceptIds,
    targetConceptIds
  );
  const contextIntelIds = uniqueStrings(learner.immersion && learner.immersion.contextIntelIds);

  const conceptEvidence = learner.conceptEvidence && typeof learner.conceptEvidence === 'object'
    ? learner.conceptEvidence
    : {};
  const objectiveEvidence = learner.objectiveEvidence && typeof learner.objectiveEvidence === 'object'
    ? learner.objectiveEvidence
    : {};

  return {
    profile_version: '1.0.0',
    mission_id: mission.id,
    principles_readiness: principlesReadiness,
    concept_readiness: readinessRows(conceptScores, targetConceptIds, conceptEvidence),
    objective_readiness: readinessRows(objectiveScores, targetObjectiveIds, objectiveEvidence),
    independence: {
      score: independence,
      evidence_count: Math.max(0, Number(learner.independenceEvidenceCount || 0))
    },
    transfer: {
      score: transfer,
      evidence_count: Math.max(0, Number(learner.transferEvidenceCount || 0)),
      changed_scenarios_completed: Math.max(0, Number(learner.changedScenariosCompleted || 0))
    },
    rhythm: {
      reinforced_concept_ids: rhythmConcepts,
      recall_tokens: rhythmConcepts.length ? 1 : 0,
      recall_cannot_reveal_solution: true
    },
    immersion: {
      context_concept_ids: immersionConcepts,
      context_intel_ids: contextIntelIds,
      context_cannot_reveal_unearned_solution: true
    },
    recommendation: {
      tactical_challenge: tactical,
      technical_challenge: technical,
      scaffolding,
      preparation_credits: credits,
      preparation_advantage_ids: preparationAdvantages,
      optional_objective_ids: technical === 'TRANSFER'
        ? uniqueStrings(mission.transferOptionalObjectiveIds)
        : [],
      targeted_review_concept_ids: targetConceptIds.filter((id) => (conceptScores[id] ?? 0) < 70)
    },
    fairness: {
      minimum_required_toolset: minimumRequiredToolset,
      granted_toolset: [...minimumRequiredToolset],
      required_tools_removed_for_low_mastery: false
    }
  };
}

export const PRIM_READINESS_LEVELS = Object.freeze({
  tactical: [...TACTICAL_LEVELS],
  technical: [...TECHNICAL_LEVELS],
  scaffolding: [...SCAFFOLDING_LEVELS]
});
