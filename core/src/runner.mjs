import { claimNext, completeJob, failJob, heartbeat, workerId } from './supabase.mjs';
import { repoHealth } from './executors/repo-health.mjs';
import { localAnalysis } from './executors/local-analysis.mjs';
import { codePatch } from './executors/code-patch.mjs';

const executors = new Map([
  ['repo_health', repoHealth],
  ['local_analysis', localAnalysis],
  ['code_patch', codePatch],
]);

const pollMs = Math.max(2000, Number(process.env.MCCLUSTER_POLL_MS || 15_000));
const heartbeatMs = Math.max(10_000, Number(process.env.MCCLUSTER_HEARTBEAT_MS || 30_000));
const once = process.argv.includes('--once');
let stopping = false;

function log(event, detail = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, worker_id: workerId, ...detail }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function execute(job) {
  const executor = executors.get(job.job_type);
  if (!executor) throw new Error(`unsupported job type: ${job.job_type}`);
  log('job_started', { job_id: job.id, job_type: job.job_type, target_id: job.target_id, attempt: job.attempts });

  const timer = setInterval(() => {
    heartbeat(job).catch((error) => log('job_heartbeat_failed', { job_id: job.id, message: error.message }));
  }, heartbeatMs);
  timer.unref();

  try {
    const output = await executor(job);
    await completeJob(job, output);
    log('job_completed', { job_id: job.id, job_type: job.job_type, output_summary: output?.summary || output?.executor || null });
  } catch (error) {
    const updated = await failJob(job, error).catch((writeError) => {
      log('job_failure_write_failed', { job_id: job.id, message: writeError.message });
      return null;
    });
    log('job_failed', {
      job_id: job.id,
      job_type: job.job_type,
      status: updated?.status || 'unknown',
      attempt: job.attempts,
      message: error.message,
    });
  } finally {
    clearInterval(timer);
  }
}

async function cycle() {
  const job = await claimNext([...executors.keys()]);
  if (!job) return false;
  await execute(job);
  return true;
}

async function main() {
  log('core_runner_started', { supported_job_types: [...executors.keys()], once });
  if (once) {
    const didWork = await cycle();
    log('core_runner_once_complete', { did_work: didWork });
    return;
  }

  while (!stopping) {
    try {
      const didWork = await cycle();
      if (!didWork) await sleep(pollMs);
    } catch (error) {
      log('core_cycle_failed', { message: error.message });
      await sleep(Math.min(60_000, pollMs * 2));
    }
  }
  log('core_runner_stopped');
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    log('core_runner_stopping', { signal });
  });
}

main().catch((error) => {
  log('core_runner_crashed', { message: error.message, stack: error.stack });
  process.exitCode = 1;
});
