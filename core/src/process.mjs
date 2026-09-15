import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURE = 1024 * 1024;

function childEnv(extra = {}) {
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'CI'];
  const env = {};
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, ...extra };
}

export function run(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: childEnv(options.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: false,
    });

    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-MAX_CAPTURE);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });

    const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    timer.unref();

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const result = {
        cmd,
        args,
        code,
        signal,
        stdout,
        stderr,
        duration_ms: Date.now() - startedAt,
      };
      if (code === 0) return resolve(result);
      const error = new Error(`${cmd} exited with ${code ?? signal ?? 'unknown status'}`);
      error.result = result;
      reject(error);
    });
  });
}

export async function commandExists(cmd) {
  try {
    await run('sh', ['-lc', `command -v "$1" >/dev/null 2>&1`, 'mccluster-core-check', cmd], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}
