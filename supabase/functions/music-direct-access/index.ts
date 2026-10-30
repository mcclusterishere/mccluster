// MUSIC-DIRECT-ACCESS — deliver a direct music purchase, and the owner's Direct sales desk.
//
// Brought into Git 2026-10-30 from the hand-deployed version and hardened. That version
// trusted session.metadata.music_direct_order_id, never checked that the order's stored
// session was this session or the amount/currency/account, and signed a download for
// anyone holding a checkout session id, forever, with no limit. Now:
//
//   claim {session_id}  the purchase page after Stripe's return. The order is found by
//                       the session id the server STORED (never by metadata), bound with
//                       ../_shared/music-direct.ts (platform account, same session, same
//                       amount and currency, paid, payment mode, payable) and fulfilled by
//                       public.music_direct_fulfil (conditional paid, one entitlement per
//                       order). It answers the entitlement TOKEN, and only for
//                       DIRECT_DEFAULTS.tokenRevealHours after payment: after that the
//                       session id opens nothing, the token link is what the buyer keeps.
//   status {token}      what the purchase page shows, without counting a download.
//   download {token}    public.music_direct_claim_download counts one download under a row
//                       lock (revoked, refunded, expired or over the limit refuse) and the
//                       private object is signed for DIRECT_DEFAULTS.signedUrlSeconds.
//
//   operator-*          the Direct sales tab of Control · Create · Music. Bearer token verified
//                       here, then the music desk's own authority: `ops.use` on the
//                       mccluster org (../_shared/house-ops.ts). Writes go through the
//                       service role, never from the browser to music_direct_offers.
//
// verify_jwt = false: buyers have no account. Every operator action verifies its caller.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { isHouseOperator } from "../_shared/house-ops.ts";
import {
  CATALOG_KEY_RE, DIRECT_AUDIO_TYPES, DIRECT_BUCKET, DIRECT_DEFAULTS, MAX_DOWNLOADS_RANGE, REFUSAL_HTTP, SESSION_ID_RE,
  TOKEN_RE, WINDOW_DAYS_RANGE, assetPathProblem, corsHeaders, directFulfilmentRefusal, directUploadPath, downloadNameFor,
  downloadRefusal, offerKeyFor, priceProblem, tokenRevealAllowed,
} from "../_shared/music-direct.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
const ORDER_COLUMNS = "id,offer_key,stripe_checkout_session_id,amount_cents,currency,status,paid_at";
const ENT_COLUMNS = "id,order_id,offer_key,token,download_count,max_downloads,expires_at,revoked_at";

async function entitlementView(orderId: string) {
  const { data: ent } = await admin.from("music_direct_entitlements").select(ENT_COLUMNS).eq("order_id", orderId).limit(1).maybeSingle();
  return ent as any;
}
async function offerTitle(offerKey: string) {
  const { data } = await admin.from("music_direct_offers").select("title,catalog_key").eq("offer_key", offerKey).limit(1).maybeSingle();
  return (data as any) || { title: "Your track", catalog_key: null };
}
function describe(ent: any, orderStatus: string, title: string) {
  const refusal = downloadRefusal(ent, orderStatus);
  return {
    title,
    downloads_used: ent ? ent.download_count : 0,
    downloads_left: ent && ent.max_downloads != null ? Math.max(0, ent.max_downloads - ent.download_count) : 0,
    max_downloads: ent?.max_downloads ?? null,
    expires_at: ent?.expires_at ?? null,
    can_download: !refusal,
    refusal: refusal ? { reason: refusal, message: REFUSAL_HTTP[refusal]?.message || "Download unavailable." } : null,
  };
}
const idOf = (v: unknown): string => typeof v === "string" ? v : (v && typeof v === "object" && typeof (v as any).id === "string" ? (v as any).id : "");

