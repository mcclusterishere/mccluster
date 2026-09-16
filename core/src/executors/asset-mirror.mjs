import { mirrorClaimedAssets } from '../show-studio/asset-mirror.mjs';

export async function assetMirror(job, options = {}) {
  const limit = Number(job?.input?.limit) || 10;
  const result = await mirrorClaimedAssets({ limit, ...options });

  return {
    executor: 'asset_mirror:v1',
    summary: result.claimed
      ? `Mirrored ${result.mirrored}/${result.claimed} generated assets into McCluster storage.`
      : 'No generated assets were waiting to be mirrored.',
    claimed: result.claimed,
    mirrored: result.mirrored,
    failed: result.failed,
    // Only successes carry a path and hash; a failure is reported by the
    // row's own mirror_error, not smuggled into the evidence as if it were
    // a stored asset.
    assets: result.results.filter((item) => item.ok).map((item) => ({
      asset_id: item.asset_id,
      storage_path: item.storage_path,
      sha256: item.sha256,
      bytes: item.bytes,
    })),
    failures: result.results.filter((item) => !item.ok).map((item) => ({
      asset_id: item.asset_id,
      error: item.error,
    })),
  };
}
