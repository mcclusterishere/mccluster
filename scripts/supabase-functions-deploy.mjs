#!/usr/bin/env node
/* Edge Function deploys that do not depend on the Supabase GitHub integration.

   The integration was the only deployer, and it skips function-only pushes
   in practice: on main it has reported "skipped" (#353's context-decision
   change), sat at "Waiting for branch action run" (eb11fb73), and failed with
   "Remote migration versions not found in local migrations directory" whenever
   production held a migration that main did not yet have (#370: l3-login and
   pay-now merged but kept serving the old code until the next push). A failed
   or skipped run is a check on a merge commit nobody reads, so the gap was
   silent.

   This script backs .github/workflows/supabase-functions-deploy.yml:
     plan    which functions a push changed (own files, shared imports, config)
     wait    the integration's result on the pushed commit, so this deploy is
             the last writer for that commit
     gate    without SUPABASE_ACCESS_TOKEN: pass only if the integration
             succeeded, otherwise fail naming every function left undeployed
     verify  after a CLI deploy: each function is live, updated after the
             deploy started, and its verify_jwt matches supabase/config.toml

   Only functions declared in supabase/config.toml are deployed, so a deploy
   can never fall back to the CLI's default verify_jwt. Nothing is pruned. */
import { readFile, readdir, stat, appendFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS_DIR = 'supabase/functions';
const CONFIG = 'supabase/config.toml';
const SHARED = '_shared';
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

/* [functions.<name>] stanzas, each read whole up to the next header. */
export function parseDeclaredFunctions(toml) {
  const out = new Map();
  const lines = String(toml).split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      const m = header[1].match(/^functions\.([A-Za-z0-9_-]+)$/);
      current = m ? m[1] : null;
      if (current) out.set(current, { verify_jwt: true });
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^verify_jwt\s*=\s*(true|false)$/);
    if (kv) out.get(current).verify_jwt = kv[1] === 'true';
  }
  return out;
}

/* Every _shared file affected by a change, following _shared files that
   import other _shared files. `sources` maps repo path -> file text. */
export function affectedShared(changedShared, sources) {
  const affected = new Set(changedShared);
  const sharedFiles = [...sources.keys()].filter((p) => p.startsWith(`${FUNCTIONS_DIR}/${SHARED}/`));
  let grew = true;
  while (grew) {
    grew = false;
    for (const file of sharedFiles) {
      if (affected.has(file)) continue;
      const text = sources.get(file) || '';
      for (const dep of affected) {
        if (importsShared(text, dep, true)) { affected.add(file); grew = true; break; }
      }
    }
  }
  return affected;
}

/* A function reaches shared code as ../_shared/<file>; shared files reach
   each other as ./<file>. Matched on the quoted specifier, not a substring. */
function importsShared(text, sharedPath, fromShared = false) {
  const rel = sharedPath.slice(`${FUNCTIONS_DIR}/${SHARED}/`.length).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spec = fromShared ? `(?:\\./|\\.\\./${SHARED}/)${rel}` : `(?:\\.\\./)+${SHARED}/${rel}`;
  return new RegExp(`['"]${spec}['"]`).test(text);
}

/* Which declared functions a set of changed paths needs redeployed.
   `existing` is the set of function directories present now; `sources`
   maps every file under supabase/functions to its text. */
export function planDeploy({ changedPaths, declared, existing, sources }) {
  const deploy = new Set();
  const deleted = new Set();
  const reasons = {};
  const note = (name, why) => { (reasons[name] ||= new Set()).add(why); };
  const changedShared = [];
  let configChanged = false;

  for (const p of changedPaths) {
    if (p === CONFIG) { configChanged = true; continue; }
    if (!p.startsWith(`${FUNCTIONS_DIR}/`)) continue;
    const [, , name] = p.split('/');
    if (!name || p.split('/').length < 4) continue;
    if (name === SHARED) { changedShared.push(p); continue; }
    if (existing.has(name)) { deploy.add(name); note(name, 'own files changed'); }
    else deleted.add(name);
  }

  if (configChanged) for (const name of declared.keys()) if (existing.has(name)) { deploy.add(name); note(name, 'supabase/config.toml changed'); }

  if (changedShared.length) {
    const shared = affectedShared(changedShared, sources);
    for (const name of existing) {
      const files = [...sources.keys()].filter((p) => p.startsWith(`${FUNCTIONS_DIR}/${name}/`));
      for (const sharedPath of shared) {
        if (files.some((f) => importsShared(sources.get(f) || '', sharedPath))) {
          deploy.add(name); note(name, `imports ${sharedPath.slice(FUNCTIONS_DIR.length + 1)}`);
          break;
        }
      }
    }
  }

  const undeclared = [...deploy].filter((name) => !declared.has(name)).sort();
  const functions = [...deploy].filter((name) => declared.has(name)).sort();
  return {
    functions,
    deleted: [...deleted].sort(),
    undeclared,
    reasons: Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, [...v].sort()]))
  };
}

