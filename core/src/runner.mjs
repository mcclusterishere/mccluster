import { claimNext, completeJob, failJob, heartbeat, workerId } from './supabase.mjs';
import { prepareClaimedDagJob } from './objective-dag-store.mjs';
import { notifyJobFailure, notifyJobSuccess } from './notifier.mjs';
import { repoHealth } from './executors/repo-health.mjs';
import { localAnalysis } from './executors/local-analysis.mjs';
import { codePatch } from './executors/code-patch.mjs';
import { objectiveReflection } from './executors/objective-reflection.mjs';
import { objectivePlan } from './executors/objective-plan.mjs';
import { objectiveSynthesis } from './executors/objective-synthesis.mjs';
import { portfolioPlan } from './executors/portfolio-plan.mjs';
import { gameBuildPlan } from './executors/game-build-plan.mjs';
import { gamePlaytest } from './executors/game-playtest.mjs';
import { gameStudioCycle, gameMediaCollect, gameOwnerDecision, gameImplementationCollect } from './executors/game-studio-cycle.mjs';
import { gameBranchSmoke } from './executors/game-branch-smoke.mjs';
import { gameReleaseDecision } from './executors/game-release-decision.mjs';
import { previewDeploy } from './executors/preview-deploy.mjs';
import { hostHealth } from './executors/host-health.mjs';
import { smsAssistantTurn } from './executors/sms-assistant-turn.mjs';

const executors = new Map([
  ['repo_health', repoHealth],
  ['local_analysis', localAnalysis],
  ['code_patch', codePatch],
  ['objective_reflection', objectiveReflection],
  ['objective_plan', objectivePlan],
  ['objective_synthesis', objectiveSynthesis],
  ['portfolio_plan', portfolioPlan],
  ['game_build_plan', gameBuildPlan],
  ['game_playtest', gamePlaytest],
  ['game_studio_cycle', gameStudioCycle],
  ['game_media_collect', gameMediaCollect],
  ['game_owner_decision', gameOwnerDecision],
  ['game_implementation_collect', gameImplementationCollect],
  ['game_branch_smoke', gameBranchSmoke],
  ['game_release_decision', gameReleaseDecision],
  ['preview_deploy', previewDeploy],
  ['host_health', hostHealth],
  ['sms_assistant_turn', smsAssistantTurn],
]);

const pollMs = Math.max(2000, Number(process.env.MCCLUSTER_POLL_MS || 15_000));
const heartbeatMs = Math.max(10_000, Number(process.env.MCCLUSTER_HEARTBEAT_MS || 30_000));
const once = process.argv.includes('--once');
let stopping = false;

function log(event, detail = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, worker_id: workerId, ...detail }));
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function safeNotify(event, fn) {
  try {
    const result = await fn();
    log(event, { sent: result?.sent === true, reason: result?.reason || null, sid: result?.sid || null });
  } catch (error) {
    log(`${event}_failed`, { message: error.message });
  }
}

async function execute(job) {
  const executor = executors.get(job.job_type);
  if (!executor) throw new Error(`unsupported job type: ${job.job_type}`);
  log('job_started', { job_id: job.id, job_type: job.job_type, target_id: job.target_id, attempt: job.attempts });
  const timer = setInterval(() => { heartbeat(job).catch((error) => log('job_heartbeat_failed', { job_id: job.id, message: error.message })); }, heartbeatMs);
  timer.unref();
  try {
    const output = await executor(job);
    await completeJob(job, output);
    log('job_completed', { job_id: job.id, job_type: job.job_type, output_summary: output?.summary || output?.executor || null });
    await safeNotify('owner_sms', () => notifyJobSuccess(job, output));
  } catch (error) {
    const updated = await failJob(job, error).catch((writeError) => { log('job_failure_write_failed', { job_id: job.id, message: writeError.message }); return null; });
    const status = updated?.status || 'unknown';
    log('job_failed', { job_id: job.id, job_type: job.job_type, status, attempt: job.attempts, message: error.message });
    await safeNotify('owner_sms_alert', () => notifyJobFailure(job, error, status));
  } finally { clearInterval(timer); }
}

async function cycle() {
  const claimed = await claimNext([...executors.keys()]);
  if (!claimed) return false;

  const prepared = await prepareClaimedDagJob(claimed);
  if (prepared.action === 'waiting') {
    log('job_dependency_wait', {
      job_id: claimed.id,
      dependency_ids: prepared.dependency?.dependency_ids || [],
      pending_ids: prepared.dependency?.pending_ids || prepared.dependency?.missing_ids || [],
    });
    return true;
  }
  if (prepared.action === 'blocked') {
    log('job_dependency_failed', {
      job_id: claimed.id,
      failed_ids: prepared.dependency?.failed_ids || [],
    });
    return true;
  }

  await execute(prepared.job);
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
  process.on(signal, () => { stopping = true; log('core_runner_stopping', { signal }); });
}

main().catch((error) => {
  log('core_runner_crashed', { message: error.message, stack: error.stack });
  process.exitCode = 1;
});
