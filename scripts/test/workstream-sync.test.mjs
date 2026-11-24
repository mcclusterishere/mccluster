// scripts/workstream-sync.mjs ingests local mccluster-workstream/1 files into the Core context plane.
// What these pin: the files go in unchanged, a dry run sends nothing, --apply has no default endpoint,
// a re-run repeats nothing, and one bad file (or one credential) stops the whole run before any call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planSync, toRpc, applyTarget, applySync, parseArgs, checkpointResult, storeLeakRisk, STORE_DIRECTORY, SYNC_HARNESS } from '../workstream-sync.mjs';
import { deriveOperationKey, looksLikeSecret, SECRET_PATTERNS, SECRET_PATTERNS_ANY_CASE } from '../../core/src/workstream-contract.mjs';

const SCRIPT = fileURLToPath(new URL('../workstream-sync.mjs', import.meta.url));
const ORG = '00000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-11-23T12:00:00Z');

// Exactly what the local reference store writes: pretty JSON for the record, one JSON object per line for events.
const RECORD = {
  schema: 'mccluster-workstream/1', id: 'durable-context', created_at: '2026-11-21T09:00:00.000Z',
  title: 'Durable context', goal: 'Work state survives a context window', status: 'active',
  branch: 'prime/durable-context', head: 'b51ede03', next: 'run the checks', updated_at: '2026-11-22T09:34:00.000Z'
};
const EVENTS = [
  { at: '2026-11-22T09:10:00.000Z', kind: 'decision', text: 'Checkpoints live in ai_context', by: 'owner' },
  { at: '2026-11-22T09:20:00.000Z', kind: 'verified', text: 'PGlite check passes', evidence: 'scripts/ai-context-workstreams-sql-check.mjs' },
  { at: '2026-11-22T09:34:00.000Z', kind: 'done', text: 'SQL written' }
];

