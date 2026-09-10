import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  credentialRefForConfiguredChannel,
  parseSocialCredentialRef,
  requireOrgId,
  requireOrgRole
} from '../src/social/security.js';

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(here, '..');
const repoRoot = resolve(workerRoot, '..', '..');

test('tenant-scoped operations require an explicit UUID org_id', () => {
  assert.throws(() => requireOrgId(null), (error) => error.status === 400);
  assert.throws(() => requireOrgId(''), (error) => error.status === 400);
  assert.throws(() => requireOrgId('mccluster'), (error) => error.status === 400);
  assert.equal(
    requireOrgId('123e4567-e89b-42d3-a456-426614174000'),
    '123e4567-e89b-42d3-a456-426614174000'
  );
});

test('social write authorization fails closed for staff and viewers', () => {
  assert.equal(requireOrgRole({ role: 'owner' }, ['owner']).role, 'owner');
  assert.throws(() => requireOrgRole({ role: 'staff' }, ['owner']), (error) => error.status === 403);
  assert.throws(() => requireOrgRole({ role: 'viewer' }, ['owner']), (error) => error.status === 403);
});

test('credential references cannot select arbitrary Worker secrets', () => {
  assert.equal(parseSocialCredentialRef('instagram', 'STRIPE_SECRET_KEY'), null);
  assert.equal(parseSocialCredentialRef('instagram', 'SUPABASE_SERVICE_ROLE_KEY'), null);
  assert.equal(parseSocialCredentialRef('instagram', 'env:STRIPE_SECRET_KEY'), null);
  assert.deepEqual(
    parseSocialCredentialRef('instagram', 'SOCIAL_IG_PRIMARY_ACCESS_TOKEN'),
    { kind: 'env', name: 'SOCIAL_IG_PRIMARY_ACCESS_TOKEN' }
  );
  assert.deepEqual(
    parseSocialCredentialRef('instagram', 'env:SOCIAL_IG_CLIENT_A_ACCESS_TOKEN'),
    { kind: 'env', name: 'SOCIAL_IG_CLIENT_A_ACCESS_TOKEN' }
  );
  assert.deepEqual(
    parseSocialCredentialRef('instagram', 'vault:123e4567-e89b-42d3-a456-426614174000'),
    { kind: 'vault', id: '123e4567-e89b-42d3-a456-426614174000' }
  );
  assert.equal(parseSocialCredentialRef('facebook', 'SOCIAL_IG_PRIMARY_ACCESS_TOKEN'), null);
});

test('each publishing platform gets its own credential pattern, and only its own', () => {
  /* Widening the allowlist for Facebook and Threads must not let either
     borrow the other's binding, reach Instagram's, or open the door for a
     platform with no publisher. */
  assert.deepEqual(
    parseSocialCredentialRef('facebook', 'SOCIAL_FB_LEVEL3_ACCESS_TOKEN'),
    { kind: 'env', name: 'SOCIAL_FB_LEVEL3_ACCESS_TOKEN' }
  );
  assert.deepEqual(
    parseSocialCredentialRef('threads', 'env:SOCIAL_TH_LEVEL3_ACCESS_TOKEN'),
    { kind: 'env', name: 'SOCIAL_TH_LEVEL3_ACCESS_TOKEN' }
  );

  // cross-platform borrowing
  assert.equal(parseSocialCredentialRef('facebook', 'SOCIAL_TH_LEVEL3_ACCESS_TOKEN'), null);
  assert.equal(parseSocialCredentialRef('threads', 'SOCIAL_FB_LEVEL3_ACCESS_TOKEN'), null);
  assert.equal(parseSocialCredentialRef('instagram', 'SOCIAL_FB_LEVEL3_ACCESS_TOKEN'), null);

  // arbitrary Worker secrets, on the new platforms too
  assert.equal(parseSocialCredentialRef('facebook', 'SUPABASE_SERVICE_ROLE_KEY'), null);
  assert.equal(parseSocialCredentialRef('threads', 'env:STRIPE_SECRET_KEY'), null);

  // platforms that are registry-only hold no binding at all
  for (const platform of ['x', 'bluesky', 'linkedin', 'slack', 'telegram', 'discord', 'whatsapp', 'site']) {
    assert.equal(parseSocialCredentialRef(platform, 'SOCIAL_IG_PRIMARY_ACCESS_TOKEN'), null);
    assert.equal(credentialRefForConfiguredChannel(platform, { token_env: 'SOCIAL_IG_PRIMARY_ACCESS_TOKEN', secret_id: null }), null);
  }

  assert.throws(
    () => credentialRefForConfiguredChannel('facebook', { token_env: 'JNH_META_PAGE_TOKEN', secret_id: null }),
    (error) => error.status === 500
  );
});

test('account credential references are derived from configured org channels', () => {
  assert.equal(
    credentialRefForConfiguredChannel('instagram', { token_env: 'SOCIAL_IG_PRIMARY_ACCESS_TOKEN', secret_id: null }),
    'env:SOCIAL_IG_PRIMARY_ACCESS_TOKEN'
  );
  assert.equal(
    credentialRefForConfiguredChannel('instagram', { token_env: null, secret_id: '123e4567-e89b-42d3-a456-426614174000' }),
    'vault:123e4567-e89b-42d3-a456-426614174000'
  );
  assert.throws(
    () => credentialRefForConfiguredChannel('instagram', { token_env: 'STRIPE_SECRET_KEY', secret_id: null }),
    (error) => error.status === 500
  );
});

test('source contracts preserve tenant, credential, queue and grant invariants', async () => {
  const [socialRouter, meta, mediaRouter, migration] = await Promise.all([
    readFile(resolve(workerRoot, 'src/social/router.js'), 'utf8'),
    readFile(resolve(workerRoot, 'src/social/meta.js'), 'utf8'),
    readFile(resolve(workerRoot, 'src/media/router.js'), 'utf8'),
    readFile(resolve(repoRoot, 'supabase/migrations/20260907040300_social_hardening.sql'), 'utf8')
  ]);

  assert.doesNotMatch(socialRouter, /order=added_at\.asc&limit=1/);
  assert.match(socialRouter, /credential_ref is server-managed and cannot be supplied by clients/);
  assert.match(socialRouter, /requireOrgRole\(org, \['owner'\]\)/);

  assert.doesNotMatch(mediaRouter, /order=added_at\.asc&limit=1/);
  assert.match(mediaRouter, /requireOrgId\(requestedOrgId\)/);
  assert.match(mediaRouter, /getOrg\(env, user\.id, body\.org_id\)/);

  assert.doesNotMatch(meta, /account\?\.credential_ref/);
  assert.doesNotMatch(meta, /env\[ref\]/);
  assert.match(meta, /org_channels\?org_id=/);
  assert.match(meta, /rpc\/claim_social_publish_jobs/);
  assert.match(meta, /rpc\/claim_social_insight_posts/);
  assert.doesNotMatch(meta, /order=published_at\.desc&limit=/);

  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /revoke all on table[\s\S]*from anon, authenticated/i);
  assert.match(migration, /grant select on table[\s\S]*to authenticated/i);
  assert.match(migration, /claim_social_publish_jobs/);
  assert.match(migration, /claim_social_insight_posts/);
});
