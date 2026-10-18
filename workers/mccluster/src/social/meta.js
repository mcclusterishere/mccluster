import { recordEvent } from '../lib/observability.js';
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

export async function graphGet(env, path, token) {
  const res = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
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

export async function tokenFor(env, account) {
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

/* A video uploaded in Control sits in the private social-outbox bucket.
   Meta fetches it from a link signed for a day, long enough for Meta's own
   processing and retries, and the file itself never becomes public. */
export const OUTBOX_BUCKET = 'social-outbox';
async function signOutboxUrl(env, storagePath) {
  const objectPath = String(storagePath).split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${OUTBOX_BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ expiresIn: 86400 })
  });
  const data = await res.json().catch(() => ({}));
  const signed = data?.signedURL || data?.signedUrl;
  if (!res.ok || !signed) throw new Error('Could not sign the uploaded video for Instagram');
  return String(signed).startsWith('http') ? signed : `${env.SUPABASE_URL}/storage/v1${signed}`;
}

async function resolveVideoUrl(env, job) {
  if (job.payload?.video_url) return job.payload.video_url;
  if (job.payload?.storage_path) return signOutboxUrl(env, job.payload.storage_path);
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
    content_id: job.content_id || null,
    external_media_id: published.id,
    publish_mode: job.publish_mode,
    caption: job.payload?.caption || '',
    published_at: new Date().toISOString(),
    metadata: { meta_creation_id: job.external_creation_id }
  });

  if (job.content_id) {
    await patch(env, 'social_content_items', job.content_id, { status: 'published' }).catch(() => {});
  }
  return { state: 'published', media_id: published.id, post_id: post?.id || null, content_id: job.content_id || null };
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
    const started = Date.now();
    try {
      const outcome = await processPublishJob(env, job);
      results.push({ id: job.id, ...outcome });
      recordEvent({
        orgId: job.org_id, name: `social.publish.${outcome?.state || 'processed'}`, kind: 'job',
        resourceType: 'social_publish_job', resourceId: job.id, durationMs: Date.now() - started,
        message: `Instagram publish job → ${outcome?.state || 'processed'}`,
        detail: { content_id: job.content_id || null, attempts: Number(job.attempts || 0) }
      });
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const terminal = attempts >= 5;
      recordEvent({
        orgId: job.org_id, name: terminal ? 'social.publish.failed' : 'social.publish.retry', kind: 'job',
        level: terminal ? 'error' : 'warn', outcome: terminal ? 'error' : 'retry',
        resourceType: 'social_publish_job', resourceId: job.id, durationMs: Date.now() - started,
        message: `Instagram publish ${terminal ? 'failed permanently' : 'will retry'}: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`,
        detail: { content_id: job.content_id || null, attempts }
      });
      await patch(env, 'social_publish_jobs', job.id, {
        state: terminal ? 'failed' : job.state,
        attempts,
        last_error: error instanceof Error ? error.message : String(error),
        lease_owner: null,
        lease_expires_at: null
      });
      if (terminal && job.content_id) {
        await patch(env, 'social_content_items', job.content_id, { status: 'failed' }).catch(() => {});
      }
      results.push({ id: job.id, state: terminal ? 'failed' : job.state, content_id: job.content_id || null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: jobs.length, results };
}


async function patchInstagramChannel(env, orgId, values) {
  await db(env, `org_channels?org_id=eq.${encodeURIComponent(orgId)}&channel=eq.instagram&enabled=eq.true`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
}

export async function checkInstagramConnectionHealth(env, { limit = 10, maxAgeMinutes = 55 } = {}) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  const maxAgeMs = Math.max(5, Number(maxAgeMinutes) || 55) * 60 * 1000;
  const staleBefore = Date.now() - maxAgeMs;
  const channels = await db(env, `org_channels?channel=eq.instagram&enabled=eq.true&select=org_id,account_id,last_ok_at,last_error_at&limit=${safeLimit * 4}`);
  const due = (channels || []).filter((channel) => {
    const lastAttempt = [channel.last_ok_at, channel.last_error_at]
      .map((value) => Date.parse(value || ''))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    return !Number.isFinite(lastAttempt) || lastAttempt < staleBefore;
  }).slice(0, safeLimit);
  const results = [];

  for (const channel of due) {
    const orgId = channel.org_id;
    const accountFilter = channel.account_id
      ? `&external_account_id=eq.${encodeURIComponent(channel.account_id)}`
      : '';
    const accounts = await db(env, `social_accounts?org_id=eq.${encodeURIComponent(orgId)}&platform=eq.instagram&status=eq.connected${accountFilter}&select=id,org_id,platform,external_account_id&limit=1`);
    const account = accounts?.[0] || null;
    const checkedAt = new Date().toISOString();

    if (!account) {
      const message = 'connected_instagram_account_missing';
      await patchInstagramChannel(env, orgId, { last_error: message, last_error_at: checkedAt });
      results.push({ org_id: orgId, connected: false, reason: message });
      continue;
    }

    const token = await tokenFor(env, account);
    if (!token) {
      const message = 'credential_secret_not_configured';
      await patchInstagramChannel(env, orgId, { last_error: message, last_error_at: checkedAt });
      results.push({ org_id: orgId, account_id: account.id, connected: false, reason: message });
      continue;
    }

    try {
      const me = await graphGet(env, `${encodeURIComponent(account.external_account_id)}?fields=username,followers_count,media_count`, token);
      await Promise.all([
        patchInstagramChannel(env, orgId, { last_ok_at: checkedAt, last_error: null, last_error_at: null }),
        patch(env, 'social_accounts', account.id, { last_synced_at: checkedAt, provider_metrics: { recorded_at: checkedAt, followers: me?.followers_count ?? null, media_count: me?.media_count ?? null } })
      ]);
      results.push({
        org_id: orgId,
        account_id: account.id,
        connected: true,
        username: me?.username || null,
        followers: me?.followers_count ?? null,
        media_count: me?.media_count ?? null
      });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await patchInstagramChannel(env, orgId, { last_error: message, last_error_at: checkedAt });
      results.push({ org_id: orgId, account_id: account.id, connected: false, reason: 'meta_refused', error: message });
    }
  }

  return { checked: due.length, results };
}

function metricValue(payload) {
  const value = payload?.data?.[0]?.values?.[0]?.value;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
    views, reach,
    likes: typeof fields.like_count === 'number' ? fields.like_count : null,
    comments: typeof fields.comments_count === 'number' ? fields.comments_count : null,
    shares, saves: saved,
    follows: null,
    profile_visits: null,
    dms: null,
    leads: null,
    watch_time_seconds: null,
    avg_watch_time_seconds: null,
    retention_3s: null
  };
  if (Object.values(metrics).every(value => value === null)) throw new Error('instagram_measurements_unavailable');
  const snapshot = await insert(env, 'social_metric_snapshots', {
    org_id: post.org_id,
    post_id: post.id,
    ...metrics,
    score: null,
    source: 'platform_api',
    raw: { graph_fields: fields, measured_metrics: Object.keys(metrics).filter(key => metrics[key] !== null), unavailable_metrics: Object.keys(metrics).filter(key => metrics[key] === null) }
  });

  const syncedAt = new Date();
  await patch(env, 'social_posts', post.id, {
    ...(fields.permalink ? { permalink: fields.permalink } : {}),
    last_insights_synced_at: syncedAt.toISOString(),
    next_insights_sync_at: nextInsightsAt(post.published_at, syncedAt)
  });
  return { post_id: post.id, snapshot_id: snapshot?.id || null, score: null };
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
      const result = await syncPostInsights(env, post);
      results.push(result);
      recordEvent({ orgId: post.org_id, name: 'social.insights.sync', kind: 'job', resourceType: 'social_post', resourceId: post.id, outcome: result.deferred ? 'retry' : 'ok', detail: { snapshot_id: result.snapshot_id || null, reason: result.reason || null } });
    } catch (error) {
      try {
        await patch(env, 'social_posts', post.id, {
          next_insights_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });
      } catch {}
      recordEvent({ orgId: post.org_id, name: 'social.insights.failed', kind: 'job', level: 'warn', outcome: 'retry', resourceType: 'social_post', resourceId: post.id, message: 'Provider measurements unavailable; retry scheduled' });
      results.push({ post_id: post.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: posts.length, results };
}


// One bounded page per account/tick. Ignore duplicate posts so discovery cannot
// overwrite campaign, variant or publishing links. Never follow provider next URLs.
export async function discoverInstagramMedia(env, { limit = 5 } = {}) {
  const accounts = await db(env, 'rpc/claim_instagram_discovery_accounts', {
    method: 'POST', body: JSON.stringify({ p_limit: Math.min(10, Math.max(1, Number(limit) || 5)) })
  });
  const results = [];
  for (const account of accounts || []) {
    try {
      const token = await tokenFor(env, account);
      if (!token) throw new Error('credential_secret_not_configured');
      const query = new URLSearchParams({ fields: 'id,caption,media_type,media_product_type,permalink,timestamp', limit: '50' });
      if (account.media_discovery_cursor) query.set('after', account.media_discovery_cursor);
      const page = await graphGet(env, `${encodeURIComponent(account.external_account_id)}/media?${query}`, token);
      if (!Array.isArray(page?.data)) throw new Error('instagram_media_invalid_payload');
      const rows = page.data.map(media => {
        if (!media.id || !Number.isFinite(Date.parse(media.timestamp))) throw new Error('instagram_media_invalid_record');
        return { org_id: account.org_id, account_id: account.id, external_media_id: String(media.id),
          permalink: media.permalink || null, caption: media.caption || null, publish_mode: 'imported',
          published_at: new Date(media.timestamp).toISOString(), metadata: { source: 'meta_graph', media_type: media.media_type, media_product_type: media.media_product_type } };
      });
      const inserted = rows.length ? await db(env, 'social_posts?on_conflict=account_id,external_media_id', {
        method: 'POST', headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(rows)
      }) : [];
      const cursor = page.paging?.next ? page.paging?.cursors?.after : null;
      if (page.paging?.next && (!cursor || cursor === account.media_discovery_cursor)) throw new Error('instagram_media_cursor_stalled');
      await patch(env, 'social_accounts', account.id, {
        media_discovery_cursor: cursor || null, last_media_discovery_at: new Date().toISOString(), media_discovery_error: null,
        next_media_discovery_at: new Date(Date.now() + (cursor ? 5 : 60) * 60000).toISOString()
      });
      recordEvent({ orgId: account.org_id, name: 'social.media.discovered', kind: 'job', resourceType: 'social_account', resourceId: account.id, detail: { seen: rows.length, imported: inserted?.length || 0 } });
      results.push({ account_id: account.id, seen: rows.length, imported: inserted?.length || 0, has_more: Boolean(cursor) });
    } catch (error) {
      // Only codes are persisted; provider errors can include request details.
      const code = error?.detail?.error?.code;
      const reason = code ? `meta_error_${code}` : 'instagram_media_discovery_failed';
      await patch(env, 'social_accounts', account.id, { media_discovery_error: reason,
        next_media_discovery_at: new Date(Date.now() + 60 * 60000).toISOString() });
      recordEvent({ orgId: account.org_id, name: 'social.media.discovery_failed', kind: 'job', level: 'warn', outcome: 'retry', resourceType: 'social_account', resourceId: account.id, message: reason });
      results.push({ account_id: account.id, error: reason });
    }
  }
  return { checked: accounts?.length || 0, results };
}
