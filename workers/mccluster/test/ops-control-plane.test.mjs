/* The infrastructure control plane's contract.

   Two kinds of test here. The static ones keep the three copies of the
   action vocabulary (catalogue, handler table, seeded policy) from
   drifting apart, and keep the estate seed honest against
   docs/control-plane/registry.json.

   The behavioural ones stub `fetch` and drive real requests through the
   router, because the properties that matter — a model cannot reboot the
   host, the command is written down before the provider is called, a
   disabled node is unreachable, an action missing from the policy table
   cannot run — are only worth anything if they hold in the code path a
   request actually takes. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ACTION_LIST, ACTIONS_BY_ID } from '../src/ops/catalog.js';
import { HANDLED_ACTIONS, providerStatus } from '../src/ops/actions.js';
import { OPS_TOOLS, handleOpsMcp } from '../src/ops/mcp.js';
import { handleOpsRequest } from '../src/ops/router.js';
import { assertReadOnlySql } from '../src/ops/providers/supabase-admin.js';
import { signature } from '../src/ops/providers/ovh.js';
import { extractStamp } from '../src/ops/providers/site.js';
import { invalidateEstate } from '../src/ops/estate.js';
import { requestHash } from '../src/ops/authority.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, '..', '..', '..', 'supabase', 'migrations', '20260916120000_infrastructure_control_plane.sql');
const registryPath = resolve(here, '..', '..', '..', 'docs', 'control-plane', 'registry.json');

/* ---------- the vocabulary stays in one piece ---------- */

test('every catalogued action has an implementation', () => {
  const missing = ACTION_LIST.filter((action) => !HANDLED_ACTIONS.includes(action.id));
  assert.deepEqual(missing.map((a) => a.id), [], 'catalogued actions with no handler');
  const orphans = HANDLED_ACTIONS.filter((id) => !ACTIONS_BY_ID[id]);
  assert.deepEqual(orphans, [], 'handlers with no catalogue entry');
});

test('every action is seeded into ops_action_policy with the same capability', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const action of ACTION_LIST) {
    const row = sql.match(new RegExp(`\\('${action.id.replace(/\./g, '\\.')}', '[^']+', '([^']+)', (true|false)`));
    assert.ok(row, `${action.id} is not seeded in ops_action_policy`);
    assert.equal(row[1], action.capability, `${action.id} capability differs between code and migration`);
    assert.equal(row[2], String(action.mutates), `${action.id} mutates flag differs between code and migration`);
  }
});

test('capability and mutation agree: reads never mutate, mutations are never reads', () => {
  for (const action of ACTION_LIST) {
    if (action.capability === 'infra.read') assert.equal(action.mutates, false, `${action.id} reads but is marked mutating`);
    else assert.equal(action.mutates, true, `${action.id} writes but is not marked mutating`);
  }
});

test('the consequential actions are the ones that need a human', () => {
  const mutating = ACTION_LIST.filter((a) => a.capability === 'infra.mutate').map((a) => a.id).sort();
  assert.deepEqual(mutating, [
    'cloudflare.dns.upsert',
    'cloudflare.worker.rollback',
    'github.file.write.protected',
    'github.pr.merge',
    'ops.estate.disable',
    'supabase.sql.apply',
    'vps.reboot',
    'vps.stop'
  ], 'the high-risk set changed — that is an authority decision, not a refactor');
});

test('infra.mutate is seeded as high risk, which is what forces an approval', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /\('infra\.mutate',\s*'[^']+',\s*'high'\)/);
  assert.match(sql, /\('infra\.read',\s*'[^']+',\s*'low'\)/);
  assert.match(sql, /\('infra\.operate',\s*'[^']+',\s*'medium'\)/);
});

test('staff and member roles cannot operate or mutate infrastructure', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const row of ["('staff', 'infra.operate', false)", "('staff', 'infra.mutate', false)",
    "('member', 'infra.read', false)", "('member', 'infra.operate', false)", "('member', 'infra.mutate', false)"]) {
    assert.ok(sql.includes(row), `missing grant row: ${row}`);
  }
});

