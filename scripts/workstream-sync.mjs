#!/usr/bin/env node
// Ingest a directory of local mccluster-workstream/1 checkpoint files into the Core context plane.
//
//   node scripts/workstream-sync.mjs --dir <directory>            dry run (the default): print the exact calls
//   node scripts/workstream-sync.mjs --dir <directory> --json     the same calls as one JSON document
//   node scripts/workstream-sync.mjs --dir <directory> --apply    make them
//
// The directory holds one <id>.json per workstream (the record) and, beside it, <id>.events.jsonl (its
// append-only events, one JSON object per line): the layout the local reference store writes. Nothing in a
// file is changed or reinterpreted; each record and each event becomes one `workstream.checkpoint` call.
// Keep the directory OUTSIDE any repository: it holds private work state. A directory inside a Git working
// tree is refused unless that repository ignores it (a top-level .mccluster/, which this repo's .gitignore lists).
//
// Every file is validated with the same rules Core applies (core/src/workstream-contract.mjs) BEFORE anything
// is sent: one bad record, one over-long field or one credential-looking string stops the whole run with
// nothing written. Running it twice is safe: each event's operation key is derived from its content, so the
// plane stores it once, and a record older than what the plane holds is reported as stale, not applied.
//
// --apply needs three environment variables and has no defaults, so it can never reach production by accident:
//   MCCLUSTER_CORE_MCP_URL   the Core MCP endpoint to post to (https, or http on localhost only)
//   MCCLUSTER_CORE_TOKEN     the house owner's bearer token for that endpoint; read, never printed, never stored
//   MCCLUSTER_ORG_ID         the house organization id (the edge overwrites it with the one it verified)
// Optional, recorded as provenance: MCCLUSTER_DEVICE, MCCLUSTER_SESSION_ID, MCCLUSTER_MODEL_ID.
// The actor is whoever the endpoint authenticates the token as. This script cannot name one.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WORKSTREAM_SCHEMA, normalizeWorkstream, normalizeEvent, deriveOperationKey, guardedText, WORKSTREAM_BOUNDS
} from '../core/src/workstream-contract.mjs';

export const SYNC_HARNESS = 'workstream-sync';
const ORG_PLACEHOLDER = '<MCCLUSTER_ORG_ID>';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const out = { dir: null, apply: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--dir') { out.dir = argv[i + 1]; i += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function provenanceFromEnv(env) {
  const provenance = { harness: SYNC_HARNESS };
  for (const [field, name] of [['device', 'MCCLUSTER_DEVICE'], ['session_id', 'MCCLUSTER_SESSION_ID'], ['model_id', 'MCCLUSTER_MODEL_ID']]) {
    const value = guardedText(`provenance.${field}`, env[name], WORKSTREAM_BOUNDS[field]);
    if (value) provenance[field] = value;
  }
  return provenance;
}

/* A local store holds private work state, and private cross-model context never goes in public Git
   (AGENTS.md). The safe place for a store is outside every repository. Inside a Git working tree it is accepted
   only where that repository's own .gitignore keeps it out: under a top-level `.mccluster/` directory that the
   root .gitignore ignores. Anywhere else in a working tree the next `git add -A` would publish it, so the run
   is refused before a file is read. Returns the reason, or null when the store is safe. */
export const STORE_DIRECTORY = '.mccluster';
export function storeLeakRisk(dir) {
  const start = path.resolve(dir);
  let root = null;
  for (let at = start; ;) {
    if (existsSync(path.join(at, '.git'))) { root = at; break; }
    const parent = path.dirname(at);
    if (parent === at) break;
    at = parent;
  }
  if (!root) return null;
  const inside = path.relative(root, start).split(path.sep);
  let ignored = false;
  try {
    ignored = readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)
      .some((line) => [`${STORE_DIRECTORY}/`, `/${STORE_DIRECTORY}/`].includes(line.trim()));
  } catch { ignored = false; }
  if (inside[0] === STORE_DIRECTORY && ignored) return null;
  return `the store is inside a Git working tree and is not ignored there; keep it outside the repository, or under a top-level ${STORE_DIRECTORY}/ that the repository's .gitignore ignores`;
}

