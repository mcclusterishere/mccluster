import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedReconcilerGitSource } from '../src/reconciler-source-receipt.mjs';

const NOW = Date.parse('2026-10-24T18:00:00.000Z');
const receipt = () => ({
  schema_version: 'mccluster-reconcile-git-source/v1',
  repository: 'mcclusterishere/mccluster',
  promoted_ref: 'deploy/ovh-production',
  github_main_sha: 'a'.repeat(40),
  github_promoted_sha: 'b'.repeat(40),
  observed_at: new Date(NOW - 2 * 60_000).toISOString(),
});

test('fresh reconciler Git receipt is an explicitly named fallback for private GitHub', () => {
  const result = verifiedReconcilerGitSource(receipt(), { nowMs: NOW });
  assert.equal(result.error, null);
  assert.equal(result.github_main_sha, 'a'.repeat(40));
  assert.equal(result.github_promoted_sha, 'b'.repeat(40));
  assert.equal(result.verification_method, 'ovh_reconciler_git_fetch_receipt');
  assert.equal(result.observed_at, receipt().observed_at);
});

test('stale, future, wrong ref, wrong repository, invalid SHA, and invalid schema fail closed', () => {
  for (const changed of [
    { observed_at: new Date(NOW - 11 * 60_000).toISOString() },
    { observed_at: new Date(NOW + 31_000).toISOString() },
    { observed_at: 'not a date' },
    { promoted_ref: 'refs/heads/main' },
    { repository: 'untrusted/repo' },
    { github_main_sha: 'main' },
    { github_promoted_sha: '' },
    { schema_version: 'unrecognized' },
  ]) {
    assert.equal(verifiedReconcilerGitSource({ ...receipt(), ...changed }, { nowMs: NOW }), null, JSON.stringify(changed));
  }
  assert.equal(verifiedReconcilerGitSource(null, { nowMs: NOW }), null);
});

test('actual reconciler persists source evidence only after ancestry verification', () => {
  const shell = readFileSync(new URL('../../scripts/mccluster-vps-reconcile.sh', import.meta.url), 'utf8');
  const checked = shell.indexOf('git merge-base --is-ancestor');
  const stamped = shell.indexOf('SOURCE_RECEIPT_TMP=');
  const returnEarly = shell.indexOf('already deployed and attested');
  assert.ok(checked >= 0 && stamped > checked && returnEarly > stamped);
  assert.match(shell, /last-source-fetch\.json/);
  assert.match(shell, /schema_version":"mccluster-reconcile-git-source\/v1"/);
});
