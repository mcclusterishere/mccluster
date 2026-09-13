import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

export function haloSnapshotFreshness(snapshot, nowMs = Date.now(), maxAgeMs = 180_000) {
  if (!snapshot || !snapshot.checked_at) return snapshot;
  const checkedAt = Date.parse(snapshot.checked_at);
  if (!Number.isFinite(checkedAt)) return { ...snapshot, stale: true, age_ms: null };
  const ageMs = Math.max(0, nowMs - checkedAt);
  return { ...snapshot, stale: ageMs > maxAgeMs, age_ms: ageMs };
}

export async function hostHealth() {
  const [hostname, uptime, disk, memory, runner, broker, reconcileTimer, haloService, haloHealthTimer, godot, blender] = await Promise.all([
    run('hostname'),
    run('uptime', ['-p']),
    run('df', ['-h', '/']),
    run('free', ['-h']),
    run('systemctl', ['is-active', 'mccluster-core-runner.service']),
    run('systemctl', ['is-active', 'mccluster-core-tool-broker.service']),
    run('systemctl', ['is-active', 'mccluster-vps-reconcile.timer']),
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
  const haloState = haloHealth?.status || haloService.stdout || 'unknown';

  return {
    executor: 'host_health:v2',
    summary: `host=${hostname.stdout || 'unknown'} core=${runner.stdout || 'unknown'} broker=${broker.stdout || 'unknown'} reconcile=${reconcileTimer.stdout || 'unknown'} halo=${haloState}`,
    host: {
      hostname: hostname.stdout || null,
      uptime: uptime.stdout || null,
      disk_root: disk.stdout || null,
      memory: memory.stdout || null,
    },
    services: {
      core_runner: runner.stdout || 'unknown',
      core_tool_broker: broker.stdout || 'unknown',
      vps_reconcile_timer: reconcileTimer.stdout || 'unknown',
      hitmans_halo: haloService.stdout || 'unknown',
      hitmans_halo_health_timer: haloHealthTimer.stdout || 'unknown',
    },
    runtime: {
      godot: godot.stdout || null,
      blender: blender.stdout || null,
      halo: haloHealth,
    },
    deployment: {
      deployed_sha: deployedShaText,
      last_success: parseJson(lastSuccessText),
      halo_sha: haloHealth?.deployment?.sha || null,
    },
    checked_at: new Date().toISOString(),
  };
}
