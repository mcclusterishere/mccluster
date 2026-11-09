import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyCompany} from '../src/company-operations/domain.js';
import {applyOrganizationCommand, isOrganizationCommand, weeklyOrganizationReport, organizationWorkProposal} from '../src/company-operations/organization.js';

const AT = '2026-11-09T15:00:00.000Z';
const scope = {actorId: 'owner', orgId: 'org', companyId: 'company', at: AT, human: true};
function setup() {
  const state = emptyCompany('org', 'company');
  state.profile = {name: 'Fixture'};
  state.documents.push({id: 'proof', artifactRef: 'artifact', sha256: 'a'.repeat(64)});
  let n = 0;
  function run(type, data, context = {}) {
    const result = applyOrganizationCommand(state, {id: `cmd${++n}`, type, data}, {...scope, ...context});
    state.revision++;
    return result;
  }
  run('org_record_mandate', {evidenceIds: ['proof'], timeZone: 'America/New_York'});
  const role = {id: 'engineer', expectedVersion: 0, title: 'Engineer', jobType: 'code_patch', responsibilities: 'Prepare and test patches', capabilityIds: ['code.build']};
  run('org_define_role', role);
  run('org_assign_seat', {id: 'seat', roleId: 'engineer', roleVersion: 1, principalRef: 'agent', principalType: 'ai_agent', replaces: null, reason: 'Unfilled human seat'});
  run('org_set_campaign', {id: 'campaign', expectedVersion: 0, title: 'Build', purpose: 'Tested backend', startDate: '2026-11-09', endDate: '2026-11-30'});
  const milestone = {id: 'milestone', expectedVersion: 0, campaignId: 'campaign', campaignVersion: 1, roleId: 'engineer', roleVersion: 1, title: 'Tests', acceptanceCriteria: 'Relevant tests pass with actual execution evidence', dueDate: '2026-11-20'};
  run('org_set_milestone', milestone);
  run('org_link_task', {id: 'task', milestoneId: 'milestone', milestoneVersion: 1, assignmentId: 'seat', objectiveId: 'objective', jobId: 'job'});
  const entry = {id: 'entry', assignmentId: 'seat', milestoneId: 'milestone', milestoneVersion: 1, taskLinkId: 'task', workDate: '2026-11-09', timeZone: 'America/New_York', summary: 'Prepared patch', status: 'submitted', evidenceIds: ['proof'], supersedes: null, correctionReason: null};
  return {state, run, role, milestone, entry};
}
const period = {weekStart: '2026-11-09', timeZone: 'America/New_York', asOf: '2026-11-10T15:00:00.000Z'};

test('human sponsor gate and strict shape; reducer touches only organization', () => {
  const {state, run, role} = setup();
  const before = structuredClone(state); delete before.organization;
  assert.throws(() => run('org_define_role', {...role, expectedVersion: 1}, {human: false}), /human_ceo_required/);
  assert.throws(() => run('org_define_role', {...role, expectedVersion: 1}, {actorId: 'other'}), /human_ceo_required/);
  assert.throws(() => run('org_define_role', {...role, expectedVersion: 1, authorized: true}), /organization_invalid_fields/);
  const after = structuredClone(state); delete after.organization;
  assert.deepEqual(after, before);
  assert.equal(isOrganizationCommand('org_link_task'), true);
  assert.equal(isOrganizationCommand('execute_task'), false);
});

test('AI cannot hold sponsor authority, submit through unwired ingress, or review', () => {
  const state = emptyCompany('org', 'company'); state.profile = {};
  state.documents = [{id: 'proof', artifactRef: 'artifact', sha256: 'a'.repeat(64)}];
  assert.throws(() => applyOrganizationCommand(state, {id: 'one', type: 'org_record_mandate', data: {evidenceIds: ['proof'], timeZone: 'America/New_York'}}, {...scope, human: false}), /human_ceo_required/);
  const {run, entry} = setup();
  assert.throws(() => run('org_submit_daily_entry', entry, {actorId: 'agent', human: false}), /owner_transcription_required/);
  run('org_submit_daily_entry', entry);
  assert.throws(() => run('org_review_daily_entry', {id: 'review', entryId: 'entry', decision: 'approve_report', evidenceIds: ['proof'], reason: 'Reviewed'}, {human: false}), /human_ceo_required/);
});

test('role versions and seat replacement preserve history and invalidate proposals', () => {
  const {state, run, role, entry} = setup();
  run('org_submit_daily_entry', entry);
  run('org_define_role', {...role, expectedVersion: 1, title: 'Senior Engineer'});
  assert.equal(state.organization.roles.length, 2);
  assert.equal(state.organization.entries[0].roleVersion, 1);
  run('org_assign_seat', {id: 'human-seat', roleId: 'engineer', roleVersion: 2, principalRef: 'employee', principalType: 'human', replaces: 'seat', reason: 'Human hire'});
  assert.equal(state.organization.assignments.length, 2);
  assert.throws(() => organizationWorkProposal(state, 'task'), /seat_replaced/);
});

