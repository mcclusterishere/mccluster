// HTTP mapping of the device job contract for the Core compute gateway. The
// gateway owns the socket, the admin secret and the response writer; this
// module only recognises /v1/compute/jobs* and /v1/compute/receipt-key and
// answers with { status, body, headers }. Every route is behind the compute
// admin token (CORE_COMPUTE_ADMIN_TOKEN): nodes never reach these.
import { parseIdempotencyKey } from './http-security.mjs';
import { assertActiveScheduler } from './scheduler-election.mjs';
import { cancelJob, defaultDeps, getJob, getJobReceipt, getJobResult, listJobs, receiptKey, submitJob } from './jobs-service.mjs';

const JOB_PATH = /^\/v1\/compute\/jobs\/([0-9a-f-]{36})(?:\/(result|receipt|cancel))?$/i;

const SCHEDULER_PATHS = new Set(['/v1/compute/scheduler', '/v1/compute/scheduler/handover']);

export function matchesJobRoute(pathname) {
  return pathname === '/v1/compute/jobs' || pathname === '/v1/compute/receipt-key' || SCHEDULER_PATHS.has(pathname) || JOB_PATH.test(pathname);
}

// requireAdmin() throws the gateway's own 401/503; adminOrg(requested) applies
// the canonical-org fence exactly as the existing admin routes do.
export async function handleJobRoute({ req, url, body, requireAdmin, adminOrg, canonicalOrg = null, issuer = {}, election = null }, deps = defaultDeps()) {
  const pathname = url.pathname;
  if (!matchesJobRoute(pathname)) return null;
  requireAdmin();
  // The org fence (adminOrg) only bites when the gateway knows its canonical
  // org; without MCCLUSTER_ORG_ID the job routes fail closed instead of
  // scoping to whatever org the caller names.
  if (!canonicalOrg) throw Object.assign(new Error('MCCLUSTER_ORG_ID is not configured on this gateway; the job routes fail closed'), { status: 503, code: 'ORG_NOT_CONFIGURED' });

  // Scheduler standby (DEVICE-JOBS-SCHEDULER-STANDBY.md): who holds the lease,
  // and the owner's controlled failback. Both are admin-only.
  if (pathname === '/v1/compute/scheduler' && req.method === 'GET') {
    if (!election) return { status: 200, body: { configured: false, scheduler: null, store: null } };
    let store = null;
    try { store = await election.store.status({ orgId: election.orgId }); } catch (error) { store = { error: error.message }; }
    return { status: 200, body: { configured: true, scheduler: election.snapshot(), store } };
  }
  if (pathname === '/v1/compute/scheduler/handover' && req.method === 'POST') {
    if (!election) throw Object.assign(new Error('No scheduler election is configured on this instance'), { status: 409, code: 'SCHEDULER_NOT_CONFIGURED' });
    const reply = await election.requestHandover(String(body?.to_holder_id || ''), body?.grace_seconds);
    return { status: reply?.ok === true ? 200 : 409, body: { ...reply, scheduler: election.snapshot() } };
  }

  if (pathname === '/v1/compute/receipt-key' && req.method === 'GET') {
    return { status: 200, body: receiptKey(deps) };
  }

  if (pathname === '/v1/compute/jobs' && req.method === 'POST') {
    // Only the active scheduler accepts new work; reads stay open everywhere.
    assertActiveScheduler(election);
    const idempotencyKey = parseIdempotencyKey(req.headers['idempotency-key']);
    const canonicalOrg = adminOrg(body?.org_id || null);
    const result = await submitJob({ ...body, org_id: canonicalOrg }, { canonicalOrg, idempotencyKey, via: 'gateway-admin' }, deps);
    return {
      status: result.replayed ? 200 : 202,
      body: { schema: result.job.schema, job: result.job, replayed: result.replayed, live_nodes: result.live_nodes },
      headers: idempotencyKey ? { 'idempotency-replayed': result.replayed ? 'true' : 'false' } : {}
    };
  }

  if (pathname === '/v1/compute/jobs' && req.method === 'GET') {
    const orgId = adminOrg(url.searchParams.get('org_id'));
    if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400, code: 'ORG_REQUIRED' });
    return { status: 200, body: await listJobs({ orgId, status: url.searchParams.get('status'), capability: url.searchParams.get('capability'), limit: url.searchParams.get('limit') || 50, idempotencyKey: url.searchParams.get('idempotency_key') }, deps) };
  }

  const match = pathname.match(JOB_PATH);
  if (match && match[2] === 'cancel') {
    if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' } };
    const orgId = adminOrg(body?.org_id || url.searchParams.get('org_id'));
    if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400, code: 'ORG_REQUIRED' });
    return { status: 200, body: await cancelJob({ orgId, jobId: match[1], reason: body?.reason }, deps) };
  }
  if (match && req.method === 'GET') {
    const orgId = adminOrg(url.searchParams.get('org_id'));
    if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400, code: 'ORG_REQUIRED' });
    const [, jobId, view] = match;
    if (!view) return { status: 200, body: await getJob({ orgId, jobId }, deps) };
    if (view === 'result') return { status: 200, body: await getJobResult({ orgId, jobId }, deps) };
    return { status: 200, body: await getJobReceipt({ orgId, jobId, issuer }, deps) };
  }

  return { status: 405, body: { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' } };
}
