import { scoreMetrics } from './router.js';

function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function db(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(env), ...(options.headers || {}) }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error('Social database request failed'), { status: res.status, detail: data });
  return data;
}

async function patch(env, table, id, values) {
  const rows = await db(env, `${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  return rows?.[0] || null;
}

async function insert(env, table, values, prefer = 'return=representation') {
  const rows = await db(env, table, {
    method: 'POST',
    headers: { prefer },
    body: JSON.stringify(values)
  });
  return rows?.[0] || null;
}

function graphVersion(env) {
  return env.META_GRAPH_API_VERSION || 'v26.0';
}

async function graphGet(env, path, token) {
  const res = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok || data?.error) throw Object.assign(new Error(data?.error?.message || 'Meta Graph API request failed'), { status: res.status, detail: data });
  return data;
}

async function graphPost(env, path, token, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok || data?.error) throw Object.assign(new Error(data?.error?.message || 'Meta Graph API request failed'), { status: res.status, detail: data });
  return data;
}

/**
 * `credential_ref` is the NAME of a Worker secret, and `env[ref]` is an
 * unrestricted dynamic lookup over every binding this Worker has. The
 * name arrives from a row that an API caller created, so the shape rule
 * is re-applied HERE as well as at the write — a row that predates the
 * CHECK constraint in 0060, or one written by any future path that
 * forgets to validate, still cannot select an unrelated secret.
 *
 * Same regex as the constraint and as router.js, deliberately: three
 * copies of one rule is fine when the rule is "these characters only".
 */
const CREDENTIAL_REF_SHAPE = /^SOCIAL_[A-Z0-9_]{1,64}$/;

function tokenFor(env, account) {
  const ref = account?.credential_ref;
  if (!ref || !CREDENTIAL_REF_SHAPE.test(String(ref))) return null;
  return env[ref] || null;
}

async function resolveVideoUrl(env, job) {
  if (job.payload?.video_url) return job.payload.video_url;
  if (!job.payload?.video_asset_id) return null;
  const rows = await db(env, `media_assets?id=eq.${encodeURIComponent(job.payload.video_asset_id)}&org_id=eq.${encodeURIComponent(job.org_id)}&select=url&limit=1`);
  return rows?.[0]?.url || null;
}

async function accountForJob(env, job) {
  const rows = await db(env, `social_accounts?id=eq.${encodeURIComponent(job.account_id)}&org_id=eq.${encodeURIComponent(job.org_id)}&platform=eq.instagram&select=*&limit=1`);
  return rows?.[0] || null;
}

async function beginInstagramPublish(env, job, account, token) {
  const videoUrl = await resolveVideoUrl(env, job);
  if (!videoUrl) throw new Error('Publish job has no resolvable video URL');
  const params = {
    media_type: 'REELS',
    video_url: videoUrl,
    caption: job.payload?.caption || ''
  };
  if (job.payload?.share_to_feed !== false) params.share_to_feed = 'true';
  if (job.publish_mode === 'trial') {
    const graduation = ['MANUAL', 'SS_PERFORMANCE'].includes(job.payload?.graduation_strategy)
      ? job.payload.graduation_strategy
      : 'MANUAL';
    params.trial_params = JSON.stringify({ graduation_strategy: graduation });
  }
  const created = await graphPost(env, `${encodeURIComponent(account.external_account_id)}/media`, token, params);
  if (!created?.id) throw new Error('Meta did not return a creation container id');
  await patch(env, 'social_publish_jobs', job.id, {
    state: 'processing',
    external_creation_id: created.id,
    attempts: Number(job.attempts || 0) + 1,
    last_error: null
  });
  return { state: 'processing', creation_id: created.id };
}

async function finishInstagramPublish(env, job, account, token) {
  if (!job.external_creation_id) throw new Error('Processing publish job is missing its creation container id');
  const status = await graphGet(env, `${encodeURIComponent(job.external_creation_id)}?fields=status_code`, token);
  const code = status?.status_code || 'UNKNOWN';
  if (code === 'IN_PROGRESS') return { state: 'processing', status_code: code };
  if (['ERROR', 'EXPIRED'].includes(code)) throw new Error(`Instagram creation container ${code.toLowerCase()}`);
  if (code !== 'FINISHED') return { state: 'processing', status_code: code };

  const published = await graphPost(env, `${encodeURIComponent(account.external_account_id)}/media_publish`, token, {
    creation_id: job.external_creation_id
  });
  if (!published?.id) throw new Error('Meta did not return a published media id');

  await patch(env, 'social_publish_jobs', job.id, {
    state: 'published',
    external_media_id: published.id,
    attempts: Number(job.attempts || 0) + 1,
    last_error: null
  });

  const existing = await db(env, `social_posts?account_id=eq.${encodeURIComponent(account.id)}&external_media_id=eq.${encodeURIComponent(published.id)}&select=*&limit=1`);
  const post = existing?.[0] || await insert(env, 'social_posts', {
    org_id: job.org_id,
    account_id: job.account_id,
    campaign_id: job.campaign_id || null,
    variant_id: job.variant_id || null,
    publish_job_id: job.id,
    external_media_id: published.id,
    publish_mode: job.publish_mode,
    caption: job.payload?.caption || '',
    published_at: new Date().toISOString(),
    metadata: { meta_creation_id: job.external_creation_id }
  });

  return { state: 'published', media_id: published.id, post_id: post?.id || null };
}

async function processPublishJob(env, job) {
  const account = await accountForJob(env, job);
  if (!account) throw new Error('Instagram account is missing or does not belong to this organization');
  const token = tokenFor(env, account);
  if (!token) return { state: job.state, deferred: true, reason: 'credential_secret_not_configured' };
  if (job.state === 'queued') return beginInstagramPublish(env, job, account, token);
  if (job.state === 'processing') return finishInstagramPublish(env, job, account, token);
  return { state: job.state, skipped: true };
}

/** How long a claimer owns a job before another run may take it back.
 *  Longer than any single publish should take, shorter than the pain of
 *  a stuck job. The cron fires every five minutes, so ten gives a slow
 *  Meta call room to finish without letting a dead Worker strand work
 *  for long. */
const LEASE_MS = 10 * 60 * 1000;

/**
 * Take exclusive ownership of one job, or return null.
 *
 * This is the fix for the worst bug in the social engine. The queue was
 * read with `state in ('queued','processing')` and then published in a
 * plain loop, with nothing between the read and the call to Meta — and
 * 'processing' is the state set AFTER a media container is created and
 * BEFORE media_publish is called. So two overlapping cron runs did not
 * merely race for a queued job: the second re-selected a job the first
 * was mid-way through publishing, and called media_publish on the same
 * container again. The client's Reel goes out twice.
 *
 * `dedupe_key` never helped — it is unique on our table and says nothing
 * about how many times we called Instagram.
 *
 * The PATCH below is a real compare-and-swap. Postgres makes a
 * concurrent updater block on the row lock, then re-evaluate the WHERE
 * against the committed new version; the loser matches nothing and gets
 * zero rows back. Zero rows means someone else owns this job.
 *
 * The lease EXPIRES rather than being released, because the failure it
 * has to survive is a Worker dying mid-publish. A lock that needed
 * releasing would strand that job forever.
 */
async function claimJob(env, job, runId) {
  const now = new Date();
  const claimed = await db(
    env,
    `social_publish_jobs?id=eq.${encodeURIComponent(job.id)}` +
      `&or=(lease_until.is.null,lease_until.lt.${encodeURIComponent(now.toISOString())})`,
    {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        lease_owner: runId,
        lease_until: new Date(now.getTime() + LEASE_MS).toISOString(),
        updated_at: now.toISOString()
      })
    }
  );
  return claimed?.[0] || null;
}

export async function processInstagramPublishQueue(env, { limit = 10 } = {}) {
  const now = new Date().toISOString();
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  // A run identity so a leased row says who holds it. Informational —
  // the lease is enforced by lease_until, not by this string.
  const runId = crypto.randomUUID();
  const jobs = await db(env, `social_publish_jobs?state=in.(queued,processing)&scheduled_at=lte.${encodeURIComponent(now)}&order=scheduled_at.asc&limit=${safeLimit}&select=*`);
  const results = [];
  let skipped = 0;
  for (const candidate of jobs || []) {
    // Claim BEFORE anything reaches Meta. Everything after this point
    // works from the freshly-read `job`, not the candidate row, because
    // the claim returns the row as it actually is now.
    const job = await claimJob(env, candidate, runId);
    if (!job) { skipped += 1; continue; }
    try {
      const outcome = await processPublishJob(env, job);
      // The lease covers ONE PHASE, not the whole job. Publishing is
      // deliberately two-phase — create the container, then publish it
      // once Meta reports FINISHED — and the second phase is meant to be
      // picked up by a later run. Holding the lease across both would
      // make every post wait out the full lease window before it could
      // finish, turning a safety mechanism into a ten-minute delay.
      //
      // So: release unless the job is done. 'published' is terminal;
      // 'failed' is set in the catch below, which releases separately.
      if (outcome?.state !== 'published') {
        await patch(env, 'social_publish_jobs', job.id, { lease_until: null, lease_owner: null });
      }
      results.push({ id: job.id, ...outcome });
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const terminal = attempts >= 5;
      await patch(env, 'social_publish_jobs', job.id, {
        state: terminal ? 'failed' : job.state,
        attempts,
        last_error: error instanceof Error ? error.message : String(error),
        // Hand a failed-but-retryable job straight back, rather than
        // making the next run wait out the full lease for nothing.
        lease_until: terminal ? null : new Date().toISOString()
      });
      results.push({ id: job.id, state: terminal ? 'failed' : job.state, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: jobs?.length || 0, claimed: results.length, skipped_leased: skipped, results };
}

function metricValue(payload) {
  const value = payload?.data?.[0]?.values?.[0]?.value;
  return typeof value === 'number' ? value : Number(value || 0);
}

async function safeInsight(env, mediaId, metric, token) {
  try {
    const payload = await graphGet(env, `${encodeURIComponent(mediaId)}/insights?metric=${encodeURIComponent(metric)}`, token);
    return metricValue(payload);
  } catch {
    return null;
  }
}

async function syncPostInsights(env, post) {
  const accounts = await db(env, `social_accounts?id=eq.${encodeURIComponent(post.account_id)}&org_id=eq.${encodeURIComponent(post.org_id)}&platform=eq.instagram&select=*&limit=1`);
  const account = accounts?.[0];
  const token = tokenFor(env, account);
  if (!account || !token) return { deferred: true, reason: 'credential_secret_not_configured' };

  let fields = {};
  try {
    fields = await graphGet(env, `${encodeURIComponent(post.external_media_id)}?fields=like_count,comments_count,permalink,timestamp`, token);
  } catch {
    fields = {};
  }

  const [views, reach, saved, shares] = await Promise.all([
    safeInsight(env, post.external_media_id, 'views', token),
    safeInsight(env, post.external_media_id, 'reach', token),
    safeInsight(env, post.external_media_id, 'saved', token),
    safeInsight(env, post.external_media_id, 'shares', token)
  ]);

  const metrics = {
    views: views ?? 0,
    reach: reach ?? 0,
    likes: Number(fields.like_count || 0),
    comments: Number(fields.comments_count || 0),
    shares: shares ?? 0,
    saves: saved ?? 0,
    follows: 0,
    profile_visits: 0,
    dms: 0,
    leads: 0,
    watch_time_seconds: 0,
    avg_watch_time_seconds: 0,
    retention_3s: null
  };
  const scored = scoreMetrics(metrics);
  const snapshot = await insert(env, 'social_metric_snapshots', {
    org_id: post.org_id,
    post_id: post.id,
    ...metrics,
    score: scored.score,
    raw: { graph_fields: fields, synced_metrics: ['views', 'reach', 'saved', 'shares'] }
  });
  if (post.variant_id) await patch(env, 'social_variants', post.variant_id, { score: scored.score, score_components: scored.components });
  if (fields.permalink && fields.permalink !== post.permalink) await patch(env, 'social_posts', post.id, { permalink: fields.permalink });
  return { post_id: post.id, snapshot_id: snapshot?.id || null, score: scored.score };
}

export async function syncInstagramInsights(env, { limit = 5 } = {}) {
  const safeLimit = Math.min(10, Math.max(1, Number(limit) || 5));
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const posts = await db(env, `social_posts?published_at=gte.${encodeURIComponent(since)}&order=published_at.desc&limit=${safeLimit}&select=id,org_id,account_id,variant_id,external_media_id,permalink,published_at`);
  const results = [];
  for (const post of posts || []) {
    try { results.push(await syncPostInsights(env, post)); }
    catch (error) { results.push({ post_id: post.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { checked: posts?.length || 0, results };
}