function store(records = [[RECORD, EVENTS]]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'workstream-sync-'));
  for (const [record, events] of records) {
    writeFileSync(path.join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    if (events) writeFileSync(path.join(dir, `${record.id}.events.jsonl`), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
  }
  return dir;
}

test('a local store becomes one call per record and one per event, unchanged, with content-derived keys', () => {
  const dir = store();
  try {
    const { calls, problems } = planSync(dir, { orgId: ORG, nowMs: NOW });
    assert.deepEqual(problems, []);
    assert.equal(calls.length, 4);
    const { schema, ...fields } = RECORD;
    assert.deepEqual(calls[0].arguments, { org_id: ORG, workstream: fields, provenance: { harness: SYNC_HARNESS } });
    EVENTS.forEach((event, i) => {
      assert.deepEqual(calls[i + 1].arguments, {
        org_id: ORG, workstream: { id: 'durable-context' }, event,
        operation_key: deriveOperationKey('durable-context', event), provenance: { harness: SYNC_HARNESS }
      });
    });
    const rpc = toRpc(calls);
    assert.deepEqual(rpc.map((body) => [body.jsonrpc, body.method, body.params.name]), Array(4).fill(['2.0', 'tools/call', 'workstream.checkpoint']));
    assert.deepEqual(rpc.map((body) => body.id), [1, 2, 3, 4]);
    assert.deepEqual(planSync(dir, { orgId: ORG, nowMs: NOW }).calls, calls, 'planning twice gives the same calls and the same keys');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a repeated line is one event; provenance comes from the environment and is bounded', () => {
  const dir = store([[RECORD, [...EVENTS, EVENTS[0]]]]);
  try {
    const { calls, problems } = planSync(dir, { orgId: ORG, nowMs: NOW, env: { MCCLUSTER_DEVICE: 'laptop', MCCLUSTER_SESSION_ID: 's-1', MCCLUSTER_MODEL_ID: 'model-x' } });
    assert.deepEqual(problems, []);
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0].arguments.provenance, { harness: SYNC_HARNESS, device: 'laptop', session_id: 's-1', model_id: 'model-x' });
    assert.match(planSync(dir, { env: { MCCLUSTER_DEVICE: 'd'.repeat(121) } }).problems[0], /provenance\.device exceeds 120/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('one bad file stops the run, names the file and never echoes a credential', () => {
  const secret = ['gh', 'p_', 'z'.repeat(24)].join('');
  const dir = store([
    [RECORD, [...EVENTS, { at: '2026-11-22T09:40:00.000Z', kind: 'note', text: `the token is ${secret}` }, { kind: 'note', text: 'no time' }]],
    [{ ...RECORD, id: 'wrong-schema', schema: 'other/1' }, null],
    [{ ...RECORD, id: 'long-goal', goal: 'g'.repeat(2001) }, null]
  ]);
  writeFileSync(path.join(dir, 'renamed.json'), JSON.stringify({ ...RECORD, id: 'something-else' }));
  writeFileSync(path.join(dir, 'broken.json'), '{not json');
  try {
    const { problems } = planSync(dir, { orgId: ORG, nowMs: NOW });
    const text = problems.join('\n');
    assert.equal(problems.length, 6);
    assert.match(text, /durable-context\.events\.jsonl line 4: refusing to checkpoint text that looks like a credential \(event\.text\)/);
    assert.match(text, /durable-context\.events\.jsonl line 5: a local event must carry its time/);
    assert.match(text, /wrong-schema\.json: schema must be mccluster-workstream\/1/);
    assert.match(text, /long-goal\.json: workstream\.goal exceeds 2000 characters/);
    assert.match(text, /renamed\.json: the id inside the file must equal the file name/);
    assert.match(text, /broken\.json: /);
    assert.equal(text.includes(secret), false);
    const run = spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--apply'], {
      encoding: 'utf8', env: { ...process.env, MCCLUSTER_CORE_MCP_URL: 'http://127.0.0.1:9/mcp', MCCLUSTER_CORE_TOKEN: 'local-test-token', MCCLUSTER_ORG_ID: ORG }
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /6 problem\(s\); nothing was sent/);
    assert.equal((run.stdout + run.stderr).includes(secret), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the default is a dry run: it prints the exact calls and sends nothing', () => {
  const dir = store();
  try {
    const clean = { ...process.env };
    for (const name of ['MCCLUSTER_CORE_MCP_URL', 'MCCLUSTER_CORE_TOKEN', 'MCCLUSTER_ORG_ID']) delete clean[name];
    // A proxy that refuses everything: a dry run that tried the network would fail rather than pass quietly.
    const offline = { ...clean, NODE_OPTIONS: '', HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' };
    const run = spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--json'], { encoding: 'utf8', env: offline });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.dry_run, true);
    assert.equal(out.url, '<MCCLUSTER_CORE_MCP_URL>');
    assert.deepEqual(out.calls, toRpc(planSync(dir, { orgId: '<MCCLUSTER_ORG_ID>', nowMs: NOW }).calls));
    const text = spawnSync(process.execPath, [SCRIPT, '--dir', dir], { encoding: 'utf8', env: offline });
    assert.equal(text.status, 0);
    assert.match(text.stdout, /^DRY RUN: 4 call\(s\) would be POSTed to <MCCLUSTER_CORE_MCP_URL>, in this order\. Nothing was sent\./);
    assert.equal(text.stdout.split('\n').filter((line) => line.startsWith('{"jsonrpc":"2.0"')).length, 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--apply has no default endpoint, token or organization, and refuses a non-TLS remote', () => {
  assert.throws(() => applyTarget({}), /needs MCCLUSTER_CORE_MCP_URL; there is no default endpoint/);
  assert.throws(() => applyTarget({ MCCLUSTER_CORE_MCP_URL: 'https://core.example.org/mcp' }), /needs MCCLUSTER_CORE_TOKEN/);
  assert.throws(() => applyTarget({ MCCLUSTER_CORE_MCP_URL: 'https://core.example.org/mcp', MCCLUSTER_CORE_TOKEN: 't' }), /needs MCCLUSTER_ORG_ID/);
  assert.throws(() => applyTarget({ MCCLUSTER_CORE_MCP_URL: 'http://core.example.org/mcp', MCCLUSTER_CORE_TOKEN: 't', MCCLUSTER_ORG_ID: ORG }), /must be https/);
  assert.throws(() => applyTarget({ MCCLUSTER_CORE_MCP_URL: 'https://u:p@core.example.org/mcp', MCCLUSTER_CORE_TOKEN: 't', MCCLUSTER_ORG_ID: ORG }), /must not carry credentials/);
  assert.throws(() => applyTarget({ MCCLUSTER_CORE_MCP_URL: 'core', MCCLUSTER_CORE_TOKEN: 't', MCCLUSTER_ORG_ID: ORG }), /is not a URL/);
  assert.equal(applyTarget({ MCCLUSTER_CORE_MCP_URL: 'http://localhost:8787/mcp', MCCLUSTER_CORE_TOKEN: 't', MCCLUSTER_ORG_ID: ORG }).url, 'http://localhost:8787/mcp');
  const source = readFileSync(SCRIPT, 'utf8');
  assert.equal(/https?:\/\/[a-z0-9.-]*mccluster\.org/i.test(source), false, 'the script must not carry a production URL');
  assert.equal(/supabase\.co/i.test(source), false);
  const clean = { ...process.env };
  for (const name of ['MCCLUSTER_CORE_MCP_URL', 'MCCLUSTER_CORE_TOKEN', 'MCCLUSTER_ORG_ID']) delete clean[name];
  const run = spawnSync(process.execPath, [SCRIPT, '--dir', '.', '--apply'], { encoding: 'utf8', env: clean });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /there is no default endpoint/);
  assert.throws(() => parseArgs(['--production']), /unknown argument/);
});

/* What Core really answers. core/src/tool-broker.mjs serialises the return value of capabilities.call with
   mcpText (pretty JSON in one text block), and capabilities.call wraps the tool's own result in an envelope
   (core/src/capabilities/registry.mjs). Built by the real registry below, not by hand, so this suite cannot
   pass against a shape Core never returns. */
const { CapabilityRegistry } = await import('../../core/src/capabilities/registry.mjs');
async function brokerAnswer(id, capability, toolResult, { isError = false } = {}) {
  if (isError) return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] } }), { status: 200 });
  const tool = 'core.workstream.checkpoint';
  const registry = new CapabilityRegistry({
    toolRegistry: {
      async list() { return { tools: [{ name: tool, transport: 'local-control' }], diagnostics: [], refreshedAt: 'now' }; },
      async call(name) { assert.equal(name, tool); return toolResult; }
    }
  });
  const envelope = await registry.call(capability, {});
  assert.equal(envelope.capability, capability);
  assert.equal(envelope.tool, tool);
  assert.equal(Object.hasOwn(envelope, 'workstream'), false, 'the checkpoint is under result, never at the top level');
  assert.deepEqual(envelope.result, toolResult);
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] } }), { status: 200 });
}

