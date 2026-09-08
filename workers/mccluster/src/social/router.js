import { createGeneration } from '../media/router.js';
// clamp and scoreMetrics live in score.js so they can be imported and
// tested without pulling in the fal.ai SDK through media/router.js.
import { clamp, scoreMetrics } from './score.js';
export { scoreMetrics };

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

// ---------------------------------------------------------------
// AUTHORIZATION
//
// The previous version of this file selected `org_id,role` and then
// never read the role. Membership was the whole check, so a viewer in
// any org could connect accounts, spend money generating variants,
// queue publications and inject metrics that steer the learning loop.
//
// The role is now resolved into a CAPABILITY, using the same
// `control_capabilities` / `control_role_capabilities` tables the edge
// functions read (see supabase/functions/_shared/authz.ts and
// docs/control-plane/AUTHZ.md). One vocabulary, one grant matrix, two
// runtimes. Changing who may publish stays an UPDATE, not a redeploy.
// ---------------------------------------------------------------

const GRANT_TTL_MS = 60_000;
let grantCache = null;
let grantInFlight = null;

async function loadGrants(env) {
  const rows = await db(env, 'control_role_capabilities?select=role,capability,allowed');
  if (!Array.isArray(rows) || !rows.length) {
    // Fail closed. An unreadable grant table is a reason to stop, never
    // a reason to let the call through.
    throw Object.assign(new Error('Authorization is temporarily unavailable'), { status: 503 });
  }
  const grants = new Map();
  for (const row of rows) grants.set(`${row.role} ${row.capability}`, row.allowed === true);
  return { grants, loadedAt: Date.now() };
}

async function grantTable(env) {
  if (grantCache && Date.now() - grantCache.loadedAt < GRANT_TTL_MS) return grantCache;
  if (!grantInFlight) {
    grantInFlight = loadGrants(env)
      .then((table) => { grantCache = table; return table; })
      .finally(() => { grantInFlight = null; });
  }
  return grantInFlight;
}

/**
 * Resolve which org this call acts on, then check the caller may do the
 * thing. Both halves matter and both used to be missing.
 *
 * The org half: the old code, given no org_id, took
 * `order=added_at.asc&limit=1` — the caller's OLDEST membership. For an
 * agency operator who belongs to several client orgs, omitting one
 * query parameter silently published to whichever client they joined
 * first. "Posted to the wrong client's account" is the failure that
 * costs you the client, and it needed no attacker to happen. A default
 * is only safe when there is exactly one thing it could mean.
 */
async function resolveOrg(env, userId, requestedOrgId, capability) {
  if (!capability) throw new Error(`resolveOrg called with no capability for user ${userId}`);

  let row;
  if (requestedOrgId) {
    const rows = await db(
      env,
      `org_members?org_id=eq.${encodeURIComponent(requestedOrgId)}&profile_id=eq.${encodeURIComponent(userId)}&select=org_id,role&limit=1`
    );
    row = rows?.[0];
    // Same refusal for "not a member" and "no such org", so this does
    // not become an oracle for which org ids exist.
    if (!row) throw Object.assign(new Error('No matching McCluster organization membership found'), { status: 403 });
  } else {
    const rows = await db(
      env,
      `org_members?profile_id=eq.${encodeURIComponent(userId)}&select=org_id,role&order=added_at.asc&limit=25`
    );
    if (!rows?.length) throw Object.assign(new Error('No matching McCluster organization membership found'), { status: 403 });
    if (rows.length > 1) {
      throw Object.assign(
        new Error('You belong to more than one organisation; name which one with org_id'),
        { status: 400 }
      );
    }
    row = rows[0];
  }

  const { grants } = await grantTable(env);
  if (grants.get(`${row.role} ${capability}`) !== true) {
    throw Object.assign(
      new Error(`Your role (${row.role}) does not include ${capability}`),
      { status: 403 }
    );
  }
  return row;
}