async function claim(sessionId: string) {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
  } catch (e) {
    /* not a session on this account (a connected account's session is invisible to the platform key) */
    if ((e as { type?: string })?.type === "StripeInvalidRequestError") throw new HttpError("That purchase was not found.", 404);
    throw e;
  }
  /* the order whose STORED session this is; metadata only has to agree */
  const { data: order } = await admin.from("music_direct_orders").select(ORDER_COLUMNS)
    .eq("stripe_checkout_session_id", session.id).limit(1).maybeSingle();
  /* a session retrieved with the platform key is a platform session: account is null */
  const refusal = directFulfilmentRefusal(session as any, { account: null }, order as any);
  if (refusal === "not_paid") return { ok: true, state: "processing" };
  if (refusal === "order_not_payable") {
    const st = (order as any)?.status;
    if (st === "refunded") return { ok: true, state: "revoked", message: REFUSAL_HTTP.revoked.message };
    throw new HttpError("This checkout can no longer be completed.", 409);
  }
  if (refusal) {
    console.error("music direct claim refused", { session: session.id, reason: refusal });
    throw new HttpError(refusal === "order_not_found" ? "That purchase was not found." : "That checkout is not a purchase from this site.", refusal === "order_not_found" ? 404 : 409);
  }
  const o = order as any;
  const pi = (session as any).payment_intent;
  const email = String(session.customer_details?.email || session.customer_email || "").toLowerCase();
  const { data: done, error } = await admin.rpc("music_direct_fulfil", {
    p_order: o.id, p_session: session.id, p_amount_cents: session.amount_total, p_currency: session.currency,
    p_payment_intent: idOf(pi), p_email: email,
  });
  if (error) throw error;
  if (!(done as any)?.ok) {
    console.error("music direct fulfil refused", { session: session.id, reason: (done as any)?.reason });
    throw new HttpError("That checkout is not a purchase from this site.", 409);
  }
  /* Stripe does not promise event order: a refund already on the charge closes it now */
  const charge = pi && typeof pi === "object" ? (pi as any).latest_charge : null;
  if (charge && typeof charge === "object" && Number(charge.amount_refunded || 0) > 0) {
    await admin.from("music_direct_orders").update({ status: "refunded" }).eq("id", o.id).eq("status", "paid");
    return { ok: true, state: "revoked", message: REFUSAL_HTTP.revoked.message };
  }
  const { data: fresh } = await admin.from("music_direct_orders").select(ORDER_COLUMNS).eq("id", o.id).limit(1).maybeSingle();
  const ent = await entitlementView(o.id);
  const offer = await offerTitle(o.offer_key);
  const view = describe(ent, (fresh as any)?.status, offer.title);
  if (!ent) throw new Error("entitlement missing after fulfilment");
  if (!tokenRevealAllowed((fresh as any)?.paid_at)) {
    return { ok: true, state: "paid", token_hidden: true, ...view,
      message: "This checkout link has expired for downloads. Use the download link saved from your purchase page." };
  }
  return { ok: true, state: "paid", token: ent.token, ...view };
}

async function tokenRow(token: string) {
  const { data: ent } = await admin.from("music_direct_entitlements").select(ENT_COLUMNS).eq("token", token).limit(1).maybeSingle();
  if (!ent) throw new HttpError(REFUSAL_HTTP.not_found.message, 404);
  const { data: order } = await admin.from("music_direct_orders").select("status").eq("id", (ent as any).order_id).limit(1).maybeSingle();
  return { ent: ent as any, orderStatus: (order as any)?.status as string };
}

/* ---------------------------------------------------------------- operator */
async function operatorFrom(req: Request) {
  const h = req.headers.get("authorization") || "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7) : "";
  if (!token) throw new HttpError("authentication required", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.id) throw new HttpError("authentication required", 401);
  if (!(await isHouseOperator(admin as any, data.user.id))) throw new HttpError("operator permission required", 403);
  return data.user;
}
async function objectExists(bucket: string, path: string) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await admin.storage.from(bucket).list(dir, { search: name, limit: 10 });
  if (error) return false;
  return (data || []).some((f: any) => f.name === name);
}
function intIn(v: unknown, [lo, hi]: readonly [number, number]): number | null {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= lo && n <= hi ? n : null;
}
function isoOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const t = new Date(String(v));
  if (!Number.isFinite(t.getTime())) throw new HttpError("invalid date", 400);
  return t.toISOString();
}

