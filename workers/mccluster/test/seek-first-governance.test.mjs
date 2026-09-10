import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  AUDIT_GENESIS,
  PURPOSES,
  canonicalAuditPayload,
  evaluateGovernedAccess,
  parsePurposeBinding,
  policyFrom,
  retentionDeadline,
  sealAuditEntry,
  verifyAuditChain
} from '../src/seek-first/governance.js';

const BINDING = {
  purpose: PURPOSES.CRIMINAL_INVESTIGATION,
  authority: 'Conn. Gen. Stat. 54-33a search warrant',
  requesting_agency: 'Hamden',
  requested_by: 'badge-4417',
  case_reference: 'HPD-2026-014392'
};

function policy(overrides = {}) {
  return policyFrom({
    jurisdiction: 'Hamden',
    retention_days: 14,
    permitted_purposes: [PURPOSES.CRIMINAL_INVESTIGATION, PURPOSES.EMERGENCY_RESPONSE, PURPOSES.MISSING_PERSON],
    permitted_agencies: [],
    external_sharing_enabled: false,
    adopted_at: '2026-03-04T00:00:00Z',
    adopted_by: 'Hamden Legislative Council',
    policy_version: 3,
    ...overrides
  });
}

function decide(bindingOverrides = {}, policyOverrides = {}, now = new Date('2026-09-10T12:00:00Z')) {
  const binding = parsePurposeBinding({ ...BINDING, ...bindingOverrides });
  return evaluateGovernedAccess({ policy: policy(policyOverrides), binding, now });
}

test('a governed query without a purpose binding is refused, not flagged', () => {
  assert.throws(() => parsePurposeBinding(null), (error) => error.code === 'purpose_missing' && error.status === 403);
  assert.throws(() => parsePurposeBinding({ purpose: PURPOSES.CRIMINAL_INVESTIGATION }),
    (error) => error.code === 'purpose_incomplete');
  assert.throws(() => parsePurposeBinding({ ...BINDING, purpose: 'because i felt like it' }),
    (error) => error.code === 'purpose_invalid');
});

/*
  Dayton's failure was not a missing box. It was a box that accepted anything.
  An investigation must name a case a records system can be asked to produce.
*/
test('an investigative purpose demands a resolvable case reference', () => {
  assert.throws(() => parsePurposeBinding({ ...BINDING, case_reference: null }),
    (error) => error.code === 'case_reference_required');
  assert.throws(() => parsePurposeBinding({ ...BINDING, case_reference: 'ongoing investigation' }),
    (error) => error.code === 'case_reference_malformed');

  // A purpose that genuinely has no case attached is still allowed to proceed.
  const works = parsePurposeBinding({ ...BINDING, purpose: PURPOSES.PUBLIC_WORKS, case_reference: null });
  assert.equal(works.case_reference, null);
});

test('a lawful query from the jurisdiction itself is permitted and carries a retention deadline', () => {
  const result = decide();
  assert.equal(result.allowed, true);
  assert.equal(result.obligations.retention_days, 14);
  assert.equal(result.obligations.external_recipient, false);
  assert.equal(result.obligations.retention_deadline, '2026-09-24T12:00:00.000Z');
});

/*
  San Francisco: 299 queries run by a regional fusion centre on behalf of
  federal and out-of-state agencies against a network the city never authorised
  them to touch. The query itself was well-formed. The reader was the problem.
*/
test('an outside agency is refused even when the query is otherwise lawful', () => {
  const outside = decide({ requesting_agency: 'Northern California Regional Intelligence Center' });
  assert.equal(outside.allowed, false);
  assert.equal(outside.reason, 'external_sharing_disabled');

  // Turning sharing on is not enough; the recipient still has to be enumerated.
  const enabled = decide(
    { requesting_agency: 'Northern California Regional Intelligence Center' },
    { external_sharing_enabled: true, permitted_agencies: ['New Haven', 'South Central Regional COG'] }
  );
  assert.equal(enabled.allowed, false);
  assert.equal(enabled.reason, 'agency_outside_boundary');

  const named = decide(
    { requesting_agency: 'South Central Regional COG' },
    { external_sharing_enabled: true, permitted_agencies: ['New Haven', 'South Central Regional COG'] }
  );
  assert.equal(named.allowed, true);
  assert.equal(named.obligations.external_recipient, true);
});

