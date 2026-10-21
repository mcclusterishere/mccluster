// Signed uploads are issued only for the canonical private bucket and the
// authenticated uploader's UUID prefix. Treat owner-controlled metadata rows
// as untrusted pointers, even when their RLS owner_m_uid matches the caller.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH = new RegExp('^(' + UUID + ')/' + UUID + '-[A-Za-z0-9._-]{1,180}$', 'i');

export function canonicalMediaUploader(asset) {
  if (!asset || asset.bucket_id !== 'mnet-media' || typeof asset.object_path !== 'string') return null;
  const match = PATH.exec(asset.object_path);
  return match ? match[1].toLowerCase() : null;
}
