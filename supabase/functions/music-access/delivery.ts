// What music-access may sign, decided from the database's answer alone.
//
// Pure apart from the client it is handed, so
// scripts/test/music-payment-integrity.test.mjs runs it under Node with a
// stubbed client. Every database dependency here comes from
// supabase/pending/music_release_payment_integrity_v1.sql; when it is not
// applied the answer is "refuse" (DependencyMissing -> 503), never "allow".

export type DbError = { code?: string; message?: string } | null | undefined;
export type DbResult = { data: unknown; error: DbError };
export type MusicDb = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<DbResult>;
  from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: DbError }> };
};

/** PostgREST/Postgres say the table or function is not there. */
export function notApplied(error: DbError) {
  return !!error && ["PGRST202", "PGRST205", "42P01", "42883"].includes(String(error.code || ""));
}

/** A required database dependency is missing: the caller answers 503 and logs. */
export class DependencyMissing extends Error {
  dependency: string;
  constructor(dependency: string) {
    super(`music_integrity_dependency_missing:${dependency}`);
    this.name = "DependencyMissing";
    this.dependency = dependency;
  }
}

export type Refusal = { ok: false; status: number; error: string; log?: Record<string, unknown> };
export type Target = { ok: true; bucket: string; path: string };

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

/* (a) Who uploaded an object is the server's record, written when the grant
   is issued to the authenticated caller, never read from its path. */
export async function recordUpload(db: MusicDb, bucket: string, path: string, userId: string, mUid: string) {
  const { error } = await db.from("music_creator_assets")
    .insert({ bucket_id: bucket, object_name: path, owner_user_id: userId, owner_m_uid: mUid, source: "upload_grant" });
  if (!error) return;
  if (notApplied(error)) throw new DependencyMissing("music_creator_assets");
  throw new Error("could_not_record_upload");
}

/* (a) Are this release's audio and artwork its creator's own, by that record? */
export async function assetsVerified(db: MusicDb, trackId: string) {
  const { data, error } = await db.rpc("music_track_assets_verified", { p_track: trackId });
  if (error) {
    if (notApplied(error)) throw new DependencyMissing("music_track_assets_verified");
    throw new Error("could_not_verify_assets");
  }
  return data === true;
}

type PurchaseRow = {
  entitlement_id: string;
  download_count: number | null;
  revoked: boolean;
  order_status: string;
  asset_version_id: string | null;
  bucket_id: string | null;
  object_name: string | null;
  intact: boolean;
  track_status: string | null;
};

/* (e) A purchaser's download: exactly the pinned version their order bought.
   Not the release's live master_path, and not gated on the release's
   current state: a purchaser keeps the version bought even after a takedown
   or a replacement (owner policy), unless the licence is revoked. */
export async function purchasedDownload(
  db: MusicDb,
  q: { trackId: string; offerId: string; userId: string; email: string },
): Promise<(Target & { entitlementId: string; downloadCount: number }) | Refusal> {
  const { data, error } = await db.rpc("music_purchase_delivery", {
    p_track: q.trackId,
    p_offer: q.offerId,
    p_user: q.userId,
    p_email: (q.email || "").toLowerCase(),
  });
  if (error) {
    if (notApplied(error)) throw new DependencyMissing("music_purchase_delivery");
    throw new Error("could_not_resolve_purchase");
  }
  const row = firstRow<PurchaseRow>(data);
  if (!row?.entitlement_id) return { ok: false, status: 402, error: "purchase required" };
  if (row.revoked || row.order_status !== "paid") {
    return { ok: false, status: 403, error: "this licence has been revoked", log: { entitlement: row.entitlement_id, order_status: row.order_status } };
  }
  if (!row.asset_version_id || !row.object_name) {
    return { ok: false, status: 409, error: "the purchased version is not on record: contact support", log: { entitlement: row.entitlement_id, reason: "no_pinned_version" } };
  }
  if (row.bucket_id !== "creator-masters") {
    return { ok: false, status: 409, error: "release assets are not verified", log: { entitlement: row.entitlement_id, reason: "bucket" } };
  }
  if (row.intact !== true) {
    return { ok: false, status: 409, error: "the purchased version failed its integrity check: contact support", log: { entitlement: row.entitlement_id, version: row.asset_version_id, reason: "pinned_object_changed" } };
  }
  return { ok: true, bucket: row.bucket_id, path: row.object_name, entitlementId: row.entitlement_id, downloadCount: Number(row.download_count || 0) };
}

type TrackDeliveryRow = { track_status: string | null; asset_version_id: string | null; bucket_id: string | null; object_name: string | null; intact: boolean };

/* (e) A listener's stream of a published release: its pinned, reviewed
   master. The creator previewing their own unreleased draft gets the draft's
   master, after the ownership check. */
export async function streamTarget(
  db: MusicDb,
  track: { id: string; status: string; master_bucket: string | null; master_path: string | null },
  owner: boolean,
): Promise<Target | Refusal> {
  if (owner && track.status !== "published") {
    if (track.master_bucket !== "creator-masters" || !track.master_path) return { ok: false, status: 409, error: "master unavailable" };
    if (!(await assetsVerified(db, track.id))) return { ok: false, status: 409, error: "release assets are not verified" };
    return { ok: true, bucket: track.master_bucket, path: track.master_path };
  }
  const { data, error } = await db.rpc("music_track_delivery", { p_track: track.id });
  if (error) {
    if (notApplied(error)) throw new DependencyMissing("music_track_delivery");
    throw new Error("could_not_resolve_release");
  }
  const row = firstRow<TrackDeliveryRow>(data);
  if (!row || row.track_status !== "published") return { ok: false, status: 404, error: "track unavailable" };
  if (!row.asset_version_id || !row.object_name || row.bucket_id !== "creator-masters") {
    return { ok: false, status: 409, error: "master unavailable" };
  }
  if (row.intact !== true) {
    return { ok: false, status: 409, error: "release assets are not verified", log: { track: track.id, version: row.asset_version_id, reason: "pinned_object_changed" } };
  }
  if (!(await assetsVerified(db, track.id))) return { ok: false, status: 409, error: "release assets are not verified" };
  return { ok: true, bucket: row.bucket_id, path: row.object_name };
}
