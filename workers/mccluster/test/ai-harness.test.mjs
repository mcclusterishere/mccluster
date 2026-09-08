import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateEnvelope, CATALOG } from '../src/ai/envelope.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

const ORG = '11111111-1111-1111-1111-111111111111';

test('catalog advertises the control plane without leaking secrets', () => {
  assert.equal(CATALOG.service, 'mccluster');
  assert.equal(CATALOG.plane, 'control');
  const paths = CATALOG.routes.map((r) => r.path);
  assert.ok(paths.includes('/health'));
  assert.ok(paths.includes('/v1/ai/ingest'));
  assert.doesNotMatch(JSON.stringify(CATALOG), /service_role|SUPABASE_SERVICE|FAL_KEY|secret/i);
});

test('ingest envelope requires org, provider, external id, and idempotency key', () => {
  assert.throws(() => validateEnvelope({}), /org_id required/);
  assert.throws(() => validateEnvelope({ org_id: ORG, provider: 'grok' }), /external_conversation_id/);
  const ok = validateEnvelope({
    org_id: ORG,
    provider: 'GROK',
    external_conversation_id: 'conv-1',
    idempotency_key: 'k1',
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(ok.provider, 'grok');
  assert.equal(ok.messages[0].role, 'user');
  assert.equal(ok.account_label, 'default');
});

test('unknown providers are rejected so adapters cannot invent a parallel memory store', () => {
  assert.throws(
    () => validateEnvelope({
      org_id: ORG,
      provider: 'shadow-db',
      external_conversation_id: 'x',
      idempotency_key: 'k'
    }),
    /provider must be/
  );
});

test('worker entry delegates AI routes to the harness without replacing the canonical worker', async () => {
  const entry = await readFile(resolve(here, '..', 'src', 'entry.js'), 'utf8');
  const index = await readFile(resolve(here, '..', 'src', 'index.js'), 'utf8');
  const tenant = await readFile(resolve(here, '..', 'src', 'here-tenant-agent.js'), 'utf8');
  assert.match(entry, /handleAiRequest/);
  assert.match(entry, /export \{ HereTenantAgent \}/);
  assert.match(index, /path === '\/v1'/);
  assert.match(index, /CATALOG/);
  assert.match(tenant, /stub:\s*false/);
  assert.doesNotMatch(tenant, /stub:\s*true/);
});

test('AI routes require house-owner membership, not any authenticated user', async () => {
  const router = await readFile(resolve(here, '..', 'src', 'ai', 'router.js'), 'utf8');
  assert.match(router, /role=eq\.owner/);
  assert.match(router, /McCluster house owner access required/);
  assert.match(router, /rpc\(env, 'ai_ingest'/);
  assert.match(router, /rpc\(env, 'ai_retrieve'/);
  assert.match(router, /rpc\(env, 'ai_record_decision'/);
});

test('private AI schema is locked away from anon and authenticated', async () => {
  const sql = [
    await readFile(resolve(repoRoot, 'supabase', 'migrations', '20260908221900_ai_harness.sql'), 'utf8'),
    await readFile(resolve(repoRoot, 'supabase', 'migrations', '20260908221901_ai_harness_rpc.sql'), 'utf8'),
  ].join('\n');
  assert.match(sql, /create schema if not exists ai_context/);
  assert.match(sql, /revoke all on schema ai_context from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.ai_ingest\(jsonb\) from public, anon, authenticated/);
  assert.match(sql, /create table if not exists public\.ops_jobs/);
  assert.match(sql, /kind text not null default 'fact'/);
  assert.doesNotMatch(sql, /grant execute on function public\.ai_ingest\(jsonb\) to anon/);
  assert.doesNotMatch(sql, /grant execute on function public\.ai_ingest\(jsonb\) to authenticated/);
});

test('health route stays minimal after the catalog was added', async () => {
  const text = await readFile(resolve(here, '..', 'src', 'index.js'), 'utf8');
  const block = text.match(/if \(path === '\/health'[\s\S]*?\n\s*}\n/);
  assert.ok(block, 'health route not found');
  assert.match(block[0], /ok:\s*true/);
  assert.match(block[0], /service:\s*'mccluster'/);
  assert.doesNotMatch(block[0], /supabase_project|durable_object|products|project_ref|harness/i);
});
