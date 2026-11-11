/* The runner aborts the executor's `signal` when a heartbeat finds that another attempt owns the job (audit
   finding C3). An executor calls stopIfLeaseLost right before each outward action (running the coding agent,
   a push, a pull request, a build or a publish, joining a meeting, a message, a public post): once the lease is
   lost the newer attempt owns the job and this one must not act. Writes keyed to the job id de-duplicate
   anyway; this check is what stops the actions that are not. The error carries the code the runner treats as
   a lost lease (core/src/runner.mjs), so the attempt is recorded as abandoned, never as failed or done. */
export function stopIfLeaseLost(job, signal, before) {
  if (!signal?.aborted) return;
  throw Object.assign(new Error(`Lost ownership of job ${job?.id} before ${before}`), { code: 'LEASE_LOST', job_id: job?.id ?? null });
}