/* Read and validate a whole directory. Returns { calls, problems }: `problems` is every reason a file cannot be
   ingested, by file name and never by content, so a refused credential is not echoed back. */
export function planSync(dir, { orgId = ORG_PLACEHOLDER, env = {}, nowMs = Date.now() } = {}) {
  const problems = [];
  const calls = [];
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
    return { calls, problems: [`not a directory: ${dir ?? '(none given; pass --dir)'}`] };
  }
  const leak = storeLeakRisk(dir);
  if (leak) return { calls, problems: [leak] };
  let provenance;
  try { provenance = provenanceFromEnv(env); } catch (error) { return { calls, problems: [`provenance: ${error.message}`] }; }
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  for (const name of files) {
    const id = name.slice(0, -'.json'.length);
    let workstream;
    try {
      const record = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      if (record?.schema !== WORKSTREAM_SCHEMA) throw new Error(`schema must be ${WORKSTREAM_SCHEMA}`);
      if (record.id !== id) throw new Error('the id inside the file must equal the file name');
      if (typeof record.title !== 'string' || typeof record.goal !== 'string') throw new Error('title and goal are required');
      workstream = normalizeWorkstream(record, { nowMs });
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
      continue;
    }
    calls.push({ file: name, tool: 'workstream.checkpoint', arguments: { org_id: orgId, workstream, provenance } });

    const log = path.join(dir, `${id}.events.jsonl`);
    if (!existsSync(log)) continue;
    const seen = new Set();
    const lines = readFileSync(log, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const where = `${id}.events.jsonl line ${index + 1}`;
      try {
        const event = normalizeEvent(JSON.parse(line), { nowMs });
        if (!event.at) throw new Error('a local event must carry its time (at)');
        const operationKey = deriveOperationKey(id, event);
        if (seen.has(operationKey)) return; // the same line twice is one event
        seen.add(operationKey);
        calls.push({
          file: where, tool: 'workstream.checkpoint',
          arguments: { org_id: orgId, workstream: { id }, event, operation_key: operationKey, provenance }
        });
      } catch (error) {
        problems.push(`${where}: ${error.message}`);
      }
    });
  }
  if (!files.length) problems.push(`no ${WORKSTREAM_SCHEMA} files (*.json) in ${dir}`);
  return { calls, problems };
}

/* The exact JSON-RPC bodies --apply posts, in order. */
export function toRpc(calls) {
  return calls.map((call, index) => ({
    jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: call.tool, arguments: call.arguments }
  }));
}

export function applyTarget(env) {
  const url = String(env.MCCLUSTER_CORE_MCP_URL || '').trim();
  const token = String(env.MCCLUSTER_CORE_TOKEN || '').trim();
  const orgId = String(env.MCCLUSTER_ORG_ID || '').trim();
  if (!url) throw new Error('--apply needs MCCLUSTER_CORE_MCP_URL; there is no default endpoint');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('MCCLUSTER_CORE_MCP_URL is not a URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new Error('MCCLUSTER_CORE_MCP_URL must be https (http is accepted for localhost only)');
  }
  if (parsed.username || parsed.password || parsed.search) throw new Error('MCCLUSTER_CORE_MCP_URL must not carry credentials or a query string');
  if (!token) throw new Error('--apply needs MCCLUSTER_CORE_TOKEN');
  if (!UUID.test(orgId)) throw new Error('--apply needs MCCLUSTER_ORG_ID (a UUID)');
  return { url: parsed.toString(), token, orgId };
}

/* Core answers a stable capability with an envelope
   ({ capability, catalogVersion, provider, binding, tool, durationMs, result, fallback_from },
   core/src/capabilities/registry.mjs) and puts the tool's own answer under `result`. A raw tool call
   (core.workstream.checkpoint) answers with the tool's result directly. Both are read here; anything that is
   neither is unconfirmed, never a success. */