/* ---------- the estate matches the registry ---------- */

test('every registry satellite is seeded onto the estate', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  for (const satellite of registry.satellites) {
    const key = `${satellite.owner}/${satellite.repo}`;
    assert.ok(sql.includes(`('repo', '${key}'`), `${key} is in registry.json but not seeded onto the estate`);
  }
});

test('Here is seeded disabled so no action can write to it', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const row = sql.match(/\('repo', 'mcclusterishere\/Here'[^\n]*/);
  assert.ok(row, 'Here is not seeded');
  assert.match(row[0], /, false, /, 'Here must be seeded disabled');
  assert.match(row[0], /do_not_deploy/);
});

test('the plane seeds itself, and names no Worker but mccluster', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /\('worker',\s+'mccluster',/);
  assert.match(sql, /\('database',\s+'zmnhbrjyhxzhkxmhkexs',/);
  assert.match(sql, /\('host',\s+'ovh-core',/);
  assert.match(sql, /\('site',\s+'matthew\.mccluster\.org',/);
  /* The name may appear only in the forbidden-siblings list, never as a
     node of its own. AGENTS.md rule 9, checked by the build. */
  assert.match(sql, /"forbidden_siblings":\["mccluster-core"\]/);
  assert.equal((sql.match(/mccluster-core/g) || []).length, 1);
});

/* ---------- the read-only SQL path is actually read-only ---------- */

test('read-only SQL guard passes reads', () => {
  for (const sql of [
    'select 1',
    'SELECT * FROM orgs limit 10',
    'with recent as (select * from control_commands limit 5) select * from recent',
    'explain analyze select 1',
    'show search_path',
    'table orgs'
  ]) assert.doesNotThrow(() => assertReadOnlySql(sql), sql);
});

test('read-only SQL guard refuses anything that could write', () => {
  for (const sql of [
    'delete from orgs',
    'update orgs set slug = 1',
    'insert into orgs(slug) values (1)',
    'drop table orgs',
    'alter table orgs add column x int',
    'grant all on orgs to anon',
    'revoke all on orgs from service_role',
    'truncate control_audit',
    'do $$ begin perform 1; end $$',
    'call some_procedure()',
    'select 1; delete from orgs',
    'select 1 -- harmless\n; drop table orgs',
    '/* hide */ delete from orgs',
    'with x as (insert into orgs(slug) values (1) returning *) select * from x',
    "select pg_read_file('/etc/passwd')",
    "copy orgs to '/tmp/out.csv'",
    'set role postgres'
  ]) assert.throws(
    () => assertReadOnlySql(sql),
    /accepts select|can write|exactly one statement/i,
    sql
  );
});

/* ---------- provider mechanics ---------- */

test('OVH signatures are deterministic and correctly shaped', async () => {
  const env = { OVH_APPLICATION_SECRET: 'secret', OVH_CONSUMER_KEY: 'consumer' };
  const a = await signature(env, 'GET', 'https://eu.api.ovh.com/1.0/vps', '', 1700000000);
  const b = await signature(env, 'GET', 'https://eu.api.ovh.com/1.0/vps', '', 1700000000);
  const c = await signature(env, 'POST', 'https://eu.api.ovh.com/1.0/vps', '', 1700000000);
  assert.equal(a, b);
  assert.notEqual(a, c, 'the method must be part of the signature');
  assert.match(a, /^\$1\$[0-9a-f]{40}$/);
});

test('a build stamp is read from the page, and a placeholder is not a build', () => {
  assert.equal(extractStamp('<link rel="stylesheet" href="css/style.css?v=a1b2c3d">'), 'a1b2c3d');
  assert.equal(extractStamp('<link href="css/style.css?v=__STAMP__">'), null);
  assert.equal(extractStamp('<p>no assets here</p>'), null);
});

test('no provider is considered configured without its secrets', () => {
  const status = providerStatus({});
  for (const name of ['github', 'cloudflare', 'supabase', 'ovh']) {
    assert.equal(status[name].configured, false, `${name} claimed to be configured with no secrets`);
    assert.ok(status[name].required_secrets.length > 0);
  }
});

test('the request hash binds the action, the target and the parameters', async () => {
  const base = await requestHash({ actionId: 'cloudflare.worker.rollback', nodeKey: 'mccluster', params: { version_id: 'a' } });
  assert.equal(base, await requestHash({ actionId: 'cloudflare.worker.rollback', nodeKey: 'mccluster', params: { version_id: 'a' } }));
  assert.notEqual(base, await requestHash({ actionId: 'cloudflare.worker.rollback', nodeKey: 'mccluster', params: { version_id: 'b' } }));
  assert.notEqual(base, await requestHash({ actionId: 'cloudflare.worker.rollback', nodeKey: 'other', params: { version_id: 'a' } }));
  assert.notEqual(base, await requestHash({ actionId: 'vps.reboot', nodeKey: 'mccluster', params: { version_id: 'a' } }));
  /* Key order is an accident of how the caller wrote the JSON and must
     not change what an approval covers. */
  assert.equal(
    await requestHash({ actionId: 'x', nodeKey: 'n', params: { a: 1, b: 2 } }),
    await requestHash({ actionId: 'x', nodeKey: 'n', params: { b: 2, a: 1 } })
  );
});

/* ---------- the gate, driven end to end against a stubbed house ---------- */

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };

function stubHouse({ role = 'owner', authorize, policyRows, estateRows, onCall } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  const nodes = estateRows || [
    { kind: 'repo', node_key: 'mcclusterishere/mccluster', name: 'mccluster', provider: 'github', provider_ref: 'mcclusterishere/mccluster', default_branch: 'main', enabled: true, metadata: {} },
    { kind: 'repo', node_key: 'mcclusterishere/Here', name: 'Here', provider: 'github', provider_ref: 'mcclusterishere/Here', default_branch: 'main', enabled: false, metadata: { do_not_deploy: true } },
    { kind: 'host', node_key: 'ovh-core', name: 'OVH Core', provider: 'ovh', provider_ref: 'vps-1.ovh.net', enabled: true, metadata: {} }
  ];
  const policy = policyRows || ACTION_LIST.map((a) => ({
    action_id: a.id, domain: a.domain, capability: a.capability, mutates: a.mutates, enabled: true
  }));

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, method: init.method || (input.method ?? 'GET'), body: init.body || null });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

    if (onCall) {
      const override = await onCall(url, init);
      if (override) return override;
    }
    if (url.includes('/auth/v1/user')) return json({ id: 'user-1', email: 'owner@mccluster.org' });
    if (url.includes('/rest/v1/orgs')) return json([{ id: 'org-1' }]);
    if (url.includes('/rest/v1/org_members')) return json([{ role }]);
    if (url.includes('/rest/v1/ops_action_policy')) return json(policy);
    if (url.includes('/rest/v1/ops_estate_nodes')) return json(nodes);
    if (url.includes('/rpc/control_authorize_service')) return json(authorize || { allowed: true, role, risk: 'low' });
    if (url.includes('/rpc/control_record_command_service')) return json('command-1');
    if (url.includes('/rpc/control_finish_command_service')) return json(null);
    if (url.includes('/rest/v1/control_commands')) return json([]);
    if (url.includes('/rest/v1/ops_agent_jobs')) return json([{ id: 'job-1', job_type: 'repo_health', status: 'queued' }]);
    return json({ unexpected: url }, 500);
  };
  return {
    calls,
    restore() { globalThis.fetch = original; invalidateEstate(); }
  };
}

