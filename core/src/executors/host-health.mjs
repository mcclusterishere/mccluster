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

export async function hostHealth() {
  const [hostname, uptime, disk, memory, runner, broker, reconcileTimer, godot, blender] = await Promise.all([
    run('hostname'),
    run('uptime', ['-p']),
    run('df', ['-h', '/']),
    run('free', ['-h']),
    run('systemctl', ['is-active', 'mccluster-core-runner.service']),
    run('systemctl', ['is-active', 'mccluster-core-tool-broker.service']),
    run('systemctl', ['is-active', 'mccluster-vps-reconcile.timer']),
    run('bash', ['-lc', '${MCCLUSTER_GODOT_BIN:-godot} --version 2>/dev/null || godot4 --version 2>/dev/null || true']),
    run('bash', ['-lc', '${MCCLUSTER_BLENDER_BIN:-blender} --version 2>/dev/null | head -n 1 || true']),
  ]);

  const deployedSha = await textFile('/var/lib/mccluster/reconcile/deployed_sha');
  const lastSuccess = await textFile('/var/lib/mccluster/reconcile/last-success.json');

  return {
    executor: 'host_health:v1',
    summary: `host=${hostname.stdout || 'unknown'} core=${runner.stdout || 'unknown'} broker=${broker.stdout || 'unknown'} reconcile=${reconcileTimer.stdout || 'unknown'}`,
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
    },
    runtime: {
      godot: godot.stdout || null,
      blender: blender.stdout || null,
    },
    deployment: {
      deployed_sha: deployedSha,
      last_success: lastSuccess ? JSON.parse(lastSuccess) : null,
    },
    checked_at: new Date().toISOString(),
  };
}
