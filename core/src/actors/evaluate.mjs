import { buildActorEvidence, evidenceReceipt, digest } from './evidence.mjs';
import { personaForActor } from './persona.mjs';
import { reviewActorCandidate, auditClaimStructure, deterministicReview, validateCommentFormat, PROMPT_VERSION } from './generate.mjs';

// Private calibration of the real local reviewer using deliberately synthetic
// candidates. No generation is fabricated or reported as model output. Expected
// labels are scoring data and are never sent to the model under evaluation.
export async function evaluateActorReview({ item, actor, comment, proposedKind, expectedReject, evidenceOptions, caseId }, { chat } = {}) {
  if (typeof expectedReject !== 'boolean') throw new Error('Evaluation needs an explicit expected verdict');
  const packet = buildActorEvidence(item, evidenceOptions), persona = personaForActor(actor);
  const body = validateCommentFormat({ source_item_id: item.id, comment }, item.id);
  const source = packet.sources.find(s => ['article', 'post', 'lyrics'].includes(s.type)) || packet.sources[0];
  if (!source || source.text.length < 12) throw new Error('Evaluation requires usable evidence');
  const anchors = [{ source_id: source.source_id, quote: source.text.slice(0, 240) }];
  const claims = [{ text: body, kind: proposedKind, source_ids: [source.source_id] }];
  const claimAudit = auditClaimStructure(body, claims, packet, anchors);
  const deterministicIssues = deterministicReview(body, packet, anchors);
  // Intentionally review even if a deterministic check rejects it, so a weak
  // semantic reviewer cannot hide behind the regex's true-positive count.
  const result = await reviewActorCandidate({ packet, persona, body, anchors, claimAudit }, { chat });
  return { executor: 'actor_review_evaluation:v1', evaluation_only: true, published: false, publication_eligible: false,
    case_id: caseId || null, candidate_origin: 'synthetic_fixture', candidate_sha256: digest(body), fixture_sha256: digest({ item, comment, proposedKind, expectedReject }),
    prompt_version: PROMPT_VERSION, review_prompt_sha256: result.prompt_sha256, provenance: evidenceReceipt(packet), claim_audit: claimAudit,
    deterministic_issues: deterministicIssues, expected_reject: expectedReject, metrics: { review: result.metrics },
    reviewer_verdict: result.verdict || null, error: result.error || null,
    false_approval: result.error ? null : expectedReject && result.verdict?.approved === true,
    semantic_gate: 'not_validated' };
}