test('an external sharing authorisation that has lapsed stops working on its own', () => {
  const lapsed = decide(
    { requesting_agency: 'New Haven' },
    { external_sharing_enabled: true, permitted_agencies: ['New Haven'], external_sharing_expires_at: '2026-06-30T00:00:00Z' }
  );
  assert.equal(lapsed.allowed, false);
  assert.equal(lapsed.reason, 'external_sharing_expired');
});

/*
  Dayton again, from the other side: 7,100+ immigration-enforcement searches
  against a policy that forbade exactly that. A prohibited purpose must not be
  reachable by citing an authority or by being on the recipient list.
*/
test('a prohibited purpose cannot be re-opened by authority or by membership', () => {
  const prohibited = decide(
    { purpose: PURPOSES.CRIMINAL_INVESTIGATION, authority: 'federal detainer request', requesting_agency: 'Hamden' },
    { prohibited_purposes: [PURPOSES.CRIMINAL_INVESTIGATION] }
  );
  assert.equal(prohibited.allowed, false);
  assert.equal(prohibited.reason, 'purpose_prohibited');
});

test('no adopted policy means no answers', () => {
  const binding = parsePurposeBinding(BINDING);
  const none = evaluateGovernedAccess({ policy: null, binding });
  assert.equal(none.allowed, false);
  assert.equal(none.reason, 'policy_missing');

  const suspended = decide({}, { enabled: false });
  assert.equal(suspended.allowed, false);
  assert.equal(suspended.reason, 'policy_suspended');
});

/*
  A policy row that omits its retention window has not finished being written.
  It must not silently inherit a generous default.
*/
test('an unspecified retention window falls to the shortest, not the longest', () => {
  const unset = policy({ retention_days: undefined });
  assert.equal(unset.retention_days, 7);
  assert.equal(retentionDeadline(unset, new Date('2026-09-10T00:00:00Z')), '2026-09-17T00:00:00.000Z');
});

async function chain(entries) {
  const sealed = [];
  let previous = AUDIT_GENESIS;
  for (let index = 0; index < entries.length; index += 1) {
    const record = await sealAuditEntry({ sequence: index, ...entries[index] }, previous);
    sealed.push(record);
    previous = record.entry_hash;
  }
  return sealed;
}

test('the audit chain verifies, and denials are recorded alongside approvals', async () => {
  const sealed = await chain([
    { ...BINDING, decision: 'allow', reason: 'permitted', record_count: 12, occurred_at: '2026-09-10T12:00:00Z' },
    { ...BINDING, requesting_agency: 'ICE', decision: 'deny', reason: 'external_sharing_disabled', occurred_at: '2026-09-10T12:04:00Z' },
    { ...BINDING, decision: 'allow', reason: 'permitted', record_count: 3, occurred_at: '2026-09-10T12:09:00Z' }
  ]);

  assert.equal(sealed[0].previous_hash, AUDIT_GENESIS);
  assert.equal(sealed[1].decision, 'deny');
  assert.equal(sealed[1].reason, 'external_sharing_disabled');

  const verified = await verifyAuditChain(sealed);
  assert.equal(verified.intact, true, JSON.stringify(verified));
  assert.equal(verified.length, 3);
});

/*
  The property the whole design turns on. The Dayton and San Francisco audits
  each took about a year of human effort to run. This has to be arithmetic.
*/
test('deleting the inconvenient entry breaks the chain at the deletion', async () => {
  const sealed = await chain([
    { ...BINDING, decision: 'allow', reason: 'permitted', occurred_at: '2026-09-10T12:00:00Z' },
    { ...BINDING, requesting_agency: 'ICE', decision: 'deny', reason: 'external_sharing_disabled', occurred_at: '2026-09-10T12:04:00Z' },
    { ...BINDING, decision: 'allow', reason: 'permitted', occurred_at: '2026-09-10T12:09:00Z' }
  ]);

  const scrubbed = [sealed[0], sealed[2]];
  const broken = await verifyAuditChain(scrubbed);
  assert.equal(broken.intact, false);
  assert.equal(broken.broken_at, 1);
  assert.equal(broken.cause, 'previous_hash_mismatch');
});

