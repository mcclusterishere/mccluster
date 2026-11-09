/* Provider-neutral corporate record preparation, not a transfer agent, legal
 * determination, cash ledger or payment executor. All identifiers are scoped by
 * the authenticated company aggregate. No network, credentials or PII required. */
export const SCHEMA = 'company-operations/v1';
export class CompanyOperationError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function requireValue(value, code, status = 400) {
  if (!value) throw new CompanyOperationError(code, status);
}
const id = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(x);
const text = (x, max = 200) => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= max && !/[\x00-\x1f]/.test(x);
const amount = (x, zero = false) => typeof x === 'string' && /^(0|[1-9][0-9]{0,35})$/.test(x) && (zero || x !== '0');
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
function shape(o, fields) {
  requireValue(o && typeof o === 'object' && !Array.isArray(o), 'invalid_object');
  requireValue(Object.keys(o).sort().join(',') === fields.split(' ').sort().join(','), 'unknown_or_missing_fields');
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  requireValue(value === null || ['string', 'boolean', 'number'].includes(typeof value), 'invalid_json');
  if (typeof value === 'number') requireValue(Number.isSafeInteger(value), 'invalid_json_number');
  return JSON.stringify(value);
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
export function emptyCompany(orgId, companyId) {
  requireValue(id(orgId) && id(companyId), 'invalid_scope');
  return { schema: SCHEMA, orgId, companyId, revision: 0, profile: null, documents: [], ownership: [], declarations: [], records: [] };
}
function evidence(state, reference, kind) {
  requireValue(id(reference), 'invalid_evidence_reference');
  const doc = state.documents.find(x => x.id === reference && (!kind || x.kind === kind));
  requireValue(doc, 'evidence_missing_or_wrong_kind');
  return doc;
}
function findDeclaration(state, declarationId) {
  const item = state.declarations.find(x => x.id === declarationId);
  requireValue(item, 'declaration_not_found', 404);
  return item;
}
function eligible(state, kind) {
  requireValue(state.profile, 'company_not_registered');
  requireValue((kind === 'cash_dividend' && state.profile.form === 'for_profit_corporation') ||
    (kind === 'member_distribution' && state.profile.form === 'llc'), 'entity_distribution_review_required', 409);
}
/* Exact integer largest-remainder allocation. Only a single explicitly selected
 * class with equal per-unit rights is supported. Preference waterfalls, options,
 * treasury shares, beneficial owners and tax withholding are not inferred. */
export function allocate(totalMinor, holdings) {
  requireValue(amount(totalMinor) && Array.isArray(holdings) && holdings.length > 0 && holdings.length <= 1000, 'invalid_allocation');
  const parties = new Set(); let totalUnits = 0n;
  for (const row of holdings) {
    shape(row, 'partyRef units');
    requireValue(id(row.partyRef) && !parties.has(row.partyRef) && amount(row.units), 'invalid_holding');
    parties.add(row.partyRef); totalUnits += BigInt(row.units);
  }
  const total = BigInt(totalMinor);
  const rows = holdings.map(row => ({ partyRef: row.partyRef, units: row.units, minor: total * BigInt(row.units) / totalUnits, remainder: total * BigInt(row.units) % totalUnits }));
  let remaining = total - rows.reduce((a, row) => a + row.minor, 0n);
  const order = [...rows].sort((a, b) => a.remainder === b.remainder ? (a.partyRef < b.partyRef ? -1 : 1) : a.remainder > b.remainder ? -1 : 1);
  for (const row of order) if (remaining > 0n) { row.minor++; remaining--; }
  return rows.sort((a, b) => a.partyRef < b.partyRef ? -1 : 1).map(({partyRef, units, minor}) => ({ partyRef, units, amountMinor: minor.toString() }));
}
export function reduceCompany(current, command, { actorId, orgId, companyId, at, human = false } = {}) {
  requireValue(current?.schema === SCHEMA && current.orgId === orgId && current.companyId === companyId && id(actorId), 'scope_mismatch', 403);
  requireValue(date(at?.slice(0, 10)) && new Date(at).toISOString() === at, 'invalid_server_time');
  shape(command, 'id type data');
  requireValue(id(command.id) && text(command.type, 80), 'invalid_command');
  requireValue(!current.records.some(x => x.commandId === command.id), 'duplicate_command', 409);
  const state = structuredClone(current), data = structuredClone(command.data);
  if (command.type !== 'register_company') requireValue(state.profile, 'company_not_registered');
  switch (command.type) {
    case 'register_company': {
      shape(data, 'name form jurisdiction currency currencyExponent');
      requireValue(!state.profile, 'company_already_registered', 409);
      requireValue(text(data.name) && text(data.jurisdiction, 80) && ['for_profit_corporation', 'llc', 'nonprofit', 'unknown'].includes(data.form), 'invalid_company');
      requireValue(typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) && Number.isInteger(data.currencyExponent) && data.currencyExponent >= 0 && data.currencyExponent <= 4, 'invalid_currency');
      state.profile = {...data, legalStatus: 'operator_record_not_verified_legal_status'};
      break;
    }
    case 'record_document': {
      shape(data, 'id kind artifactRef sha256 effectiveDate');
      requireValue(id(data.id) && id(data.artifactRef) && typeof data.sha256 === 'string' && /^[a-f0-9]{64}$/.test(data.sha256) && date(data.effectiveDate) && data.effectiveDate <= at.slice(0, 10), 'invalid_document');
      requireValue(['charter', 'ownership_register', 'resolution', 'legal_review', 'accounting_review', 'correction'].includes(data.kind), 'invalid_document_kind');
      requireValue(!state.documents.some(x => x.id === data.id), 'document_id_exists', 409);
      state.documents.push({...data, recordedBy: actorId, recordedAt: at});
      break;
    }
    case 'record_ownership_snapshot': {
      shape(data, 'id effectiveDate sourceDocument supersedes classes');
      requireValue(id(data.id) && date(data.effectiveDate) && data.effectiveDate <= at.slice(0, 10), 'invalid_ownership');
      requireValue(!state.ownership.some(x => x.id === data.id), 'ownership_id_exists', 409);
      const doc = evidence(state, data.sourceDocument, 'ownership_register');
      requireValue(doc.effectiveDate <= data.effectiveDate, 'ownership_evidence_date');
      const previous = data.supersedes === null ? null : state.ownership.find(x => x.id === data.supersedes);
      requireValue(data.supersedes === null || previous?.effectiveDate === data.effectiveDate, 'missing_superseded_snapshot');
      requireValue(!state.ownership.some(x => x.effectiveDate === data.effectiveDate) || previous, 'correction_reference_required', 409);
      requireValue(!state.ownership.some(x => data.supersedes && x.supersedes === data.supersedes), 'correction_branch_conflict', 409);
      requireValue(Array.isArray(data.classes) && data.classes.length > 0 && data.classes.length <= 30, 'invalid_classes');
      const classes = new Set();
      for (const c of data.classes) {
        shape(c, 'id authorizedUnits outstandingUnits unitScale allocationBasis holdings');
        requireValue(id(c.id) && !classes.has(c.id) && amount(c.authorizedUnits) && amount(c.outstandingUnits) && BigInt(c.outstandingUnits) <= BigInt(c.authorizedUnits), 'invalid_share_class');
        requireValue(Number.isInteger(c.unitScale) && c.unitScale >= 0 && c.unitScale <= 12 && ['equal_per_unit', 'unsupported'].includes(c.allocationBasis), 'invalid_share_class');
        allocate('1', c.holdings); // Validates integer quantities and duplicate parties.
        requireValue(c.holdings.reduce((sum, row) => sum + BigInt(row.units), 0n) === BigInt(c.outstandingUnits), 'ownership_total_mismatch');
        classes.add(c.id);
      }
      state.ownership.push({...data, recordedBy: actorId, recordedAt: at, status: 'recorded_assertion_not_title_transfer'});
      break;
    }
    case 'draft_declaration': {
      shape(data, 'id kind snapshotId classId totalMinor currency recordDate payableDate');
      requireValue(id(data.id) && !state.declarations.some(x => x.id === data.id), 'declaration_id_exists', 409);
      eligible(state, data.kind);
      requireValue(amount(data.totalMinor) && data.currency === state.profile.currency && date(data.recordDate) && date(data.payableDate) && data.payableDate >= data.recordDate && data.recordDate <= at.slice(0, 10), 'invalid_declaration_terms');
      const snapshot = state.ownership.find(x => x.id === data.snapshotId);
      requireValue(snapshot && snapshot.effectiveDate === data.recordDate && !state.ownership.some(x => x.supersedes === snapshot.id), 'record_date_snapshot_required', 409);
      const shareClass = snapshot.classes.find(x => x.id === data.classId);
      requireValue(shareClass?.allocationBasis === 'equal_per_unit', 'unsupported_distribution_rights', 409);
      state.declarations.push({...data, status: 'draft', termsRevision: 1, preparedBy: actorId, preparedAt: at,
        allocations: allocate(data.totalMinor, shareClass.holdings), reviews: [], declarationRecord: null, handoff: null, voidRecord: null});
      break;
    }
    case 'submit_declaration_review': {
      shape(data, 'declarationId'); const d = findDeclaration(state, data.declarationId);
      requireValue(d.status === 'draft', 'invalid_declaration_state', 409);
      requireValue(!state.ownership.some(x => x.supersedes === d.snapshotId), 'snapshot_superseded', 409);
      d.status = 'in_review'; break;
    }
    case 'record_declaration_review': {
      shape(data, 'declarationId termsRevision decision legalDocument accountingDocument');
      const d = findDeclaration(state, data.declarationId);
      requireValue(d.status === 'in_review' && data.termsRevision === d.termsRevision, 'stale_review', 409);
      requireValue(human === true && actorId !== d.preparedBy, 'independent_human_review_required', 403);
      requireValue(['approve', 'reject'].includes(data.decision), 'invalid_review');
      evidence(state, data.legalDocument, 'legal_review'); evidence(state, data.accountingDocument, 'accounting_review');
      requireValue(!state.ownership.some(x => x.supersedes === d.snapshotId), 'snapshot_superseded', 409);
      d.reviews.push({...data, reviewerId: actorId, recordedAt: at}); d.status = data.decision === 'approve' ? 'reviewed' : 'rejected'; break;
    }
    case 'record_declaration': {
      shape(data, 'declarationId termsRevision resolutionDocument declaredDate');
      const d = findDeclaration(state, data.declarationId);
      requireValue(d.status === 'reviewed' && data.termsRevision === d.termsRevision, 'review_required', 409);
      requireValue(human === true, 'human_recording_required', 403);
      const resolution = evidence(state, data.resolutionDocument, 'resolution');
      requireValue(date(data.declaredDate) && data.declaredDate <= at.slice(0, 10) && data.declaredDate <= d.payableDate && resolution.effectiveDate === data.declaredDate, 'invalid_declared_date');
      requireValue(!state.ownership.some(x => x.supersedes === d.snapshotId), 'snapshot_superseded', 409);
      d.status = 'declaration_recorded';
      d.declarationRecord = {...data, recordedBy: actorId, recordedAt: at, legalEffect: 'records_external_decision_only'}; break;
    }
    case 'prepare_handoff': {
      shape(data, 'declarationId'); const d = findDeclaration(state, data.declarationId);
      requireValue(d.status === 'declaration_recorded' && !d.handoff, 'declaration_not_handoff_ready', 409);
      requireValue(!state.ownership.some(x => x.supersedes === d.snapshotId), 'snapshot_superseded', 409);
      d.handoff = {id: command.id, preparedAt: at, preparedBy: actorId, status: 'human_handoff_required', executionEnabled: false}; break;
    }
    case 'void_declaration_record': {
      shape(data, 'declarationId reason correctionDocument'); const d = findDeclaration(state, data.declarationId);
      requireValue(human === true && !['void', 'rejected'].includes(d.status), 'invalid_void', 409);
      requireValue(text(data.reason, 1000), 'reason_required'); evidence(state, data.correctionDocument, 'correction');
      d.voidRecord = {...data, recordedBy: actorId, recordedAt: at}; d.status = 'void'; break;
    }
    default: throw new CompanyOperationError('unsupported_command');
  }
  requireValue(state.documents.length <= 500 && state.ownership.length <= 100 && state.declarations.length <= 200 && state.records.length < 2000, 'workspace_capacity', 409);
  state.revision++;
  state.records.push({commandId: command.id, type: command.type, actorId, at, revision: state.revision});
  return state;
}
/* A proposal for the EXISTING financial journal adapter, never an actual posting.
 * Account references must be resolved by that adapter, not supplied by a client. */
