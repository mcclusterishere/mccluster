/* E=Up import job: one claimed run, from claim to settlement.

   NOTHING CALLS THIS IN PRODUCTION. No route, no schedule and no queue consumer imports this module; it is
   exercised by workers/mccluster/test/eup-import-runner.test.mjs only. Where it runs is an owner decision.

   The order is fixed and every step is a boundary where the persisted policy of module intake can stop the job:

     1. claim           guarded in the store: a module that is not installed, draining or disabled starts no job.
                        The claim returns a lease (the holder's secret) and the policy revision it was made under.
     2. source gate     assertFetchAllowed: definition known, rights approved and unexpired, configured, every
                        credential binding present, not paused. It never touches the network.
     3. plan            what this source may fetch for this run's cursor, and from which exact hosts. A source
                        without a plan, or a cursor that names no scope, fetches nothing.
     4. policy check    before EVERY upstream request the policy is read again: the job goes on only while the
                        module is enabled at the revision of its claim. A network request cannot be bound to a
                        transaction, so this is a pre-check; the write below is the authority.
     5. upstream read   boundedUpstreamRead (./adapters/index.js): https only, the source's own domain, no
                        cross-host redirect, 2 MB, 15 s. This file adds no network path of its own, only a
                        stricter exact-host list in front of that helper.
     6. parse           the existing pure adapters.
     7. apply           every write carries the claim's revision: the store refuses it once the module drains
                        (module_draining) and after a drain and re-enable (module_policy_changed).
     8. settlement      by the lease alone, in every module state:
                          a module refusal anywhere after the claim  -> release: the run goes back to queued and is kept
                          any other failure                           -> finish as failed
                          all applied                                 -> finish as completed

   Limits that are not hidden:
     - A lease cannot be renewed. The job stops (finishes as failed, lease_expired) when its own clock says the
       lease is nearly over; it does not start a request or a write after that.
     - The store does not check the lease on a write. A holder whose lease expired and was taken over can have
       landed writes before it finds out at settlement (lease_lost); they are idempotent by raw hash.
     - Writes that landed before a refusal stay (each apply is its own transaction). A released run is run
       again from the start and its earlier records are then duplicates, not second copies.

   What leaves this file: fixed reason words, a run id, counts, and for an upstream request its host and path.
   Never a query string, a header, a credential binding, a lease, a database message or an upstream body. */
import { assertFetchAllowed, importRunClaim, importRunFinish, importRunRelease, intakeApply, readSourceStates } from './intake.js';
import { MODULE_POLICY_ERRORS, readModulePolicy } from './modules.js';
import { boundedUpstreamRead } from './adapters/index.js';
import { parseSecSubmissions, parseSecCompanyFacts } from './adapters/sec.js';
import { parseGleifRecord } from './adapters/gleif.js';
import { rawHash } from './provenance.js';

export const IMPORT_MODULE = 'intake';
export const DEFAULT_LEASE_SECONDS = 300;
/* One job reads at most this many upstream documents (15 s each in the bounded read) and writes in chunks of
   at most this many records, so the default lease covers the whole job with room to spare. */
export const MAX_UPSTREAM_REQUESTS = 4;
export const APPLY_CHUNK = 100;
/* The job stops this long before its lease ends by its own clock. */
const LEASE_MARGIN_MS = 5000;

const GUARD = MODULE_POLICY_ERRORS.guard;
/* The module-policy refusals, by reason: taken from the one shared table, never listed a second time. */
const MODULE_REFUSALS = new Set(Object.values(GUARD).map(([, reason]) => reason));
const [, DRAINING] = GUARD.EUM02;
const [, DISABLED] = GUARD.EUM03;
const [, POLICY_CHANGED] = GUARD.EUM04;
const [, POLICY_UNAVAILABLE] = GUARD.EUM00;

const REASON = /^[a-z][a-z0-9_]{0,63}$/;
const stop = (reason) => Object.assign(new Error(reason), { reason });
/* The reason word of a failure, or `fallback`. A message is never used: it can carry a URL or a database text. */
function reasonOf(error, fallback) {
  if (typeof error?.reason === 'string' && REASON.test(error.reason)) return error.reason;
  if (error?.name === 'UpstreamError' && typeof error.code === 'string' && REASON.test(error.code)) return error.code;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'upstream_timeout';
  return fallback;
}

