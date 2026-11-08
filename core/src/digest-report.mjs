import { rest } from './supabase.mjs';

export const DIGEST_OUTPUT_FIELDS = ['summary', 'commented', 'briefed', 'pairs_new', 'pairs_sent', 'status', 'reason', 'queued_jobs', 'overall', 'changed', 'commit', 'pushed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short = (value, max = 180) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const count = value => Number.isInteger(value) && value >= 0 ? value : 0;
// Never recurse unboundedly into private JSONB. Unknown is not empty.
export function evidencePresence(value) {
  let remaining = 512;
  function visit(item, depth) {
    if (depth > 16 || --remaining < 0) return 'unknown';
    if (typeof item === 'string') return /\S/.test(item) ? 'present' : 'empty';
    if (typeof item === 'number' || typeof item === 'boolean') return 'present';
    if (!item || typeof item !== 'object') return 'empty';
    let result = 'empty';
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue;
      const child = visit(item[key], depth + 1);
      if (child === 'present') return child;
      if (child === 'unknown') result = child;
      if (remaining < 0) break;
    }
    return result;
  }
  return visit(value, 0);
}

// This is a bounded scan of mutable job rows, not an immutable execution ledger.
// Fixed upper bound and keyset pagination avoid offset drift and timestamp ties.
export async function readDigestJobs({ orgId, hours = 24, now = new Date(), maxJobs = 10000, read = rest } = {}) {
  if (!UUID.test(orgId || '')) throw new Error('Digest requires a resolved organization UUID');
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error('Digest window must be 1–168 hours');
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10000) throw new Error('Invalid digest row bound');
  const until = now.toISOString();
  const since = new Date(now.getTime() - hours * 3600000).toISOString();
  const jobs = [];
  const seen = new Set();
  let cursor;
  let complete = false;
  let pages = 0;
  // One lookahead row distinguishes exactly-at-cap from truncated results.
  while (jobs.length <= maxJobs && pages < 100) {
    const limit = Math.min(200, maxJobs + 1 - jobs.length);
    const params = new URLSearchParams({ org_id: `eq.${orgId}`,
      and: `(updated_at.gte.${since},updated_at.lte.${until})`,
      select: ['id,org_id,job_type,target_type,target_id,status,last_error,updated_at,evidence:input->evidence,context:input->context', ...DIGEST_OUTPUT_FIELDS.map(key => `out_${key}:output->${key}`), 'out_analysis_summary:output->analysis->summary,out_tests_ran:output->tests->ran,out_tests_ok:output->tests->ok,out_digest:output->completion_evidence->result_sha256'].join(','),
      order: 'updated_at.desc,id.desc', limit: String(limit) });
    if (cursor) params.set('or', `(updated_at.lt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.lt.${cursor.id}))`);
    pages++;
    const { body } = await read(`ops_agent_jobs?${params}`);
    if (!Array.isArray(body) || body.length > limit) throw new Error('Invalid digest job page');
    if (!body.length) { complete = true; break; }
    for (const job of body) {
      if (job.org_id !== orgId || !UUID.test(job.id || '') || !Number.isFinite(Date.parse(job.updated_at)) || Date.parse(job.updated_at) < Date.parse(since) || Date.parse(job.updated_at) > Date.parse(until) || seen.has(job.id)) {
        throw new Error('Invalid, duplicate, or out-of-scope digest job');
      }
      if (cursor && (job.updated_at > cursor.updated_at || (job.updated_at === cursor.updated_at && job.id >= cursor.id))) throw new Error('Digest cursor did not advance');
      const output = Object.fromEntries(DIGEST_OUTPUT_FIELDS.map(key => [key, job[`out_${key}`]]));
      for (const key of ['summary', 'reason', 'commit']) if (typeof output[key] === 'string') output[key] = short(output[key]);
      output.queued_child_count = Array.isArray(output.queued_jobs) ? output.queued_jobs.length : null;
      delete output.queued_jobs;
      output.analysis = { summary: short(job.out_analysis_summary) };
      output.tests = { ran: job.out_tests_ran, ok: job.out_tests_ok };
      output.completion_evidence = { result_sha256: job.out_digest };
      jobs.push({ id: job.id, org_id: job.org_id, updated_at: job.updated_at, job_type: job.job_type, target_type: job.target_type, target_id: job.target_id, status: job.status, last_error: short(job.last_error), output, evidence_presence: evidencePresence(job.evidence ?? job.context) });
      seen.add(job.id); cursor = { id: job.id, updated_at: job.updated_at };
    }
    // Continue even on a short page: a server-side row cap may be smaller.
  }
  return { jobs: jobs.slice(0, maxJobs), coverage: { status: complete ? 'complete' : 'truncated', complete, truncated: !complete,
    since, until, window_hours: hours, max_jobs: maxJobs, max_pages: 100, pages, reason: complete ? 'query_exhausted' : jobs.length > maxJobs ? 'row_limit' : 'read_limit', rows: Math.min(jobs.length, maxJobs),
    basis: 'current job rows updated in window; not execution counts or a transactional snapshot' } };
}