test('missing/cross-tenant evidence and invented fields cannot be approved', () => {
  const {state, run, entry} = setup();
  assert.throws(() => run('org_submit_daily_entry', {...entry, evidenceIds: ['missing']}), /organization_evidence_missing/);
  state.documents[0].orgId = 'foreign';
  assert.throws(() => run('org_submit_daily_entry', entry), /evidence_scope_mismatch/);
  delete state.documents[0].orgId;
  run('org_submit_daily_entry', {...entry, evidenceIds: []});
  assert.throws(() => run('org_review_daily_entry', {id: 'review', entryId: 'entry', decision: 'approve_report', evidenceIds: ['proof'], reason: 'Reviewed'}), /invalid_organization_evidence/);
});

test('stale milestone revisions cannot acquire new work', () => {
  const {state, run, milestone, entry} = setup();
  run('org_set_milestone', {...milestone, expectedVersion: 1, title: 'Updated test gate'});
  assert.throws(() => run('org_set_milestone', milestone), /stale_organization_version/);
  assert.throws(() => run('org_submit_daily_entry', entry), /stale_or_missing_organization_reference/);
  assert.throws(() => organizationWorkProposal(state, 'task'), /stale_or_missing_organization_reference/);
});

test('weekly reported versus approved output never invents verified AI completion', () => {
  const {state, run, entry} = setup(); run('org_submit_daily_entry', entry);
  assert.equal(weeklyOrganizationReport(state, period).totals.approvedReports, 0);
  run('org_review_daily_entry', {id: 'review', entryId: 'entry', decision: 'approve_report', evidenceIds: ['proof'], reason: 'Reviewed report evidence'}, {at: '2026-11-10T12:00:00.000Z'});
  const report = weeklyOrganizationReport(state, period);
  assert.deepEqual(report.totals, {entries: 1, reported: 1, approvedReports: 1, blocked: 0, verifiedCompletions: 0});
  assert.equal(weeklyOrganizationReport(state, {...period, asOf: AT}).totals.approvedReports, 0);
  assert.deepEqual(weeklyOrganizationReport(state, period), report);
  const proposal = organizationWorkProposal(state, 'task');
  assert.equal(proposal.executionEnabled, false); assert.equal(proposal.createsJob, false);
  assert.equal(state.organization.taskLinks[0].provenanceStatus, 'unverified_reference');
  run('org_record_weekly_report', {id: 'report1', ...period}, {at: period.asOf});
  run('org_record_weekly_report', {id: 'report2', ...period}, {at: period.asOf});
  assert.equal(state.organization.reports[1].reportVersion, 2);
  assert.deepEqual(state.organization.reports[0].report, state.organization.reports[1].report);
});

test('explicit time zones and local dates, immutable corrections, as-of history', () => {
  const {state, run, entry} = setup(); run('org_submit_daily_entry', entry);
  assert.throws(() => weeklyOrganizationReport(state, {...period, timeZone: undefined}), /time_zone_required/);
  assert.throws(() => weeklyOrganizationReport(state, {...period, timeZone: 'Mars/City'}), /invalid_time_zone/);
  assert.throws(() => weeklyOrganizationReport(state, {...period, timeZone: 'UTC'}), /organization_reporting_time_zone_mismatch/);
  run('org_submit_daily_entry', {...entry, id: 'corrected', summary: 'Patch blocked on dependency', status: 'blocked', supersedes: 'entry', correctionReason: 'Corrected claim'}, {at: '2026-11-10T12:00:00.000Z'});
  assert.equal(state.organization.entries.length, 2);
  assert.equal(weeklyOrganizationReport(state, period).totals.blocked, 1);
  assert.equal(weeklyOrganizationReport(state, {...period, asOf: AT}).totals.reported, 1);
  assert.throws(() => run('org_submit_daily_entry', {...entry, id: 'branch', supersedes: 'entry', correctionReason: 'Another correction'}), /invalid_entry_correction/);
  assert.throws(() => run('org_submit_daily_entry', {...entry, id: 'future', workDate: '2026-11-10'}, {at: '2026-11-10T02:00:00.000Z'}), /invalid_work_date/);
});

test('AI approved reports need linked job; mismatched task and self-review fail closed', () => {
  const {state, run, entry} = setup();
  run('org_submit_daily_entry', {...entry, taskLinkId: null});
  assert.throws(() => run('org_review_daily_entry', {id: 'review', entryId: 'entry', decision: 'approve_report', evidenceIds: ['proof'], reason: 'Reviewed'}), /ai_job_reference_required/);
  assert.throws(() => run('org_submit_daily_entry', {...entry, id: 'wrong', taskLinkId: 'unknown'}), /entry_task_mismatch/);
  assert.throws(() => applyOrganizationCommand(state, {id: 'cross', type: 'org_define_role', data: {}}, {...scope, orgId: 'other'}), /scope_mismatch/);
  run('org_assign_seat', {id: 'owner-seat', roleId: 'engineer', roleVersion: 1, principalRef: 'owner', principalType: 'human', replaces: 'seat', reason: 'Owner performs task'});
  run('org_submit_daily_entry', {...entry, id: 'self', assignmentId: 'owner-seat', taskLinkId: null});
  assert.throws(() => run('org_review_daily_entry', {id: 'self-review', entryId: 'self', decision: 'approve_report', evidenceIds: ['proof'], reason: 'Reviewed'}), /independent_human_review_required/);
});