/* Where a push's plan starts. Runs are serialized, and GitHub keeps only
   one pending run per concurrency group: a third push cancels the waiting
   one. Diffing from this push's own `before` would then skip whatever the
   cancelled (or failed) push changed, so the plan starts at the commit of
   the last successful push run. Without one that is still an ancestor of
   HEAD (none yet, history unreadable, or rewritten) nothing proves any
   earlier push reached production, so the base is empty and every
   declared function is planned. */
export function chooseBase({ lastSuccess, isAncestor }) {
  if (lastSuccess && isAncestor(lastSuccess)) return { base: lastSuccess, from: 'last successful deploy run' };
  return {
    base: '',
    from: lastSuccess
      ? 'no usable baseline: the last successful run is not an ancestor of main, so every declared function'
      : 'no usable baseline: no successful run could be read, so every declared function'
  };
}

/* The integration's verdict on one commit, from its check runs. */
export function integrationVerdict(checkRuns) {
  const runs = (checkRuns || []).filter((r) => r && r.app && r.app.slug === 'supabase');
  if (!runs.length) return { state: 'missing', summary: 'The Supabase integration posted no check on this commit.' };
  const run = runs.sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))[0];
  const summary = String((run.output && (run.output.summary || run.output.title)) || '').replace(/```/g, '').trim();
  if (run.status !== 'completed') return { state: 'pending', summary, url: run.html_url };
  return { state: run.conclusion === 'success' ? 'success' : (run.conclusion || 'unknown'), summary, url: run.html_url };
}

/* Without a deploy token this workflow can only trust the integration. */
export function gate({ functions, verdict, hasToken, manual = false, baseline = 'known' }) {
  if (!functions.length) return { ok: true, level: 'notice', message: 'No declared Edge Function changed in this push.' };
  if (hasToken) return { ok: true, level: 'notice', message: `Deploying ${functions.length} function(s) with the Supabase CLI: ${functions.join(', ')}.` };
  if (manual) return { ok: false, level: 'error', message: `Cannot deploy ${functions.join(', ')}: a manual run deploys with the Supabase CLI, which needs the SUPABASE_ACCESS_TOKEN repository secret.` };
  if (verdict.state === 'success') {
    return { ok: true, level: 'warning', message: `The Supabase integration reported success for ${functions.join(', ')}. Not independently verified: add the SUPABASE_ACCESS_TOKEN repository secret so this workflow deploys and verifies each function itself.` };
  }
  if (baseline === 'unknown') {
    return {
      ok: false,
      level: 'error',
      message: `UNVERIFIED: no earlier successful run proves which Edge Functions are current, and the Supabase integration ${verdict.state === 'missing' ? 'did not run' : `ended "${verdict.state}"`} on this commit` +
        (verdict.summary ? ` (${verdict.summary.replace(/\s+/g, ' ').slice(0, 200)})` : '') +
        `. Any of these ${functions.length} declared functions may be serving old code. Add the SUPABASE_ACCESS_TOKEN repository secret and re-run this workflow to deploy and verify them all.`
    };
  }
  return {
    ok: false,
    level: 'error',
    message: `NOT DEPLOYED: ${functions.join(', ')}. The Supabase integration ${verdict.state === 'missing' ? 'did not run' : `ended "${verdict.state}"`} on this commit` +
      (verdict.summary ? ` (${verdict.summary.replace(/\s+/g, ' ').slice(0, 200)})` : '') +
      '. Production is still serving the previous code for these functions. Add the SUPABASE_ACCESS_TOKEN repository secret and re-run this workflow, or deploy them by hand.'
  };
}

function epochMs(value) {
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  const n = Number(value);
  if (Number.isFinite(n) && String(value).trim() !== '') return n > 1e12 ? n : n * 1000;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

/* Proof after a CLI deploy, from `supabase functions list -o json`. */
export function verifyDeployed({ functions, declared, listed, startedAt }) {
  const rows = Array.isArray(listed) ? listed : Array.isArray(listed && listed.functions) ? listed.functions : [];
  const bySlug = new Map(rows.map((r) => [r.slug || r.name, r]));
  const since = epochMs(startedAt) - 5000;
  const problems = [];
  const proven = [];
  for (const name of functions) {
    const row = bySlug.get(name);
    if (!row) { problems.push(`${name}: not listed in the project after deploy`); continue; }
    const updated = epochMs(row.updated_at);
    if (!(updated >= since)) problems.push(`${name}: last updated ${Number.isFinite(updated) ? new Date(updated).toISOString() : 'unknown'}, before this deploy started`);
    if (row.status && row.status !== 'ACTIVE') problems.push(`${name}: status ${row.status}`);
    const want = declared.get(name)?.verify_jwt;
    if (typeof row.verify_jwt === 'boolean' && row.verify_jwt !== want) problems.push(`${name}: verify_jwt is ${row.verify_jwt} live but ${want} in supabase/config.toml`);
    if (!problems.some((p) => p.startsWith(`${name}:`))) proven.push({ name, version: row.version ?? null, updated_at: Number.isFinite(updated) ? new Date(updated).toISOString() : null, verify_jwt: row.verify_jwt ?? null });
  }
  return { ok: problems.length === 0, problems, proven };
}

/* ---------- CLI ---------- */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...await walk(rel)); }
    else if (/\.(m?[jt]sx?|json)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

async function repoState() {
  const declared = parseDeclaredFunctions(await readFile(path.join(ROOT, CONFIG), 'utf8'));
  const existing = new Set();
  for (const entry of await readdir(path.join(ROOT, FUNCTIONS_DIR), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === SHARED || entry.name.startsWith('.')) continue;
    try { await stat(path.join(ROOT, FUNCTIONS_DIR, entry.name, 'index.ts')); existing.add(entry.name); } catch { /* not a function */ }
  }
  const sources = new Map();
  for (const file of await walk(FUNCTIONS_DIR)) sources.set(file, await readFile(path.join(ROOT, file), 'utf8'));
  return { declared, existing, sources };
}

function git(args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }

function changedSince(before, after) {
  const zero = !before || /^0+$/.test(before);
  if (!zero) {
    try { git(['cat-file', '-e', `${before}^{commit}`]); return { all: false, paths: git(['diff', '--name-only', before, after]).split('\n').filter(Boolean) }; }
    catch { /* unknown base: deploy everything declared */ }
  }
  return { all: true, paths: [] };
}

async function output(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
async function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}
function annotate(level, message) { console.log(`::${level}::${message.replace(/\r?\n/g, ' ')}`); }

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

async function cmdPlan() {
  const state = await repoState();
  const requested = arg('functions').trim();
  let plan;
  if (requested) {
    const names = requested === 'all' ? [...state.declared.keys()].filter((n) => state.existing.has(n)) : requested.split(/[\s,]+/).filter(Boolean);
    const bad = names.filter((n) => !NAME_RE.test(n) || !state.existing.has(n) || !state.declared.has(n));
    if (bad.length) { annotate('error', `Not a declared function in this checkout: ${bad.join(', ')}`); process.exit(1); }
    plan = { functions: [...new Set(names)].sort(), deleted: [], undeclared: [], reasons: Object.fromEntries(names.map((n) => [n, ['requested']])) };
  } else {
    const after = arg('after', 'HEAD');
    let base = arg('before'), from = 'this push';
    if (arg('base-from-last-success') === 'true') {
      ({ base, from } = chooseBase({
        lastSuccess: await lastSuccessfulPushSha(),
        isAncestor: (sha) => { try { git(['merge-base', '--is-ancestor', sha, after]); return true; } catch { return false; } }
      }));
    }
    console.log(`Planning from ${base ? base.slice(0, 8) : '(none)'}: ${from}.`);
    const diff = changedSince(base, after);
    plan = diff.all
      ? { functions: [...state.declared.keys()].filter((n) => state.existing.has(n)).sort(), deleted: [], undeclared: [], baseline: 'unknown', reasons: { '*': [from.startsWith('no usable baseline') ? from : 'no usable base commit; every declared function'] } }
      : planDeploy({ changedPaths: diff.paths, ...state });
  }
  if (plan.undeclared.length) {
    annotate('error', `Changed but not declared in supabase/config.toml, so a deploy would fall back to the CLI default verify_jwt: ${plan.undeclared.join(', ')}. Declare them first.`);
    process.exit(1);
  }
  for (const name of plan.deleted) annotate('warning', `${name} was removed from the repo. Its deployment stays live until the owner deletes it; this workflow never prunes.`);
  console.log(JSON.stringify(plan, null, 2));
  await output('functions', plan.functions.join(' '));
  await output('count', String(plan.functions.length));
  await output('baseline', plan.baseline || 'known');
  await summary(`### Edge Functions in this push\n\n${plan.functions.length ? plan.functions.map((n) => `- \`${n}\` (${(plan.reasons[n] || plan.reasons['*'] || []).join('; ')})`).join('\n') : 'None.'}\n`);
}