export function summarizeDigest(jobs, coverage) {
  const counts = {};
  const outcomes = { completed_with_reported_outcome: 0, no_change: 0, observations: 0, abstained: 0, empty_evidence: 0, planning: 0, other_done: 0 };
  const facts = { prim3: { runs: 0, comments: 0, briefs: 0, zero_change: 0, unknown_outputs: 0 },
    pairing: { runs: 0, new_pairs: 0, sent_pairs: 0, zero_new_pairs: 0, unknown_outputs: 0 },
    repo_health: { runs: 0, tests_ran: 0, tests_passed: 0, tests_failed: 0, tests_not_run: 0, tests_unknown: 0, repeated_digest: 0 },
    local_analysis: { with_evidence: 0, empty_evidence: 0, abstained: 0, evidence_unknown: 0 }, reflection: { runs: 0, children_queued: 0 },
    health: { failing_observations: 0 }, jobs_with_completion_digest: 0 };
  const digests = new Set();
  const details = [];
  for (const job of jobs) {
    counts[job.status] = (counts[job.status] || 0) + 1;
    const out = job.output || {};
    let category = job.status;
    let detail = short(out.summary || out.analysis?.summary || 'Outcome not summarized');
    if (job.status === 'done') {
      facts.jobs_with_completion_digest += Number(Boolean(out.completion_evidence?.result_sha256));
      category = 'other_done';
      switch (job.job_type) {
        case 'prim3_agent_news': {
          const f = facts.prim3; f.runs++; f.comments += count(out.commented); f.briefs += Number(out.briefed === true);
          f.unknown_outputs += Number(!Number.isInteger(out.commented) || typeof out.briefed !== 'boolean');
          const zero = out.commented === 0 && out.briefed === false;
          f.zero_change += Number(zero); category = zero ? 'no_change' : out.commented > 0 || out.briefed === true ? 'completed_with_reported_outcome' : 'other_done';
          detail = `${Number.isInteger(out.commented) ? out.commented : 'unknown'} comments, ${typeof out.briefed === 'boolean' ? Number(out.briefed) : 'unknown'} briefs`; break;
        }
        case 'world_news_pairing': {
          const f = facts.pairing; f.runs++; f.new_pairs += count(out.pairs_new); f.sent_pairs += count(out.pairs_sent); f.zero_new_pairs += Number(out.pairs_new === 0);
          f.unknown_outputs += Number(!Number.isInteger(out.pairs_new) || !Number.isInteger(out.pairs_sent));
          category = out.pairs_new === 0 && out.pairs_sent === 0 ? 'no_change' : out.pairs_new > 0 || out.pairs_sent > 0 ? 'completed_with_reported_outcome' : 'other_done';
          detail = `${Number.isInteger(out.pairs_new) ? out.pairs_new : 'unknown'} new pairs, ${Number.isInteger(out.pairs_sent) ? out.pairs_sent : 'unknown'} sent`; break;
        }
        case 'repo_health': {
          const f = facts.repo_health; f.runs++;
          const digest = out.completion_evidence?.result_sha256;
          const key = `${job.target_type}:${job.target_id}:${digest}`;
          if (digest && digests.has(key)) f.repeated_digest++;
          if (digest) digests.add(key);
          if (out.tests?.ran === true) { f.tests_ran++; f.tests_passed += Number(out.tests.ok === true); f.tests_failed += Number(out.tests.ok === false); category = 'completed_with_reported_outcome'; }
          else { if (out.tests?.ran === false) f.tests_not_run++; else f.tests_unknown++; category = 'observations'; }
          detail = out.tests?.ran === true ? `Tests ran: ${out.tests.ok === true ? 'passed' : out.tests.ok === false ? 'FAILED' : 'unknown result'}` : out.tests?.ran === false ? 'Repository observed; tests did not run' : 'Repository observed; test execution unknown'; break;
        }
        case 'local_analysis': {
          const f = facts.local_analysis;
          const presence = job.evidence_presence ?? evidencePresence(job.evidence ?? job.context ?? job.input?.evidence ?? job.input?.context);
          if (out.status === 'abstained') { f.abstained++; category = 'abstained'; detail = short(out.reason || 'abstained'); }
          else if (presence === 'unknown') { f.evidence_unknown++; category = 'other_done'; detail = 'Evidence presence unknown: inspection bound reached; not a verified diagnosis'; }
          else if (presence === 'empty') { f.empty_evidence++; category = 'empty_evidence'; detail = 'Model response with no supplied evidence; not a verified diagnosis'; }
          else { f.with_evidence++; category = 'completed_with_reported_outcome'; detail = `Input-backed analysis (not independently verified): ${detail}`; }
          break;
        }
        case 'objective_reflection':
          facts.reflection.runs++; facts.reflection.children_queued += count(out.queued_child_count ?? out.queued_jobs?.length);
          category = 'planning'; detail = `${out.queued_child_count ?? out.queued_jobs?.length ?? 'unknown'} child jobs queued; child completion not implied`; break;
        case 'host_health': category = 'observations'; facts.health.failing_observations += Number(['fail', 'degraded'].includes(out.overall)); break;
        case 'code_patch':
          category = out.changed === true && out.commit ? 'completed_with_reported_outcome' : out.changed === false ? 'no_change' : 'other_done';
          detail = out.changed === true ? `Commit ${short(out.commit, 40)}; pushed=${out.pushed === true}` : out.changed === false ? 'No code change' : 'Code outcome unknown'; break;
        default: break;
      }
      outcomes[category]++;
    } else if (job.status === 'failed') detail = short(job.last_error || 'No error recorded');
    else detail = `Current state: ${job.status}; not completed`;
    details.push({ id: job.id, job_type: job.job_type, target_id: job.target_id, category, detail, attention: job.status === 'failed' || out.tests?.ok === false || ['fail', 'degraded'].includes(out.overall) });
  }
  // Factual buckets, not a guessed usefulness score. Repeated news runs are
  // aggregated, leaving the detail slots for work, failures and test outcomes.
  const priority = ['failed', 'completed_with_reported_outcome', 'empty_evidence', 'abstained', 'running', 'planning', 'queued', 'other_done', 'observations', 'no_change'];
  const candidates = details.filter(item => !['prim3_agent_news', 'world_news_pairing'].includes(item.job_type) || item.category === 'failed');
  candidates.sort((a, b) => Number(b.attention) - Number(a.attention) || priority.indexOf(a.category) - priority.indexOf(b.category));
  const p = facts.prim3, r = facts.repo_health, a = facts.local_analysis, w = facts.pairing;
  const lines = [
    `McCluster Core ${coverage.window_hours}h: ${coverage.status.toUpperCase()} scan, ${jobs.length} updated rows (read-time states, not executions or a snapshot).`,
    `States: ${counts.done || 0} done, ${counts.failed || 0} failed, ${counts.running || 0} running, ${counts.queued || 0} queued.`,
    `Done breakdown: ${outcomes.completed_with_reported_outcome} reported outcomes, ${outcomes.no_change} no-change, ${outcomes.observations} observations, ${outcomes.planning} planning, ${outcomes.empty_evidence} empty-evidence, ${outcomes.abstained} abstained, ${outcomes.other_done} other.`,
    `Tests: ${r.tests_ran} ran (${r.tests_passed} passed, ${r.tests_failed} failed); ${r.tests_not_run} repo checks without tests, ${r.tests_unknown} unknown; ${r.repeated_digest} repeated results.`,
    `Analysis: ${a.with_evidence} input-backed, ${a.empty_evidence} empty-evidence, ${a.abstained} abstained, ${a.evidence_unknown} unknown. Reflection queued ${facts.reflection.children_queued} children (not completed work).`,
    `PRIM3: ${p.comments} comments, ${p.briefs} briefs in ${p.runs} runs; ${p.zero_change} zero-change, ${p.unknown_outputs} unknown. Pairing: ${w.new_pairs} new/${w.sent_pairs} sent in ${w.runs} runs; ${w.zero_new_pairs} zero-new, ${w.unknown_outputs} unknown.`,
    ...candidates.slice(0, 6).map(item => `${item.job_type} [${item.category}] ${short(item.target_id, 60)}: ${item.detail}`),
    'Counts describe read-time states of rows updated in the window, not executions or historical failures after retries; not a transactional snapshot. No-change can be legitimate. Input-backed and recorded evidence are not independent verification.',
  ];
  return { body: lines.join('\n'), counts, outcomes, facts, details: candidates.slice(0, 20), jobs: jobs.length, coverage };
}
