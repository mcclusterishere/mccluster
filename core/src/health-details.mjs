import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const exec = promisify(execFile);
const iso = value => new Date(value).toISOString();
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const code = error => String(error?.code || error?.cause?.code || error?.name || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64);

// Scan failures independently of the high-frequency health/evidence sample.
// Bounded pagination is explicit: never label a truncated scan as an exact count.
export async function failureDetails(rest, orgId, nowMs = Date.now(), maxRows = 2000) {
  const rows = [];
  let expected = null;
  let stable = true;
  let ended = false;
  try {
    for (let offset = 0; offset < maxRows; offset += 100) {
      const query = new URLSearchParams({
        org_id: `eq.${orgId}`, status: 'eq.failed',
        and: `(updated_at.gte.${iso(nowMs - 86400000)},updated_at.lte.${iso(nowMs)})`,
        select: 'id,job_type,target_id,attempts,max_attempts,last_error,updated_at',
        order: 'updated_at.desc,id.desc', limit: String(Math.min(100, maxRows - offset)), offset: String(offset),
      });
      const {body, headers} = await rest(`ops_agent_jobs?${query}`, {headers: {Prefer: 'count=exact'}});
      if (!Array.isArray(body)) throw new Error('InvalidFailureResponse');
      const match = String(headers?.get('content-range') || '').match(/\/(\d+)$/);
      const total = match ? Number(match[1]) : null;
      if (offset === 0) expected = total;
      else if (expected !== total) stable = false;
      rows.push(...body);
      if (body.length < Math.min(100, maxRows - offset) || (total !== null && rows.length >= total)) { ended = true; break; }
    }
    const unique = [...new Map(rows.map(row => [row.id, row])).values()];
    const complete = stable && ended && expected !== null && unique.length === expected && rows.length === unique.length;
    const exhausted = unique.filter(row => Number(row.attempts || 0) >= Math.max(1, Number(row.max_attempts || 1))).length;
    return {sampled_at: iso(nowMs), window_hours: 24, complete, matched_count: expected, scanned_count: unique.length,
      retry_exhausted_count: complete ? exhausted : null, retry_exhausted_lower_bound: exhausted,
      recent_failures: unique.slice(0, 12), error: complete ? null : 'failure_detail_scan_incomplete'};
  } catch (error) {
    return {sampled_at: iso(nowMs), window_hours: 24, complete: false, scanned_count: rows.length,
      retry_exhausted_count: null, recent_failures: [], error: code(error)};
  }
}

async function commandProbe(command, args = []) {
  try {
    const {stdout} = await exec(command, args, {timeout: 5000, maxBuffer: 16384});
    return {ok: true, stdout: String(stdout).trim().slice(0, 1500), error: null};
  } catch (error) {
    return {ok: false, stdout: String(error.stdout || '').trim().slice(0, 1500), error: code(error),
      stderr: String(error.stderr || '').trim().slice(0, 300)};
  }
}

export async function jsonFileProbe(path, read = readFile) {
  try {
    const raw = await read(path, 'utf8');
    if (Buffer.byteLength(raw) > 65536) return {ok: false, error: 'snapshot_too_large'};
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {ok: false, error: 'snapshot_invalid_object'};
    return {ok: true, error: null, checked_at: typeof value.checked_at === 'string' ? value.checked_at.slice(0, 40) : null,
      status: typeof value.status === 'string' ? value.status.slice(0, 40) : null};
  } catch (error) { return {ok: false, error: code(error)}; }
}

export async function healthProbe(url, fetchImpl = globalThis.fetch) {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(5000)});
    const body = await response.json().catch(() => null);
    return {observed_at: iso(Date.now()), http_status: response.status, latency_ms: Date.now() - started,
      ok: response.ok && body?.ok === true, service: typeof body?.service === 'string' ? body.service.slice(0, 80) : null,
      deployment_sha: /^[a-f0-9]{40}$/i.test(body?.deployment_sha || '') ? body.deployment_sha : null,
      busy: typeof body?.busy === 'boolean' ? body.busy : null, queue_depth: number(body?.queue_depth),
      last_started_at: typeof body?.last_started_at === 'string' ? body.last_started_at.slice(0, 40) : null,
      last_completed_at: typeof body?.last_completed_at === 'string' ? body.last_completed_at.slice(0, 40) : null,
      last_error_present: Boolean(body?.last_error), error: body ? null : 'invalid_json'};
  } catch (error) {
    return {observed_at: iso(Date.now()), http_status: null, ok: null, deployment_sha: null,
      latency_ms: Date.now() - started, verification: 'unverified', error: code(error)};
  }
}

