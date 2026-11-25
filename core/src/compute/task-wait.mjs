// Bounded wait for a durable compute task, shared by the Core's browser_act
// tool (and reusable by the fabric client). Done returns the task; failed or
// canceled throws COMPUTE_TASK_FAILED; past the deadline a task that is still
// queued (or whose status is unknown) is taken back with the atomic cancel and
// COMPUTE_TASK_TIMEOUT is thrown either way, never leaving a second runner.
import { cancelQueuedComputeTask, computeTaskById } from './store.mjs';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function awaitComputeTask({ orgId, taskId, deadlineMs = 150_000, pollMs = 1_500 } = {}, dependencies = {}) {
  const read = dependencies.computeTaskById || computeTaskById;
  const cancel = dependencies.cancelQueuedComputeTask || cancelQueuedComputeTask;
  const now = dependencies.now || Date.now;
  const sleep = dependencies.sleep || defaultSleep;
  if (!orgId || !taskId) throw Object.assign(new Error('orgId and taskId are required'), { status: 400, code: 'COMPUTE_TASK_INVALID', retryable: false });
  const started = now();
  const deadline = started + Math.max(1_000, Number(deadlineMs) || 150_000);
  const poll = Math.max(100, Math.min(10_000, Number(pollMs) || 1_500));
  let lastStatus = 'queued';
  let polls = 0;
  let failedReads = 0;
  while (true) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(poll, remaining));
    let task = null;
    try { task = await read({ orgId, taskId }); } catch { task = null; }
    polls += 1;
    if (!task) {
      failedReads += 1;
      if (failedReads >= 3) lastStatus = 'unknown';
      continue;
    }
    failedReads = 0;
    lastStatus = String(task.status || 'unknown');
    if (task.status === 'done') return { task, waitMs: now() - started, polls };
    if (task.status === 'failed' || task.status === 'canceled') {
      const lastError = task.last_error == null ? null : String(task.last_error).slice(0, 1000);
      throw Object.assign(new Error(`compute task ${task.status}${lastError ? `: ${lastError.slice(0, 300)}` : ''}`), {
        status: 502, code: 'COMPUTE_TASK_FAILED', retryable: false, task_id: taskId, task_status: task.status, last_error: lastError
      });
    }
  }
  let canceled = false;
  if (lastStatus === 'queued' || lastStatus === 'unknown') {
    try { canceled = Boolean(await cancel({ orgId, taskId, reason: 'canceled: wait deadline passed' })); }
    catch { canceled = false; }
  }
  throw Object.assign(new Error(`compute task ${taskId} did not finish within ${deadline - started} ms (status ${lastStatus}${canceled ? ', canceled while queued' : ''})`), {
    status: 504, code: 'COMPUTE_TASK_TIMEOUT', retryable: false, task_id: taskId, task_status: lastStatus, canceled
  });
}
