import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const SITE = "https://matthew.mccluster.org";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData.user;
  if (userError || !user?.id || !user.email) return json({ error: "authentication required" }, 401);

  const body = await req.json().catch(() => ({}));
  const offerId = String(body.offer_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(offerId)) return json({ error: "invalid offer" }, 400);

  const { data: offer, error } = await admin.from("music_license_offers")
    .select("id,track_id,creator_m_uid,title,license_type,price_cents,currency,terms_text,platform_fee_bps,active,checkout_enabled,creator_tracks!inner(id,title,artist,status,rights_status,slug)")
    .eq("id", offerId).eq("active", true).eq("checkout_enabled", true).limit(1).maybeSingle();
  if (error || !offer) return json({ error: "offer unavailable" }, 404);
  const track = Array.isArray(offer.creator_tracks) ? offer.creator_tracks[0] : offer.creator_tracks;
  if (!track || track.status !== "published" || track.rights_status !== "cleared") return json({ error: "track is not cleared for sale" }, 409);
  if (!Number.isInteger(offer.price_cents) || offer.price_cents < 1) return json({ error: "offer has no checkout price" }, 409);

  const orderId = crypto.randomUUID();
  const fee = Math.round(offer.price_cents * Number(offer.platform_fee_bps || 1500) / 10000);
  const creatorNet = offer.price_cents - fee;
  const metadata = {
    kind: "music_license_sale",
    music_order_id: orderId,
    music_offer_id: offer.id,
    music_track_id: offer.track_id,
    creator_m_uid: offer.creator_m_uid,
    customer_user_id: user.id,
    platform_fee_cents: String(fee),
    creator_net_cents: String(creatorNet),
  };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      customer_creation: "always",
      billing_address_collection: "auto",
      line_items: [{
        price_data: {
          currency: offer.currency || "usd",
          unit_amount: offer.price_cents,
          product_data: {
            name: `${track.title} — ${offer.title}`,
            description: offer.terms_text.slice(0, 450),
            metadata: { music_track_id: offer.track_id, music_offer_id: offer.id },
          },
        },
        quantity: 1,
      }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${SITE}/listen.html?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/listen.html?purchase=canceled&track=${encodeURIComponent(offer.track_id)}`,
    });
  } catch (checkoutError) {
    console.error("music checkout", checkoutError);
    return json({ error: "checkout unavailable" }, 502);
  }

  const { error: insertError } = await admin.from("music_orders").insert({
    id: orderId,
    offer_id: offer.id,
    track_id: offer.track_id,
    creator_m_uid: offer.creator_m_uid,
    customer_user_id: user.id,
    customer_email: user.email.toLowerCase(),
    stripe_checkout_session_id: session.id,
    amount_cents: offer.price_cents,
    platform_fee_cents: fee,
    creator_net_cents: creatorNet,
    currency: offer.currency || "usd",
    status: "pending",
    metadata,
  });
  if (insertError) {
    try { await stripe.checkout.sessions.expire(session.id); } catch (_) {}
    return json({ error: "could not record checkout" }, 500);
  }
  return json({ ok: true, url: session.url, order_id: orderId });
});