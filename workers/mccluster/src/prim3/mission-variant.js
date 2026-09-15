const TECHNICAL_ORDER = Object.freeze({
  FOUNDATION: 0,
  APPLIED: 1,
  ADVANCED: 2,
  TRANSFER: 3
});

const SCAFFOLDING_DISTRACTOR_BUDGET = Object.freeze({
  HIGH: 0,
  STANDARD: 1,
  LOW: 2,
  NONE: 3
});

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function stableHash(value) {
  let hash = 2166136261;
  const input = String(value || 'prim3');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function overlapCount(left, right) {
  const rightSet = new Set(right);
  return left.reduce((count, value) => count + (rightSet.has(value) ? 1 : 0), 0);
}

function normalizeVariant(variant) {
  if (!variant || typeof variant !== 'object' || typeof variant.id !== 'string' || !variant.id.trim()) {
    throw new TypeError('Every approved Mission variant requires an id');
  }
  const minimum = TECHNICAL_ORDER[variant.minTechnicalChallenge || 'FOUNDATION'];
  const maximum = TECHNICAL_ORDER[variant.maxTechnicalChallenge || 'TRANSFER'];
  if (minimum == null || maximum == null || minimum > maximum) {
    throw new TypeError(`Invalid technical challenge range for variant ${variant.id}`);
  }
  return {
    id: variant.id.trim(),
    minTechnicalChallenge: variant.minTechnicalChallenge || 'FOUNDATION',
    maxTechnicalChallenge: variant.maxTechnicalChallenge || 'TRANSFER',
    targetConceptIds: uniqueStrings(variant.targetConceptIds),
    faultPrimitiveIds: uniqueStrings(variant.faultPrimitiveIds),
    distractorPrimitiveIds: uniqueStrings(variant.distractorPrimitiveIds),
    labAdapter: variant.labAdapter || null,
    optionalObjectiveIds: uniqueStrings(variant.optionalObjectiveIds)
  };
}

function validateInputs(mission, readinessProfile) {
  if (!mission || typeof mission !== 'object' || typeof mission.id !== 'string') {
    throw new TypeError('mission.id is required');
  }
  if (!Array.isArray(mission.approvedVariants) || mission.approvedVariants.length === 0) {
    throw new TypeError('mission.approvedVariants must contain at least one validated variant');
  }
  if (!readinessProfile || typeof readinessProfile !== 'object' || !readinessProfile.recommendation) {
    throw new TypeError('readinessProfile.recommendation is required');
  }
  const technical = readinessProfile.recommendation.technical_challenge;
  if (TECHNICAL_ORDER[technical] == null) throw new TypeError('readiness profile has an invalid technical challenge');
}

function candidatesForChallenge(variants, challenge) {
  const level = TECHNICAL_ORDER[challenge];
  return variants.filter((variant) => {
    return level >= TECHNICAL_ORDER[variant.minTechnicalChallenge]
      && level <= TECHNICAL_ORDER[variant.maxTechnicalChallenge];
  });
}

/**
 * Select one authored and validated Mission variant.
 *
 * This compiler adapts which approved problem the learner receives. It never
 * creates new infrastructure primitives, never changes technical truth during
 * play, and never sends learner mastery data to Threat AI.
 */
export function compileMissionVariant({ mission, readinessProfile, seed = '' }) {
  validateInputs(mission, readinessProfile);

  const variants = mission.approvedVariants.map(normalizeVariant);
  const technicalChallenge = readinessProfile.recommendation.technical_challenge;
  const scaffolding = readinessProfile.recommendation.scaffolding || 'STANDARD';
  const reviewConcepts = uniqueStrings(readinessProfile.recommendation.targeted_review_concept_ids);

  let candidates = candidatesForChallenge(variants, technicalChallenge);
  if (!candidates.length) candidates = variants;

  const ranked = candidates
    .map((variant) => ({
      variant,
      remediationFit: overlapCount(variant.targetConceptIds, reviewConcepts)
    }))
    .sort((a, b) => b.remediationFit - a.remediationFit || a.variant.id.localeCompare(b.variant.id));

  const bestFit = ranked[0].remediationFit;
  const bestCandidates = ranked.filter((entry) => entry.remediationFit === bestFit);
  const choiceIndex = stableHash(`${mission.id}:${seed}:${technicalChallenge}`) % bestCandidates.length;
  const selected = bestCandidates[choiceIndex].variant;

  const distractorBudget = SCAFFOLDING_DISTRACTOR_BUDGET[scaffolding] ?? 1;
  const distractors = selected.distractorPrimitiveIds.slice(0, distractorBudget);
  const requiredTools = uniqueStrings(
    readinessProfile.fairness && readinessProfile.fairness.minimum_required_toolset
  );
  const grantedTools = uniqueStrings(
    readinessProfile.fairness && readinessProfile.fairness.granted_toolset
  );

  const missingRequiredTools = requiredTools.filter((tool) => !grantedTools.includes(tool));
  if (missingRequiredTools.length) {
    throw new Error(`Mission Readiness violated required tool floor: ${missingRequiredTools.join(', ')}`);
  }

  return {
    compiler_version: '1.0.0',
    mission_id: mission.id,
    variant_id: selected.id,
    technical_challenge: technicalChallenge,
    tactical_challenge: readinessProfile.recommendation.tactical_challenge || 'STANDARD',
    scaffolding,
    target_concept_ids: selected.targetConceptIds,
    fault_primitive_ids: selected.faultPrimitiveIds,
    distractor_primitive_ids: distractors,
    lab_adapter: selected.labAdapter,
    minimum_required_toolset: requiredTools,
    granted_toolset: grantedTools,
    preparation_credit_count: Math.max(0, Number(readinessProfile.recommendation.preparation_credits || 0)),
    preparation_advantage_ids: uniqueStrings(readinessProfile.recommendation.preparation_advantage_ids),
    optional_objective_ids: technicalChallenge === 'TRANSFER'
      ? selected.optionalObjectiveIds
      : [],
    invariants: {
      technical_truth_locked_at_compile: true,
      mission_director_may_mutate_technical_answer: false,
      threat_ai_may_access_learner_model: false,
      learning_evaluator_separate_from_compiler: true,
      minimum_required_tools_preserved: true
    }
  };
}

export const PRIM_VARIANT_COMPILER_POLICY = Object.freeze({
  technicalOrder: {...TECHNICAL_ORDER},
  scaffoldingDistractorBudget: {...SCAFFOLDING_DISTRACTOR_BUDGET}
});