const json = (text) => { try { return JSON.parse(text); } catch { throw stop('parse_failed'); } };
const batch = (kind, records) => ({ kind, records });

/* What a source may fetch for one run, and how its documents become intake records.
     hosts     the exact upstream hosts of this plan (each also has to be inside the source's own domain,
               which boundedUpstreamRead checks against the registry)
     requests  ({ cursor, env }) -> [{ id, url, headers }]; throws `no_import_scope` when the run's cursor
               does not say what to read. A credential goes in a header, never in the URL.
     parse     (documents by id: { text, fetched_at, raw_hash }, { cursor }) -> [{ kind, records }] in apply order
   Only the two sources whose existing adapter output is accepted by the store as it is have a plan. The
   scope of a run is its cursor; nothing in this release writes one (a refresh queues an empty cursor), so a
   run claimed today fails as no_import_scope until an owner decides what each source covers. */
export const IMPORT_PLANS = Object.freeze({
  sec_edgar: Object.freeze({
    hosts: Object.freeze(['data.sec.gov']),
    /* cursor { cik, facts? }: the submissions document (identity and address assertions) and, only when
       facts is true, the XBRL companyfacts document (which exceeds the 2 MB bound for a large filer). */
    requests({ cursor, env }) {
      const digits = typeof cursor?.cik === 'string' || Number.isSafeInteger(cursor?.cik) ? String(cursor.cik) : '';
      if (!/^\d{1,10}$/.test(digits)) throw stop('no_import_scope');
      const cik = digits.padStart(10, '0');
      const headers = { 'user-agent': env.SEC_USER_AGENT };
      const out = [{ id: 'submissions', url: `https://data.sec.gov/submissions/CIK${cik}.json`, headers }];
      if (cursor.facts === true) out.push({ id: 'companyfacts', url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, headers });
      return out;
    },
    parse(documents) {
      const s = documents.submissions;
      const { company, locations } = parseSecSubmissions(json(s.text), { fetched_at: s.fetched_at, raw_hash: s.raw_hash });
      const out = [batch('company', [company]), batch('company_location', locations)];
      const f = documents.companyfacts;
      if (f) out.push(batch('company_fact', parseSecCompanyFacts(json(f.text), { fetched_at: f.fetched_at, raw_hash: f.raw_hash })));
      return out;
    }
  }),
  gleif: Object.freeze({
    hosts: Object.freeze(['api.gleif.org']),
    /* cursor { lei }: one LEI record. */
    requests({ cursor }) {
      const lei = typeof cursor?.lei === 'string' ? cursor.lei : '';
      if (!/^[A-Z0-9]{20}$/.test(lei)) throw stop('no_import_scope');
      return [{ id: 'record', url: `https://api.gleif.org/api/v1/lei-records/${lei}`, headers: {} }];
    },
    parse(documents) {
      const d = documents.record;
      const { company, locations } = parseGleifRecord(json(d.text), { fetched_at: d.fetched_at, raw_hash: d.raw_hash });
      return [batch('company', [company]), batch('company_location', locations)];
    }
  })
});

/* The requests of a plan, checked before the first one is sent: a short list, https, default port, no
   userinfo, and a host that is exactly one of the plan's. A plan cannot widen its source: each host it lists
   has to be the source's registered host or a subdomain of it (whole labels, not a suffix of the text).
   Anything else and nothing at all is fetched. */
function plannedRequests(plan, feedEntry, cursor, env) {
  const hosts = Array.isArray(plan?.hosts) ? plan.hosts.filter((h) => typeof h === 'string' && h).map((h) => h.toLowerCase()) : [];
  if (!hosts.length || typeof plan.requests !== 'function' || typeof plan.parse !== 'function') throw stop('no_import_plan');
  const domain = String(feedEntry.fetch_host || new URL(feedEntry.url).hostname).toLowerCase().replace(/^www\./, '');
  if (!hosts.every((h) => h === domain || h.endsWith(`.${domain}`))) throw stop('invalid_upstream');
  const asked = plan.requests({ cursor, env });
  if (!Array.isArray(asked) || asked.length < 1) throw stop('no_import_scope');
  if (asked.length > MAX_UPSTREAM_REQUESTS) throw stop('invalid_upstream');
  const seen = new Set();
  return asked.map((r) => {
    let target = null;
    try { target = new URL(String(r?.url)); } catch { target = null; }
    const id = typeof r?.id === 'string' ? r.id : '';
    if (!target || !id || seen.has(id) || target.protocol !== 'https:' || target.username || target.password || target.port !== '' || !hosts.includes(target.hostname.toLowerCase())) throw stop('invalid_upstream');
    seen.add(id);
    target.hash = '';
    return { id, url: target.href, host: target.hostname.toLowerCase(), path: target.pathname, headers: r.headers && typeof r.headers === 'object' ? r.headers : {} };
  });
}

