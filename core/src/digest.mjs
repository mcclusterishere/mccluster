import { addSignal, houseOrgId, recentJobs, rest } from './supabase.mjs';
import { sendSms } from './notifier.mjs';

const ORG_ID = process.env.MCCLUSTER_ORG_ID || '';
const HOURS = Number(process.env.MCCLUSTER_DIGEST_HOURS || 12);

function short(value, max = 220) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function describe(job) {
  const target = [job.target_type, job.target_id].filter(Boolean).join(':');
  if (job.status === 'done') {
    const summary = job.output?.summary || job.output?.analysis?.summary || job.output?.repo || 'completed';
    return `✓ ${job.job_type}${target ? ` (${target})` : ''}: ${short(summary, 180)}`;
  }
  if (job.status === 'failed') return `✗ ${job.job_type}${target ? ` (${target})` : ''}: ${short(job.last_error, 180)}`;
  if (job.status === 'running') return `→ ${job.job_type}${target ? ` (${target})` : ''} is still running`;
  return `· ${job.job_type}${target ? ` (${target})` : ''} ${job.status}`;
}

export async function buildDigest() {
  const jobs = await recentJobs({ orgId: ORG_ID || undefined, sinceHours: HOURS, limit: 40 });
  const counts = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  const headline = `McCluster Core ${HOURS}h: ${counts.done || 0} done, ${counts.failed || 0} failed, ${counts.running || 0} running, ${counts.queued || 0} queued.`;
  const interesting = jobs.filter((job) => ['done', 'failed', 'running'].includes(job.status)).slice(0, 6);
  const body = [headline, ...interesting.map(describe)].join('\n').slice(0, 1450);
  return { body, counts, jobs: jobs.length };
}

/* THE REPORT IS THE SUCCESS CONDITION.
   Audit finding C7: the record step caught its own failure and the process
   still exited 0, so a systemd timer could look green with no canonical daily
   report. Now the window has a stable identity, an existing report for the
   same window is reused instead of duplicated, a failed write is a failed
   run (exit 1), and SMS delivery stays optional: its failure never erases or
   fails an already persisted report. */
export function digestWindowId(now = new Date(), hours = HOURS) {
  const span = Math.max(1, Number(hours) || 12) * 3_600_000;
  const start = new Date(Math.floor(now.getTime() / span) * span).toISOString();
  return `core_morning_digest:${start}/${Math.max(1, Number(hours) || 12)}h`;
}

async function existingReport(orgId, windowId) {
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`, signal_type: 'eq.core_morning_digest', 'payload->>window_id': `eq.${windowId}`,
    select: 'id,payload', limit: '1',
  });
  const { body: rows = [] } = await rest(`ops_signals?${params.toString()}`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function markDelivered(signal, sms) {
  try {
    await rest(`ops_signals?id=eq.${encodeURIComponent(signal.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ payload: { ...(signal.payload || {}), sms_sent: true, sms_sid: sms?.sid || null } }),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'core_digest_delivery_mark_failed', message: error.message }));
  }
}

async function main() {
  const digest = await buildDigest();
  const orgId = ORG_ID || (await houseOrgId());
  if (!orgId) throw Object.assign(new Error('house org id unavailable; the daily report cannot be recorded'), { code: 'core_digest_record_failed' });
  const windowId = digestWindowId();

  let signal = null;
  let duplicate = false;
  try {
    signal = await existingReport(orgId, windowId);
    if (signal) duplicate = true;
    else {
      signal = await addSignal({
        orgId,
        kind: 'core_morning_digest',
        body: digest.body,
        severity: digest.counts.failed ? 'warn' : 'info',
        metadata: { counts: digest.counts, jobs: digest.jobs, window_hours: HOURS, window_id: windowId, sms_sent: false },
      });
      if (!signal) throw new Error('ops_signals insert returned no row');
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'core_digest_record_failed', window_id: windowId, message: error.message }));
    throw Object.assign(new Error(`daily report was not persisted for ${windowId}: ${error.message}`), { code: 'core_digest_record_failed' });
  }

  let sms;
  if (duplicate && signal.payload?.sms_sent === true) sms = { sent: false, reason: 'already_delivered' };
  else {
    try { sms = await sendSms(digest.body); }
    catch (error) { sms = { sent: false, reason: 'delivery_error', error: String(error.message || error).slice(0, 300) }; }
    if (sms?.sent) await markDelivered(signal, sms);
  }
  console.log(JSON.stringify({ event: 'core_digest', ...digest, recorded: true, duplicate_window: duplicate, window_id: windowId, signal_id: signal.id || null, org_id: orgId, sms }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'core_digest_failed', message: error.message }));
    process.exitCode = 1;
  });
}
