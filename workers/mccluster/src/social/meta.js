import { scoreMetrics } from './router.js';
import { credentialRefForConfiguredChannel, parseSocialCredentialRef } from './security.js';

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

async function tokenFor(env, account) {
  if (!account?.org_id || String(account.platform || '').toLowerCase() !== 'instagram') return null;
  const rows = await db(env, `org_channels?org_id=eq.${encodeURIComponent(account.org_id)}&channel=eq.instagram&enabled=eq.true&select=token_env,secret_id,account_id&limit=1`);
  const channel = rows?.[0] || null;
  if (!channel) return null;
  if (channel.account_id && String(channel.account_id) !== String(account.external_account_id)) return null;

  const ref = credentialRefForConfiguredChannel('instagram', channel);
  const parsed = parseSocialCredentialRef('instagram', ref);
  if (!parsed) return null;
  if (parsed.kind === 'env') return env[parsed.name] || null;
  if (parsed.kind === 'vault') {
    const token = await db(env, 'rpc/vault_secret', {
      method: 'POST',
      body: JSON.stringify({ p_id: parsed.id })
    });
    return typeof token === 'string' && token ? token : null;
  }
  return null;
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
    last_error: null,
    lease_owner: null,
    lease_expires_at: null
  });
  return { state: 'processing', creation_id: created.id };
}

async function finishInstagramPublish(env, job, account, token) {
  if (!job.external_creation_id) throw new Error('Processing publish job is missing its creation container id');
  const status = await graphGet(env, `${encodeURIComponent(job.external_creation_id)}?fields=status_code`, token);
  const code = status?.status_code || 'UNKNOWN';
  if (code === 'IN_PROGRESS') {
    await patch(env, 'social_publish_jobs', job.id, { lease_owner: null, lease_expires_at: null });
    return { state: 'processing', status_code: code };
  }
  if (['ERROR', 'EXPIRED'].includes(code)) throw new Error(`Instagram creation container ${code.toLowerCase()}`);
  if (code !== 'FINISHED') {
    await patch(env, 'social_publish_jobs', job.id, { lease_owner: null, lease_expires_at: null });
    return { state: 'processing', status_code: code };
  }

  const published = await graphPost(env, `${encodeURIComponent(account.external_account_id)}/media_publish`, token, {
    creation_id: job.external_creation_id
  });
  if (!published?.id) throw new Error('Meta did not return a published media id');

  await patch(env, 'social_publish_jobs', job.id, {
    state: 'published',
    external_media_id: published.id,
    attempts: Number(job.attempts || 0) + 1,
    last_error: null,
    lease_owner: null,
    lease_expires_at: null
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
  const token = await tokenFor(env, account);
  if (!token) {
    await patch(env, 'social_publish_jobs', job.id, {
      lease_owner: null,
      lease_expires_at: null,
      last_error: 'credential_secret_not_configured'
    });
    return { state: job.state, deferred: true, reason: 'credential_secret_not_configured' };
  }
  if (job.state === 'queued') return beginInstagramPublish(env, job, account, token);
  if (job.state === 'processing') return finishInstagramPublish(env, job, account, token);
  await patch(env, 'social_publish_jobs', job.id, { lease_owner: null, lease_expires_at: null });
  return { state: job.state, skipped: true };
}

async function claimPublishJobs(env, limit) {
  const leaseOwner = crypto.randomUUID();
  const jobs = await db(env, 'rpc/claim_social_publish_jobs', {
    method: 'POST',
    body: JSON.stringify({
      p_lease_owner: leaseOwner,
      p_limit: limit,
      p_lease_seconds: 120
    })
  });
  return Array.isArray(jobs) ? jobs : [];
}

export async function processInstagramPublishQueue(env, { limit = 10 } = {}) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  const jobs = await claimPublishJobs(env, safeLimit);
  const results = [];
  for (const job of jobs) {
    try {
      results.push({ id: job.id, ...(await processPublishJob(env, job)) });
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const terminal = attempts >= 5;
      await patch(env, 'social_publish_jobs', job.id, {
        state: terminal ? 'failed' : job.state,
        attempts,
        last_error: error instanceof Error ? error.message : String(error),
        lease_owner: null,
        lease_expires_at: null
      });
      results.push({ id: job.id, state: terminal ? 'failed' : job.state, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: jobs.length, results };
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

function nextInsightsAt(publishedAt, now = new Date()) {
  const published = new Date(publishedAt || now);
  const ageMs = Math.max(0, now.getTime() - published.getTime());
  let delayMs = 15 * 60 * 1000;
  if (ageMs >= 24 * 60 * 60 * 1000 && ageMs < 72 * 60 * 60 * 1000) delayMs = 60 * 60 * 1000;
  if (ageMs >= 72 * 60 * 60 * 1000) delayMs = 6 * 60 * 60 * 1000;
  return new Date(now.getTime() + delayMs).toISOString();
}

async function syncPostInsights(env, post) {
  const accounts = await db(env, `social_accounts?id=eq.${encodeURIComponent(post.account_id)}&org_id=eq.${encodeURIComponent(post.org_id)}&platform=eq.instagram&select=*&limit=1`);
  const account = accounts?.[0];
  const token = await tokenFor(env, account);
  if (!account || !token) {
    await patch(env, 'social_posts', post.id, {
      next_insights_sync_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    return { post_id: post.id, deferred: true, reason: 'credential_secret_not_configured' };
  }

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

  const syncedAt = new Date();
  await patch(env, 'social_posts', post.id, {
    ...(fields.permalink ? { permalink: fields.permalink } : {}),
    last_insights_synced_at: syncedAt.toISOString(),
    next_insights_sync_at: nextInsightsAt(post.published_at, syncedAt)
  });
  return { post_id: post.id, snapshot_id: snapshot?.id || null, score: scored.score };
}

async function claimInsightPosts(env, limit) {
  const posts = await db(env, 'rpc/claim_social_insight_posts', {
    method: 'POST',
    body: JSON.stringify({ p_limit: limit })
  });
  return Array.isArray(posts) ? posts : [];
}

export async function syncInstagramInsights(env, { limit = 25 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const posts = await claimInsightPosts(env, safeLimit);
  const results = [];
  for (const post of posts) {
    try {
      results.push(await syncPostInsights(env, post));
    } catch (error) {
      try {
        await patch(env, 'social_posts', post.id, {
          next_insights_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });
      } catch {}
      results.push({ post_id: post.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: posts.length, results };
}
