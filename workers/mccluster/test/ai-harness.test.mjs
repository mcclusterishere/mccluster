import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateEnvelope, CATALOG } from '../src/ai/envelope.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

const ORG = '11111111-1111-1111-1111-111111111111';

test('catalog advertises the control plane without leaking secrets', () => {
  assert.equal(CATALOG.service, 'mccluster');
  assert.equal(CATALOG.plane, 'control');
  const paths = CATALOG.routes.map((route) => route.path);
  assert.ok(paths.includes('/health'));
  assert.ok(paths.includes('/v1/ai/ingest'));
  assert.doesNotMatch(JSON.stringify(CATALOG), /service_role|SUPABASE_SERVICE|FAL_KEY|secret/i);
});

test('ingest envelope still defines the cross-provider interchange format', () => {
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

test('worker entry delegates AI and media MCP routes without replacing the canonical worker', async () => {
  const entry = await readFile(resolve(here, '..', 'src', 'entry.js'), 'utf8');
  const index = await readFile(resolve(here, '..', 'src', 'index.js'), 'utf8');
  const tenant = await readFile(resolve(here, '..', 'src', 'here-tenant-agent.js'), 'utf8');
  assert.match(entry, /handleAiRequest/);
  assert.match(entry, /handleMediaMcp/);
  assert.match(entry, /\/v1\/media\/mcp/);
  assert.match(entry, /export \{ HereTenantAgent \}/);
  assert.match(index, /path === '\/v1'/);
  assert.match(index, /CATALOG/);
  assert.match(tenant, /stub:\s*false/);
  assert.doesNotMatch(tenant, /stub:\s*true/);
});

test('AI routes use the evolved context functions and ops_agent_jobs contract', async () => {
  const router = await readFile(resolve(here, '..', 'src', 'ai', 'router.js'), 'utf8');
  assert.match(router, /role=eq\.owner/);
  assert.match(router, /McCluster house owner access required/);
  assert.match(router, /context-ingest/);
  assert.match(router, /context-query/);
  assert.match(router, /context-decision/);
  assert.match(router, /ops_agent_jobs/);
  assert.doesNotMatch(router, /ai_ingest/);
  assert.doesNotMatch(router, /ai_retrieve/);
  assert.doesNotMatch(router, /ai_record_decision/);
  assert.doesNotMatch(router, /ai_harness_status/);
});

test('unapplied legacy harness migrations cannot recreate a shadow job/RPC vocabulary', async () => {
  const migrations = await readdir(resolve(repoRoot, 'supabase', 'migrations'));
  const legacy = [
    '20260908221900_ai_harness.sql',
    '20260908221901_ai_harness_ops.sql',
    '20260908221902_ai_harness_ingest.sql',
    '20260908221903_ai_harness_rpc.sql'
  ];
  for (const name of legacy) assert.equal(migrations.includes(name), false, `${name} must stay retired`);
});

test('decision ingress verifies a human and writes only to the canonical private decisions table', async () => {
  const decision = await readFile(resolve(repoRoot, 'supabase', 'functions', 'context-decision', 'index.ts'), 'utf8');
  assert.match(decision, /\/auth\/v1\/user/);
  assert.match(decision, /owner.*admin/);
  assert.match(decision, /ai_context\.decisions/);
  assert.doesNotMatch(decision, /ops_jobs/);
  assert.doesNotMatch(decision, /create table/i);
});

test('health route stays minimal after the catalog was added', async () => {
  const text = await readFile(resolve(here, '..', 'src', 'index.js'), 'utf8');
  const block = text.match(/if \(path === '\/health'[\s\S]*?\n\s*}\n/);
  assert.ok(block, 'health route not found');
  assert.match(block[0], /ok:\s*true/);
  assert.match(block[0], /service:\s*'mccluster'/);
  assert.doesNotMatch(block[0], /supabase_project|durable_object|products|project_ref|harness/i);
});
