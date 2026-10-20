/* Deterministic screening over the existing funding catalog. This module never
 * submits applications, grants access, records money, or authorizes spending.
 * No applicant facts or reviewer attestations arrive through query parameters. */
export const FUNDING_REGISTER_VERSION = 'funding-requirements/1';
export const CRITERION_STATUSES = Object.freeze([
  'evidenced', 'gap', 'unverified', 'external_prerequisite',
  'not_applicable', 'closed', 'incompatible'
]);
const REQUIRED = new Set(['required_eligibility', 'required_submission']);
const KINDS = new Set([...REQUIRED, 'scored', 'recommendation', 'proposed_target']);
const CALL_STATES = new Set(['open', 'rolling', 'closed', 'forecast', 'unverified',
  'invitation_only', 'conditional', 'incompatible', 'event_triggered', 'no_standing_call']);
const STOPPED = new Set(['closed', 'incompatible', 'forecast', 'no_standing_call']);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const bounded = (value, length = 500) => typeof value === 'string' ? value.slice(0, length) : '';

function criterionProjection(criterion, { now, resolvedEvidence, reviewedSources }) {
  const c = criterion && typeof criterion === 'object' ? criterion : {};
  let status = CRITERION_STATUSES.includes(c.status) ? c.status : 'unverified';
  const classification = KINDS.has(c.classification) ? c.classification : 'required_eligibility';
  const refs = Array.isArray(c.evidence_refs) ? c.evidence_refs.slice(0, 30).filter(x => typeof x === 'string') : [];
  // A label or hash is not proof. The caller must independently resolve each
  // reference in the authorized project. The current read-only API supplies no
  // resolver, so imported assertions cannot turn a route into "eligible".
  const reviewed = typeof c.reviewer === 'string' && c.reviewer.length > 0 &&
    validDate(c.reviewed_at) && Date.parse(c.reviewed_at) <= now &&
    refs.length > 0 && refs.every(ref => resolvedEvidence.has(ref));
  const sourceReviewed = c.source_basis === 'reviewed_primary_source' &&
    typeof c.source_version === 'string' && reviewedSources.has(c.source_version);
  let reason = null;
  if ((status === 'evidenced' || status === 'not_applicable') && (!reviewed || !sourceReviewed)) {
    status = 'unverified';
    reason = 'reviewed_source_and_resolved_evidence_required';
  }
  return {
    criterion_id: bounded(c.criterion_id, 100), classification,
    requirement: bounded(c.requirement, 1200), status,
    blocking: REQUIRED.has(classification) && !['evidenced', 'not_applicable'].includes(status),
    reason, work_package: /^W\d\d$/.test(c.work_package || '') ? c.work_package : null,
    deliverable: bounded(c.deliverable), acceptance_artifact: bounded(c.acceptance_artifact),
    source_url: bounded(c.source_url, 1000), source_section: bounded(c.source_section),
    source_basis: bounded(c.source_basis, 100), source_version: bounded(c.source_version, 150),
    responsible_owner: bounded(c.responsible_owner, 100) || null,
    reviewer: bounded(c.reviewer, 100) || null, reviewed_at: validDate(c.reviewed_at) ? c.reviewed_at : null,
    evidence_refs: refs
  };
}