/* The commit of the newest successful push run of this workflow on main.
   Empty when there is none or the API cannot be read, which falls back to
   the push's own `before`. */
async function lastSuccessfulPushSha() {
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN, file = process.env.WORKFLOW_FILE || 'supabase-functions-deploy.yml';
  if (!repo) return '';
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(file)}/runs?branch=main&event=push&status=success&per_page=1`, {
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) }
    });
    if (!res.ok) return '';
    const sha = (((await res.json()).workflow_runs || [])[0] || {}).head_sha || '';
    return /^[0-9a-f]{40}$/.test(sha) ? sha : '';
  } catch { return ''; }
}

async function cmdWait() {
  const sha = arg('sha');
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const started = Date.now();
  const deadline = started + Number(arg('timeout', '600')) * 1000;
  let verdict = { state: 'missing', summary: '' };
  for (;;) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`, {
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) }
      });
      if (res.ok) verdict = integrationVerdict((await res.json()).check_runs);
    } catch { /* transient: poll again */ }
    if (verdict.state !== 'pending' && verdict.state !== 'missing') break;
    // The integration posts its check within a minute when it runs at all.
    if (verdict.state === 'missing' && Date.now() - started > 180000) break;
    if (Date.now() > deadline) { if (verdict.state === 'pending') verdict = { ...verdict, state: 'timed_out' }; break; }
    await new Promise((r) => setTimeout(r, 15000));
  }
  console.log(`Supabase integration on ${sha}: ${verdict.state}${verdict.summary ? ` (${verdict.summary})` : ''}`);
  await writeFile(arg('out'), JSON.stringify(verdict));
  await summary(`### Supabase integration on \`${sha.slice(0, 8)}\`\n\n**${verdict.state}**${verdict.summary ? `: ${verdict.summary.replace(/\s+/g, ' ')}` : ''}\n`);
}