test('editing a purpose after the fact breaks that entry', async () => {
  const sealed = await chain([
    { ...BINDING, purpose: PURPOSES.CRIMINAL_INVESTIGATION, decision: 'allow', reason: 'permitted', occurred_at: '2026-09-10T12:00:00Z' },
    { ...BINDING, decision: 'allow', reason: 'permitted', occurred_at: '2026-09-10T12:05:00Z' }
  ]);

  const laundered = [{ ...sealed[0], purpose: PURPOSES.PUBLIC_WORKS }, sealed[1]];
  const broken = await verifyAuditChain(laundered);
  assert.equal(broken.intact, false);
  assert.equal(broken.broken_at, 0);
  assert.equal(broken.cause, 'entry_hash_mismatch');
});

test('the digest does not depend on key order', () => {
  const forward = { sequence: 1, jurisdiction: 'Hamden', purpose: PURPOSES.PUBLIC_WORKS, previous_hash: AUDIT_GENESIS };
  const reversed = { previous_hash: AUDIT_GENESIS, purpose: PURPOSES.PUBLIC_WORKS, jurisdiction: 'Hamden', sequence: 1 };
  assert.equal(canonicalAuditPayload(forward), canonicalAuditPayload(reversed));
});

/*
  Structural guards.

  The two claims below are not about a function's return value, they are about
  the shape of the request path, and both are the difference between this and
  what the 214 cancelling towns already had. A refactor that quietly reorders
  either one gives back the exact failure mode the design exists to remove, so
  they are asserted against the source rather than trusted to review.
*/
const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(here, '..');
const repoRoot = resolve(workerRoot, '..', '..');

test('the decision is written to the audit log before the provider is ever called', async () => {
  const source = await readFile(resolve(workerRoot, 'src/seek-first/index.js'), 'utf8');
  const start = source.indexOf('async function governedQuery(');
  assert.ok(start > 0, 'governedQuery must exist');
  const body = source.slice(start, source.indexOf('\n}\n', start));

  const sealed = body.indexOf('sealAuditEntry(');
  const written = body.indexOf('appendAuditEntry(');
  const executed = body.indexOf('executeProvider(');

  assert.ok(sealed > 0 && written > sealed, 'the entry must be sealed and then written');
  assert.ok(executed > written, 'executeProvider must not run before the decision is on the record');

  // And the refusal must return before reaching the provider at all.
  const refused = body.indexOf("if (!verdict.allowed)");
  assert.ok(refused > written && refused < executed, 'a refusal must short-circuit between the audit write and the provider');
});

test('the licensing firewall still runs on top of a town policy', async () => {
  const source = await readFile(resolve(workerRoot, 'src/seek-first/index.js'), 'utf8');
  const start = source.indexOf('async function governedQuery(');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  assert.ok(body.includes('assertConsumable('), 'a permitted purpose does not create a licence');
  assert.ok(body.indexOf('assertConsumable(') < body.indexOf('executeProvider('));
});

test('the audit table is append-only in the database, not only in the Worker', async () => {
  const migration = await readFile(
    resolve(repoRoot, 'supabase/migrations/20260910234500_spatial_governance_and_audit.sql'),
    'utf8'
  );
  assert.match(migration, /before update or delete on public\.seek_first_query_audit/);
  assert.match(migration, /is append-only/);
  // A unique sequence per jurisdiction makes a gap as loud as a hash break.
  assert.match(migration, /seek_first_query_audit_seq_uidx/);
  assert.match(migration, /alter table public\.seek_first_query_audit enable row level security/);
});

test('every governance route is registered', async () => {
  const source = await readFile(resolve(workerRoot, 'src/seek-first/index.js'), 'utf8');
  for (const route of [
    '/v1/seek-first/governance/policies',
    '/v1/seek-first/governance/policy',
    '/v1/seek-first/governance/query',
    '/v1/seek-first/governance/audit',
    '/v1/seek-first/governance/audit/verify',
    '/v1/seek-first/governance/transparency',
    '/v1/seek-first/governance/retention'
  ]) {
    assert.ok(source.includes(`path === '${route}'`), `${route} must be routed`);
  }
});
