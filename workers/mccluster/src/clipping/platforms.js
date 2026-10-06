/* Server-side reads of a clip on its platform. These are the only source
   of the numbers clip settlement pays on; nothing a browser or a person
   types reaches here.

   Instagram is read through the Graph API with the member account's own
   stored credential (a Worker env name or a vault secret, the shapes org
   accounts already use). YouTube and TikTok have no provider integration
   yet: they answer available=false, and the database refuses to pay for
   them (private.clip_platform_enabled). */
import { graphGet } from '../social/meta.js';
import { parseSocialCredentialRef } from '../social/security.js';

export const PLATFORMS = {
  instagram: { enabled: true, label: 'Instagram Reels' },
  youtube: { enabled: false, label: 'YouTube Shorts', reason: 'YouTube clips cannot be verified yet: no YouTube integration is connected.' },
  tiktok: { enabled: false, label: 'TikTok', reason: 'TikTok clips cannot be verified yet: no TikTok integration is connected.' }
};

export function platformStatus() {
  return Object.entries(PLATFORMS).map(([key, p]) => ({ platform: key, label: p.label, enabled: p.enabled, reason: p.reason || null }));
}

/* The member account's token, from its own credential reference. */
export async function memberToken(env, account, rpc) {
  const parsed = parseSocialCredentialRef(account?.platform, account?.credential_ref);
  if (!parsed) return null;
  if (parsed.kind === 'env') return env[parsed.name] || null;
  const token = await rpc('vault_secret', { p_id: parsed.id });
  return typeof token === 'string' && token ? token : null;
}

/* Graph errors that mean "this object is gone", not "try again later". */
export function isGone(error) {
  const e = error?.detail?.error;
  return Boolean(e && (e.code === 100 && (e.error_subcode === 33 || /does not exist/i.test(e.message || ''))));
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function insightValue(payload) {
  const v = payload?.data?.[0]?.values?.[0]?.value ?? payload?.data?.[0]?.total_value?.value;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

async function insight(env, mediaId, metric, token) {
  try {
    return insightValue(await graphGet(env, `${encodeURIComponent(mediaId)}/insights?metric=${metric}`, token));
  } catch (error) {
    if (isGone(error)) throw error;
    return null;
  }
}

/* Find the Instagram professional account the token can see with this
   handle, and whether its bio carries the member's verification code. */
export async function instagramAccountCheck(env, token, handle, code) {
  const pages = await graphGet(env, 'me/accounts?fields=instagram_business_account{id,username,biography}&limit=50', token);
  const want = String(handle || '').toLowerCase();
  const ig = (pages?.data || []).map((p) => p.instagram_business_account).find((a) => a && String(a.username || '').toLowerCase() === want);
  if (!ig) return { found: false };
  return {
    found: true,
    external_account_id: String(ig.id),
    handle: String(ig.username),
    code_present: Boolean(code) && String(ig.biography || '').includes(code)
  };
}

const MEDIA_FIELDS = 'id,shortcode,permalink,caption,timestamp,like_count,comments_count,media_product_type';

/* A submitted Reel, found by its shortcode in the account's own media, so
   ownership is a fact of the platform rather than a claim. */
export async function instagramFindClip(env, token, accountId, shortcode, { pages = 4 } = {}) {
  let after = '';
  for (let i = 0; i < pages; i += 1) {
    const page = await graphGet(env, `${encodeURIComponent(accountId)}/media?fields=${MEDIA_FIELDS}&limit=50${after ? `&after=${encodeURIComponent(after)}` : ''}`, token);
    const hit = (page?.data || []).find((m) => m.shortcode === shortcode || String(m.permalink || '').includes(`/${shortcode}`));
    if (hit) return hit;
    after = page?.paging?.cursors?.after || '';
    if (!after || !page?.paging?.next) break;
  }
  return null;
}

async function instagramMetrics(env, token, mediaId) {
  const fields = await graphGet(env, `${encodeURIComponent(mediaId)}?fields=id,like_count,comments_count,permalink,timestamp,caption`, token);
  const [views, reach, saved, shares] = await Promise.all(['views', 'reach', 'saved', 'shares'].map((m) => insight(env, mediaId, m, token)));
  return {
    views: count(views), likes: count(fields?.like_count), comments: count(fields?.comments_count), shares: count(shares),
    raw: { graph_fields: fields, reach, saved, synced_metrics: ['views', 'reach', 'saved', 'shares'] }
  };
}

/* One read of a clip for the database. job: the clip_work_due row. A new
   clip is looked for in each of the clipper's verified, connected accounts;
   a tracked one is read through the account that owns its post. */
export async function readClip(env, job, rpc) {
  const platform = PLATFORMS[job.platform];
  if (!platform?.enabled) return { available: false, reason: platform?.reason || 'This platform cannot be verified yet.' };
  const accounts = (job.accounts || []).filter((a) => a.credential_ref
    && (!job.post_account || String(a.external_account_id) === String(job.post_account)));
  if (!accounts.length) return { available: false, reason: 'Your Instagram account has no connected credential yet; the desk connects it.' };

  let readable = 0;
  for (const account of accounts) {
    const token = await memberToken(env, { platform: job.platform, credential_ref: account.credential_ref }, rpc);
    if (!token) continue;
    readable += 1;
    try {
      let mediaId = job.platform_media_id || null;
      let media = null;
      if (!mediaId) {
        media = await instagramFindClip(env, token, account.external_account_id, job.external_media_id);
        if (!media) continue;
        mediaId = String(media.id);
      }
      const metrics = await instagramMetrics(env, token, mediaId);
      return {
        available: true, found: true, live: true,
        owner_account_id: String(account.external_account_id),
        platform_media_id: mediaId,
        caption: media?.caption ?? metrics.raw.graph_fields?.caption ?? '',
        posted_at: media?.timestamp || metrics.raw.graph_fields?.timestamp || null,
        ...metrics
      };
    } catch (error) {
      if (isGone(error)) return { available: true, found: false, live: false };
      throw error;
    }
  }
  if (!readable) return { available: false, reason: 'The Instagram credential for your account is not readable.' };
  return { available: true, found: false, live: false };
}
