import { reply, fail } from '../lib/http.js';
import { requireOrgId, requireOrgRole } from './security.js';
import { handleSocialRequest } from './router.js';

const SCOPES = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish'];
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
function configuration(env) {
  const blockers = [];
  if (env.CUSTOMER_SOCIAL_ENABLED !== 'true') blockers.push('Customer Instagram connections are not enabled.');
  if (!env.META_APP_ID || !env.META_APP_SECRET) blockers.push('Meta application credentials are not configured.');
  try {
    const u = new URL(env.CUSTOMER_SOCIAL_REDIRECT_URI);
    if (u.protocol !== 'https:' || u.pathname !== '/customer-social.html' || u.search || u.hash) throw Error();
  } catch { blockers.push('The approved Instagram return URL is not configured.'); }
  return blockers;
}
async function db(env, path, body) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    // Never return database details: RPC arguments can contain provider credentials.
    const known = { 'P0002': ['Connection or request expired. Connect again.', 409], '42501': ['Organization owner access required.', 403], '23505': ['This request changed or another connection is active. Refresh and try again.', 409], '55000': ['Publishing is in progress or an operator-managed connection exists. Try again after publishing finishes.', 409] };
    const [message, status] = known[result?.code] || ['Social storage is unavailable. Try again later.', 503];
    throw error(message, status);
  }
  return result;
}
async function provider(env, path, token, values, method = 'GET') {
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION || 'v26.0'}/${path}`);
  const init = { method, headers: {}, signal: AbortSignal.timeout(15000) };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (method === 'GET') for (const [k,v] of Object.entries(values || {})) url.searchParams.set(k, v);
  else { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(values); }
  let response;
  try { response = await fetch(url, init); } catch { throw error('Instagram did not respond. Reconnect and try again.', 502); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw error('Instagram authorization failed. Check your permissions and reconnect.', 409);
  return data;
}
async function pages(env, token) {
  const found = [];
  let after;
  for (let n = 0; n < 10; n++) {
    const data = await provider(env, 'me/accounts', token, { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100', ...(after ? { after } : {}) });
    found.push(...(data.data || []).filter(p => p.instagram_business_account?.id && p.access_token));
    if (!data.paging?.next) return found;
    after = data.paging?.cursors?.after;
    if (!after) break;
  }
  throw error('Too many Facebook Pages to select safely. Contact support.', 409);
}
function publicJob(job) {
  return { id: job.id, state: job.state, created_at: job.created_at, external_media_id: job.external_media_id,
    caption: job.payload?.caption || '', recovery: job.state === 'failed' ? 'Check your connection, then retry. Existing Instagram containers are reused when possible.' : null };
}

// Called only after the canonical authUser gate. Never accepts a user id from the browser.
export async function handleCustomerSocialRequest(request, env, user) {
  if (!user?.id) throw error('Sign in to continue.', 401);
  const url = new URL(request.url);
  let body = {};
  if (request.method === 'POST') {
    if (Number(request.headers.get('content-length') || 0) > 16000) throw error('Request too large.', 413);
    const raw = await request.text();
    if (raw.length > 16000) throw error('Request too large.', 413);
    try { body = JSON.parse(raw); } catch { throw error('Invalid JSON.'); }
  }
  const org = requireOrgId(body.org_id || url.searchParams.get('org_id'));
  const members = await db(env, `org_members?org_id=eq.${org}&profile_id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`);
  requireOrgRole(members?.[0]);
  const rpc = (action, data = {}) => db(env, 'rpc/customer_social_service', { p_action: action, p_org: org, p_user: user.id, p_data: data });
  const blockers = configuration(env);
  const suffix = url.pathname.replace('/v1/customer-social/', '');
  if (suffix === 'status' && request.method === 'GET') {
    let connection = null;
    try { connection = await rpc('status'); } catch (e) { if (e.status !== 503) throw e; blockers.push('Customer social database migration is not available.'); }
    return { org_id: org, provider: 'instagram', configured: !blockers.length, blockers, connection, supported: ['instagram_reels'] };
  }
  // Disconnect stays available when the feature is disabled.
  if (suffix === 'disconnect' && request.method === 'POST') return rpc('disconnect');
  const cancelling = /^jobs\/[a-f0-9-]{36}\/cancel$/i.test(suffix);
  if (request.method === 'POST' && !cancelling) {
    const paid = await db(env, `creator_billing_subscriptions?org_id=eq.${org}&owner_user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&select=current_period_end&limit=10`);
    if (!paid?.some(row => Date.parse(row.current_period_end) > Date.now())) throw error('An active site plan is required for Instagram publishing.', 402);
  }
  if (blockers.length && !cancelling && suffix !== 'jobs') throw error(blockers.join(' '), 503);
  if (suffix === 'connect' && request.method === 'POST') {
    const state = crypto.randomUUID() + crypto.randomUUID();
    await rpc('begin', { state_hash: await digest(state) });
    const authorize = new URL(`https://www.facebook.com/${env.META_GRAPH_API_VERSION || 'v26.0'}/dialog/oauth`);
    authorize.search = new URLSearchParams({ client_id: env.META_APP_ID, redirect_uri: env.CUSTOMER_SOCIAL_REDIRECT_URI, state, response_type: 'code', scope: SCOPES.join(','), auth_type: 'rerequest' });
    return { authorization_url: authorize.href };
  }
  if (suffix === 'complete' && request.method === 'POST') {
    if (!/^[a-f0-9-]{72}$/i.test(body.state || '') || typeof body.code !== 'string' || !body.code || body.code.length > 4096) throw error('Invalid authorization response.');
    const state_hash = await digest(body.state);
    await rpc('claim', { state_hash }); // Atomically one-use, user + org + expiry bound, before exchange.
    const short = await provider(env, 'oauth/access_token', null, { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: env.CUSTOMER_SOCIAL_REDIRECT_URI, code: body.code }, 'POST');
    const long = await provider(env, 'oauth/access_token', null, { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: short.access_token }, 'POST');
    if (!long.access_token) throw error('Instagram did not grant an access token.', 409);
    const debug = await provider(env, 'debug_token', `${env.META_APP_ID}|${env.META_APP_SECRET}`, { input_token: long.access_token });
    const info = debug.data;
    if (!info?.is_valid || String(info.app_id) !== String(env.META_APP_ID) || !SCOPES.every(s => info.scopes?.includes(s)) || (info.expires_at && info.expires_at * 1000 <= Date.now())) throw error('Required Instagram publishing permissions were not granted. Reconnect.', 409);
    const candidates = await pages(env, long.access_token);
    if (!candidates.length) throw error('No Instagram Professional account linked to an authorized Facebook Page was found.', 409);
    const selection = crypto.randomUUID();
    await rpc('stage', { state_hash, selection_hash: await digest(selection), token: long.access_token, expires_at: info.expires_at ? new Date(info.expires_at * 1000).toISOString() : null });
    return { selection, accounts: candidates.map(p => ({ page_id: p.id, account_id: p.instagram_business_account.id, handle: p.instagram_business_account.username, name: p.name })) };
  }
  if (suffix === 'select' && request.method === 'POST') {
    if (!/^[a-f0-9-]{36}$/i.test(body.selection || '') || !/^\d+$/.test(body.page_id || '')) throw error('Choose an authorized account.');
    const selection_hash = await digest(body.selection);
    const staged = await rpc('selection', { selection_hash });
    const candidates = await pages(env, staged.token);
    const page = candidates.find(p => String(p.id) === body.page_id);
    if (!page) throw error('That Facebook Page was not authorized.', 403);
    return rpc('install', { selection_hash, token: page.access_token, external_id: page.instagram_business_account.id, handle: page.instagram_business_account.username || page.name });
  }
  if (suffix === 'jobs' && request.method === 'GET') {
    const jobs = await db(env, `social_publish_jobs?org_id=eq.${org}&payload->>source=eq.customer-social&order=created_at.desc&limit=50&select=id,state,created_at,external_media_id,payload`);
    return { jobs: (jobs || []).map(publicJob) };
  }
  if (suffix === 'publish' && request.method === 'POST') {
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(body.idempotency_key || '')) throw error('A stable request key is required.');
    if (typeof body.caption !== 'string' || body.caption.length > 2200) throw error('Caption must be 2200 characters or fewer.');
    const pattern = new RegExp(`^${org}/[a-f0-9-]{36}\\.(mp4|mov)$`, 'i');
    if (!pattern.test(body.storage_path || '')) throw error('Upload a video to this organization first.');
    const payload = { source: 'customer-social', caption: body.caption, storage_path: body.storage_path };
    const job = await rpc('enqueue', { key: body.idempotency_key, hash: await digest(JSON.stringify(payload)), payload });
    return { publish_job: publicJob(job) };
  }
  if (suffix === 'uploads' && request.method === 'POST') {
    if (!['video/mp4','video/quicktime'].includes(body.mime_type)) throw error('Choose an MP4 or MOV video.');
    await rpc('ready');
    return handleSocialRequest(new Request(`${url.origin}/v1/social/uploads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, user);
  }
  const jobAction = suffix.match(/^jobs\/([a-f0-9-]{36})\/(retry|cancel)$/i);
  if (jobAction && request.method === 'POST') {
    if (jobAction[2] === 'retry') await rpc('ready');
    const jobs = await db(env, `social_publish_jobs?id=eq.${jobAction[1]}&org_id=eq.${org}&payload->>source=eq.customer-social&select=id&limit=1`);
    if (!jobs?.length) throw error('Publish job not found.', 404);
    const result = await handleSocialRequest(new Request(`${url.origin}/v1/social/publish/${jobAction[1]}/${jobAction[2]}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ org_id: org }) }), env, user);
    return { publish_job: publicJob(result.publish_job) };
  }
  throw error('Social route not found.', 404);
}

export async function handleCustomerSocial(request, env) {
  if (!new URL(request.url).pathname.startsWith('/v1/customer-social/')) return null;
  let response;
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw error('Social connections are unavailable.', 503);
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) throw error('Sign in to continue.', 401);
    const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }, signal: AbortSignal.timeout(15000) });
    if (!auth.ok) throw error('Session expired. Sign in again.', 401);
    const user = await auth.json();
    if (!/^[a-f0-9-]{36}$/i.test(user?.id || '')) throw error('Invalid session.', 401);
    response = reply(request, env, await handleCustomerSocialRequest(request, env, user));
  } catch (e) { response = fail(request, env, e.status ? e.message : 'Social connections are unavailable. Try again later.', e.status || 503); }
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'origin, authorization');
  return response;
}