/* The parsed batches, checked before the first write: known shape, and every record says it came from this source. */
function checkedBatches(parsed, source_id) {
  if (!Array.isArray(parsed)) throw stop('parse_failed');
  const out = [];
  for (const b of parsed) {
    if (!b || typeof b.kind !== 'string' || !b.kind || !Array.isArray(b.records)) throw stop('parse_failed');
    if (b.records.some((r) => !r || typeof r !== 'object' || r.provenance?.source_id !== source_id)) throw stop('parse_failed');
    if (b.records.length) out.push(b);
  }
  return out;
}

/* Run one import job.

   runImportJob(env, { worker, source_id = null, lease_seconds = 300, fetchImpl = fetch, now = Date.now,
                       plans = IMPORT_PLANS, log = null })
     worker         this holder's name, [A-Za-z0-9._:-]{1,64} (the store checks it)
     source_id      claim a run of this source only; null takes the oldest claimable run of any source
     lease_seconds  30 to 3600; it cannot be renewed
     fetchImpl      used for the store and for the upstream read
     log            optional (entry) => void; entries carry what the result carries and nothing else

   It never throws. Every answer has `outcome` and `claimed`:
     { outcome: 'idle', claimed: false, policy_revision }            nothing to claim
     { outcome: 'refused', claimed: false, reason }                  the claim was refused; no run is held
     { outcome: 'released', claimed: true, released: true, reason }  stopped by module policy (or a pause); the run is queued again
     { outcome: 'failed', claimed: true, finished: true, status: 'failed', reason }
     { outcome: 'completed', claimed: true, finished: true, status: 'completed', reason: null }
     { outcome: 'unsettled', claimed: true, released: false, reason, settle_reason }
     { outcome: 'unsettled', claimed: true, finished: false, intended: 'completed' | 'failed', reason, settle_reason }
                                                                     the run could not be settled: lease_lost,
                                                                     run_not_running or the store; it stays
                                                                     with whoever holds it, or until its lease ends
   A claimed answer also has run_id, source_id, policy_revision, attempt, reclaimed, records, applied,
   duplicates, reviewed, and upstream: [{ id, host, path }] for each request that was sent. */
