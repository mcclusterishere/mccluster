import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { DependencyMissing, purchasedDownload, recordUpload, streamTarget, type MusicDb } from "./delivery.ts";
import { prepareReviewAudio, reviewDecisionRefusal, shortHash, type ObjectReader } from "./review-audio.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function clean(value: unknown, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}
function bearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7) : "";
}
async function caller(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: links } = await admin.from("m_auth_user_links").select("m_uid").eq("auth_user_id", data.user.id).eq("is_primary", true).limit(1);
  return { token, user: data.user, mUid: links?.[0]?.m_uid || null };
}
async function houseOps(userId: string) {
  const { data: org } = await admin.from("orgs").select("id").eq("slug", "mccluster").limit(1).maybeSingle();
  if (!org?.id) return false;
  const { data, error } = await admin.rpc("control_authorize_service", {
    p_actor: userId,
    p_org: org.id,
    p_capability: "ops.use",
    p_resource_type: null,
    p_resource_id: null,
    p_request_hash: null,
    p_approval_id: null,
  });
  if (error) return false;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.allowed === true;
}
async function signDownload(bucket: string, path: string, download?: string, expiresIn = 3600) {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, expiresIn, download ? { download } : undefined);
  if (error || !data?.signedUrl) throw new Error(error?.message || "could_not_sign_asset");
  return data.signedUrl;
}
/* Creator grants are never upserts: each grant is a fresh path, and an
   approved or purchased object is immutable (the database refuses an
   overwrite for every role; supabase/pending/music_release_payment_integrity_v1.sql). */
async function uploadGrant(bucket: string, path: string, upsert: boolean) {
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path, { upsert });
  if (error || !data?.token) throw new Error(error?.message || "could_not_create_upload_url");
  return { bucket, path: data.path || path, token: data.token, signed_url: data.signedUrl || null };
}
const db = admin as unknown as MusicDb;
/* (f) One Storage object as a stream, for hashing: the Storage API with the
   service key, read chunk by chunk (never storage.download(), which buffers
   the whole file into a Blob). */