function opsRequest(path, { method = 'GET', body } = {}) {
  return new Request(`https://api.mccluster.org${path}`, {
    method,
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

test('an unconfigured Worker serves no operations surface at all', async () => {
  const res = await handleOpsRequest(opsRequest('/v1/ops'), {});
  assert.equal(res.status, 503);
});

test('the catalogue itself requires house membership', async () => {
  const house = stubHouse({ onCall: (url) => url.includes('/rest/v1/org_members') ? new Response('[]', { status: 200 }) : null });
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops'), ENV);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /house membership/i);
  } finally { house.restore(); }
});

test('an action missing from ops_action_policy cannot run, even though the code ships it', async () => {
  const house = stubHouse({ policyRows: [] });
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops/run', { method: 'POST', body: { action: 'vps.state' } }), ENV);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).detail.code, 'action_not_in_policy');
  } finally { house.restore(); }
});

test('an action switched off in the database cannot run', async () => {
  const house = stubHouse({
    policyRows: ACTION_LIST.map((a) => ({ action_id: a.id, capability: a.capability, mutates: a.mutates, enabled: a.id !== 'vps.state' }))
  });
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops/run', { method: 'POST', body: { action: 'vps.state' } }), ENV);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).detail.code, 'action_disabled');
  } finally { house.restore(); }
});