test('organization commands replay through the shared ledger and existing audit chain', async () => {
  const {reduceSharedLedger} = await import('../src/company-operations/shared-ledger.js');
  const {digest} = await import('../src/company-operations/domain.js');
  const {replayCompany} = await import('../src/company-operations/service.js');
  const commands = [
    {id: 'register', type: 'register_company', data: {name: 'Fixture', form: 'nonprofit', jurisdiction: 'CT', currency: 'USD', currencyExponent: 2}},
    {id: 'document', type: 'record_document', data: {id: 'mandate-proof', kind: 'resolution', artifactRef: 'artifact', sha256: 'a'.repeat(64), effectiveDate: '2026-11-09'}},
    {id: 'mandate', type: 'org_record_mandate', data: {evidenceIds: ['mandate-proof'], timeZone: 'America/New_York'}},
    {id: 'role', type: 'org_define_role', data: {id: 'analyst', expectedVersion: 0, title: 'Analyst', jobType: 'local_analysis', responsibilities: 'Prepare evidence-backed research', capabilityIds: ['research.web']}}
  ];
  let state = emptyCompany('org', 'company'), previousHash = null;
  const events = [];
  for (const command of commands) {
    const body = {...scope, revision: state.revision + 1, previousHash, command};
    state = reduceSharedLedger(state, command, body);
    const hash = await digest(body); events.push({...body, hash}); previousHash = hash;
  }
  const replay = await replayCompany('org', 'company', events, reduceSharedLedger);
  assert.deepEqual(replay.state, state);
  assert.equal(state.records.length, 4);
  assert.equal(state.organization.roles[0].aggregateRevision, 4);
});


test('canonical reporting zone prevents omitted entries and requires a mandate zone', () => {
  const {state, run, entry} = setup();
  assert.throws(() => run('org_submit_daily_entry', {...entry, timeZone: 'UTC'}), /organization_reporting_time_zone_mismatch/);
  run('org_submit_daily_entry', entry);
  state.organization.entries[0].timeZone = 'UTC';
  assert.throws(() => weeklyOrganizationReport(state, period), /organization_entry_time_zone_inconsistent/);
  const bare = emptyCompany('org', 'company'); bare.profile = {}; bare.documents = state.documents;
  assert.throws(() => applyOrganizationCommand(bare, {id: 'missing-zone', type: 'org_record_mandate', data: {evidenceIds: ['proof']}}, scope), /organization_invalid_fields/);
});

test('weekly summaries show latest definitions, role counts and missing daily reports', () => {
  const {state, run, entry, role, milestone} = setup();
  run('org_submit_daily_entry', entry);
  run('org_review_daily_entry', {id: 'review', entryId: 'entry', decision: 'approve_report', evidenceIds: ['proof'], reason: 'Reviewed report'});
  run('org_define_role', {...role, expectedVersion: 1, title: 'Senior Engineer'});
  run('org_define_role', {...role, id: 'analyst', title: 'Analyst'});
  run('org_assign_seat', {id: 'analyst-seat', roleId: 'analyst', roleVersion: 1, principalRef: 'analyst-agent', principalType: 'ai_agent', replaces: null, reason: 'Needs reporting'});
  run('org_set_milestone', {...milestone, expectedVersion: 1, roleVersion: 2, title: 'Revised acceptance'});
  const report = weeklyOrganizationReport(state, period);
  assert.equal(report.roles.find(x => x.id === 'engineer').version, 2);
  assert.deepEqual(report.roles.find(x => x.id === 'engineer').counts, {submitted: 1, approved: 1, blocked: 0});
  assert.deepEqual(report.roles.find(x => x.id === 'engineer').missingDailyEntry, ['2026-11-10']);
  assert.deepEqual(report.roles.find(x => x.id === 'analyst').missingDailyEntry, ['2026-11-09', '2026-11-10']);
  assert.deepEqual(report.noEntriesRoleIds, ['analyst']);
  assert.equal(report.assignments.length, 2);
  assert.equal(report.campaigns[0].id, 'campaign');
  assert.equal(report.milestones[0].version, 2);
  assert.equal(report.totals.verifiedCompletions, 0);
  assert.deepEqual(report, weeklyOrganizationReport(state, period));
});

test('organization evidence hashes cannot use JSON coercion', () => {
  const {state, run, entry} = setup(); state.documents[0].sha256 = ['a'.repeat(64)];
  assert.throws(() => run('org_submit_daily_entry', entry), /organization_evidence_invalid/);
});
