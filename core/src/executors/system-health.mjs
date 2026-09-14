import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { run } from '../process.mjs';
import { rest } from '../supabase.mjs';
import { listNodes } from '../compute/store.mjs';
import { assertCompletionEvidence } from '../completion-evidence.mjs';
import { hostHealth } from './host-health.mjs';
import {
  SYSTEM_HEALTH_SCHEMA,
  assessSystemHealth,
  deriveOutstandingApprovals,
  expectedMigrationFromPaths,
  summarizeGameJobs,
} from '../system-health-policy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(HERE, '..', '..');
const REPO_ROOT = process.env.MCCLUSTER_REPO_ROOT || '/srv/mccluster/repos';
const CANONICAL_REPO = process.env.MCCLUSTER_CANONICAL_REPO || 'mcclusterishere/mccluster';
const CANONICAL_REPO_PATH = process.env.MCCLUSTER_CANONICAL_REPO_PATH || path.join(REPO_ROOT, CANONICAL_REPO.split('/')[1]);
const DEPLOY_REF = process.env.MCCLUSTER_OVH_DEPLOY_REF || 'deploy/ovh-production';
const WORKER_HEALTH_URL = process.env.MCCLUSTER_WORKER_HEALTH_URL || 'https://api.mccluster.org/v1/health';
const EVIDENCE_ENFORCED_SINCE = Date.parse(process.env.MCCLUSTER_EVIDENCE_ENFORCED_SINCE || '2026-09-14T19:12:27Z');
const RELAY_STALE_MS = Number(process.env.MCCLUSTER_COMMS_RELAY_STALE_MS || 10 * 60_000);
const JOB_STALE_MS = Number(process.env.MCCLUSTER_JOB_STALE_MS || 10 * 60_000);

const REQUIRED_PRIM3_CAPABILITIES = [
  'video.generate',
  'model3d.generate',
  'code.build',
  'world.generate',
  'research.web',
  'game.build',
  'deploy.preview',
];

function text(value) {
  return String(value ?? '').trim();
}