test('a high-risk action without an approval is refused, and says how to ask', async () => {
  const house = stubHouse({ authorize: { allowed: false, reason: 'approval_required', role: 'owner', risk: 'high' } });
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops/run', {
      method: 'POST', body: { action: 'vps.reboot', params: { node_key: 'ovh-core' } }
    }), ENV);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.detail.code, 'approval_required');
    assert.ok(body.detail.request_hash, 'the refusal must carry the hash an approval binds to');
    assert.match(body.detail.how, /\/v1\/ops\/approvals/);
    /* Nothing reached OVH. */
    assert.equal(house.calls.filter((c) => c.url.includes('ovh.com')).length, 0);
  } finally { house.restore(); }
});

test('a model calling a high-risk tool over MCP is refused the same way', async () => {
  const house = stubHouse({ authorize: { allowed: false, reason: 'approval_required', role: 'owner', risk: 'high' } });
  try {
    const { body } = await handleOpsMcp(new Request('https://api.mccluster.org/v1/ops/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'vps.reboot', arguments: { node_key: 'ovh-core' } } })
    }), ENV);
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /approval/i);
    assert.equal(house.calls.filter((c) => c.url.includes('ovh.com')).length, 0);
  } finally { house.restore(); }
});

test('the ledger records the attempt before the provider is called', async () => {
  const house = stubHouse({
    onCall: (url) => url.includes('api.github.com')
      ? new Response(JSON.stringify({ default_branch: 'main', private: false }), { status: 200, headers: { 'content-type': 'application/json' } })
      : null
  });
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops/run', {
      method: 'POST', body: { action: 'github.repo.state', params: { node_key: 'mcclusterishere/mccluster' } }
    }), { ...ENV, GITHUB_CONTROL_TOKEN: 'gh-token' });
    assert.equal(res.status, 200);
    const recordIndex = house.calls.findIndex((c) => c.url.includes('control_record_command_service'));
    const providerIndex = house.calls.findIndex((c) => c.url.includes('api.github.com'));
    const finishIndex = house.calls.findIndex((c) => c.url.includes('control_finish_command_service'));
    assert.ok(recordIndex >= 0 && providerIndex > recordIndex, 'the command must be written down before the provider is touched');
    assert.ok(finishIndex > providerIndex, 'the outcome must be written down after');
  } finally { house.restore(); }
});

test('a disabled estate node is unreachable, and says why', async () => {
  const house = stubHouse();
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops/run', {
      method: 'POST', body: { action: 'github.repo.state', params: { node_key: 'mcclusterishere/Here' } }
    }), { ...ENV, GITHUB_CONTROL_TOKEN: 'gh-token' });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.detail.code, 'node_disabled');
    assert.equal(house.calls.filter((c) => c.url.includes('api.github.com')).length, 0);
  } finally { house.restore(); }
});

test('an unregistered repository cannot be reached at all', async () => {
  const house = stubHouse();
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops/run', {
      method: 'POST', body: { action: 'github.repo.state', params: { node_key: 'someone-else/private-repo' } }
    }), { ...ENV, GITHUB_CONTROL_TOKEN: 'gh-token' });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).detail.code, 'node_not_found');
    assert.equal(house.calls.filter((c) => c.url.includes('api.github.com')).length, 0);
  } finally { house.restore(); }
});

