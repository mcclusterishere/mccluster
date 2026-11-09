/* WHERE A MEMBER'S UPLOAD MAY LIVE.

   public.network_media_assets rows are written by their owner: RLS lets an
   owner insert and update the row (network_media_owner_insert / _update,
   supabase/migrations/20260920071811_mnet_real_network_v1.sql) and nothing
   pins bucket_id or object_path. So the bucket and path on a row are a
   pointer the member chose, not a fact about what they uploaded. Signing
   whatever the row names with the service role turns "edit your own row"
   into "get a link to any private object".

   The media function only ever issues an upload to
     mnet-media/<the uploader's auth user id>/<uuid>-<clean name>
   (supabase/functions/mnet-media/index.ts, action upload-url) and refuses to
   view, finalize or discard anything else (storage-path.mjs,
   storageBelongsToAsset). Every Worker route that signs a row from this
   table goes through the same two checks here before it signs:

     1. the row names the upload bucket and a path of exactly that shape;
     2. the auth user in the path's first segment is linked, in
        public.m_auth_user_links (not writable by members), to the row's
        owner_m_uid.

   Anything unproven is left out. Callers sign MEDIA_BUCKET by name, never
   the row's own bucket_id. */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/* The twin of supabase/functions/mnet-media/storage-path.mjs. `$` without the
   m flag is end-of-input in JavaScript, so a trailing newline does not pass. */
const PATH = new RegExp('^(' + UUID + ')/' + UUID + '-[A-Za-z0-9._-]{1,180}$', 'i');
const ONE_UUID = new RegExp('^' + UUID + '$', 'i');

export const MEDIA_BUCKET = 'mnet-media';

/* The auth user id whose upload prefix the row points into, lowercased, or
   null when the row does not name a canonical upload at all. */
export function canonicalMediaUploader(asset) {
  if (!asset || asset.bucket_id !== MEDIA_BUCKET || typeof asset.object_path !== 'string') return null;
  const match = PATH.exec(asset.object_path);
  return match ? match[1].toLowerCase() : null;
}

/* The rows of `assets` that are provably their owner's own uploads, in the
   order given. `read(path)` is the caller's service-role PostgREST reader
   (path relative to /rest/v1/); it must throw on a failed read, so an
   unreachable link table never reads as "linked". Lookups are batched and
   bounded so a board of many cases stays a handful of short requests. */
const LOOKUP_BATCH = 40;
export async function ownMediaUploads(assets, read) {
  const candidates = [];
  for (const asset of Array.isArray(assets) ? assets : []) {
    const uploader = canonicalMediaUploader(asset);
    if (!uploader || typeof asset.owner_m_uid !== 'string' || !ONE_UUID.test(asset.owner_m_uid)) continue;
    candidates.push({ asset, uploader, owner: asset.owner_m_uid.toLowerCase() });
  }
  if (!candidates.length) return [];
  const pairs = [...new Set(candidates.map((c) => `${c.uploader}|${c.owner}`))].map((p) => p.split('|'));
  const linked = new Set();
  for (let i = 0; i < pairs.length; i += LOOKUP_BATCH) {
    const batch = pairs.slice(i, i + LOOKUP_BATCH);
    const uploaders = [...new Set(batch.map((p) => p[0]))], owners = [...new Set(batch.map((p) => p[1]))];
    const rows = await read(`m_auth_user_links?auth_user_id=in.(${uploaders.join(',')})&m_uid=in.(${owners.join(',')})&select=auth_user_id,m_uid`);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row?.auth_user_id === 'string' && typeof row?.m_uid === 'string') linked.add(`${row.auth_user_id.toLowerCase()}|${row.m_uid.toLowerCase()}`);
    }
  }
  return candidates.filter((c) => linked.has(`${c.uploader}|${c.owner}`)).map((c) => c.asset);
}

export async function isOwnMediaUpload(asset, read) {
  return (await ownMediaUploads([asset], read)).length === 1;
}

/* The object path as URL path segments, for a single-object sign request. */
export function mediaObjectUrlPath(asset) {
  return String(asset.object_path).split('/').map(encodeURIComponent).join('/');
}
