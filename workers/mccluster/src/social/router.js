import { createGeneration } from '../media/router.js';
import { credentialRefForConfiguredChannel, requireOrgId, requireOrgRole } from './security.js';

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

async function bodyJson(request) {
  try { return await request.json(); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

async function getOrg(env, userId, requestedOrgId) {
  const orgId = requireOrgId(requestedOrgId);
  const rows = await db(env, `org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(userId)}&select=org_id,role&limit=1`);
  if (!rows?.length) throw Object.assign(new Error('No matching McCluster organization membership found'), { status: 403 });
  return rows[0];
}

/* Resolve the credential the ORG has configured for this platform. It was
   bound to Instagram, so connecting a Facebook or Threads account always
   came back with no credential and a 'disconnected' row — an account that
   could never publish. security.js still decides which platforms may hold
   a binding at all; this only stops assuming there is one. */
async function configuredCredentialRef(env, orgId, platform, externalAccountId) {
  const name = String(platform || '').toLowerCase();
  if (!name) return null;
  const rows = await db(env, `org_channels?org_id=eq.${encodeURIComponent(orgId)}&channel=eq.${encodeURIComponent(name)}&enabled=eq.true&select=token_env,secret_id,account_id&limit=1`);
  const channel = rows?.[0] || null;
  if (!channel) return null;
  if (channel.account_id && String(channel.account_id) !== String(externalAccountId)) {
    throw Object.assign(new Error(`${name} account id does not match the credential configured for this organization`), { status: 409 });
  }
  return credentialRefForConfiguredChannel(name, channel);
}

async function ownedRow(env, table, id, orgId, select = '*') {
  const rows = await db(env, `${table}?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(orgId)}&select=${select}&limit=1`);
  return rows?.[0] || null;
}

async function insert(env, table, value) {
  const rows = await db(env, table, {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(value)
  });
  return rows?.[0] || null;
}

async function patch(env, table, id, value) {
  const rows = await db(env, `${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ ...value, updated_at: new Date().toISOString() })
  });
  return rows?.[0] || null;
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

// `Math.max(0, Number(x))` looks like a clamp but is not one: Number('abc')
// is NaN, and Math.max(0, NaN) is NaN, not 0. Metrics arrive from the Meta
// Graph API and from operator-supplied JSON, so one non-numeric field used
// to poison `score` — and `score` is what the variant generator orders by
// to pick top performers, so a single NaN silently removed a variant from
// consideration forever. Everything numeric goes through num().
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function scoreMetrics(metrics = {}) {
  const views = num(metrics.views);
  const reach = num(metrics.reach) || views;
  const likes = num(metrics.likes);
  const comments = num(metrics.comments);
  const shares = num(metrics.shares);
  const saves = num(metrics.saves);
  const follows = num(metrics.follows);
  const dms = num(metrics.dms);
  const leads = num(metrics.leads);
  const retention = metrics.retention_3s == null ? 0 : clamp(num(metrics.retention_3s), 0, 1);
  const viewScore = clamp(Math.log10(views + 1) * 20, 0, 100);
  const engagementScore = clamp(((likes + comments * 2 + shares * 4 + saves * 4) / Math.max(views, 1)) * 1000, 0, 100);
  const conversionScore = clamp(((follows * 4 + dms * 8 + leads * 15) / Math.max(reach, 1)) * 1000, 0, 100);
  const retentionScore = retention * 100;
  const score = Number((viewScore * 0.20 + engagementScore * 0.35 + conversionScore * 0.25 + retentionScore * 0.20).toFixed(3));
  return { score, components: { views: Number(viewScore.toFixed(3)), engagement: Number(engagementScore.toFixed(3)), conversion: Number(conversionScore.toFixed(3)), retention: Number(retentionScore.toFixed(3)) } };
}

function generationRequest(request, payload) {
  const h = new Headers(request.headers);
  h.set('content-type', 'application/json');
  return new Request(request.url, { method: 'POST', headers: h, body: JSON.stringify(payload) });
}

async function listAccounts(request, env, user) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  const rows = await db(env, `social_accounts?org_id=eq.${encodeURIComponent(org.org_id)}&order=created_at.asc&select=id,org_id,platform,external_account_id,handle,display_name,status,capabilities,settings,last_synced_at,created_at,updated_at`);
  return { org_id: org.org_id, accounts: rows || [] };
}

async function createAccount(request, env, user) {
  const body = await bodyJson(request);
  const org = await getOrg(env, user.id, body.org_id);
  requireOrgRole(org, ['owner']);
  if (!body.platform || !body.external_account_id) throw Object.assign(new Error('platform and external_account_id are required'), { status: 400 });
  if (body.credential_ref != null) {
    throw Object.assign(new Error('credential_ref is server-managed and cannot be supplied by clients'), { status: 400 });
  }
  const platform = String(body.platform).toLowerCase();
  const credentialRef = await configuredCredentialRef(env, org.org_id, platform, body.external_account_id);
  return { account: await insert(env, 'social_accounts', {
    org_id: org.org_id,
    platform,
    external_account_id: String(body.external_account_id),
    handle: body.handle || null,
    display_name: body.display_name || null,
    credential_ref: credentialRef,
    status: credentialRef ? 'connected' : 'disconnected',
    capabilities: body.capabilities || {},
    settings: body.settings || {}
  }) };
}

async function listCampaigns(request, env, user) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  const rows = await db(env, `social_campaigns?org_id=eq.${encodeURIComponent(org.org_id)}&order=created_at.desc&select=*`);
  return { org_id: org.org_id, campaigns: rows || [] };
}

async function createCampaign(request, env, user) {
  const body = await bodyJson(request);
  const org = await getOrg(env, user.id, body.org_id);
  requireOrgRole(org, ['owner']);
  if (!body.account_id || !body.name) throw Object.assign(new Error('account_id and name are required'), { status: 400 });
  const account = await ownedRow(env, 'social_accounts', body.account_id, org.org_id, 'id');
  if (!account) throw Object.assign(new Error('Social account not found in this organization'), { status: 404 });
  return { campaign: await insert(env, 'social_campaigns', {
    org_id: org.org_id,
    account_id: body.account_id,
    name: body.name,
    objective: body.objective || 'growth',
    status: body.status || 'draft',
    source_asset_id: body.source_asset_id || null,
    created_by: user.id,
    settings: body.settings || {},
    starts_at: body.starts_at || null,
    ends_at: body.ends_at || null
  }) };
}

async function generateVariant(request, env, user) {
  const body = await bodyJson(request);
  if (!body.campaign_id || !body.model_id) throw Object.assign(new Error('campaign_id and model_id are required'), { status: 400 });
  const org = await getOrg(env, user.id, body.org_id);
  requireOrgRole(org, ['owner']);
  const campaign = await ownedRow(env, 'social_campaigns', body.campaign_id, org.org_id);
  if (!campaign) throw Object.assign(new Error('Campaign not found in this organization'), { status: 404 });
  const leaders = await db(env, `social_variants?campaign_id=eq.${encodeURIComponent(campaign.id)}&score=not.is.null&order=score.desc&limit=5&select=variant_key,hook,hypothesis,score,score_components`);
  const learning = (leaders || []).map((v) => `${v.variant_key}: score ${v.score}; hook=${v.hook || 'n/a'}; hypothesis=${v.hypothesis || 'n/a'}`).join('\n');
  const prompt = [body.prompt || 'Create a distinct short-form social media variant optimized for retention and conversion.', learning ? `Prior campaign evidence:\n${learning}` : 'No prior campaign evidence exists yet.', body.hypothesis ? `Test hypothesis: ${body.hypothesis}` : ''].filter(Boolean).join('\n\n');
  const job = await createGeneration(generationRequest(request, {
    org_id: org.org_id,
    model_id: body.model_id,
    prompt,
    input: { ...(body.input || {}), prompt: body.input?.prompt || prompt },
    budget_cents: body.budget_cents ?? null
  }), env, user);
  const variant = await insert(env, 'social_variants', {
    org_id: org.org_id,
    campaign_id: campaign.id,
    source_asset_id: body.source_asset_id || campaign.source_asset_id || null,
    media_job_id: job.id,
    variant_key: body.variant_key || `v-${Date.now().toString(36)}`,
    hypothesis: body.hypothesis || null,
    hook: body.hook || null,
    caption: body.caption || null,
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
    status: job.status === 'completed' ? 'ready' : 'generating',
    metadata: { generation_model_id: body.model_id }
  });
  return { campaign_id: campaign.id, variant, media_job: job, learned_from: leaders || [] };
}

async function leaderboard(request, env, user, campaignId) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  const campaign = await ownedRow(env, 'social_campaigns', campaignId, org.org_id, 'id,name,objective,status');
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const variants = await db(env, `social_variants?campaign_id=eq.${encodeURIComponent(campaignId)}&order=score.desc.nullslast,created_at.asc&select=*`);
  return { campaign, variants: variants || [] };
}

async function queuePublish(request, env, user) {
  const body = await bodyJson(request);
  const org = await getOrg(env, user.id, body.org_id);
  requireOrgRole(org, ['owner']);
  if (!body.account_id) throw Object.assign(new Error('account_id is required'), { status: 400 });
  const account = await ownedRow(env, 'social_accounts', body.account_id, org.org_id, 'id,platform');
  if (!account) throw Object.assign(new Error('Social account not found'), { status: 404 });
  const platform = String(account.platform || 'instagram').toLowerCase();
  if (body.variant_id) {
    const variant = await ownedRow(env, 'social_variants', body.variant_id, org.org_id, 'id,campaign_id,output_asset_id,caption');
    if (!variant) throw Object.assign(new Error('Variant not found'), { status: 404 });
    body.campaign_id ||= variant.campaign_id;
    body.video_asset_id ||= variant.output_asset_id;
    body.caption ||= variant.caption;
  }
  /* Instagram's queue is reels, so it needs video. Facebook and Threads
     take text on its own, and refusing a text post for having no video is
     how a publishing plane ends up only able to say things with a camera. */
  const hasMedia = Boolean(body.video_url || body.video_asset_id || body.image_url);
  const hasWords = Boolean((body.caption && String(body.caption).trim()) || body.link);
  let mode;
  if (platform === 'instagram') {
    if (!hasMedia) throw Object.assign(new Error('video_url, video_asset_id, or a ready variant is required'), { status: 400 });
    mode = body.publish_mode || 'trial';
    if (!['trial', 'reel'].includes(mode)) throw Object.assign(new Error('publish_mode must be trial or reel'), { status: 400 });
  } else {
    if (!hasMedia && !hasWords) throw Object.assign(new Error('a caption, link, image or video is required'), { status: 400 });
    mode = body.publish_mode || 'post';
    if (mode !== 'post') throw Object.assign(new Error('publish_mode must be post for this platform'), { status: 400 });
  }
  return { publish_job: await insert(env, 'social_publish_jobs', {
    org_id: org.org_id,
    account_id: body.account_id,
    campaign_id: body.campaign_id || null,
    variant_id: body.variant_id || null,
    publish_mode: mode,
    scheduled_at: body.scheduled_at || new Date().toISOString(),
    state: 'queued',
    dedupe_key: body.dedupe_key || `${body.account_id}:${body.variant_id || body.video_asset_id || body.video_url || body.image_url || body.link || (body.caption || '').slice(0, 80)}:${body.scheduled_at || 'now'}:${mode}`,
    payload: {
      video_url: body.video_url || null,
      video_asset_id: body.video_asset_id || null,
      image_url: body.image_url || null,
      link: body.link || null,
      caption: body.caption || '',
      share_to_feed: body.share_to_feed !== false,
      graduation_strategy: body.graduation_strategy || 'MANUAL'
    }
  }) };
}

async function registerPost(request, env, user) {
  const body = await bodyJson(request);
  const org = await getOrg(env, user.id, body.org_id);
  requireOrgRole(org, ['owner']);
  if (!body.account_id || !body.external_media_id) throw Object.assign(new Error('account_id and external_media_id are required'), { status: 400 });
  const account = await ownedRow(env, 'social_accounts', body.account_id, org.org_id, 'id');
  if (!account) throw Object.assign(new Error('Social account not found'), { status: 404 });
  return { post: await insert(env, 'social_posts', {
    org_id: org.org_id,
    account_id: body.account_id,
    campaign_id: body.campaign_id || null,
    variant_id: body.variant_id || null,
    publish_job_id: body.publish_job_id || null,
    external_media_id: body.external_media_id,
    permalink: body.permalink || null,
    publish_mode: body.publish_mode || 'reel',
    caption: body.caption || null,
    published_at: body.published_at || new Date().toISOString(),
    metadata: body.metadata || {}
  }) };
}

async function ingestMetrics(request, env, user) {
  const body = await bodyJson(request);
  if (!body.post_id) throw Object.assign(new Error('post_id is required'), { status: 400 });
  const org = await getOrg(env, user.id, body.org_id);
  requireOrgRole(org, ['owner']);
  const post = await ownedRow(env, 'social_posts', body.post_id, org.org_id, 'id,variant_id');
  if (!post) throw Object.assign(new Error('Social post not found'), { status: 404 });
  const m = body.metrics || body;
  const scored = scoreMetrics(m);
  const snapshot = await insert(env, 'social_metric_snapshots', {
    org_id: org.org_id, post_id: post.id, recorded_at: body.recorded_at || new Date().toISOString(),
    views: num(m.views), reach: num(m.reach), likes: num(m.likes), comments: num(m.comments), shares: num(m.shares), saves: num(m.saves), follows: num(m.follows), profile_visits: num(m.profile_visits), dms: num(m.dms), leads: num(m.leads), watch_time_seconds: num(m.watch_time_seconds), avg_watch_time_seconds: num(m.avg_watch_time_seconds), retention_3s: m.retention_3s == null ? null : clamp(num(m.retention_3s), 0, 1), score: scored.score, raw: body.raw || m.raw || {}
  });
  if (post.variant_id) await patch(env, 'social_variants', post.variant_id, { score: scored.score, score_components: scored.components });
  return { snapshot, score: scored };
}

async function listAutomations(request, env, user) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  const rows = await db(env, `social_automation_rules?org_id=eq.${encodeURIComponent(org.org_id)}&order=created_at.desc&select=*`);
  return { org_id: org.org_id, automations: rows || [] };
}

async function createAutomation(request, env, user) {
  const body = await bodyJson(request);
  const org = await getOrg(env, user.id, body.org_id);
  requireOrgRole(org, ['owner']);
  if (!body.account_id || !body.name || !body.trigger_type || !body.action_type) throw Object.assign(new Error('account_id, name, trigger_type, and action_type are required'), { status: 400 });
  const account = await ownedRow(env, 'social_accounts', body.account_id, org.org_id, 'id');
  if (!account) throw Object.assign(new Error('Social account not found'), { status: 404 });
  return { automation: await insert(env, 'social_automation_rules', {
    org_id: org.org_id, account_id: body.account_id, campaign_id: body.campaign_id || null, name: body.name,
    trigger_type: body.trigger_type, trigger_config: body.trigger_config || {}, action_type: body.action_type,
    action_config: body.action_config || {}, approval_mode: body.approval_mode || 'manual', enabled: Boolean(body.enabled)
  }) };
}

function secureEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleMetaWebhook(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') || '';
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && env.META_WEBHOOK_VERIFY_TOKEN && secureEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
    return new Response('Webhook verification failed', { status: 403 });
  }
  if (!env.META_APP_SECRET) return new Response('META_APP_SECRET is not configured', { status: 503 });
  const raw = await request.text();
  const supplied = request.headers.get('x-hub-signature-256') || '';
  const expected = `sha256=${await hmacHex(env.META_APP_SECRET, raw)}`;
  if (!secureEqual(supplied, expected)) return new Response('Invalid webhook signature', { status: 401 });
  let payload;
  try { payload = JSON.parse(raw); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const digest = await sha256(raw);
  let accepted = 0;
  for (const entry of payload.entry || []) {
    const accounts = await db(env, `social_accounts?platform=eq.instagram&external_account_id=eq.${encodeURIComponent(String(entry.id || ''))}&select=id,org_id&limit=1`);
    const account = accounts?.[0] || null;
    for (const item of [...(entry.messaging || []).map((value) => ({ type: 'message', value })), ...(entry.changes || []).map((value) => ({ type: value.field || 'change', value }))]) {
      await insert(env, 'social_webhook_events', { org_id: account?.org_id || null, account_id: account?.id || null, platform: 'instagram', event_id: `${digest}:${accepted}`, event_type: item.type, payload: item.value });
      accepted += 1;
    }
  }
  return new Response(JSON.stringify({ ok: true, accepted }), { status: 200, headers: { 'content-type': 'application/json' } });
}

export async function attachCompletedVariantAssets(env) {
  const variants = await db(env, 'social_variants?media_job_id=not.is.null&output_asset_id=is.null&status=in.(generating,planned)&order=created_at.asc&limit=25&select=id,org_id,media_job_id');
  let attached = 0;
  for (const variant of variants || []) {
    const jobs = await db(env, `media_jobs?id=eq.${encodeURIComponent(variant.media_job_id)}&org_id=eq.${encodeURIComponent(variant.org_id)}&select=status&limit=1`);
    const job = jobs?.[0];
    if (!job) continue;
    if (job.status === 'failed') { await patch(env, 'social_variants', variant.id, { status: 'failed' }); continue; }
    if (job.status !== 'completed') continue;
    const assets = await db(env, `media_assets?job_id=eq.${encodeURIComponent(variant.media_job_id)}&order=created_at.asc&select=id&limit=1`);
    if (assets?.[0]) { await patch(env, 'social_variants', variant.id, { output_asset_id: assets[0].id, status: 'ready' }); attached += 1; }
  }
  return attached;
}

export async function handleSocialRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/v1/social/accounts' && request.method === 'GET') return listAccounts(request, env, user);
  if (path === '/v1/social/accounts' && request.method === 'POST') return createAccount(request, env, user);
  if (path === '/v1/social/campaigns' && request.method === 'GET') return listCampaigns(request, env, user);
  if (path === '/v1/social/campaigns' && request.method === 'POST') return createCampaign(request, env, user);
  if (path === '/v1/social/variants/generate' && request.method === 'POST') return generateVariant(request, env, user);
  if (path === '/v1/social/publish' && request.method === 'POST') return queuePublish(request, env, user);
  if (path === '/v1/social/posts' && request.method === 'POST') return registerPost(request, env, user);
  if (path === '/v1/social/metrics' && request.method === 'POST') return ingestMetrics(request, env, user);
  if (path === '/v1/social/automations' && request.method === 'GET') return listAutomations(request, env, user);
  if (path === '/v1/social/automations' && request.method === 'POST') return createAutomation(request, env, user);
  const leaderboardMatch = path.match(/^\/v1\/social\/campaigns\/([0-9a-f-]{36})\/leaderboard$/i);
  if (leaderboardMatch && request.method === 'GET') return leaderboard(request, env, user, leaderboardMatch[1]);
  throw Object.assign(new Error('Social route not found'), { status: 404 });
}
