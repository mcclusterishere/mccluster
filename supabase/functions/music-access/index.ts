import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
async function signDownload(bucket: string, path: string, download?: string) {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 3600, download ? { download } : undefined);
  if (error || !data?.signedUrl) throw new Error(error?.message || "could_not_sign_asset");
  return data.signedUrl;
}
async function uploadGrant(bucket: string, path: string) {
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.token) throw new Error(error?.message || "could_not_create_upload_url");
  return { bucket, path: data.path || path, token: data.token, signed_url: data.signedUrl || null };
}
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
      const grant = await uploadGrant("mcc-gated-audio", allowed[format].path);
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
      return json({ ok: true, ...(await uploadGrant(bucket, path)) });
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
      const url = await signDownload(track.master_bucket, track.master_path);
      return json({ ok: true, track_id: track.id, state: "full", url, expires_in: 3600 });
    }

    if (action === "download") {
      const trackId = clean(body.track_id, 80);
      const offerId = clean(body.offer_id, 80);
      if (!trackId || !offerId) return json({ error: "track_id and offer_id required" }, 400);
      const { data: entitlement } = await admin.from("music_entitlements").select("id,offer_id").eq("track_id", trackId)
        .or(`user_id.eq.${who.user.id},customer_email.eq.${(who.user.email || "").toLowerCase()}`)
        .is("revoked_at", null).limit(1).maybeSingle();
      if (!entitlement || entitlement.offer_id !== offerId) return json({ error: "purchase required", purchase_required: true }, 402);
      const { data: track } = await admin.from("creator_tracks").select("master_bucket,master_path,title").eq("id", trackId).limit(1).maybeSingle();
      if (!track?.master_path) return json({ error: "master unavailable" }, 409);
      const url = await signDownload(track.master_bucket, track.master_path, `${track.title || "track"}.mp3`);
      await admin.from("music_entitlements").update({ download_count: 1, last_download_at: new Date().toISOString() }).eq("id", entitlement.id);
      return json({ ok: true, url, expires_in: 3600 });
    }

    if (action === "operator-dashboard") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const { data: tracks, error: trackError } = await admin.from("creator_tracks")
        .select("id,m_uid,title,artist,status,rights_status,access_mode,genre,created_at,published_at,moderation_note")
        .in("status", ["pending_review", "approved", "published", "rejected"])
        .order("created_at", { ascending: false }).limit(100);
      if (trackError) throw trackError;
      const { data: creators } = await admin.from("music_creator_profiles")
        .select("m_uid,handle,artist_name,verification_state,payout_state,status");
      const { data: offers } = await admin.from("music_license_offers")
        .select("id,track_id,title,license_type,price_cents,currency,active,checkout_enabled,platform_fee_bps")
        .order("created_at", { ascending: false }).limit(200);
      return json({ ok: true, tracks: tracks || [], creators: creators || [], offers: offers || [] });
    }

    if (action === "operator-review") {
      if (!(await houseOps(who.user.id))) return json({ error: "operator permission required" }, 403);
      const trackId = clean(body.track_id, 80);
      const decision = clean(body.decision, 30);
      const note = clean(body.note, 1200);
      if (!trackId || !["publish", "approve", "reject", "review"].includes(decision)) {
        return json({ error: "invalid review request" }, 400);
      }
      const patch: Record<string, unknown> = { moderation_note: note, updated_at: new Date().toISOString() };
      if (decision === "publish") {
        patch.status = "published";
        patch.rights_status = "cleared";
        patch.published_at = new Date().toISOString();
      } else if (decision === "approve") {
        patch.status = "approved";
        patch.rights_status = "cleared";
      } else if (decision === "reject") {
        patch.status = "rejected";
        patch.rights_status = "disputed";
      } else {
        patch.status = "pending_review";
        patch.rights_status = "review";
      }
      const { data: updated, error } = await admin.from("creator_tracks")
        .update(patch).eq("id", trackId)
        .select("id,title,status,rights_status,published_at,moderation_note").single();
      if (error) throw error;
      return json({ ok: true, track: updated });
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
    console.error("music-access", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});