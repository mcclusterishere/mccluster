/* Recovery for paid media operations: what a person and the cron do about a
   job the normal path could not finish (audit 2026-11-09, C5, recovery lane).

   The router (./router.js) never guesses: a submit whose outcome is unknown
   keeps its reservation, and a reservation is released only on a definite
   provider answer, a definite failure before any provider request, or a
   recorded operator decision. This module is the other half:

   - THE OPERATOR SURFACE. GET /v1/media/recovery lists what is stuck, by
     class, with the next action for each; POST /v1/media/jobs/:id/reconcile
     records one decision (release, settle, bind). Both are for the house
     operator only, whatever organization the job belongs to: the house
     owner's own session, or McCluster Core's verified signature (which acts
     as that owner), on these routes and on the MCP tools alike. The
     decision is bound to the job's organization in SQL and written to the
     audit ledger BEFORE it runs.
   - THE CRON SWEEP. Polls open jobs the webhook has not finished, parks a
     submit marker nobody completed, and records the candidate counts as
     evidence. It moves money only where the provider itself answered.

   The same two operations are MCP tools (./mcp.js: media.recovery.list,
   media.job.reconcile). Database functions:
   supabase/pending/media_operation_claims_v2.sql. */

import { recordEvent } from '../lib/observability.js';
import { recordAudit } from '../lib/audit.js';
import { requireOrgId } from '../social/security.js';
import { houseOwnerActor } from './core-signature.js';
import { CAS_UNCERTAIN, db, jobById, patchJobWhere, pollProviderStatus, rpc, verifyWebhookHint } from './router.js';

export { verifyWebhookHint };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = ['release', 'settle', 'bind'];
const PROVIDER_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_EVIDENCE_CHARS = 8000;
/* The sweep polls an open job the webhook has left alone this long. */
const POLL_AFTER_MS = 5 * 60 * 1000;
/* A 'submitting' marker this old belongs to an isolate that is gone. */
const SUBMIT_MARKER_STALE_MS = 10 * 60 * 1000;
/* Classes a person has to act on; the others resolve by retry or polling. */
const NEEDS_A_PERSON = ['reserved_never_submitted', 'submit_outcome_unknown', 'failed_still_reserved', 'billed_while_failed'];

function httpError(status, message, reason, detail) {
  return Object.assign(new Error(message), { status, reason, detail });
}

function isMissingFunction(error) {
  const code = error?.detail?.code;
  return code === 'PGRST202' || code === '42883';
}

function recoveryUnavailable() {
  return httpError(503, 'Media recovery is unavailable: supabase/pending/media_operation_claims_v2.sql is not applied', 'recovery_unavailable');
}

/* The house operator: the one house owner, in person or as McCluster Core's
   verified signature (which acts as that same owner, ./core-signature.js).
   Checked here, inside the handler, for the REST routes and the MCP tools
   alike. The actor's id must BE the house owner's id either way, so nothing
   rests on a flag a caller could carry. */
export async function assertHouseOperator(env, user) {
  if (!user?.id) throw httpError(401, 'Authentication required');
  const owner = await houseOwnerActor(env);
  if (owner.id !== user.id) throw httpError(403, 'House owner access is required');
  return user;
}

function actorKind(actor) {
  return actor?.actor_source === 'core-signature' ? 'core' : 'user';
}

