import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { rest, recentJobs } from '../supabase.mjs';
import { listNodes } from '../compute/store.mjs';
import {
  SYSTEM_CONTRACT_MIGRATION,
  SYSTEM_HEALTH_SCHEMA,
  aggregateSystemHealth,
  classifyComputeNodes,
  deriveApprovals,
  verifyRecentCompletionEvidence,
} from '../system-health.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY = process.env.MCCLUSTER_CANONICAL_REPOSITORY || 'mcclusterishere/mccluster';
const EDGE_URL = String(process.env.MCCLUSTER_EDGE_URL || 'https://api.mccluster.org').replace(/\/$/, '');

async function run(command, args = [], timeout = 5000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, maxBuffer: 256 * 1024 });
    return { ok: true, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() };
  } catch (error) {
    return { ok: false, stdout: String(error?.stdout || '').trim(), stderr: String(error?.stderr || '').trim(), error: error.message };
  }
}

async function textFile(path) {
  try { return (await readFile(path, 'utf8')).trim(); }
  catch { return null; }
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

function errorText(error) {
  return String(error?.message || error || 'unknown error').slice(0, 500);
}

function ageMs(value, nowMs = Date.now()) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : null;
}

export function haloSnapshotFreshness(snapshot, nowMs = Date.now(), maxAgeMs = 180_000) {
  if (!snapshot || !snapshot.checked_at) return snapshot;
  const checkedAt = Date.parse(snapshot.checked_at);
  if (!Number.isFinite(checkedAt)) return { ...snapshot, stale: true, age_ms: null };
  const snapshotAgeMs = Math.max(0, nowMs - checkedAt);
  return { ...snapshot, stale: snapshotAgeMs > maxAgeMs, age_ms: snapshotAgeMs };
}

async function githubMain() {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'mccluster-core-system-health',
    'x-github-api-version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/main`, {
      headers,
      signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_HEALTH_GITHUB_TIMEOUT_MS || 5000)),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || `GitHub returned ${response.status}`);
    return { repository: REPOSITORY, github_main_sha: body?.sha || null, observed_at: new Date().toISOString(), error: null };
  } catch (error) {
    return { repository: REPOSITORY, github_main_sha: null, observed_at: new Date().toISOString(), error: errorText(error) };
  }
}