export function checkpointResult(body) {
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isRecord(body)) return null;
  const inner = typeof body.capability === 'string' && isRecord(body.result) ? body.result : body;
  return isRecord(inner.workstream) && (inner.event === null || inner.event === undefined || isRecord(inner.event)) ? inner : null;
}

function outcome(payload) {
  if (payload?.error) return { ok: false, text: `refused: ${String(payload.error.message || 'error').slice(0, 300)}` };
  const content = payload?.result?.content?.[0]?.text;
  if (payload?.result?.isError) return { ok: false, text: `refused: ${String(content || 'tool error').slice(0, 300)}` };
  let body = payload?.result?.structuredContent ?? null;
  if (!body && typeof content === 'string') { try { body = JSON.parse(content); } catch { body = null; } }
  body = checkpointResult(body);
  if (!body) return { ok: false, text: 'unconfirmed: the endpoint answered without a checkpoint result' };
  if (body.event) return { ok: true, text: body.event.replayed ? 'event already recorded' : 'event appended' };
  if (body.workstream.stale) return { ok: true, text: 'workstream stale: the plane holds a newer checkpoint, nothing changed' };
  return { ok: true, text: body.workstream.created ? 'workstream created' : 'workstream updated' };
}

export async function applySync(calls, target, { fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const bodies = toRpc(calls);
  let done = 0;
  for (let i = 0; i < bodies.length; i += 1) {
    const response = await fetchImpl(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${target.token}` },
      body: JSON.stringify(bodies[i]),
      signal: AbortSignal.timeout(30_000)
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    const result = response.ok ? outcome(payload) : { ok: false, text: `HTTP ${response.status}: ${String(payload?.error?.message || payload?.error || 'request refused').slice(0, 300)}` };
    log(`${result.ok ? 'ok  ' : 'FAIL'} ${calls[i].file}: ${result.text}`);
    if (!result.ok) return { ok: false, done, total: bodies.length };
    done += 1;
  }
  return { ok: true, done, total: bodies.length };
}

const USAGE = 'usage: node scripts/workstream-sync.mjs --dir <directory of mccluster-workstream/1 files> [--json] [--apply]';

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${error.message}\n${USAGE}`); return 2; }
  if (args.help) { console.log(USAGE); return 0; }
  let target = null;
  if (args.apply) {
    try { target = applyTarget(process.env); } catch (error) { console.error(error.message); return 2; }
  }
  const orgId = target?.orgId || (UUID.test(String(process.env.MCCLUSTER_ORG_ID || '')) ? process.env.MCCLUSTER_ORG_ID : ORG_PLACEHOLDER);
  const { calls, problems } = planSync(args.dir, { orgId, env: process.env });
  if (problems.length) {
    for (const problem of problems) console.error(`BAD ${problem}`);
    console.error(`${problems.length} problem(s); nothing was sent`);
    return 1;
  }
  if (!args.apply) {
    const bodies = toRpc(calls);
    if (args.json) console.log(JSON.stringify({ dry_run: true, method: 'POST', url: '<MCCLUSTER_CORE_MCP_URL>', calls: bodies }, null, 2));
    else {
      console.log(`DRY RUN: ${bodies.length} call(s) would be POSTed to <MCCLUSTER_CORE_MCP_URL>, in this order. Nothing was sent.`);
      for (let i = 0; i < bodies.length; i += 1) console.log(`# ${calls[i].file}\n${JSON.stringify(bodies[i])}`);
      console.log('Re-run with --apply (and MCCLUSTER_CORE_MCP_URL, MCCLUSTER_CORE_TOKEN, MCCLUSTER_ORG_ID) to make these calls.');
    }
    return 0;
  }
  const result = await applySync(calls, target);
  console.log(`${result.done} of ${result.total} call(s) made${result.ok ? '' : '; stopped at the first failure (safe to re-run: applied events are not repeated)'}`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
