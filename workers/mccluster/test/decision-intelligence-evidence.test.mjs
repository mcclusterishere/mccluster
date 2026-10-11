import test from 'node:test';
import assert from 'node:assert/strict';
import { assessClaimEvidence } from '../src/decision-intelligence/evidence.js';

const claim = { id: 'c1', org_id: 'orgA' };
const source = { id: 's1', org_id: 'orgA', retrieved_at: '2026-10-01T00:00:00Z' };
const link = { claim_id: 'c1', org_id: 'orgA', source_id: 's1', relationship: 'supports' };
const now = new Date('2026-10-11T00:00:00Z');

test('a citation remains unverified, not automatically proven', () => {
  assert.deepEqual(assessClaimEvidence(claim, [source], [link], now).status, 'cited_unverified');
});

test('contradictory evidence flags a dispute', () => {
  const result = assessClaimEvidence(claim, [source], [link, { ...link, relationship: 'contradicts' }], now);
  assert.equal(result.status, 'disputed');
  assert.equal(result.contradictionCount, 1);
});

test('other organizations cannot satisfy evidence', () => {
  const result = assessClaimEvidence(claim, [{ ...source, org_id: 'orgB' }], [link], now);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.missingOrUnusableCount, 1);
});

test('expired or future-dated evidence cannot count as available', () => {
  const expired = { ...source, retention_until: '2026-10-02T00:00:00Z' };
  assert.equal(assessClaimEvidence(claim, [expired], [link], now).status, 'unsupported');
  const future = { ...source, retrieved_at: '2026-10-12T00:00:00Z' };
  assert.equal(assessClaimEvidence(claim, [future], [link], now).status, 'unsupported');
});