export async function runtimeDiagnostics({command = commandProbe, read = readFile, fetchImpl = globalThis.fetch} = {}) {
  const [user, blender, timer, haloService, file, local, publicCore, adapter] = await Promise.all([
    command('id', ['-un']),
    command(process.env.MCCLUSTER_BLENDER_BIN || 'blender', ['--version']),
    command('systemctl', ['show', 'hitmans-halo-health.timer', '--property=LoadState,ActiveState,UnitFileState,FragmentPath', '--no-pager']),
    command('systemctl', ['show', 'hitmans-halo-health.service', '--property=LoadState,ActiveState,Result,ExecMainStatus,User,Group', '--no-pager']),
    jsonFileProbe('/var/lib/hitmans-halo/health/status.json', read),
    healthProbe('http://127.0.0.1:4777/health', fetchImpl),
    healthProbe('https://core.mccluster.org/health', fetchImpl),
    healthProbe('http://127.0.0.1:4790/health', fetchImpl),
  ]);
  return {service_user: user.ok ? user.stdout : null, blender, halo_health_timer: timer,
    halo_health_service: haloService, halo_snapshot: file, local_core: local, public_core: publicCore, local_ai: adapter};
}

export function healthSections(snapshot) {
  const warnings = Array.isArray(snapshot.degradation) ? snapshot.degradation : [];
  const infrastructureCodes = new Set(['core', 'deployment', 'source', 'supabase', 'edge', 'compute', 'evidence']);
  const issues = warnings.filter(item => infrastructureCodes.has(item.component));
  const known = snapshot.services?.core_runner === 'active' && snapshot.services?.core_tool_broker === 'active'
    && snapshot.supabase?.reachable === true && snapshot.supabase?.migration_attestation?.parity === true
    && snapshot.deployment?.sha_match === true && snapshot.edge?.reachable === true;
  const infrastructure = {status: issues.some(item => item.severity === 'critical') ? 'fail' : issues.length ? 'degraded' : known ? 'ok' : 'unverified',
    scope: 'core_services_deployment_database_edge_compute', issues};
  const counts = snapshot.jobs?.counts || {};
  const workloads = {status: snapshot.jobs?.error ? 'unverified' : Number(counts.failed) > 0 || Number(snapshot.jobs?.stale_running_count) > 0 ? 'degraded' : number(counts.failed) === null ? 'unverified' : 'ok',
    window_hours: 24, failed: counts.failed ?? null, retry_exhausted_count: snapshot.jobs?.retry_exhausted_count ?? null,
    details_complete: snapshot.jobs?.failure_details?.complete === true};
  const comms = snapshot.communications || {};
  const communications = {status: comms.schema_ready !== true ? 'unverified'
    : Number(comms.pending_outbox) > 0 && Number(comms.enabled_relays) === 0 ? 'degraded'
    : Number(comms.failed_outbox) > 0 || Number(comms.stale_relays) > 0 ? 'degraded'
    : comms.relay_count === 0 ? 'not_configured' : comms.enabled_relays === 0 ? 'disabled' : 'ready',
    registered: comms.relay_count ?? null, enabled: comms.enabled_relays ?? null};
  return {infrastructure, workloads, capabilities: {communications, studio: {status: snapshot.prim3?.status || 'unverified'}}};
}

export async function enrichHostHealth(snapshot, {rest, orgId, diagnostics = runtimeDiagnostics} = {}) {
  const [failures, probes] = await Promise.all([
    orgId ? failureDetails(rest, orgId) : Promise.resolve({complete: false, retry_exhausted_count: null, recent_failures: [], error: 'org_id_unavailable'}),
    diagnostics(),
  ]);
  const result = {...snapshot, jobs: {...snapshot.jobs, retry_exhausted_count: failures.retry_exhausted_count,
    recent_failures: failures.recent_failures, failure_details: failures}, runtime_checks: probes};
  result.health_sections = healthSections(result);
  // Preserve the aggregate warning status and all historical failures. Sections
  // explain the scope; they do not turn unconfigured capabilities into successes.
  result.summary = `${snapshot.summary} infrastructure=${result.health_sections.infrastructure.status} workloads=${result.health_sections.workloads.status} communications=${result.health_sections.capabilities.communications.status} studio=${result.health_sections.capabilities.studio.status}`;
  return result;
}