export async function runImportJob(env, { worker, source_id = null, lease_seconds = DEFAULT_LEASE_SECONDS, fetchImpl = fetch, now = Date.now, plans = IMPORT_PLANS, log = null } = {}) {
  const ctx = { fetchImpl };
  const say = (entry) => { if (typeof log === 'function') { try { log(entry); } catch { /* a log sink never stops a job */ } } return entry; };
  const started = now();

  let claim;
  try { claim = await importRunClaim(env, ctx, worker, source_id, lease_seconds); }
  catch (error) { return say({ outcome: 'refused', claimed: false, reason: reasonOf(error, 'storage_unavailable') }); }
  if (claim?.claimed === false) return say({ outcome: 'idle', claimed: false, policy_revision: Number.isSafeInteger(claim.policy_revision) ? claim.policy_revision : null });
  if (claim?.claimed !== true || typeof claim.run_id !== 'string' || typeof claim.source_id !== 'string' || typeof claim.lease !== 'string' || !claim.lease || !Number.isSafeInteger(claim.policy_revision)) {
    /* An answer this code cannot read. If a run was taken, its lease is unknown here and simply runs out. */
    return say({ outcome: 'refused', claimed: false, reason: 'storage_unavailable' });
  }
  const job = { run_id: claim.run_id, source_id: claim.source_id, lease: claim.lease, revision: claim.policy_revision, cursor: claim.cursor && typeof claim.cursor === 'object' ? claim.cursor : {} };
  const tally = { records: 0, applied: 0, duplicates: 0, reviewed: 0 };
  const upstream = [];
  const answer = (fields) => say({
    ...fields, claimed: true, run_id: job.run_id, source_id: job.source_id, policy_revision: job.revision,
    attempt: Number.isSafeInteger(claim.attempt) ? claim.attempt : null, reclaimed: claim.reclaimed === true, ...tally, upstream: upstream.map((u) => ({ ...u }))
  });
  /* Settlement. Neither is guarded by module state; both need this job's lease. */
  const release = async (reason) => {
    try { await importRunRelease(env, ctx, job.run_id, job.lease, reason); }
    catch (error) { return answer({ outcome: 'unsettled', released: false, reason, settle_reason: reasonOf(error, 'storage_unavailable') }); }
    return answer({ outcome: 'released', released: true, reason });
  };
  const finish = async (status, reason) => {
    try { await importRunFinish(env, ctx, job.run_id, status, status === 'completed' ? tally.records : null, reason, null, job.lease); }
    catch (error) { return answer({ outcome: 'unsettled', finished: false, intended: status, reason, settle_reason: reasonOf(error, 'storage_unavailable') }); }
    return answer({ outcome: status, finished: true, status, reason });
  };
  /* A module refusal gives the run back; anything else is this run's failure. */
  const settle = (error, fallback) => {
    const reason = reasonOf(error, fallback);
    return MODULE_REFUSALS.has(reason) ? release(reason) : finish('failed', reason);
  };
  const leaseMs = Number.isFinite(lease_seconds) ? lease_seconds * 1000 : DEFAULT_LEASE_SECONDS * 1000;
  const leaseOver = () => now() - started >= leaseMs - LEASE_MARGIN_MS;

  /* 2. the source gate */
  let state; let feedEntry;
  try { state = (await readSourceStates(env, ctx)).find((s) => s?.source_id === job.source_id) || null; }
  catch (error) { return settle(error, 'storage_unavailable'); }
  try { feedEntry = assertFetchAllowed(job.source_id, state, env, { now: now() }); }
  catch (error) {
    const reason = reasonOf(error, 'not_configured');
    /* A pause only stops work: the run is kept for the resume. (A paused source is not claimable, so this cannot loop.) */
    return reason === 'source_paused' ? release(reason) : finish('failed', reason);
  }

  /* 3. the plan, checked whole before anything is sent */
  let requests;
  try {
    if (!plans || !Object.hasOwn(plans, job.source_id)) throw stop('no_import_plan');
    requests = plannedRequests(plans[job.source_id], feedEntry, job.cursor, env);
  } catch (error) { return finish('failed', reasonOf(error, 'no_import_plan')); }
  const plan = plans[job.source_id];

  const documents = {};
  for (const request of requests) {
    if (leaseOver()) return finish('failed', 'lease_expired');
    /* 4. the policy, read again before this request: fail closed on anything but enabled at the claim's revision */
    let policy;
    try { policy = await readModulePolicy(env, fetchImpl, IMPORT_MODULE); }
    catch (error) { return release(reasonOf(error, POLICY_UNAVAILABLE)); }
    if (policy.state !== 'enabled') return release(policy.state === 'draining' ? DRAINING : DISABLED);
    if (policy.revision !== job.revision) return release(POLICY_CHANGED);
    /* 5. the bounded read */
    let read;
    try { read = await boundedUpstreamRead(job.source_id, state, env, request.url, { fetchImpl, now, headers: request.headers }); }
    catch (error) { return finish('failed', reasonOf(error, 'upstream_unavailable')); }
    upstream.push({ id: request.id, host: request.host, path: request.path });
    documents[request.id] = { text: read.text, fetched_at: read.fetched_at, raw_hash: await rawHash(read.text) };
  }

  /* 6. parse */
  let batches;
  try { batches = checkedBatches(plan.parse(documents, { cursor: job.cursor }), job.source_id); }
  catch (error) { return finish('failed', reasonOf(error, 'parse_failed')); }

  /* 7. apply, each chunk in its own transaction and bound to the claim's revision */
  for (const { kind, records } of batches) {
    for (let at = 0; at < records.length; at += APPLY_CHUNK) {
      if (leaseOver()) return finish('failed', 'lease_expired');
      const chunk = records.slice(at, at + APPLY_CHUNK);
      let out;
      try { out = await intakeApply(env, ctx, job.source_id, kind, chunk, job.revision); }
      catch (error) { return settle(error, 'storage_unavailable'); }
      tally.records += chunk.length;
      for (const key of ['applied', 'duplicates', 'reviewed']) if (Number.isSafeInteger(out?.[key])) tally[key] += out[key];
    }
  }

  /* 8. done */
  return finish('completed', null);
}
