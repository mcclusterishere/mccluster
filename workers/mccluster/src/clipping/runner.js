/* The clipping cron: every due clip is read from its platform and recorded
   through the service-only database functions, which decide everything that
   touches money (supabase/pending/action_clipping_marketplace_v1.sql). This
   file only carries platform facts to them. */
import { readClip } from './platforms.js';

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

export function serviceRpc(env) {
  return async function rpc(name, args) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: serviceHeaders(env),
      body: JSON.stringify(args || {})
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw Object.assign(new Error(data?.message || `${name} failed`), { status: res.status, detail: data });
    return data;
  };
}

export async function runClipping(env, { limit = 25, now = Date.now() } = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { skipped: 'not configured' };
  const rpc = serviceRpc(env);
  let due;
  try {
    due = await rpc('clip_work_due', { p_limit: limit });
  } catch (error) {
    // before the clipping migration is applied the function does not exist
    if (error?.status === 404 || error?.detail?.code === 'PGRST202') return { skipped: 'not provisioned' };
    throw error;
  }
  const results = [];
  for (const job of Array.isArray(due) ? due : []) {
    try {
      const read = await readClip(env, job, rpc);
      const fn = job.status === 'submitted' ? 'clip_record_verification' : 'clip_record_metrics';
      const out = await rpc(fn, { p_submission: job.submission_id, p: read });
      results.push({ submission_id: job.submission_id, status: out?.status || null, waiting: out?.waiting || out?.deferred || false });
    } catch (error) {
      // the row stays leased for ten minutes, then comes due again
      results.push({ submission_id: job.submission_id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const released = await rpc('clip_release_due', {});
  const conversions = await rpc('clip_attribute_conversions', { p_since: new Date(now - 2 * 24 * 3600 * 1000).toISOString() });
  return { checked: results.length, results, released: released?.released || 0, conversions: conversions?.conversions || 0 };
}