async function countRows(table, filters = {}) {
  const params = new URLSearchParams({ select: 'id' });
  for (const [key, value] of Object.entries(filters)) if (value !== null && value !== undefined) params.set(key, String(value));
  const { headers } = await rest(`${table}?${params.toString()}`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
  const match = String(headers.get('content-range') || '').match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function supabaseProjectRef() {
  try { return new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0] || null; }
  catch { return null; }
}

async function supabaseHealth(orgId) {
  try {
    await rest('ops_agent_jobs?select=id&limit=1');
  } catch (error) {
    return { reachable: false, project_ref: supabaseProjectRef(), error: errorText(error), contract: { parity: false, error: 'canonical database unreachable' } };
  }

  let contract;
  try {
    const { body = [] } = await rest('ops_system_contract?singleton=eq.true&select=schema_version,migration_version,updated_at&limit=1');
    const row = body[0] || null;
    contract = {
      schema_version: row?.schema_version || null,
      migration_version: row?.migration_version || null,
      updated_at: row?.updated_at || null,
      parity: row?.schema_version === SYSTEM_HEALTH_SCHEMA && row?.migration_version === SYSTEM_CONTRACT_MIGRATION,
      error: row ? null : 'system contract row missing',
    };
  } catch (error) {
    contract = { schema_version: null, migration_version: null, updated_at: null, parity: false, error: errorText(error) };
  }

  return { reachable: true, project_ref: supabaseProjectRef(), org_id: orgId || null, contract, error: null };
}

async function jobHealth(orgId) {
  if (!orgId) {
    return {
      window_hours: 24,
      counts: { total: null, queued: null, running: null, failed: null, done: null },
      stale_running_count: null,
      retry_exhausted_count: null,
      recent_failures: [],
      evidence: { eligible_done: 0, verified: 0, missing: 0, invalid: 0, coverage: 1, recent_verified: [], problems: [] },
      recent: [],
      error: 'org_id unavailable',
    };
  }

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const staleLock = new Date(Date.now() - 10 * 60_000).toISOString();
  try {
    const [total, queued, running, failed, done, staleRunning, recent] = await Promise.all([
      countRows('ops_agent_jobs', { org_id: `eq.${orgId}` }),
      countRows('ops_agent_jobs', { org_id: `eq.${orgId}`, status: 'eq.queued' }),
      countRows('ops_agent_jobs', { org_id: `eq.${orgId}`, status: 'eq.running' }),
      countRows('ops_agent_jobs', { org_id: `eq.${orgId}`, status: 'eq.failed', updated_at: `gte.${since}` }),
      countRows('ops_agent_jobs', { org_id: `eq.${orgId}`, status: 'eq.done', updated_at: `gte.${since}` }),
      countRows('ops_agent_jobs', { org_id: `eq.${orgId}`, status: 'eq.running', locked_at: `lt.${staleLock}` }),
      recentJobs({ orgId, sinceHours: 24, limit: 100 }),
    ]);
    const evidence = verifyRecentCompletionEvidence(recent);
    const failures = recent.filter((job) => job.status === 'failed');
    return {
      window_hours: 24,
      counts: { total, queued, running, failed, done },
      stale_running_count: staleRunning,
      retry_exhausted_count: failures.filter((job) => Number(job.attempts || 0) >= Number(job.max_attempts || 1)).length,
      recent_failures: failures.slice(0, 12).map((job) => ({ id: job.id, job_type: job.job_type, target_id: job.target_id, attempts: job.attempts, max_attempts: job.max_attempts, last_error: job.last_error, updated_at: job.updated_at })),
      evidence,
      recent,
      error: null,
    };
  } catch (error) {
    return {
      window_hours: 24,
      counts: { total: null, queued: null, running: null, failed: null, done: null },
      stale_running_count: null,
      retry_exhausted_count: null,
      recent_failures: [],
      evidence: { eligible_done: 0, verified: 0, missing: 0, invalid: 0, coverage: 1, recent_verified: [], problems: [] },
      recent: [],
      error: errorText(error),
    };
  }
}

async function communicationsHealth(orgId) {
  if (!orgId) return { schema_ready: false, error: 'org_id unavailable' };
  const now = Date.now();
  const recentCutoff = new Date(now - 24 * 3_600_000).toISOString();
  try {
    const [relayResponse, pendingOutbox, failedOutbox, pausedThreads] = await Promise.all([
      rest(`comms_relay_devices?org_id=eq.${orgId}&select=id,label,enabled,last_seen_at,updated_at&order=updated_at.desc&limit=100`),
      countRows('comms_outbox', { org_id: `eq.${orgId}`, status: 'in.(queued,claimed)' }),
      countRows('comms_outbox', { org_id: `eq.${orgId}`, status: 'eq.failed', updated_at: `gte.${recentCutoff}` }),
      countRows('comms_threads', { org_id: `eq.${orgId}`, mode: 'eq.paused' }),
    ]);
    const relays = relayResponse.body || [];
    const enabled = relays.filter((relay) => relay.enabled === true);
    const stale = enabled.filter((relay) => {
      const seen = ageMs(relay.last_seen_at, now);
      return seen === null || seen > 10 * 60_000;
    });
    return {
      schema_ready: true,
      relay_count: relays.length,
      enabled_relays: enabled.length,
      stale_relays: stale.length,
      pending_outbox: pendingOutbox,
      failed_outbox: failedOutbox,
      paused_threads: pausedThreads,
      relays: relays.map((relay) => ({ id: relay.id, label: relay.label, enabled: relay.enabled, last_seen_at: relay.last_seen_at, age_ms: ageMs(relay.last_seen_at, now) })),
      error: null,
    };
  } catch (error) {
    return { schema_ready: false, relay_count: null, enabled_relays: null, stale_relays: null, pending_outbox: null, failed_outbox: null, paused_threads: null, relays: [], error: errorText(error) };
  }
}

async function computeHealth(orgId) {
  if (!orgId) return { node_count: 0, online: 0, stale_or_offline: 0, status: 'unknown', nodes: [], error: 'org_id unavailable' };
  try { return { ...classifyComputeNodes(await listNodes(orgId)), error: null }; }
  catch (error) { return { node_count: 0, online: 0, stale_or_offline: 0, status: 'unknown', nodes: [], error: errorText(error) }; }
}

async function edgeHealth() {
  const started = Date.now();
  try {
    const response = await fetch(`${EDGE_URL}/v1/health`, { signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_HEALTH_EDGE_TIMEOUT_MS || 5000)) });
    const body = await response.json().catch(() => null);
    return {
      url: `${EDGE_URL}/v1/health`,
      reachable: response.ok && body?.ok === true,
      http_status: response.status,
      latency_ms: Date.now() - started,
      service: body?.service || null,
      deployment_sha: body?.deployment_sha || null,
      deployment_ref: body?.deployment_ref || null,
      supabase_project_ref: body?.supabase_project_ref || null,
      capabilities: body?.capabilities || null,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      url: `${EDGE_URL}/v1/health`,
      reachable: false,
      http_status: null,
      latency_ms: Date.now() - started,
      service: null,
      deployment_sha: null,
      deployment_ref: null,
      supabase_project_ref: null,
      capabilities: null,
      error: errorText(error),
    };
  }
}

