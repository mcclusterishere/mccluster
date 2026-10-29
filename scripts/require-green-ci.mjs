#!/usr/bin/env node
/* A production deploy waits for CI on the exact commit it ships.

   Reads the required check names from docs/control-plane/deploy-gate.json
   and polls GitHub's check runs for one SHA until every required check has
   concluded `success` (pass), any has concluded anything else (fail), or the
   timeout runs out (fail). A check that never appears is a failure at the
   timeout, never a pass: absence of evidence does not ship.

     node scripts/require-green-ci.mjs --sha <40-hex> [--timeout 2700] [--poll 20]

   Needs GITHUB_TOKEN with checks:read and GITHUB_REPOSITORY. Read-only:
   it never re-runs, approves or changes anything. */
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GATE = JSON.parse(readFileSync(path.join(ROOT, 'docs/control-plane/deploy-gate.json'), 'utf8'));

/* The newest run of each name decides it: a re-run that passes supersedes
   an earlier failure of the same check on the same commit. */
export function evaluate(checkRuns, required = GATE.required_checks_on_main_sha) {
  const latest = new Map();
  for (const run of checkRuns) {
    if (!required.includes(run.name)) continue;
    const prev = latest.get(run.name);
    const key = (r) => `${r.started_at || ''}#${String(r.id).padStart(20, '0')}`;
    if (!prev || key(run) > key(prev)) latest.set(run.name, run);
  }
  const missing = [], pending = [], failed = [], passed = [];
  for (const name of required) {
    const run = latest.get(name);
    if (!run) missing.push(name);
    else if (run.status !== 'completed') pending.push(name);
    else if (run.conclusion === 'success') passed.push(name);
    else failed.push(`${name}=${run.conclusion}`);
  }
  const state = failed.length ? 'failure' : (missing.length || pending.length) ? 'pending' : 'success';
  return { state, missing, pending, failed, passed };
}

async function checkRuns(repo, sha, token) {
  const runs = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`GitHub check-runs API answered ${res.status}`);
    const body = await res.json();
    runs.push(...(body.check_runs || []));
    if (!body.check_runs || body.check_runs.length < 100) break;
  }
  return runs;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const sha = arg('sha', process.env.TARGET_SHA || '');
  const timeout = Number(arg('timeout', GATE.timeout_seconds));
  const poll = Number(arg('poll', GATE.poll_seconds));
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('--sha must be an exact 40-character commit SHA');
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const deadline = Date.now() + timeout * 1000;
  let verdict;
  for (;;) {
    verdict = evaluate(await checkRuns(repo, sha, token));
    console.log(`${sha}: ${verdict.state} passed=[${verdict.passed}] pending=[${verdict.pending}] missing=[${verdict.missing}] failed=[${verdict.failed}]`);
    if (verdict.state !== 'pending' || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, poll * 1000));
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### CI gate for \`${sha}\`\n- state: **${verdict.state}**\n- passed: ${verdict.passed.join(', ') || 'none'}\n- failed: ${verdict.failed.join(', ') || 'none'}\n- not finished: ${[...verdict.pending, ...verdict.missing].join(', ') || 'none'}\n`);
  }
  if (verdict.state !== 'success') {
    console.error(`Refusing to deploy ${sha}: required CI is ${verdict.state === 'pending' ? 'not green within the timeout' : 'red'}.`);
    process.exit(1);
  }
  console.log(`Required CI is green on ${sha}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