function boundedInteger(raw, fallback, min, max, name) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw httpError(400, `${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/* GET /v1/media/recovery?org_id=&older_than_minutes=&limit= */
export async function listRecoveryCandidates(request, env, actor) {
  await assertHouseOperator(env, actor);
  const query = new URL(request.url).searchParams;
  const rawOrg = query.get('org_id');
  const orgId = rawOrg ? requireOrgId(rawOrg) : null;
  const minutes = boundedInteger(query.get('older_than_minutes'), 15, 1, 1440, 'older_than_minutes');
  const limit = boundedInteger(query.get('limit'), 50, 1, 200, 'limit');
  let answer;
  try {
    answer = await rpc(env, 'media_operation_recovery_candidates_v1', {
      p_org_id: orgId, p_older_than: `${minutes} minutes`, p_limit: limit
    });
  } catch (error) {
    if (isMissingFunction(error)) throw recoveryUnavailable();
    throw error;
  }
  return Array.isArray(answer) ? answer[0] : answer;
}

function decisionFrom(body) {
  const orgId = requireOrgId(body?.org_id);
  const decision = String(body?.decision || '').trim().toLowerCase();
  if (!DECISIONS.includes(decision)) throw httpError(400, 'decision must be release, settle or bind');
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) throw httpError(400, 'reason must be 3 to 500 characters');

  let evidence = body?.evidence;
  if (evidence === undefined || evidence === null) evidence = {};
  if (typeof evidence !== 'object' || Array.isArray(evidence)) throw httpError(400, 'evidence must be an object');
  if (JSON.stringify(evidence).length > MAX_EVIDENCE_CHARS) throw httpError(400, `evidence must be at most ${MAX_EVIDENCE_CHARS} characters of JSON`);

  let providerRequestId = null;
  if (decision === 'settle') {
    providerRequestId = typeof body?.provider_request_id === 'string' ? body.provider_request_id.trim() : '';
    if (!PROVIDER_REQUEST_ID.test(providerRequestId)) {
      throw httpError(400, 'settle requires provider_request_id: 1-200 characters of letters, digits, ".", "_", ":" or "-"');
    }
  }
  return { orgId, decision, reason, evidence, providerRequestId };
}

/* POST /v1/media/jobs/:id/reconcile
   { org_id, decision: release | settle | bind, reason, evidence?, provider_request_id? }

   The request is written to the audit ledger first and refused if that write
   fails: a decision about someone's money never runs unrecorded. The decision
   itself (its rules, its idempotency and the organization check) is one
   database function, so this handler cannot half-apply it. */
export async function reconcileJob(request, env, actor, jobId) {
  await assertHouseOperator(env, actor);
  if (!UUID.test(String(jobId || ''))) throw httpError(400, 'job_id must be a UUID');
  let body;
  try { body = await request.json(); } catch { throw httpError(400, 'Invalid JSON'); }
  const { orgId, decision, reason, evidence, providerRequestId } = decisionFrom(body);

  const before = await jobById(env, jobId, orgId);
  if (!before) throw httpError(404, 'Media job not found in that organization');

  const ledger = {
    orgId,
    actorUserId: actor.id,
    actorKind: actorKind(actor),
    capability: 'media.recover',
    resourceType: 'media_job',
    resourceId: jobId
  };
  const subject = { decision, reason, operation_id: before.routing?.operation_id || null };
  const requested = await recordAudit(env, {
    ...ledger,
    event: 'media_operation.resolve_requested',
    detail: {
      ...subject,
      evidence,
      provider_request_id: providerRequestId,
      before: {
        status: before.status ?? null,
        outcome: before.provider_status?.outcome ?? null,
        reservation_state: before.routing?.reservation_state ?? null,
        provider_request_id: before.provider_request_id ?? null
      }
    }
  });
  if (!requested.recorded) {
    throw httpError(503, 'The audit ledger is unavailable; the decision was not applied', 'audit_unavailable', { audit: requested });
  }

  let answer;
  try {
    answer = await rpc(env, 'media_resolve_operation_job_v1', {
      p_org_id: orgId,
      p_job_id: jobId,
      p_decision: decision,
      p_actor_id: actor.id,
      p_reason: reason,
      p_evidence: evidence,
      p_provider_request_id: providerRequestId
    });
  } catch (error) {
    const code = String(error?.detail?.code || '');
    const message = String(error?.detail?.message || '');
    let refusal;
    if (isMissingFunction(error)) refusal = recoveryUnavailable();
    else if (code === '22023') refusal = httpError(400, message || 'The decision was not valid');
    else if (code === 'P0001' && (message === 'job_not_found' || message === 'job_not_in_org')) refusal = httpError(404, 'Media job not found in that organization', message);
    else if (code === 'P0001') refusal = httpError(409, `The decision was refused: ${message}`, message, { refusal: message });
    else refusal = httpError(502, 'The decision could not be applied', 'recovery_failed', error?.detail || null);
    /* best effort: the ledger already says it was requested */
    await recordAudit(env, {
      ...ledger,
      event: 'media_operation.resolve_refused',
      detail: { ...subject, refusal: refusal.reason || refusal.message, status: refusal.status }
    });
    throw refusal;
  }
  const outcome = (Array.isArray(answer) ? answer[0] : answer) || {};
  const resolved = await recordAudit(env, {
    ...ledger,
    event: 'media_operation.resolved',
    detail: {
      ...subject,
      outcome: outcome.outcome ?? null,
      after: {
        status: outcome.status ?? null,
        released_usd_micros: outcome.release?.released ? (outcome.release.amount_usd_micros ?? null) : null,
        provider_request_id: outcome.provider_request_id ?? null
      }
    }
  });
  return {
    outcome: outcome.outcome ?? null,
    job_id: jobId,
    decision,
    status: outcome.status ?? null,
    resolution: outcome.resolution ?? null,
    release: outcome.release ?? null,
    claim: outcome.claim ?? null,
    audit: { requested, resolved }
  };
}

/* The cron sweep (./entry.js scheduled, every five minutes).

   (a) open jobs that HAVE a provider request id and have not moved for five
       minutes are polled; the provider's answer completes, fails (and then
       releases) or updates them exactly as a member's read would;
   (b) a cas-v1 'submitting' marker with no request id after ten minutes is an
       isolate that stopped mid-submit: the job is parked as 'reconciling'
       with outcome 'uncertain'. No money moves and nothing is resubmitted;
   (c) the candidate counts are recorded per organization, so a stuck job is
       visible in System · Observability without anyone asking.
   It never polls, releases or resolves a job without a request id. One phase
   failing does not stop the others. */
export async function sweepMediaRecovery(env, options = {}, deps = {}) {
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 25));
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const report = { polled: 0, completed: 0, settled: 0, released: 0, marked_uncertain: 0, errors: [], candidate_counts: null };
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return { ...report, skipped: 'supabase_not_configured' };
  const failed = (phase, error, jobId = null) => {
    if (report.errors.length < 10) report.errors.push({ phase, job_id: jobId, message: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
  };

  /* (a) */
  if (env.FAL_KEY || typeof deps.status === 'function') {
    try {
      const staleBefore = encodeURIComponent(new Date(now - POLL_AFTER_MS).toISOString());
      const open = await db(env, `media_jobs?provider=eq.fal&provider_request_id=not.is.null&status=in.(queued,running,reconciling)&updated_at=lt.${staleBefore}&order=updated_at.asc&limit=${limit}&select=*`);
      for (const job of open || []) {
        report.polled += 1;
        try {
          const { job: after, action, released } = await pollProviderStatus(env, job, deps);
          if (action === 'completed') {
            report.completed += 1;
            if ((after?.actual_cost_cents ?? null) !== null) report.settled += 1;
          }
          if (released) report.released += 1;
        } catch (error) {
          failed('poll', error, job.id);
        }
      }
    } catch (error) {
      failed('poll', error);
    }
  } else {
    report.poll_skipped = 'fal_not_configured';
  }

  /* (b) */
  try {
    const markerBefore = encodeURIComponent(new Date(now - SUBMIT_MARKER_STALE_MS).toISOString());
    const stuck = await db(env, `media_jobs?provider=eq.fal&status=eq.queued&provider_request_id=is.null&provider_status->>outcome=eq.submitting&routing->>submit_protocol=eq.cas-v1&updated_at=lt.${markerBefore}&order=updated_at.asc&limit=${limit}&select=*`);
    for (const job of stuck || []) {
      try {
        const parked = await patchJobWhere(env, job.id, CAS_UNCERTAIN, {
          status: 'reconciling',
          error: { message: 'submit outcome unknown: the submitting isolate recorded no result', uncertain: true, stage: 'submit' },
          provider_status: { ...(job.provider_status || {}), outcome: 'uncertain', marked_uncertain_at: new Date(now).toISOString() }
        });
        if (!parked) continue;
        report.marked_uncertain += 1;
        recordEvent({
          orgId: job.org_id, name: 'media.generation.submit_outcome_unknown', kind: 'dependency', level: 'warn', outcome: 'pending',
          traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
          message: 'A submit marker was never completed; the reservation is kept and the job waits for an operator decision',
          detail: { operation_id: job.routing?.operation_id || null, attempted_at: job.provider_status?.attempted_at || null }
        });
      } catch (error) {
        failed('marker', error, job.id);
      }
    }
  } catch (error) {
    failed('marker', error);
  }

  /* (c) */
  try {
    const answer = await rpc(env, 'media_operation_recovery_candidates_v1', { p_org_id: null, p_older_than: '15 minutes', p_limit: 50 });
    const body = (Array.isArray(answer) ? answer[0] : answer) || {};
    report.candidate_counts = body.counts || {};
    for (const entry of Array.isArray(body.by_org) ? body.by_org : []) {
      const counts = entry?.counts && typeof entry.counts === 'object' ? entry.counts : {};
      const total = Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
      const person = NEEDS_A_PERSON.some((name) => Number(counts[name]) > 0);
      recordEvent({
        orgId: entry?.org_id, name: 'media.recovery.candidates', kind: 'scheduled', level: person ? 'warn' : 'info', outcome: 'pending',
        resourceType: 'media_recovery',
        message: `${total} paid media ${total === 1 ? 'operation needs' : 'operations need'} recovery${person ? ' (an operator decision is required)' : ''}`,
        detail: counts
      });
    }
  } catch (error) {
    if (isMissingFunction(error)) report.recovery_unavailable = true;
    else failed('candidates', error);
  }

  return report;
}