async function operator(action: string, body: Record<string, unknown>) {
  if (action === "operator-direct-list") {
    const { data: catalogue, error: cErr } = await admin.from("music_catalog_objects")
      .select("catalog_key,album_slug,album_title,track_title,artist_name,status")
      .eq("status", "active").order("album_title", { ascending: true }).order("track_title", { ascending: true }).limit(500);
    if (cErr) throw cErr;
    const { data: offers, error: oErr } = await admin.from("music_direct_offers")
      .select("offer_key,catalog_key,title,price_cents,currency,asset_bucket,asset_path,download_name,active,max_downloads,download_window_days,sale_starts_at,sale_ends_at,updated_at")
      .limit(500);
    if (oErr) throw oErr;
    const { data: orders } = await admin.from("music_direct_orders").select("offer_key,status,amount_cents").limit(5000);
    const sales: Record<string, { paid: number; refunded: number; gross_cents: number }> = {};
    for (const r of (orders || []) as any[]) {
      const s = sales[r.offer_key] ||= { paid: 0, refunded: 0, gross_cents: 0 };
      if (r.status === "paid") { s.paid++; s.gross_cents += Number(r.amount_cents || 0); }
      if (r.status === "refunded") s.refunded++;
    }
    return { ok: true, catalogue: catalogue || [], offers: offers || [], sales,
      defaults: { max_downloads: DIRECT_DEFAULTS.maxDownloads, download_window_days: DIRECT_DEFAULTS.downloadWindowDays },
      audio_types: Object.keys(DIRECT_AUDIO_TYPES) };
  }

  if (action === "operator-direct-upload-url") {
    const catalogKey = String(body.catalog_key || "");
    if (!CATALOG_KEY_RE.test(catalogKey)) throw new HttpError("invalid recording", 400);
    const { data: rec } = await admin.from("music_catalog_objects").select("catalog_key").eq("catalog_key", catalogKey).eq("status", "active").limit(1).maybeSingle();
    if (!rec) throw new HttpError("recording not in the catalogue", 404);
    const path = directUploadPath(catalogKey, String(body.file_name || ""), crypto.randomUUID());
    if (!path) throw new HttpError(`choose an audio file (${Object.keys(DIRECT_AUDIO_TYPES).join(", ")})`, 400);
    /* a fresh path every time, never an overwrite of a file buyers already hold */
    const { data, error } = await admin.storage.from(DIRECT_BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (error || !data?.token) throw new Error(error?.message || "could not create upload url");
    const ext = path.slice(path.lastIndexOf(".") + 1);
    return { ok: true, bucket: DIRECT_BUCKET, path: data.path || path, token: data.token, signed_url: data.signedUrl || null, content_type: DIRECT_AUDIO_TYPES[ext] };
  }

  if (action === "operator-direct-save") {
    const catalogKey = String(body.catalog_key || "");
    const offerKey = offerKeyFor(catalogKey);
    if (!offerKey) throw new HttpError("invalid recording", 400);
    const { data: rec } = await admin.from("music_catalog_objects").select("catalog_key,track_title").eq("catalog_key", catalogKey).limit(1).maybeSingle();
    if (!rec) throw new HttpError("recording not in the catalogue", 404);
    const { data: existing } = await admin.from("music_direct_offers").select("*").eq("offer_key", offerKey).limit(1).maybeSingle();
    const cur = (existing || {}) as any;
    const title = body.title !== undefined ? String(body.title).trim().slice(0, 200) : (cur.title || (rec as any).track_title);
    const price = body.price_cents !== undefined ? Number(body.price_cents) : cur.price_cents;
    const assetPath = body.asset_path !== undefined ? String(body.asset_path) : cur.asset_path;
    const active = body.active !== undefined ? body.active === true : cur.active === true;
    const maxDownloads = body.max_downloads !== undefined ? intIn(body.max_downloads, MAX_DOWNLOADS_RANGE) : (cur.max_downloads ?? DIRECT_DEFAULTS.maxDownloads);
    const windowDays = body.download_window_days !== undefined ? intIn(body.download_window_days, WINDOW_DAYS_RANGE) : (cur.download_window_days ?? DIRECT_DEFAULTS.downloadWindowDays);
    const startsAt = isoOrNull(body.sale_starts_at);
    const endsAt = isoOrNull(body.sale_ends_at);
    if (!title) throw new HttpError("title required", 400);
    const pp = priceProblem(price);
    if (pp) throw new HttpError(pp, 400);
    if (!assetPath) throw new HttpError("upload the full-quality file first", 400);
    const ap = assetPathProblem(DIRECT_BUCKET, assetPath);
    if (ap) throw new HttpError(ap, 400);
    if (maxDownloads == null) throw new HttpError(`downloads per purchase must be ${MAX_DOWNLOADS_RANGE[0]}-${MAX_DOWNLOADS_RANGE[1]}`, 400);
    if (windowDays == null) throw new HttpError(`download window must be ${WINDOW_DAYS_RANGE[0]}-${WINDOW_DAYS_RANGE[1]} days`, 400);
    /* nothing goes on sale without the file actually being there */
    if (active && !(await objectExists(DIRECT_BUCKET, assetPath))) throw new HttpError("the uploaded file was not found: upload it again", 409);
    const row: Record<string, unknown> = {
      offer_key: offerKey, catalog_key: catalogKey, title, price_cents: price, currency: "usd",
      asset_bucket: DIRECT_BUCKET, asset_path: assetPath, download_name: downloadNameFor(title, assetPath),
      active, max_downloads: maxDownloads, download_window_days: windowDays,
    };
    if (startsAt !== undefined) row.sale_starts_at = startsAt;
    if (endsAt !== undefined) row.sale_ends_at = endsAt;
    const { data: saved, error } = await admin.from("music_direct_offers").upsert(row, { onConflict: "offer_key" })
      .select("offer_key,catalog_key,title,price_cents,currency,asset_path,active,max_downloads,download_window_days,sale_starts_at,sale_ends_at").single();
    if (error) {
      console.error("music direct save", error.code, error.message);
      throw new HttpError("could not save the offer: " + (error.message || "database refused"), 409);
    }
    return { ok: true, offer: saved };
  }

  throw new HttpError("unknown action", 400);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), true);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  /* the deployed contract was { session_id } alone: that is a claim */
  const action = String(body.action || (body.session_id ? "claim" : ""));
  try {
    if (action === "claim") {
      const sessionId = String(body.session_id || "").trim();
      if (!SESSION_ID_RE.test(sessionId)) return json({ error: "invalid checkout session" }, 400);
      return json(await claim(sessionId));
    }
    if (action === "status" || action === "download") {
      const token = String(body.token || "").trim();
      if (!TOKEN_RE.test(token)) return json({ error: "invalid download link" }, 400);
      if (action === "status") {
        const { ent, orderStatus } = await tokenRow(token);
        const offer = await offerTitle(ent.offer_key);
        return json({ ok: true, state: orderStatus === "paid" && !ent.revoked_at ? "paid" : "revoked", ...describe(ent, orderStatus, offer.title) });
      }
      const { data: got, error } = await admin.rpc("music_direct_claim_download", { p_token: token });
      if (error) throw error;
      const r = got as any;
      if (!r?.ok) {
        const h = REFUSAL_HTTP[r?.reason] || { status: 403, message: "Download unavailable." };
        return json({ error: h.message, reason: r?.reason || "refused" }, h.status);
      }
      const { data: signed, error: signError } = await admin.storage.from(r.bucket)
        .createSignedUrl(r.path, DIRECT_DEFAULTS.signedUrlSeconds, { download: r.download_name });
      if (signError || !signed?.signedUrl) throw new Error(signError?.message || "could not sign download");
      return json({ ok: true, title: r.title, url: signed.signedUrl, expires_in: DIRECT_DEFAULTS.signedUrlSeconds,
        downloads_left: r.downloads_left, download_expires_at: r.expires_at });
    }
    if (action === "operator-status") {
      await operatorFrom(req);
      return json({ ok: true, operator: true });
    }
    if (action.startsWith("operator-")) {
      await operatorFrom(req);
      return json(await operator(action, body));
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("music direct access", e);
    return json({ error: "download service unavailable" }, 500);
  }
});