test('an action whose provider has no secrets fails closed with the secrets it needs', async () => {
  const house = stubHouse();
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops/run', {
      method: 'POST', body: { action: 'vps.state', params: { node_key: 'ovh-core' } }
    }), ENV);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.detail.code, 'provider_not_configured');
    assert.deepEqual(body.detail.required_secrets, ['OVH_APPLICATION_KEY', 'OVH_APPLICATION_SECRET', 'OVH_CONSUMER_KEY']);
  } finally { house.restore(); }
});

test('a dry run proves the gate without touching the provider', async () => {
  const house = stubHouse();
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops/run', {
      method: 'POST', body: { action: 'github.repo.state', params: { node_key: 'mcclusterishere/mccluster' }, dry_run: true }
    }), { ...ENV, GITHUB_CONTROL_TOKEN: 'gh-token' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.dry_run, true);
    assert.equal(body.target.node_key, 'mcclusterishere/mccluster');
    assert.equal(house.calls.filter((c) => c.url.includes('api.github.com')).length, 0);
    assert.equal(house.calls.filter((c) => c.url.includes('control_record_command_service')).length, 0);
  } finally { house.restore(); }
});

test('a replayed idempotency key returns the first outcome instead of running again', async () => {
  const house = stubHouse({
    onCall: (url) => url.includes('/rest/v1/control_commands') && url.includes('idempotency_key=eq.')
      ? new Response(JSON.stringify([{ id: 'command-0', action: 'vps.reboot', status: 'executed', result: { task_id: 7 } }]),
        { status: 200, headers: { 'content-type': 'application/json' } })
      : null
  });
  try {
    const res = await handleOpsRequest(opsRequest('/v1/ops/run', {
      method: 'POST',
      body: { action: 'vps.reboot', params: { node_key: 'ovh-core' }, idempotency_key: 'reboot-once', approval_id: 'a' }
    }), { ...ENV, OVH_APPLICATION_KEY: 'k', OVH_APPLICATION_SECRET: 's', OVH_CONSUMER_KEY: 'c' });
    const body = await res.json();
    assert.equal(body.replayed, true);
    assert.deepEqual(body.result, { task_id: 7 });
    assert.equal(house.calls.filter((c) => c.url.includes('ovh.com')).length, 0, 'a replay must not reboot anything');
  } finally { house.restore(); }
});

test('the MCP surface offers exactly the catalogue, plus the way to ask permission', () => {
  const names = OPS_TOOLS.map((t) => t.name);
  for (const action of ACTION_LIST) assert.ok(names.includes(action.id), `${action.id} is missing from the MCP surface`);
  assert.ok(names.includes('ops.approval.request'));
  assert.equal(names.length, ACTION_LIST.length + 1);
  for (const action of ACTION_LIST.filter((a) => a.capability === 'infra.mutate')) {
    const tool = OPS_TOOLS.find((t) => t.name === action.id);
    assert.ok(tool.inputSchema.properties.approval_id, `${action.id} must advertise approval_id`);
    assert.match(tool.description, /owner must approve/i);
  }
});

/* ---------- wiring ---------- */

test('the Worker routes /v1/ops, and checks the MCP path first', async () => {
  const entry = await readFile(resolve(here, '..', 'src', 'entry.js'), 'utf8');
  const mcpIndex = entry.indexOf("path === '/v1/ops/mcp'");
  const restIndex = entry.indexOf("path.startsWith('/v1/ops/')");
  const aiIndex = entry.indexOf("path.startsWith('/v1/ai/')");
  assert.ok(mcpIndex > 0 && restIndex > mcpIndex, 'the MCP route must be matched before the REST catch-all');
  assert.ok(restIndex < aiIndex, '/v1/ops must be routed before /v1/ai');
  assert.match(entry, /captureEstateSnapshot\(env\)/, 'the cron must take an estate snapshot');
});