export function evaluateFundingRegister(row, { now = Date.now(), resolvedEvidence = new Set(), details = false } = {}) {
  const raw = row?.criteria_register;
  const installed = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.schema_version === 1;
  const register = installed ? raw : {};
  const sources = Array.isArray(register.source_versions) ? register.source_versions.slice(-20) : [];
  const reviewedSources = new Set(sources.filter(s =>
    s.review_state === 'complete_requirements_review' && validDate(s.reviewed_at) &&
    Date.parse(s.reviewed_at) <= now && /^[a-f0-9]{64}$/.test(s.sha256 || '') &&
    typeof s.source_id === 'string' && s.source_id.startsWith('official:') &&
    typeof s.reviewer === 'string' && s.reviewer.length > 0
  ).map(s => s.source_id));
  const criteria = (Array.isArray(register.criteria) ? register.criteria : []).slice(0, 100)
    .map(c => criterionProjection(c, { now, resolvedEvidence, reviewedSources }));
  const invalid = !installed || criteria.length === 0 || register.criteria.length > 100 ||
    new Set(criteria.map(c => c.criterion_id)).size !== criteria.length || criteria.some(c => !c.criterion_id);
  let callStatus = CALL_STATES.has(register.call_status) ? register.call_status : 'unverified';
  const deadline = register.deadline && typeof register.deadline === 'object' ? register.deadline : {};
  const deadlinePassed = validDate(deadline.instant) && now >= Date.parse(deadline.instant);
  if (deadlinePassed && !['incompatible', 'closed'].includes(callStatus)) callStatus = 'closed';
  // Preserve older closure evidence even when newer metadata incorrectly says open.
  if (row?.availability === 'closed' && callStatus !== 'incompatible') callStatus = 'closed';
  const required = criteria.filter(c => REQUIRED.has(c.classification));
  const blockers = required.filter(c => c.blocking);
  const eligibility = required.filter(c => c.classification === 'required_eligibility' && c.blocking);
  const sourceComplete = register.requirements_complete === true && reviewedSources.size > 0;
  // A general program catalog intentionally has no selected private applicant.
  // Even a complete technical packet is not an applicant eligibility finding.
  const applicantStatus = eligibility.some(c => ['closed', 'incompatible', 'gap'].includes(c.status)) || STOPPED.has(callStatus)
    ? 'blocked' : 'external_prerequisite';
  const readiness = invalid ? 'unverified' : STOPPED.has(callStatus) ? callStatus :
    blockers.length ? 'blocked' : !sourceComplete ? 'unverified' : 'awaiting_private_applicant_review';
  const out = {
    opportunity_id: bounded(row?.opportunity_id, 100), route_id: bounded(register.route_id, 10),
    funder_name: bounded(row?.funder_name, 250), program_title: bounded(row?.program_title, 350),
    source_url: bounded(row?.source_url, 1000),
    register_version: bounded(register.version, 100) || null,
    projection_version: FUNDING_REGISTER_VERSION,
    register_state: invalid ? 'unverified' : 'installed',
    instrument: bounded(register.instrument, 80) || 'unverified', call_status: callStatus,
    call_status_basis: deadlinePassed ? 'declared_deadline_elapsed' : bounded(register.call_status_basis, 100),
    brief_status: bounded(register.brief_status), deadline,
    criteria_scope: bounded(register.criteria_scope, 100) || 'unverified',
    requirements_complete: sourceComplete,
    technical_fit: { status: 'proposed_not_evaluated', work_packages: Array.isArray(register.work_packages) ?
      register.work_packages.filter(w => /^W\d\d$/.test(w)).slice(0, 10) : [] },
    applicant_eligibility: { status: applicantStatus, selected_applicant: null },
    application_readiness: { status: readiness, blocking_criterion_ids: blockers.map(c => c.criterion_id) },
    eligible_to_apply: STOPPED.has(callStatus) || eligibility.some(c => ['gap', 'incompatible', 'closed'].includes(c.status)) ? false : null,
    funding_authorized: false, award_received: false, payout_enabled: false,
    source_review: sourceComplete ? 'complete_requirements_review' : 'unverified_or_partial',
    criterion_counts: { total: criteria.length, required: required.length, blocking: blockers.length,
      proposed_targets: criteria.filter(c => c.classification === 'proposed_target').length },
    // No percentage, reviewer weight, award probability or available-cash sum.
    notice: 'Technical fit, applicant eligibility and submission readiness are separate. A catalog record authorizes no application, mission, spending or payout.'
  };
  if (details) Object.assign(out, { criteria, source_versions: sources,
    official_identifier: bounded(register.official_identifier, 150) || null,
    amendment: bounded(register.amendment, 100) || null,
    award: register.award || null, cost_evidence: register.cost_evidence || null,
    allowed_scope_costs: register.allowed_scope_costs || null,
    required_materials: register.required_materials || null,
    data_ip_ai_terms: register.data_ip_ai_terms || null,
    reporting_milestones: Array.isArray(register.reporting_milestones) ? register.reporting_milestones.slice(0, 50) : [] });
  return out;
}