async function cmdGate() {
  const functions = arg('functions').split(/\s+/).filter(Boolean);
  let verdict = { state: 'missing', summary: '' };
  try { verdict = JSON.parse(await readFile(arg('verdict'), 'utf8')); } catch { /* no verdict recorded: treated as missing */ }
  const result = gate({ functions, verdict, hasToken: arg('has-token') === 'true', manual: arg('manual') === 'true', baseline: arg('baseline', 'known') });
  annotate(result.level, result.message);
  await summary(result.ok ? `${result.message}\n` : `**${result.message}**\n`);
  if (!result.ok) process.exit(1);
}

async function cmdVerify() {
  const state = await repoState();
  const functions = arg('functions').split(/\s+/).filter(Boolean);
  let listed;
  const raw = await readFile(arg('list'), 'utf8');
  try { listed = JSON.parse(raw); } catch { annotate('error', `Could not read the function list: ${raw.slice(0, 300)}`); process.exit(1); }
  const result = verifyDeployed({ functions, declared: state.declared, listed, startedAt: arg('started-at') });
  for (const p of result.problems) annotate('error', p);
  await summary(`### Verified live\n\n| Function | Version | Updated | verify_jwt |\n|---|---|---|---|\n${result.proven.map((r) => `| \`${r.name}\` | ${r.version ?? '?'} | ${r.updated_at ?? '?'} | ${r.verify_jwt ?? '?'} |`).join('\n')}\n${result.problems.length ? `\n**Problems:**\n${result.problems.map((p) => `- ${p}`).join('\n')}\n` : ''}`);
  if (!result.ok) process.exit(1);
  console.log(`Verified ${result.proven.length} function(s) live.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commands = { plan: cmdPlan, wait: cmdWait, gate: cmdGate, verify: cmdVerify };
  const command = commands[process.argv[2]];
  if (!command) { console.error(`usage: ${path.basename(process.argv[1])} plan|wait|gate|verify [--options]`); process.exit(2); }
  await command();
}