const readObject: ObjectReader = async (bucket, path) => {
  const res = await fetch(`${SB}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { authorization: `Bearer ${SRV}`, apikey: SRV },
  });
  const length = Number(res.headers.get("content-length"));
  return { ok: res.ok, status: res.status, body: res.body, length: Number.isFinite(length) && length > 0 ? length : null };
};
async function hasMusicEntitlement(trackId: string, userId: string, email: string) {
  const { count: byUser } = await admin.from("music_entitlements").select("id", { count: "exact", head: true })
    .eq("track_id", trackId).eq("user_id", userId).is("revoked_at", null);
  if (Number(byUser || 0) > 0) return true;
  const { count: byEmail } = await admin.from("music_entitlements").select("id", { count: "exact", head: true })
    .eq("track_id", trackId).eq("customer_email", email.toLowerCase()).is("revoked_at", null);
  return Number(byEmail || 0) > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const who = await caller(req);
  if (!who) return json({ error: "authentication required" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "invalid json" }, 400); }
  const action = clean(body.action, 60);

  try {
    if (action === "operator-status") {
      return json({ ok: true, operator: await houseOps(who.user.id) });
    }

    if (action === "owner-upload-url") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const format = clean(body.format, 10).toLowerCase();
      const allowed: Record<string, { path: string; type: string }> = {
        mp3: { path: "niggy-nigg/niggy-nigg.mp3", type: "audio/mpeg" },
        m4r: { path: "niggy-nigg/niggy-nigg.m4r", type: "audio/mp4" },
        wav: { path: "niggy-nigg/niggy-nigg.wav", type: "audio/wav" },
      };
      if (!allowed[format]) return json({ error: "unsupported format" }, 400);
      const grant = await uploadGrant("mcc-gated-audio", allowed[format].path, true);
      return json({ ok: true, ...grant, content_type: allowed[format].type });
    }

    if (action === "creator-upload-url") {
      if (!who.mUid) return json({ error: "M identity required" }, 409);
      const { data: profile } = await admin.from("music_creator_profiles").select("m_uid,status").eq("m_uid", who.mUid).limit(1).maybeSingle();
      if (!profile || profile.status !== "active") return json({ error: "active creator profile required" }, 403);
      const bucket = clean(body.bucket, 60);
      if (!["creator-previews", "creator-masters", "creator-artwork"].includes(bucket)) return json({ error: "unsupported bucket" }, 400);
      const fileName = clean(body.file_name, 180).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
      if (!fileName || fileName.includes("..")) return json({ error: "invalid file name" }, 400);
      const path = `${who.user.id}/${crypto.randomUUID()}-${fileName}`;
      await recordUpload(db, bucket, path, who.user.id, who.mUid);
      return json({ ok: true, ...(await uploadGrant(bucket, path, false)) });
    }

    if (action === "stream") {
      const trackId = clean(body.track_id, 80);
      if (!trackId) return json({ error: "track_id required" }, 400);
      const { data: track, error } = await admin.from("creator_tracks").select("id,uid,m_uid,status,access_mode,master_bucket,master_path,title").eq("id", trackId).limit(1).maybeSingle();
      if (error || !track) return json({ error: "track not found" }, 404);
      const owner = track.uid === who.user.id || (who.mUid && track.m_uid === who.mUid);
      if (!owner && track.status !== "published") return json({ error: "track unavailable" }, 404);
      if (!track.master_bucket || !track.master_path) return json({ error: "master unavailable" }, 409);

      let entitled = owner || track.access_mode === "public" || track.access_mode === "account";
      if (!entitled && track.access_mode === "purchase") {
        entitled = await hasMusicEntitlement(track.id, who.user.id, who.user.email || "");
      }
      if (!entitled) return json({ error: "purchase required", purchase_required: true }, 402);
      /* (e) listeners get the pinned, reviewed master; never the live path */
      const target = await streamTarget(db, track, !!owner);
      if (!target.ok) {
        if (target.log) console.error("music-access stream refused", target.log);
        return json({ error: target.error }, target.status);
      }
      const url = await signDownload(target.bucket, target.path);
      return json({ ok: true, track_id: track.id, state: "full", url, expires_in: 3600 });
    }

    if (action === "download") {
      const trackId = clean(body.track_id, 80);
      const offerId = clean(body.offer_id, 80);
      if (!trackId || !offerId) return json({ error: "track_id and offer_id required" }, 400);
      /* (e) exactly the version this purchase bought, re-checked against
         Storage; revoked refuses; a takedown does not (owner policy) */
      const target = await purchasedDownload(db, { trackId, offerId, userId: who.user.id, email: who.user.email || "" });
      if (!target.ok) {
        if (target.log) console.error("music-access download refused", target.log);
        return json({ error: target.error, ...(target.status === 402 ? { purchase_required: true } : {}) }, target.status);
      }
      const { data: track } = await admin.from("creator_tracks").select("title").eq("id", trackId).limit(1).maybeSingle();
      const ext = (target.path.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "mp3").toLowerCase();
      const url = await signDownload(target.bucket, target.path, `${track?.title || "track"}.${ext}`);
      await admin.from("music_entitlements").update({
        download_count: target.downloadCount + 1,
        last_download_at: new Date().toISOString()
      }).eq("id", target.entitlementId);
      return json({ ok: true, url, expires_in: 3600 });
    }

    if (action === "operator-dashboard") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const { data: tracks, error: trackError } = await admin.from("creator_tracks")
        .select("id,m_uid,title,artist,status,rights_status,access_mode,genre,music_video_url,lyrics_url,experience,created_at,updated_at,published_at,moderation_note")
        .in("status", ["pending_review", "approved", "published", "rejected"])
        .order("created_at", { ascending: false }).limit(100);
      if (trackError) throw trackError;
      const { data: creators } = await admin.from("music_creator_profiles")
        .select("m_uid,handle,artist_name,verification_state,payout_state,status,settings");
      const { data: offers } = await admin.from("music_license_offers")
        .select("id,track_id,title,license_type,price_cents,currency,active,checkout_enabled,platform_fee_bps")
        .order("created_at", { ascending: false }).limit(200);
      return json({ ok: true, tracks: tracks || [], creators: creators || [], offers: offers || [] });
    }

    /* THE LYRIC MACHINE, owner side (Control → Create → Music → Lyrics).
       get: the release's timed lyrics + a short-lived URL to listen against;
       save: the owner's corrected lyrics (and the reviewed mark) onto
       creator_tracks.lyrics; queue: run the machine again on McCluster Core
       (an ops_agent_jobs row; core/src/executors/lyrics-align.mjs). */
    if (action === "operator-lyrics-get") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const trackId = clean(body.track_id, 80);
      if (!trackId) return json({ error: "track_id required" }, 400);
      const { data: t, error } = await admin.from("creator_tracks")
        .select("id,title,artist,lyrics,master_bucket,master_path,audio_url").eq("id", trackId).maybeSingle();
      if (error) throw error;
      if (!t) return json({ error: "track not found" }, 404);
      const listen = t.master_bucket && t.master_path ? await signDownload(t.master_bucket, t.master_path, undefined, 900) : (t.audio_url || null);
      return json({ ok: true, track_id: t.id, title: t.title, artist: t.artist, lyrics: t.lyrics || null, listen_url: listen, expires_in: 900 });
    }

    if (action === "operator-lyrics-save") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const trackId = clean(body.track_id, 80);
      type LyricLine = { begin?: unknown; content?: unknown };
      type LyricDoc = Record<string, unknown> & { timed?: { line?: unknown } };
      const lyrics = (body.lyrics && typeof body.lyrics === "object") ? body.lyrics as LyricDoc : null;
      if (!trackId) return json({ error: "track_id required" }, 400);
      const lines = lyrics && lyrics.timed && Array.isArray(lyrics.timed.line) ? lyrics.timed.line as LyricLine[] : null;
      if (!lines || lines.length > 2000) return json({ error: "lyrics must carry timed.line (at most 2000 lines)" }, 400);
      if (JSON.stringify(lyrics).length > 512 * 1024) return json({ error: "lyrics too large" }, 413);
      let prev = -1;
      for (const l of lines) {
        const begin = l && typeof l.begin === "number" ? l.begin : NaN;
        if (!l || typeof l.content !== "string" || !Number.isFinite(begin) || begin < prev) {
          return json({ error: "every line needs content and a begin time in order" }, 400);
        }
        prev = begin;
      }
      const reviewed = body.reviewed === true;
      const doc = { ...lyrics, reviewed, reviewed_at: reviewed ? new Date().toISOString() : null, reviewed_by: reviewed ? who.user.id : null };
      const { data, error } = await admin.from("creator_tracks").update({ lyrics: doc }).eq("id", trackId).select("id");
      if (error) throw error;
      if (!data?.length) return json({ error: "track not found" }, 404);
      return json({ ok: true, track_id: trackId, reviewed });
    }

    if (action === "operator-lyrics-queue") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const trackId = clean(body.track_id, 80);
      if (!trackId) return json({ error: "track_id required" }, 400);
      const { data: org } = await admin.from("orgs").select("id").eq("slug", "mccluster").limit(1).maybeSingle();
      if (!org?.id) return json({ error: "house org missing" }, 500);
      const { count } = await admin.from("ops_agent_jobs").select("id", { count: "exact", head: true })
        .eq("org_id", org.id).eq("job_type", "lyrics_align").eq("target_id", trackId).in("status", ["queued", "running"]);
      if (Number(count || 0) > 0) return json({ ok: true, queued: false, already: true });
      const { data: job, error } = await admin.from("ops_agent_jobs").insert({
        org_id: org.id, job_type: "lyrics_align", target_type: "creator_track", target_id: trackId,
        priority: 30, max_attempts: 2, input: { track_id: trackId, trigger: "operator", requested_by: who.user.id },
      }).select("id").single();
      if (error) throw error;
      return json({ ok: true, queued: true, job_id: job.id });
    }

    /* (f) The reviewer's step before a decision: pin the master under review,
       hash its exact bytes once (streaming, size-capped, fail closed), and
       hand back a player URL for THAT pinned object and its hash. The
       decision below must carry the same hash. */
    if (action === "operator-review-prepare") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const trackId = clean(body.track_id, 80);
      if (!trackId) return json({ error: "track_id required" }, 400);
      const audio = await prepareReviewAudio(db, readObject, trackId, undefined, body.recheck === true);
      if (!audio.ok) {
        if (audio.log) console.error("music-access review prepare refused", audio.log);
        return json({ error: audio.error }, audio.status);
      }
      const url = await signDownload(audio.bucket, audio.path, undefined, 900);
      return json({
        ok: true, track_id: audio.trackId, version_id: audio.versionId, sha256: audio.sha256,
        sha256_short: shortHash(audio.sha256), size_bytes: audio.sizeBytes, hashed_now: audio.hashedNow,
        expected_updated_at: audio.trackUpdatedAt, listen_url: url, expires_in: 900,
      });
    }

    if (action === "operator-review") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const trackId = clean(body.track_id, 80);
      const decision = clean(body.decision, 30);
      const note = clean(body.note, 1200);
      /* (b) The decision is about the version the operator looked at. A
         release that changed since then (updated_at moves on every write) is
         not published or cleared on an old look.
         (f) ...and about the audio bytes they listened to: approve/publish
         carry the SHA-256 operator-review-prepare showed them, and the
         database refuses unless it is the pinned master's recorded hash. */
      const expected = clean(body.expected_updated_at, 64);
      const expectedSha = clean(body.expected_master_sha256, 64).toLowerCase();
      if (!trackId || !["publish", "approve", "reject", "review"].includes(decision)) {
        return json({ error: "invalid review request" }, 400);
      }
      if ((decision === "publish" || decision === "approve") && !expected) {
        return json({ error: "expected_updated_at required: reload the queue and review again" }, 400);
      }
      if ((decision === "publish" || decision === "approve") && !/^[0-9a-f]{64}$/.test(expectedSha)) {
        return json({ error: "expected_master_sha256 required: verify the audio and review again" }, 400);
      }
      const { data, error } = await admin.rpc("music_operator_review", {
        p_track: trackId,
        p_decision: decision,
        p_note: note,
        p_expected_updated_at: expected || null,
        p_expected_master_sha256: expectedSha || null,
      });
      if (error) {
        const refusal = reviewDecisionRefusal(error);
        if (refusal) return json({ error: refusal.error }, refusal.status);
        throw error;
      }
      if (!data) return json({ error: "the release changed since you loaded it: reload and review it again" }, 409);
      return json({ ok: true, track: data });
    }

    if (action === "operator-license") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const offerId = clean(body.offer_id, 80);
      const enabled = body.enabled === true;
      const { data: offer } = await admin.from("music_license_offers")
        .select("id,track_id").eq("id", offerId).limit(1).maybeSingle();
      if (!offer) return json({ error: "offer not found" }, 404);
      if (enabled) {
        const { data: track } = await admin.from("creator_tracks")
          .select("status,rights_status").eq("id", offer.track_id).limit(1).maybeSingle();
        if (!track || track.status !== "published" || track.rights_status !== "cleared") {
          return json({ error: "publish and clear the track before enabling checkout" }, 409);
        }
      }
      const { data: updated, error } = await admin.from("music_license_offers")
        .update({ active: enabled, checkout_enabled: enabled, updated_at: new Date().toISOString() })
        .eq("id", offerId)
        .select("id,track_id,active,checkout_enabled").single();
      if (error) throw error;
      return json({ ok: true, offer: updated });
    }

    return json({ error: "unknown action" }, 400);
  } catch (error) {
    /* a missing integrity dependency refuses; it never falls back to signing */
    if (error instanceof DependencyMissing) {
      console.error("music-access dependency missing: refusing", { action, dependency: error.dependency });
      return json({ error: "music delivery is temporarily unavailable", dependency: error.dependency }, 503);
    }
    console.error("music-access", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});