test('--apply posts the dry-run bodies, in order, to the given endpoint only, and never prints the token', async () => {
  const dir = store();
  try {
    const target = applyTarget({ MCCLUSTER_CORE_MCP_URL: 'https://core.example.org/v1/core/mcp', MCCLUSTER_CORE_TOKEN: 'owner-session-token', MCCLUSTER_ORG_ID: ORG });
    const { calls } = planSync(dir, { orgId: target.orgId, nowMs: NOW });
    const sent = [];
    const lines = [];
    const seenKeys = new Set();
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push({ url, authorization: init.headers.authorization, method: init.method, body });
      const args = body.params.arguments;
      const replayed = args.operation_key ? seenKeys.has(args.operation_key) : false;
      if (args.operation_key) seenKeys.add(args.operation_key);
      return brokerAnswer(body.id, body.params.name, { workstream: { applied: true, created: !args.event, stale: false, workstream: { id: args.workstream.id } }, event: args.event ? { appended: !replayed, replayed, event: {} } : null });
    };
    const first = await applySync(calls, target, { fetchImpl, log: (line) => lines.push(line) });
    assert.deepEqual(first, { ok: true, done: 4, total: 4 });
    assert.deepEqual(sent.map((call) => call.body), toRpc(calls));
    assert.ok(sent.every((call) => call.url === 'https://core.example.org/v1/core/mcp' && call.method === 'POST' && call.authorization === 'Bearer owner-session-token'));
    assert.deepEqual(lines.map((line) => line.replace(/^ok {3}[^:]+(?: line \d+)?: /, '')), ['workstream created', 'event appended', 'event appended', 'event appended']);
    await applySync(calls, target, { fetchImpl, log: (line) => lines.push(line) });
    assert.deepEqual(lines.slice(5), ['event already recorded', 'event already recorded', 'event already recorded'].map((text, i) => `ok   durable-context.events.jsonl line ${i + 1}: ${text}`));
    assert.equal(lines.join('\n').includes('owner-session-token'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--apply stops at the first refusal and reports how far it got', async () => {
  const dir = store();
  try {
    const target = applyTarget({ MCCLUSTER_CORE_MCP_URL: 'https://core.example.org/mcp', MCCLUSTER_CORE_TOKEN: 't', MCCLUSTER_ORG_ID: ORG });
    const { calls } = planSync(dir, { orgId: ORG, nowMs: NOW });
    const lines = [];
    let n = 0;
    const answers = [
      () => brokerAnswer(1, 'workstream.checkpoint', { workstream: { applied: false, created: false, stale: true, workstream: { id: 'durable-context' } }, event: null }),
      () => brokerAnswer(2, 'workstream.checkpoint', { error: 'Workstream checkpoints are not applied on this database', code: 'WORKSTREAMS_NOT_APPLIED', status: 503 }, { isError: true })
    ];
    const result = await applySync(calls, target, { fetchImpl: async () => answers[n++](), log: (line) => lines.push(line) });
    assert.deepEqual(result, { ok: false, done: 1, total: 4 });
    assert.equal(n, 2, 'nothing is sent after a refusal');
    assert.match(lines[0], /workstream stale: the plane holds a newer checkpoint, nothing changed/);
    assert.match(lines[1], /^FAIL .*refused: .*Workstream checkpoints are not applied/s);
    const denied = await applySync(calls, target, { fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'McCluster house owner access required' } }), { status: 403 }), log: (line) => lines.push(line) });
    assert.deepEqual(denied, { ok: false, done: 0, total: 4 });
    assert.match(lines.at(-1), /HTTP 403: McCluster house owner access required/);
    const empty = await applySync(calls, target, { fetchImpl: async () => new Response('{}', { status: 200 }), log: (line) => lines.push(line) });
    assert.equal(empty.ok, false, 'an answer without a checkpoint result is not a success');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the checkpoint result is read from the capability envelope and from a raw tool answer, and from nothing else', () => {
  const result = { workstream: { applied: true, created: true, stale: false, workstream: { id: 'a-stream' } }, event: null };
  const envelope = { capability: 'workstream.checkpoint', catalogVersion: 'v', provider: 'mccluster-core', binding: 'core.workstream-checkpoint', tool: 'core.workstream.checkpoint', durationMs: 3, result, fallback_from: [] };
  assert.equal(checkpointResult(envelope), result, 'the stable capability name: one level down, under result');
  assert.equal(checkpointResult(result), result, 'the raw core.workstream.checkpoint tool: at the top');
  for (const not of [null, undefined, 'ok', [], {}, { capability: 'workstream.checkpoint', result: {} }, { capability: 'workstream.checkpoint', result: null },
    { capability: 'workstream.checkpoint', result: { workstream: 'yes' } }, { result }, { workstream: { created: true }, event: 'appended' }]) {
    assert.equal(checkpointResult(not), null, JSON.stringify(not));
  }
});