export async function hostHealth(job = {}) {
  const orgId = job.org_id || process.env.MCCLUSTER_ORG_ID || null;
  const [hostname, uptime, disk, memory, runner, broker, reconcileTimer, healthTimer, reflectionTimer, portfolioTimer, haloService, haloHealthTimer, godot, blender] = await Promise.all([
    run('hostname'),
    run('uptime', ['-p']),
    run('df', ['-h', '/']),
    run('free', ['-h']),
    run('systemctl', ['is-active', 'mccluster-core-runner.service']),
    run('systemctl', ['is-active', 'mccluster-core-tool-broker.service']),
    run('systemctl', ['is-active', 'mccluster-vps-reconcile.timer']),
    run('systemctl', ['is-active', 'mccluster-core-system-health.timer']),
    run('systemctl', ['is-active', 'mccluster-core-reflection.timer']),
    run('systemctl', ['is-active', 'mccluster-core-portfolio-plan.timer']),
    run('systemctl', ['is-active', 'hitmans-halo.service']),
    run('systemctl', ['is-active', 'hitmans-halo-health.timer']),
    run('bash', ['-lc', '${MCCLUSTER_GODOT_BIN:-godot} --version 2>/dev/null || godot4 --version 2>/dev/null || true']),
    run('bash', ['-lc', '${MCCLUSTER_BLENDER_BIN:-blender} --version 2>/dev/null | head -n 1 || true']),
  ]);

  const [deployedShaText, lastSuccessText, haloHealthText] = await Promise.all([
    textFile('/var/lib/mccluster/reconcile/deployed_sha'),
    textFile('/var/lib/mccluster/reconcile/last-success.json'),
    textFile('/var/lib/hitmans-halo/health/status.json'),
  ]);
  const haloHealth = haloSnapshotFreshness(parseJson(haloHealthText));

  const [source, supabase, jobs, compute, communications, edge] = await Promise.all([
    githubMain(),
    supabaseHealth(orgId),
    jobHealth(orgId),
    computeHealth(orgId),
    communicationsHealth(orgId),
    edgeHealth(),
  ]);

  const services = {
    core_runner: runner.stdout || 'unknown',
    core_tool_broker: broker.stdout || 'unknown',
    vps_reconcile_timer: reconcileTimer.stdout || 'unknown',
    system_health_timer: healthTimer.stdout || 'unknown',
    reflection_timer: reflectionTimer.stdout || 'unknown',
    portfolio_plan_timer: portfolioTimer.stdout || 'unknown',
    hitmans_halo: haloService.stdout || 'unknown',
    hitmans_halo_health_timer: haloHealthTimer.stdout || 'unknown',
  };
  const runtime = { godot: godot.stdout || null, blender: blender.stdout || null, halo: haloHealth };
  const prim3 = {
    status: Boolean(godot.stdout) && Boolean(blender.stdout) && services.hitmans_halo === 'active' && haloHealth?.stale === false ? 'ready' : 'degraded',
    godot_available: Boolean(godot.stdout),
    blender_available: Boolean(blender.stdout),
    halo_service_active: services.hitmans_halo === 'active',
    halo_snapshot_fresh: haloHealth?.stale === false,
    recent_game_failures: jobs.recent.filter((item) => String(item.job_type || '').startsWith('game_') && item.status === 'failed').length,
    detail: { halo_status: haloHealth?.status || services.hitmans_halo, halo_checked_at: haloHealth?.checked_at || null },
  };

  const result = aggregateSystemHealth({
    source,
    host: { hostname: hostname.stdout || null, uptime: uptime.stdout || null, disk_root: disk.stdout || null, memory: memory.stdout || null },
    services,
    runtime,
    deployment: { deployed_sha: deployedShaText, last_success: parseJson(lastSuccessText), halo_sha: haloHealth?.deployment?.sha || null },
    supabase,
    jobs: { ...jobs, recent: undefined },
    compute,
    communications,
    prim3,
    edge,
    approvals: deriveApprovals(jobs.recent),
  });

  return result;
}