export function accountingProposal(state, declarationId) {
  const d = findDeclaration(state, declarationId);
  requireValue(d.status === 'declaration_recorded', 'declaration_not_recorded', 409);
  requireValue(!state.ownership.some(x => x.supersedes === d.snapshotId), 'snapshot_superseded', 409);
  return {schema: 'company-accounting-proposal/v1', orgId: state.orgId, companyId: state.companyId, declarationId: d.id,
    currency: d.currency, currencyExponent: state.profile.currencyExponent, posted: false, recognitionRequiresHumanReview: true,
    lines: [{purpose: 'distribution_equity', side: 'debit', amountMinor: d.totalMinor}, {purpose: 'distribution_payable', side: 'credit', amountMinor: d.totalMinor}]};
}
export function handoffPacket(state, declarationId) {
  const d = findDeclaration(state, declarationId);
  requireValue(d.status === 'declaration_recorded' && d.handoff, 'handoff_unavailable', 409);
  requireValue(!state.ownership.some(x => x.supersedes === d.snapshotId), 'snapshot_superseded', 409);
  return {schema: 'company-distribution-handoff/v1', orgId: state.orgId, companyId: state.companyId, declarationId: d.id,
    handoffId: d.handoff.id, status: 'human_handoff_required', executionEnabled: false, currency: d.currency,
    currencyExponent: state.profile.currencyExponent, totalMinor: d.totalMinor, allocations: structuredClone(d.allocations),
    snapshotId: d.snapshotId, resolutionDocument: d.declarationRecord.resolutionDocument, payableDate: d.payableDate,
    warnings: ['No payment submitted or scheduled', 'No legal entitlement or tax calculation established', 'Resolve recipients, tax, solvency, provider eligibility and authorization before action']};
}
