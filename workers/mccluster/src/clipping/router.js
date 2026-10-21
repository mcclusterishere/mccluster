/* Clipping routes that need the Worker: reading a platform, or signing a
   private file. Everything else (claiming, submitting, dashboards, payouts)
   is a database function the client calls with its own session, and the
   function checks the caller. */
import { instagramAccountCheck, memberToken, platformStatus } from './platforms.js';
import { serviceRpc } from './runner.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function service(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error('Clipping request failed'), { status: res.status, detail: data });
  return data;
}

async function memberOf(env, user) {
  const rows = await service(env, `rest/v1/m_auth_user_links?auth_user_id=eq.${encodeURIComponent(user.id)}&is_primary=eq.true&select=m_uid&limit=1`);
  const mUid = rows?.[0]?.m_uid;
  if (!mUid) throw bad('Your M account is not ready yet', 403);
  return mUid;
}

/* The member asks us to look: the account must carry the desk-connected
   credential, the handle must be an account that credential can see, and
   its bio must hold the member's code. */
async function verifyAccount(env, user, accountId) {
  if (!UUID.test(accountId)) throw bad('account id must be a uuid');
  const mUid = await memberOf(env, user);
  const rows = await service(env, `rest/v1/social_accounts?id=eq.${accountId}&owner_m_uid=eq.${mUid}&select=id,platform,handle,credential_ref,owner_verified_at,owner_verification&limit=1`);
  const account = rows?.[0];
  if (!account) throw bad('Account not found', 404);
  if (account.owner_verified_at) return { account_id: account.id, verified: true, idempotent: true };
  if (account.platform !== 'instagram') return { account_id: account.id, verified: false, reason: `${account.platform} accounts cannot be verified yet.` };
  if (!account.credential_ref) {
    return { account_id: account.id, verified: false, reason: 'Waiting for the desk to connect this Instagram account. Keep the code in your bio.' };
  }
  const rpc = serviceRpc(env);
  const token = await memberToken(env, account, rpc);
  if (!token) return { account_id: account.id, verified: false, reason: 'The connected Instagram credential is not readable.' };
  const check = await instagramAccountCheck(env, token, account.handle, account.owner_verification?.code);
  if (!check.found) return { account_id: account.id, verified: false, reason: `@${account.handle} is not an account this credential can read.` };
  if (!check.code_present) return { account_id: account.id, verified: false, reason: `Put ${account.owner_verification?.code} in your bio, then check again.` };
  await rpc('clip_account_mark_verified', { p_account: account.id, p: { external_account_id: check.external_account_id, handle: check.handle } });
  return { account_id: account.id, verified: true };
}

/* Approved source files, for clippers who hold an active claim only, as
   links that expire in fifteen minutes. */
async function campaignAssets(env, user, missionId) {
  if (!UUID.test(missionId)) throw bad('campaign id must be a uuid');
  const mUid = await memberOf(env, user);
  const claims = await service(env, `rest/v1/action_clip_claims?mission_id=eq.${missionId}&m_uid=eq.${mUid}&status=eq.active&select=id&limit=1`);
  if (!claims?.length) throw bad('Claim this campaign to get its files', 403);
  const assets = await service(env, `rest/v1/action_clip_assets?mission_id=eq.${missionId}&select=id,kind,label,network_media_asset_id,start_ms,end_ms,sort&order=sort.asc`);
  const ids = (assets || []).map((a) => a.network_media_asset_id).filter(Boolean);
  const files = ids.length
    ? await service(env, `rest/v1/network_media_assets?id=in.(${ids.join(',')})&status=eq.ready&select=id,bucket_id,object_path,media_type,mime_type`)
    : [];
  const signed = {};
  const byBucket = {};
  for (const f of files || []) (byBucket[f.bucket_id] ||= []).push(f);
  for (const [bucket, rows] of Object.entries(byBucket)) {
    const out = await service(env, `storage/v1/object/sign/${encodeURIComponent(bucket)}`, {
      method: 'POST', body: JSON.stringify({ expiresIn: 900, paths: rows.map((r) => r.object_path) })
    });
    for (const r of rows) {
      const hit = (out || []).find((x) => x.path === r.object_path && x.signedURL);
      if (hit) signed[r.id] = { url: `${env.SUPABASE_URL}/storage/v1${hit.signedURL}`, media_type: r.media_type, mime_type: r.mime_type };
    }
  }
  return {
    expires_in: 900,
    assets: (assets || []).map((a) => ({
      id: a.id, kind: a.kind, label: a.label, start_ms: a.start_ms, end_ms: a.end_ms,
      ...(a.network_media_asset_id ? signed[a.network_media_asset_id] || { unavailable: true } : {})
    }))
  };
}

/* Returns a result for a clipping route, or null when the path is not one. */
export async function handleClippingRequest(request, env, user, url) {
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/v1/clips/platforms' && request.method === 'GET') return { platforms: platformStatus() };
  if (!user) throw bad('Authentication required', 401);
  const verify = path.match(/^\/v1\/clips\/accounts\/([^/]+)\/verify$/);
  if (verify && request.method === 'POST') return verifyAccount(env, user, verify[1]);
  const assets = path.match(/^\/v1\/clips\/campaigns\/([^/]+)\/assets$/);
  if (assets && request.method === 'GET') return campaignAssets(env, user, assets[1]);
  return null;
}
