import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDisclosure, appendDisclosure, disclosuresAsOf, authorizeFinance, assertCollectionAllowed } from '../src/finance/foundation.js';
import { handleIntelRequest } from '../src/intel/router.js';
import { IntelError } from '../src/intel/store.js';
// Entirely synthetic extracted rows; no vendor or official filing data copied.
const scope = { org_id: 'org-fixture', owner_id: 'owner-fixture' };
const input = { scope, source: 'house', report_id: 'synthetic-1', row_id: '1', filer_id: 'synthetic-person',
  source_url: 'https://disclosures-clerk.house.gov/synthetic-fixture.pdf', document_sha256: 'a'.repeat(64),
  page: 1, parser_version: 'fixture-v1', synthetic: true, asset_description: 'Example company call option',
  owner_category: 'unknown', transaction: 'purchase', transaction_date: '2026-01-01', filing_date: '2026-02-01',
  public_available_at: '2026-02-02T00:00:00Z', ingested_at: '2026-03-01T00:00:00Z', value_range: { lower: 1001, upper: 15000 } };
test('preserves ranges, unknown owner, provenance and unresolved instrument', () => {
  const row = normalizeDisclosure(input);
  assert.equal(row.security_id, null); assert.equal(row.owner_category, 'unknown');
  assert.deepEqual(row.value_range, { lower: 1001, upper: 15000, currency: 'USD' });
  assert.equal(row.provenance.synthetic, true);
});
test('rejects bad dates, source spoofing, reversed ranges and false availability', () => {
  for (const patch of [{ transaction_date: '2026-02-30' }, { source_url: 'https://disclosures-clerk.house.gov.evil.test/a' },
    { value_range: { lower: 15000, upper: 1001 } }, { public_available_at: '2027-01-01T00:00:00Z' },
    { transaction_date: '2026-02-02' }, { document_sha256: 'bad' }]) assert.throws(() => normalizeDisclosure({ ...input, ...patch }));
});
test('replay separates historical availability from actual possession and owner scopes', () => {
  const rows = [normalizeDisclosure(input)];
  assert.equal(disclosuresAsOf(rows, scope, '2026-02-03T00:00:00Z').length, 0);
  assert.equal(disclosuresAsOf(rows, scope, '2026-02-03T00:00:00Z', 'reconstructed').length, 1);
  assert.equal(disclosuresAsOf(rows, { ...scope, owner_id: 'other' }, '2026-04-01T00:00:00Z').length, 0);
  assert.equal(disclosuresAsOf([normalizeDisclosure({ ...input, public_available_at: null })], scope, '2026-04-01T00:00:00Z', 'reconstructed').length, 0);
});
test('amendments are immutable, scoped, idempotent and visible only when known', () => {
  const original = normalizeDisclosure(input), history = appendDisclosure([], original);
  assert.equal(appendDisclosure(history, original), history);
  const amended = normalizeDisclosure({ ...input, report_id: 'synthetic-2', supersedes: { report_id: input.report_id, row_id: '1' },
    transaction: 'sale', ingested_at: '2026-04-01T00:00:00Z', public_available_at: '2026-03-30T00:00:00Z' });
  const next = appendDisclosure(history, amended);
  assert.equal(history.length, 1);
  assert.equal(disclosuresAsOf(next, scope, '2026-03-15T00:00:00Z')[0].transaction, 'purchase');
  assert.equal(disclosuresAsOf(next, scope, '2026-04-02T00:00:00Z')[0].transaction, 'sale');
  assert.throws(() => appendDisclosure(history, { ...amended, scope: { ...scope, owner_id: 'other' } }), /invalid_amendment/);
  assert.throws(() => appendDisclosure(history, { ...original, transaction: 'sale' }), /conflicting_revision/);
  assert.throws(() => appendDisclosure(next, { ...amended, report_id: 'branch' }), /amendment_conflict/);
});
const grant = { org_id: scope.org_id, principal_id: scope.owner_id, product: 'finance', starts_at: '2026-01-01T00:00:00Z', expires_at: '2027-01-01T00:00:00Z' };
const access = { principal: { id: scope.owner_id, org_id: scope.org_id, isHouseOwner: true },
  resource: { ...scope, visibility: 'member', source: 'house' }, capability: 'research', release: { owner: true, member: true }, now: '2026-06-01T00:00:00Z' };
const rights = { ...grant, kind: 'source', source: 'house', audience: 'member' };
const premium = { ...grant, kind: 'feature', capability: 'research' };
test('premium never overrides source rights; free browse still needs source rights', () => {
  assert.equal(authorizeFinance({ ...access, grants: [premium] }), false);
  assert.equal(authorizeFinance({ ...access, grants: [rights] }), false);
  assert.equal(authorizeFinance({ ...access, grants: [rights], capability: 'browse' }), true);
  assert.equal(authorizeFinance({ ...access, grants: [rights, premium] }), true);
});
test('release, revocation, expiry, malformed grants and cross-account checks fail closed', () => {
  for (const patch of [{ release: { member: false } }, { principal: { ...access.principal, id: 'other' } },
    { now: '2027-01-01T00:00:00Z' }, { grants: [{ ...rights, revoked: true }, premium] },
    { grants: [{ ...rights, expires_at: 'invalid' }, premium] }]) {
    assert.equal(authorizeFinance({ ...access, grants: [rights, premium], ...patch }), false);
  }
  const privateAccess = { ...access, resource: { ...access.resource, visibility: 'private' } };
  assert.equal(authorizeFinance({ ...privateAccess, grants: [rights, premium] }), false);
  assert.equal(authorizeFinance({ ...privateAccess, grants: [{ ...rights, audience: 'private' }] }), true);
});
test('all collectors are explicitly disabled', () => {
  for (const source of ['house', 'senate', 'sec', 'unknown']) assert.throws(() => assertCollectionAllowed(source));
});
test('development manifest enforces existing server owner gate and default-off flag', async () => {
  const env = { SUPABASE_URL: 'https://fixture.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
  const req = new Request('https://fixture.test/v1/intel/finance');
  const owner = { requireHouseOwner: async () => ({ id: scope.owner_id }) };
  assert.equal((await handleIntelRequest(req, env, owner)).status, 404);
  const response = await handleIntelRequest(req, { ...env, FINANCE_DEV_ENABLED: 'true' }, owner);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).product.live_data, false);
  assert.equal((await handleIntelRequest(req, { ...env, FINANCE_DEV_ENABLED: 'true' }, {
    requireHouseOwner: async () => { throw new IntelError('Forbidden', 403, 'forbidden'); }
  })).status, 403);
});