/**
 * `credential_ref` names a Worker secret; the publisher resolves it with
 * `env[ref]`. That is an unrestricted dynamic lookup over every binding
 * the Worker has, and this endpoint takes the name from the request
 * body — so without a shape rule, a caller could point a social account
 * at STRIPE_SECRET_KEY or the service-role key.
 *
 * The prefix is the whole defence: only secrets deliberately named for
 * this purpose can be selected. Checked here for a good error message
 * and by a CHECK constraint in 0060 for the guarantee.
 */
const CREDENTIAL_REF_SHAPE = /^SOCIAL_[A-Z0-9_]{1,64}$/;

function validCredentialRef(value) {
  if (value == null || value === '') return null;
  const ref = String(value);
  if (!CREDENTIAL_REF_SHAPE.test(ref)) {
    throw Object.assign(
      new Error('credential_ref must name a Worker secret of the form SOCIAL_YOUR_ACCOUNT'),
      { status: 400 }
    );
  }
  return ref;
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

function generationRequest(request, payload) {
  const h = new Headers(request.headers);
  h.set('content-type', 'application/json');
  return new Request(request.url, { method: 'POST', headers: h, body: JSON.stringify(payload) });
}

async function listAccounts(request, env, user) {
  const url = new URL(request.url);
  const org = await resolveOrg(env, user.id, url.searchParams.get('org_id'), 'social.read');
  const rows = await db(env, `social_accounts?org_id=eq.${encodeURIComponent(org.org_id)}&order=created_at.asc&select=id,org_id,platform,external_account_id,handle,display_name,credential_ref,status,capabilities,settings,last_synced_at,created_at,updated_at`);
  return { org_id: org.org_id, accounts: rows || [] };
}

async function createAccount(request, env, user) {
  const body = await bodyJson(request);
  const org = await resolveOrg(env, user.id, body.org_id || null, 'social.connect');
  if (!body.platform || !body.external_account_id) throw Object.assign(new Error('platform and external_account_id are required'), { status: 400 });
  return { account: await insert(env, 'social_accounts', {
    org_id: org.org_id,
    platform: String(body.platform).toLowerCase(),
    external_account_id: String(body.external_account_id),
    handle: body.handle || null,
    display_name: body.display_name || null,
    credential_ref: validCredentialRef(body.credential_ref),
    status: body.status || (body.credential_ref ? 'connected' : 'disconnected'),
    capabilities: body.capabilities || {},
    settings: body.settings || {}
  }) };
}

async function listCampaigns(request, env, user) {
  const url = new URL(request.url);
  const org = await resolveOrg(env, user.id, url.searchParams.get('org_id'), 'social.read');
  const rows = await db(env, `social_campaigns?org_id=eq.${encodeURIComponent(org.org_id)}&order=created_at.desc&select=*`);
  return { org_id: org.org_id, campaigns: rows || [] };
}

async function createCampaign(request, env, user) {
  const body = await bodyJson(request);
  const org = await resolveOrg(env, user.id, body.org_id || null, 'social.queue');
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
  const org = await resolveOrg(env, user.id, body.org_id || null, 'media.generate');
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
  const org = await resolveOrg(env, user.id, url.searchParams.get('org_id'), 'social.read');
  const campaign = await ownedRow(env, 'social_campaigns', campaignId, org.org_id, 'id,name,objective,status');
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const variants = await db(env, `social_variants?campaign_id=eq.${encodeURIComponent(campaignId)}&order=score.desc.nullslast,created_at.asc&select=*`);
  return { campaign, variants: variants || [] };
}

async function queuePublish(request, env, user) {
  const body = await bodyJson(request);
  const org = await resolveOrg(env, user.id, body.org_id || null, 'social.queue');
  if (!body.account_id) throw Object.assign(new Error('account_id is required'), { status: 400 });
  const account = await ownedRow(env, 'social_accounts', body.account_id, org.org_id, 'id');
  if (!account) throw Object.assign(new Error('Social account not found'), { status: 404 });
  if (body.variant_id) {
    const variant = await ownedRow(env, 'social_variants', body.variant_id, org.org_id, 'id,campaign_id,output_asset_id,caption');
    if (!variant) throw Object.assign(new Error('Variant not found'), { status: 404 });
    body.campaign_id ||= variant.campaign_id;
    body.video_asset_id ||= variant.output_asset_id;
    body.caption ||= variant.caption;
  }
  if (!body.video_url && !body.video_asset_id) throw Object.assign(new Error('video_url, video_asset_id, or a ready variant is required'), { status: 400 });
  const mode = body.publish_mode || 'trial';
  if (!['trial', 'reel'].includes(mode)) throw Object.assign(new Error('publish_mode must be trial or reel'), { status: 400 });
  return { publish_job: await insert(env, 'social_publish_jobs', {
    org_id: org.org_id,
    account_id: body.account_id,
    campaign_id: body.campaign_id || null,
    variant_id: body.variant_id || null,
    publish_mode: mode,
    scheduled_at: body.scheduled_at || new Date().toISOString(),
    state: 'queued',
    dedupe_key: body.dedupe_key || `${body.account_id}:${body.variant_id || body.video_asset_id || body.video_url}:${body.scheduled_at || 'now'}:${mode}`,
    payload: { video_url: body.video_url || null, video_asset_id: body.video_asset_id || null, caption: body.caption || '', share_to_feed: body.share_to_feed !== false, graduation_strategy: body.graduation_strategy || 'MANUAL' }
  }) };
}

async function registerPost(request, env, user) {
  const body = await bodyJson(request);
  const org = await resolveOrg(env, user.id, body.org_id || null, 'social.queue');
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
  const org = await resolveOrg(env, user.id, body.org_id || null, 'social.queue');
  const post = await ownedRow(env, 'social_posts', body.post_id, org.org_id, 'id,variant_id');
  if (!post) throw Object.assign(new Error('Social post not found'), { status: 404 });
  const m = body.metrics || body;
  const scored = scoreMetrics(m);
  const snapshot = await insert(env, 'social_metric_snapshots', {
    org_id: org.org_id, post_id: post.id, recorded_at: body.recorded_at || new Date().toISOString(),
    views: Math.max(0, Number(m.views || 0)), reach: Math.max(0, Number(m.reach || 0)), likes: Math.max(0, Number(m.likes || 0)), comments: Math.max(0, Number(m.comments || 0)), shares: Math.max(0, Number(m.shares || 0)), saves: Math.max(0, Number(m.saves || 0)), follows: Math.max(0, Number(m.follows || 0)), profile_visits: Math.max(0, Number(m.profile_visits || 0)), dms: Math.max(0, Number(m.dms || 0)), leads: Math.max(0, Number(m.leads || 0)), watch_time_seconds: Math.max(0, Number(m.watch_time_seconds || 0)), avg_watch_time_seconds: Math.max(0, Number(m.avg_watch_time_seconds || 0)), retention_3s: m.retention_3s == null ? null : clamp(Number(m.retention_3s), 0, 1), score: scored.score, raw: body.raw || m.raw || {}
  });
  if (post.variant_id) await patch(env, 'social_variants', post.variant_id, { score: scored.score, score_components: scored.components });
  return { snapshot, score: scored };
}

async function listAutomations(request, env, user) {
  const url = new URL(request.url);
  const org = await resolveOrg(env, user.id, url.searchParams.get('org_id'), 'social.read');
  const rows = await db(env, `social_automation_rules?org_id=eq.${encodeURIComponent(org.org_id)}&order=created_at.desc&select=*`);
  return { org_id: org.org_id, automations: rows || [] };
}

async function createAutomation(request, env, user) {
  const body = await bodyJson(request);
  const org = await resolveOrg(env, user.id, body.org_id || null, 'social.queue');
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