test('a store inside a Git working tree is refused unless that repository ignores it', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'workstream-sync-repo-'));
  const put = (dir) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${RECORD.id}.json`), JSON.stringify(RECORD));
    return dir;
  };
  try {
    assert.equal(storeLeakRisk(repo), null, 'a directory outside every repository is the safe place');
    writeFileSync(path.join(repo, '.git'), 'gitdir: elsewhere\n'); // a linked worktree has a .git file, a clone a .git directory
    const loose = put(path.join(repo, 'notes', 'workstreams'));
    assert.match(planSync(loose, { orgId: ORG, nowMs: NOW }).problems[0], /inside a Git working tree and is not ignored/);
    assert.deepEqual(planSync(loose, { orgId: ORG, nowMs: NOW }).calls, [], 'nothing is planned from a store that could be committed');
    const spool = put(path.join(repo, STORE_DIRECTORY, 'workstreams'));
    assert.match(planSync(spool, { orgId: ORG, nowMs: NOW }).problems[0], /not ignored/, 'the directory name alone is not enough');
    writeFileSync(path.join(repo, '.gitignore'), `node_modules/\n${STORE_DIRECTORY}/\n`);
    assert.deepEqual(planSync(spool, { orgId: ORG, nowMs: NOW }).problems, []);
    assert.equal(planSync(spool, { orgId: ORG, nowMs: NOW }).calls.length, 1);
    assert.match(planSync(loose, { orgId: ORG, nowMs: NOW }).problems[0], /not ignored/, 'ignoring the spool does not bless any other path');
    assert.match(planSync(put(path.join(repo, 'docs', STORE_DIRECTORY)), { orgId: ORG, nowMs: NOW }).problems[0], /not ignored/, 'only the top-level directory is the ignored one');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('this repository ignores the local store, and the contract no longer points a hook at a file that is not here', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const ignore = readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((line) => line.trim());
  assert.ok(ignore.includes(`${STORE_DIRECTORY}/`), '.gitignore must keep .mccluster/ out of Git');
  assert.equal(ignore.some((line) => line.startsWith('!') && line.includes(STORE_DIRECTORY)), false, 'and nothing may re-include it');
  assert.equal(storeLeakRisk(path.join(root, STORE_DIRECTORY, 'workstreams')), null);
  assert.match(storeLeakRisk(path.join(root, 'docs')), /not ignored/);
  const contract = readFileSync(path.join(root, 'docs/control-plane/WORKSTREAM-CHECKPOINTS.md'), 'utf8');
  for (const [, command] of contract.matchAll(/"command":\s*"([^"]+)"/g)) {
    for (const [, file] of command.matchAll(/node\s+(\S+\.mjs)/g)) {
      assert.ok(file.startsWith('<') || existsSync(path.join(root, file)), `the documented hook runs ${file}, which is not in this repository`);
    }
    const store = command.match(/--dir\s+(\S+)/);
    if (store) assert.ok(store[1].startsWith('<'), 'a documented hook names the store as a placeholder, never as a path inside the repository');
  }
});

test('every credential shape the Git secret scan refuses is refused by the contract and by the SQL', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const workflow = readFileSync(path.join(root, '.github/workflows/secret-scan.yml'), 'utf8');
  const block = workflow.slice(workflow.indexOf('patterns=('), workflow.indexOf('\n          )', workflow.indexOf('patterns=(')));
  const scanned = [...block.matchAll(/^\s*'(.+)'\s*$/gm)].map((match) => match[1]);
  assert.ok(scanned.length >= 11, `expected the workflow's pattern list, found ${scanned.length}`);
  const sql = readFileSync(path.join(root, 'supabase/pending/ai_context_workstreams_v1.sql'), 'utf8');
  for (const pattern of scanned) {
    assert.ok(SECRET_PATTERNS.includes(pattern), `core/src/workstream-contract.mjs does not refuse ${pattern}`);
    assert.ok(sql.includes(`'${pattern}'`) || sql.includes(`'|${pattern}'`), `ai_context.workstream_looks_secret does not refuse ${pattern}`);
  }
  for (const pattern of [...SECRET_PATTERNS, ...SECRET_PATTERNS_ANY_CASE]) {
    assert.ok(sql.includes(`'${pattern}'`) || sql.includes(`'|${pattern}'`), `the SQL list is missing ${pattern}`);
  }
  // A Twilio account SID, assembled at run time so this file never holds one.
  const sid = ['A', 'C', '0123456789abcdef'.repeat(2)].join('');
  assert.equal(looksLikeSecret(`sid ${sid} end`), true);
  assert.equal(looksLikeSecret(`x${sid}`), false, 'bounded on both sides, as the workflow has it');
});

test('an empty or missing directory is a problem, not an empty success', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workstream-sync-empty-'));
  try {
    assert.match(planSync(dir).problems[0], /no mccluster-workstream\/1 files/);
    assert.match(planSync(path.join(dir, 'nope')).problems[0], /not a directory/);
    assert.match(planSync(null).problems[0], /pass --dir/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