function safeDate(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function params(values = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}

async function git(args, timeoutMs = 120_000) {
  const result = await run('git', args, { cwd: CANONICAL_REPO_PATH, timeoutMs });
  return result.stdout.trim();
}

async function countRows(table, filters = {}) {
  const query = params({ ...filters, select: 'id' });
  const { headers } = await rest(`${table}?${query}`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const range = headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

async function rows(table, values = {}) {
  const { body = [] } = await rest(`${table}?${params(values)}`);
  return Array.isArray(body) ? body : [];
}

async function collectSource() {
  const result = {
    canonical_repository: CANONICAL_REPO,
    github_main_sha: null,
    deploy_ref: DEPLOY_REF,
    deploy_ref_sha: null,
    worker_expected_sha: null,
    fetch_ok: false,
    error: null,
    expected_latest_migration: null,
  };

  try {
    await git(['fetch', '--prune', 'origin'], 180_000);
    result.fetch_ok = true;
    result.github_main_sha = await git(['rev-parse', '--verify', 'origin/main']);
    result.deploy_ref_sha = await git(['rev-parse', '--verify', `origin/${DEPLOY_REF}`]).catch(() => null);
    result.worker_expected_sha = await git([
      'log', '-1', '--format=%H', 'origin/main', '--',
      'workers/mccluster', '.github/workflows/deploy-mccluster-worker.yml',
    ]).catch(() => null);
    const migrationPaths = (await git(['ls-tree', '-r', '--name-only', 'origin/main', '--', 'supabase/migrations']).catch(() => ''))
      .split('\n').filter(Boolean);
    result.expected_latest_migration = expectedMigrationFromPaths(migrationPaths);
  } catch (error) {
    result.error = error.message;
    result.github_main_sha = await git(['rev-parse', '--verify', 'origin/main']).catch(() => null);
    result.deploy_ref_sha = await git(['rev-parse', '--verify', `origin/${DEPLOY_REF}`]).catch(() => null);
  }

  return result;
}

async function collectCloudflare(source) {
  const expectedSha = source.worker_expected_sha || null;
  try {
    const response = await fetch(WORKER_HEALTH_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_WORKER_HEALTH_TIMEOUT_MS || 10_000)),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Worker health returned HTTP ${response.status}`);
    const deployedSha = text(body?.deployment_sha) || null;
    return {
      reachable: true,
      url: WORKER_HEALTH_URL,
      deployed_sha: deployedSha,
      deployment_ref: body?.deployment_ref || null,
      expected_sha: expectedSha,
      source_current: expectedSha && deployedSha ? expectedSha === deployedSha : null,
      supabase_project_ref: body?.supabase_project_ref || null,
      capabilities: body?.capabilities || null,
      checked_at: body?.checked_at || new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      url: WORKER_HEALTH_URL,
      deployed_sha: null,
      deployment_ref: null,
      expected_sha: expectedSha,
      source_current: null,
      supabase_project_ref: null,
      capabilities: null,
      checked_at: new Date().toISOString(),
      error: error.message,
    };
  }
}

async function probeMediaModel(providerModelId) {
  try {
    const result = await rows('media_models', {
      provider_model_id: `eq.${providerModelId}`,
      select: 'id',
      limit: '1',
    });
    return result.length > 0;
  } catch {
    return false;
  }
}

async function probeTable(table) {
  try {
    await rows(table, { select: 'id', limit: '1' });
    return true;
  } catch {
    return false;
  }
}

async function collectDatabase(orgId, source) {
  const expected = source.expected_latest_migration || null;
  try {
    await rows('ops_agent_jobs', { org_id: `eq.${orgId}`, select: 'id', limit: '1' });
  } catch (error) {
    return {
      reachable: false,
      error: error.message,
      expected_latest_migration: expected,
      verified_minimum_applied_migration: null,
      migration_parity: null,
      probes: {},
    };
  }

  const probes = {
    communications_beta: await probeTable('comms_relay_devices'),
    fal_text_to_video_seed: await probeMediaModel('fal-ai/kling-video/v2.6/pro/text-to-video'),
    fal_text_to_3d_seed: await probeMediaModel('fal-ai/hunyuan3d-v3/text-to-3d'),
  };

  let verified = null;
  if (probes.communications_beta) {
    verified = { version: '20260913213000', evidence: 'public.comms_relay_devices relation exists' };
  } else if (probes.fal_text_to_video_seed) {
    verified = { version: '20260913182810', evidence: 'Kling Video 2.6 seed row exists' };
  } else if (probes.fal_text_to_3d_seed) {
    verified = { version: '20260913182443', evidence: 'Hunyuan3D V3 seed row exists' };
  }

  let migrationParity = null;
  if (expected?.version === '20260913213000') {
    migrationParity = probes.communications_beta;
  } else if (expected?.version === '20260913182810') {
    migrationParity = probes.fal_text_to_video_seed;
  } else if (expected?.version === '20260913182443') {
    migrationParity = probes.fal_text_to_3d_seed;
  }

  return {
    reachable: true,
    error: null,
    expected_latest_migration: expected,
    verified_minimum_applied_migration: verified,
    migration_parity: migrationParity,
    probes,
  };
}

function evidenceSummary(jobs) {
  const done = jobs.filter((item) => item?.status === 'done' && item?.job_type !== 'system_health');
  const recent = [];
  let verified = 0;
  let unverified = 0;
  let postContractUnverified = 0;

  for (const item of done.slice(0, 40)) {
    let valid = false;
    let error = null;
    try {
      assertCompletionEvidence(item, item.output);
      valid = true;
      verified += 1;
    } catch (currentError) {
      unverified += 1;
      error = currentError.message;
      const updatedMs = safeDate(item.updated_at);
      if (updatedMs != null && updatedMs >= EVIDENCE_ENFORCED_SINCE) postContractUnverified += 1;
    }
    recent.push({
      id: item.id,
      job_type: item.job_type,
      target_id: item.target_id,
      updated_at: item.updated_at || null,
      verified: valid,
      result_sha256: item?.output?.completion_evidence?.result_sha256 || null,
      error,
    });
  }

  return {
    contract: 'mccluster-completion-evidence/v1',
    enforced_since: new Date(EVIDENCE_ENFORCED_SINCE).toISOString(),
    sampled: recent.length,
    verified,
    unverified,
    post_contract_unverified: postContractUnverified,
    recent: recent.slice(0, 15),
  };
}

async function collectJobs(orgId) {
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60_000).toISOString();
  const since7d = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
  const staleBefore = new Date(now - JOB_STALE_MS).toISOString();

  const recent = await rows('ops_agent_jobs', {
    org_id: `eq.${orgId}`,
    updated_at: `gte.${since7d}`,
    select: 'id,job_type,target_type,target_id,status,priority,input,output,attempts,max_attempts,run_after,locked_at,locked_by,last_error,created_at,updated_at',
    order: 'updated_at.desc',
    limit: '200',
  });

  const [queued, running, failed, staleRunning] = await Promise.all([
    countRows('ops_agent_jobs', { org_id: `eq.${orgId}`, status: 'eq.queued' }),
    countRows('ops_agent_jobs', { org_id: `eq.${orgId}`, status: 'eq.running' }),
    countRows('ops_agent_jobs', { org_id: `eq.${orgId}`, status: 'eq.failed', updated_at: `gte.${since24h}` }),
    countRows('ops_agent_jobs', { org_id: `eq.${orgId}`, status: 'eq.running', locked_at: `lt.${staleBefore}` }),
  ]);

  const recentFailures = recent
    .filter((item) => item.status === 'failed' && (safeDate(item.updated_at) || 0) >= Date.parse(since24h))
    .slice(0, 12)
    .map((item) => ({ id: item.id, job_type: item.job_type, target_id: item.target_id, last_error: item.last_error, updated_at: item.updated_at }));
  const done = recent.filter((item) => item.status === 'done');

  return {
    queued,
    running,
    failed,
    stale_running: staleRunning,
    recent_failures: recentFailures,
    evidence: evidenceSummary(recent),
    recent_autonomy: done.slice(0, 12).map((item) => ({
      id: item.id,
      job_type: item.job_type,
      target_id: item.target_id,
      updated_at: item.updated_at,
      executor: item?.output?.executor || null,
      summary: item?.output?.summary || null,
      result_sha256: item?.output?.completion_evidence?.result_sha256 || null,
      evidence_verified: Boolean(item?.output?.completion_evidence),
    })),
    recent,
  };
}

async function collectCompute(orgId) {
  try {
    const nodes = await listNodes({ orgId, liveOnly: false, limit: 100 });
    const now = Date.now();
    const live = nodes.filter((node) => node?.state === 'online' && safeDate(node?.last_seen_at) != null && now - safeDate(node.last_seen_at) <= 180_000);
    return {
      available: true,
      configured: nodes.length,
      live: live.length,
      stale: nodes.filter((node) => node?.state === 'online' && !live.includes(node)).length,
      quarantined: nodes.filter((node) => node?.state === 'quarantined').length,
      nodes: nodes.slice(0, 20).map((node) => ({
        node_id: node.node_id,
        state: node.state,
        last_seen_at: node.last_seen_at,
        engine: node.engine,
        capabilities: node.capabilities,
      })),
    };
  } catch (error) {
    return { available: false, configured: 0, live: 0, stale: 0, quarantined: 0, nodes: [], error: error.message };
  }
}

async function collectCommunications(orgId) {
  try {
    const relays = await rows('comms_relay_devices', {
      org_id: `eq.${orgId}`,
      select: 'id,label,phone_number,enabled,last_seen_at,updated_at',
      order: 'last_seen_at.desc.nullslast',
      limit: '50',
    });
    const now = Date.now();
    const enabled = relays.filter((item) => item.enabled === true);
    const live = enabled.filter((item) => {
      const seen = safeDate(item.last_seen_at);
      return seen != null && now - seen <= RELAY_STALE_MS;
    });
    const pausedThreads = await rows('comms_threads', {
      org_id: `eq.${orgId}`,
      mode: 'eq.paused',
      select: 'id,contact_id,relay_device_id,mode,updated_at',
      order: 'updated_at.desc',
      limit: '20',
    });
    const [queued, claimed, failed] = await Promise.all([
      countRows('comms_outbox', { org_id: `eq.${orgId}`, status: 'eq.queued' }),
      countRows('comms_outbox', { org_id: `eq.${orgId}`, status: 'eq.claimed' }),
      countRows('comms_outbox', { org_id: `eq.${orgId}`, status: 'eq.failed' }),
    ]);
    return {
      schema_present: true,
      configured: enabled.length > 0,
      enabled_relays: enabled.length,
      live_relays: live.length,
      stale_relays: enabled.length - live.length,
      relays: enabled.slice(0, 20).map((item) => ({ id: item.id, label: item.label, last_seen_at: item.last_seen_at })),
      paused_threads: pausedThreads,
      outbox_queued: queued,
      outbox_claimed: claimed,
      outbox_failed: failed,
      error: null,
    };
  } catch (error) {
    return {
      schema_present: false,
      configured: false,
      enabled_relays: 0,
      live_relays: 0,
      stale_relays: 0,
      relays: [],
      paused_threads: [],
      outbox_queued: null,
      outbox_claimed: null,
      outbox_failed: null,
      error: error.message,
    };
  }
}

async function catalogReadiness() {
  try {
    const file = path.join(CORE_ROOT, 'capabilities', 'catalog.json');
    const catalog = JSON.parse(await readFile(file, 'utf8'));
    const capabilities = new Map((catalog.capabilities || []).map((item) => [item.id, item]));
    const bindings = Array.isArray(catalog.bindings) ? catalog.bindings : [];
    const missing = [];
    for (const id of REQUIRED_PRIM3_CAPABILITIES) {
      const capability = capabilities.get(id);
      const activeBinding = bindings.some((binding) => binding.capability === id && binding.status === 'active');
      if (capability?.lifecycle !== 'active' || !activeBinding) missing.push(id);
    }
    return { ok: missing.length === 0, required: REQUIRED_PRIM3_CAPABILITIES, missing, catalog_version: catalog.catalogVersion || null };
  } catch (error) {
    return { ok: false, required: REQUIRED_PRIM3_CAPABILITIES, missing: REQUIRED_PRIM3_CAPABILITIES, catalog_version: null, error: error.message };
  }
}

async function collectPrim3(host, jobs) {
  const gameJobs = summarizeGameJobs(jobs);
  const catalog = await catalogReadiness();
  const godot = text(host?.runtime?.godot);
  const haloService = text(host?.services?.['hitmans-halo.service']);
  const halo = host?.game_runtime?.hitmans_halo || null;
  const haloFresh = halo?.fresh === true;
  const ready = Boolean(godot) && haloService === 'active' && haloFresh && catalog.ok && gameJobs.failed === 0;
  return {
    ready,
    readiness: {
      godot_available: Boolean(godot),
      hitmans_halo_service_active: haloService === 'active',
      hitmans_halo_snapshot_fresh: haloFresh,
      capability_catalog_ready: catalog.ok,
      recent_game_failures: gameJobs.failed,
    },
    godot_version: godot || null,
    hitmans_halo: halo,
    capability_catalog: catalog,
    jobs: gameJobs,
  };
}

export async function systemHealth(job) {
  if (!job.org_id) throw new Error('system_health requires org_id');

  const checkedAt = new Date().toISOString();
  const host = await hostHealth({ ...job, job_type: 'host_health' }).catch((error) => ({
    executor: 'host_health:v2',
    host: { hostname: null },
    services: {},
    runtime: {},
    deployment: { deployed_sha: null },
    game_runtime: { hitmans_halo: null },
    checked_at: checkedAt,
    error: error.message,
  }));

  const source = await collectSource();
  const [cloudflare, database, jobState, compute, communications] = await Promise.all([
    collectCloudflare(source),
    collectDatabase(job.org_id, source),
    collectJobs(job.org_id),
    collectCompute(job.org_id),
    collectCommunications(job.org_id),
  ]);

  const prim3 = await collectPrim3(host, jobState.recent);
  const approvals = deriveOutstandingApprovals(jobState.recent, communications);
  const core = {
    host: host.host || null,
    services: host.services || {},
    runtime: host.runtime || {},
    deployed_sha: host?.deployment?.deployed_sha || null,
    reconcile_last_success: host?.deployment?.last_success || null,
    deployment_manifest: host?.deployment?.manifest || null,
    checked_at: host.checked_at || checkedAt,
    error: host.error || null,
  };

  const observed = {
    source,
    core,
    cloudflare,
    database,
    jobs: {
      queued: jobState.queued,
      running: jobState.running,
      failed: jobState.failed,
      stale_running: jobState.stale_running,
      recent_failures: jobState.recent_failures,
      evidence: jobState.evidence,
      recent_autonomy: jobState.recent_autonomy,
    },
    compute,
    communications,
    prim3,
    approvals,
  };
  const assessment = assessSystemHealth(observed);

  return {
    executor: 'system_health:v1',
    schema_version: SYSTEM_HEALTH_SCHEMA,
    status: assessment.status,
    summary: `McCluster system health is ${assessment.status}: ${assessment.issues.length} issue(s), ${approvals.count} owner approval(s) pending.`,
    checked_at: checkedAt,
    components: assessment.components,
    issues: assessment.issues,
    source,
    core,
    cloudflare,
    database,
    jobs: observed.jobs,
    compute,
    communications,
    prim3,
    approvals,
  };
}
