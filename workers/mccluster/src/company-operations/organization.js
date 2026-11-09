/* Recordkeeping architecture only. Canonical owner ingress remains in service.js.
 * Seats are work assignments, never legal offices, auth grants or execution jobs. */
import { requireValue, CompanyOperationError } from './domain.js';

const TYPES = ['org_record_mandate', 'org_define_role', 'org_assign_seat', 'org_set_campaign', 'org_set_milestone', 'org_link_task', 'org_submit_daily_entry', 'org_review_daily_entry', 'org_record_weekly_report'];
export const isOrganizationCommand = type => TYPES.includes(type);
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(x);
const text = (x, max = 1000) => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= max && !/[\x00-\x1f]/.test(x);
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const instant = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
function shape(x, fields) {
  requireValue(x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).sort().join(' ') === fields.split(' ').sort().join(' '), 'organization_invalid_fields');
}
function zone(x) {
  requireValue(text(x, 100), 'time_zone_required');
  try { new Intl.DateTimeFormat('en-US', {timeZone: x}).format(0); } catch { throw new CompanyOperationError('invalid_time_zone'); }
  return x;
}
function localDate(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(at));
  const get = key => parts.find(x => x.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const latest = (rows, key) => rows.filter(x => x.id === key).at(-1);
const empty = () => ({schema: 'company-organization/v1', mandates: [], roles: [], assignments: [], campaigns: [], milestones: [], taskLinks: [], entries: [], reviews: [], reports: []});
function evidence(state, ids, {required = false} = {}) {
  requireValue(Array.isArray(ids) && ids.length <= 20 && (!required || ids.length > 0) && ids.every(id) && new Set(ids).size === ids.length, 'invalid_organization_evidence');
  for (const key of ids) {
    const candidates = [...(state.documents || []), ...(state.ledger?.evidence || [])].filter(x => x.id === key);
    requireValue(candidates.length === 1, 'organization_evidence_missing_or_ambiguous');
    const doc = candidates[0];
    requireValue((doc.orgId === undefined || doc.orgId === state.orgId) && (doc.companyId === undefined || doc.companyId === state.companyId), 'evidence_scope_mismatch', 403);
    requireValue(id(doc.artifactRef) && typeof doc.sha256 === 'string' && /^[a-f0-9]{64}$/.test(doc.sha256), 'organization_evidence_invalid');
  }
}
function version(rows, d) {
  requireValue(id(d.id) && Number.isSafeInteger(d.expectedVersion) && d.expectedVersion >= 0, 'invalid_organization_version');
  const previous = latest(rows, d.id);
  requireValue((previous?.version || 0) === d.expectedVersion, 'stale_organization_version', 409);
  return d.expectedVersion + 1;
}
function current(rows, key, v) {
  const row = latest(rows, key);
  requireValue(row && row.version === v, 'stale_or_missing_organization_reference', 409);
  return row;
}
function unique(rows, key) { requireValue(id(key) && !rows.some(x => x.id === key), 'organization_id_exists', 409); }

export function applyOrganizationCommand(state, command, context) {
  shape(command, 'id type data');
  requireValue(isOrganizationCommand(command.type) && id(command.id), 'unsupported_organization_command');
  requireValue(context?.orgId === state.orgId && context?.companyId === state.companyId && id(context.actorId), 'scope_mismatch', 403);
  requireValue(instant(context.at), 'invalid_server_time');
  requireValue(state.profile, 'company_not_registered');
  const o = structuredClone(state.organization || empty());
  const d = structuredClone(command.data), {actorId, at, human} = context;
  const stamp = {recordedBy: actorId, recordedAt: at, aggregateRevision: state.revision + 1, commandId: command.id};
  const ceo = () => requireValue(human === true && o.mandates.at(-1)?.actorId === actorId, 'human_ceo_required', 403);
  switch (command.type) {
    case 'org_record_mandate': {
      shape(d, 'evidenceIds timeZone'); zone(d.timeZone); evidence(state, d.evidenceIds, {required: true});
      requireValue(human === true, 'human_ceo_required', 403);
      requireValue(o.mandates.length === 0, 'mandate_already_recorded', 409);
      o.mandates.push({...d, ...stamp, actorId, meaning: 'human_operational_sponsor_not_legal_appointment'}); break;
    }
    case 'org_define_role': {
      ceo(); shape(d, 'id expectedVersion title jobType responsibilities capabilityIds');
      const v = version(o.roles, d);
      requireValue(text(d.title, 200) && id(d.jobType) && text(d.responsibilities, 4000), 'invalid_role');
      requireValue(Array.isArray(d.capabilityIds) && d.capabilityIds.length <= 20 && new Set(d.capabilityIds).size === d.capabilityIds.length && d.capabilityIds.every(x => typeof x === 'string' && /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/.test(x) && x.length <= 100), 'invalid_capability_references');
      o.roles.push({...d, ...stamp, version: v, authority: 'work_scope_only'}); break;
    }
    case 'org_assign_seat': {
      ceo(); shape(d, 'id roleId roleVersion principalRef principalType replaces reason'); unique(o.assignments, d.id);
      current(o.roles, d.roleId, d.roleVersion);
      requireValue(id(d.principalRef) && ['human', 'ai_agent'].includes(d.principalType) && text(d.reason), 'invalid_seat');
      const previous = o.assignments.filter(x => x.roleId === d.roleId).at(-1);
      requireValue(d.replaces === (previous?.id || null), 'seat_replacement_required', 409);
      o.assignments.push({...d, ...stamp, identityStatus: 'owner_asserted_not_authenticated', legalOffice: false}); break;
    }
    case 'org_set_campaign': {
      ceo(); shape(d, 'id expectedVersion title purpose startDate endDate'); const v = version(o.campaigns, d);
      requireValue(text(d.title, 200) && text(d.purpose, 4000) && date(d.startDate) && date(d.endDate) && d.endDate >= d.startDate, 'invalid_campaign');
      o.campaigns.push({...d, ...stamp, version: v}); break;
    }
    case 'org_set_milestone': {
      ceo(); shape(d, 'id expectedVersion campaignId campaignVersion roleId roleVersion title acceptanceCriteria dueDate'); const v = version(o.milestones, d);
      const campaign = current(o.campaigns, d.campaignId, d.campaignVersion); current(o.roles, d.roleId, d.roleVersion);
      requireValue(text(d.title, 200) && text(d.acceptanceCriteria, 4000) && date(d.dueDate) && d.dueDate >= campaign.startDate && d.dueDate <= campaign.endDate, 'invalid_milestone');
      o.milestones.push({...d, ...stamp, version: v}); break;
    }
    case 'org_link_task': {
      ceo(); shape(d, 'id milestoneId milestoneVersion assignmentId objectiveId jobId'); unique(o.taskLinks, d.id);
      const m = current(o.milestones, d.milestoneId, d.milestoneVersion);
      const a = o.assignments.find(x => x.id === d.assignmentId);
      requireValue(a && a.roleId === m.roleId && a.roleVersion === m.roleVersion && o.assignments.filter(x => x.roleId === a.roleId).at(-1)?.id === a.id, 'task_assignment_mismatch');
      requireValue(id(d.objectiveId) && (d.jobId === null || id(d.jobId)), 'invalid_ops_reference');
      o.taskLinks.push({...d, ...stamp, source: 'ops_objectives/ops_agent_jobs', provenanceStatus: 'unverified_reference', executionEnabled: false}); break;
    }
    case 'org_submit_daily_entry': {
      shape(d, 'id assignmentId milestoneId milestoneVersion taskLinkId workDate timeZone summary status evidenceIds supersedes correctionReason'); unique(o.entries, d.id); zone(d.timeZone);
      requireValue(d.timeZone === o.mandates.at(-1)?.timeZone, 'organization_reporting_time_zone_mismatch');
      const a = o.assignments.find(x => x.id === d.assignmentId); const m = current(o.milestones, d.milestoneId, d.milestoneVersion);
      requireValue(a && a.roleId === m.roleId && a.roleVersion === m.roleVersion, 'entry_role_mismatch');
      // Owner transcription is explicit; no seat identity becomes authenticated.
      requireValue(human === true && o.mandates.at(-1)?.actorId === actorId, 'owner_transcription_required', 403);
      requireValue(date(d.workDate) && d.workDate <= localDate(at, d.timeZone) && d.workDate >= localDate(a.recordedAt, d.timeZone), 'invalid_work_date');
      const replacement = o.assignments.find(x => x.replaces === a.id);
      requireValue(!replacement || d.workDate < localDate(replacement.recordedAt, d.timeZone), 'seat_replaced', 409);
      const campaign = current(o.campaigns, m.campaignId, m.campaignVersion);
      requireValue(d.workDate >= campaign.startDate && d.workDate <= campaign.endDate, 'entry_outside_campaign');
      requireValue(text(d.summary, 4000) && ['submitted', 'blocked'].includes(d.status), 'invalid_daily_entry');
      evidence(state, d.evidenceIds);
      const task = d.taskLinkId === null ? null : o.taskLinks.find(x => x.id === d.taskLinkId);
      requireValue(d.taskLinkId === null || (task && task.assignmentId === a.id && task.milestoneId === m.id && task.milestoneVersion === m.version), 'entry_task_mismatch');
      const prev = o.entries.find(x => x.id === d.supersedes);
      requireValue(d.supersedes === null ? d.correctionReason === null : prev && prev.assignmentId === a.id && prev.workDate === d.workDate && prev.timeZone === d.timeZone && text(d.correctionReason) && !o.entries.some(x => x.supersedes === prev.id), 'invalid_entry_correction');
      o.entries.push({...d, ...stamp, principalRef: a.principalRef, principalType: a.principalType, roleId: a.roleId, roleVersion: a.roleVersion, campaignId: m.campaignId, campaignVersion: m.campaignVersion, completionStatus: 'claimed_not_verified'}); break;
    }
    case 'org_review_daily_entry': {
      ceo(); shape(d, 'id entryId decision evidenceIds reason'); unique(o.reviews, d.id);
      const entry = o.entries.find(x => x.id === d.entryId);
      requireValue(entry && !o.entries.some(x => x.supersedes === entry.id) && !o.reviews.some(x => x.entryId === entry.id), 'entry_not_reviewable', 409);
      requireValue(actorId !== entry.principalRef, 'independent_human_review_required', 403);
      requireValue(['approve_report', 'reject_report'].includes(d.decision) && text(d.reason), 'invalid_entry_review');
      evidence(state, d.evidenceIds, {required: true});
      if (d.decision === 'approve_report') {
        requireValue(entry.status === 'submitted', 'blocked_entry_not_approvable', 409);
        evidence(state, entry.evidenceIds, {required: true});
        if (entry.principalType === 'ai_agent') requireValue(o.taskLinks.find(x => x.id === entry.taskLinkId)?.jobId, 'ai_job_reference_required');
      }
      o.reviews.push({...d, ...stamp, status: 'reviewed', verifiedCompletion: false, verificationBoundary: 'human_review_of_report_not_canonical_execution_verification'}); break;
    }
    case 'org_record_weekly_report': {
      ceo(); shape(d, 'id weekStart timeZone asOf'); unique(o.reports, d.id);
      requireValue(instant(d.asOf) && d.asOf <= at, 'invalid_report_as_of');
      const report = weeklyOrganizationReport({...state, organization: o}, d);
      const reportVersion = o.reports.filter(x => x.weekStart === d.weekStart && x.timeZone === d.timeZone).length + 1;
      o.reports.push({...d, ...stamp, reportVersion, report}); break;
    }
    default: throw new CompanyOperationError('unsupported_organization_command');
  }
  requireValue(Object.values(o).filter(Array.isArray).every(rows => rows.length <= 1000), 'organization_capacity', 409);
  state.organization = o;
  return state;
}

export function weeklyOrganizationReport(state, {weekStart, timeZone, asOf} = {}) {
  requireValue(date(weekStart) && instant(asOf), 'explicit_report_period_required'); zone(timeZone);
  const weekEndExclusive = new Date(Date.parse(weekStart) + 7 * 86400000).toISOString().slice(0, 10);
  const o = state.organization || empty(), visible = rows => rows.filter(x => x.recordedAt <= asOf);
  const mandate = visible(o.mandates).at(-1);
  requireValue(mandate && mandate.timeZone === timeZone, 'organization_reporting_time_zone_mismatch');
  const all = visible(o.entries), reviews = visible(o.reviews);
  requireValue(all.every(x => x.timeZone === timeZone), 'organization_entry_time_zone_inconsistent', 409);
  const entries = all.filter(x => x.timeZone === timeZone && x.workDate >= weekStart && x.workDate < weekEndExclusive && !all.some(y => y.supersedes === x.id)).map(entry => {
    const review = reviews.find(x => x.entryId === entry.id);
    return {...structuredClone(entry), review: review ? structuredClone(review) : null, reported: entry.status === 'submitted', approvedReport: review?.decision === 'approve_report', verifiedCompletion: false};
  }).sort((a, b) => a.workDate.localeCompare(b.workDate) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const latestVisible = (rows, key = 'id') => {
    const byId = new Map();
    for (const row of visible(rows)) byId.set(row[key], structuredClone(row));
    return [...byId.values()].sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
  };
  const assignments = latestVisible(o.assignments, 'roleId');
  const elapsedDates = [];
  const asOfDate = localDate(asOf, timeZone);
  for (let day = weekStart; day < weekEndExclusive && day <= asOfDate; day = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10)) elapsedDates.push(day);
  const roles = latestVisible(o.roles).map(role => {
    const rows = entries.filter(x => x.roleId === role.id);
    const assignedOnOrBefore = day => visible(o.assignments).some(x => x.roleId === role.id && localDate(x.recordedAt, timeZone) <= day);
    return {...role, assignment: assignments.find(x => x.roleId === role.id) || null,
      counts: {submitted: rows.filter(x => x.reported).length, approved: rows.filter(x => x.approvedReport).length, blocked: rows.filter(x => x.status === 'blocked').length},
      noEntries: rows.length === 0,
      missingDailyEntry: elapsedDates.filter(day => assignedOnOrBefore(day) && !rows.some(x => x.workDate === day))};
  });
  const sourceRows = ['mandates', 'roles', 'assignments', 'campaigns', 'milestones', 'taskLinks', 'entries', 'reviews'].flatMap(key => visible(o[key]));
  return {schema: 'company-weekly-report/v1', orgId: state.orgId, companyId: state.companyId, weekStart, weekEndExclusive, timeZone, asOf,
    sourceRevision: Math.max(0, ...sourceRows.map(x => x.aggregateRevision)), scope: 'owner_recorded_entries_in_canonical_organization_time_zone', entries,
    roles, assignments, campaigns: latestVisible(o.campaigns), milestones: latestVisible(o.milestones),
    missingEntryBasis: 'elapsed_calendar_dates_with_an_assigned_seat_including_as_of_day_not_an_attendance_or_work_schedule_judgment',
    noEntriesRoleIds: roles.filter(x => x.noEntries).map(x => x.id),
    totals: {entries: entries.length, reported: entries.filter(x => x.reported).length, approvedReports: entries.filter(x => x.approvedReport).length, blocked: entries.filter(x => x.status === 'blocked').length, verifiedCompletions: 0},
    executionVerification: 'not_wired_requires_tenant_scoped_canonical_job_and_completion_evidence_resolver', deliveryEnabled: false};
}

export function organizationWorkProposal(state, taskLinkId) {
  const o = state.organization || empty(), task = o.taskLinks.find(x => x.id === taskLinkId);
  requireValue(task, 'task_link_not_found', 404);
  const milestone = current(o.milestones, task.milestoneId, task.milestoneVersion);
  const assignment = o.assignments.find(x => x.id === task.assignmentId);
  requireValue(o.assignments.filter(x => x.roleId === assignment.roleId).at(-1)?.id === assignment.id, 'seat_replaced', 409);
  const role = current(o.roles, assignment.roleId, assignment.roleVersion);
  current(o.campaigns, milestone.campaignId, milestone.campaignVersion);
  return {schema: 'company-core-work-proposal/v1', orgId: state.orgId, companyId: state.companyId, taskLinkId, objectiveId: task.objectiveId, jobId: task.jobId,
    assignmentId: assignment.id, capabilityIds: [...role.capabilityIds], acceptanceCriteria: milestone.acceptanceCriteria,
    dryRun: true, executionEnabled: false, destination: 'existing_ops_objectives_and_ops_agent_jobs',
    requiredChecks: ['authenticated_human_mandate', 'tenant_scoped_objective_and_job_resolution', 'active_capability_registry_binding', 'core_plan_policy', 'human_approval_for_external_financial_legal_production_or_destructive_actions', 'canonical_completion_evidence_from_actual_executor'],
    createsJob: false, grantsAuthority: false};
}
