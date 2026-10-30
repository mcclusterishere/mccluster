// MUSIC-DIRECT-CHECKOUT — buy one of Matthew McCluster's recordings, anonymously.
//
// Brought into Git 2026-10-30 from the hand-deployed version (which was wired to one
// campaign offer and returned to a campaign page) and generalised to any catalogue
// recording with an active offer (supabase/pending/music_direct_sales_v1.sql).
//
// Public by design (verify_jwt = false: buyers have no account). The request names an
// offer and nothing else: the price, currency and title come only from the server's
// offer row; the charge is on the PLATFORM account; the order is written with the
// Checkout Session id the server just created, which is what fulfilment binds to
// (../_shared/music-direct.ts, stripe-webhook, music-direct-access).
//
// Actions (POST JSON):
//   { action: "offers" }                     -> offers on sale now: catalog_key, offer_key, title, price, format
//   { action: "checkout", offer_key: "..." } -> { url } of a Stripe Checkout page
//   { offer_key: "..." }                     -> same as checkout (the deployed contract)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { MUSIC_DIRECT_KIND, OFFER_KEY_RE, audioFormatOf, corsHeaders, formatLabel, offerSaleRefusal } from "../_shared/music-direct.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
/* Matthew's property; equal to SITE in ../_shared/music-direct.ts (scripts/test/music-direct-sales.test.mjs) */
const HOUSE = "https://matthew.mccluster.org";
/* read with the service role; asset_path only to name the delivered format, never returned */
const OFFER_COLUMNS = "offer_key,catalog_key,title,price_cents,currency,active,sale_starts_at,sale_ends_at,asset_path";

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "checkout");

  if (action === "offers") {
    const { data, error } = await admin.from("music_direct_offers").select(OFFER_COLUMNS).eq("active", true).limit(500);
    if (error) {
      console.error("music direct offers", error.code, error.message);
      return json({ error: "offers unavailable" }, 503);
    }
    const now = new Date();
    const offers = (data || []).filter((o: any) => !offerSaleRefusal(o, now) && audioFormatOf(o.asset_path)).map((o: any) => ({
      offer_key: o.offer_key, catalog_key: o.catalog_key, title: o.title, price_cents: o.price_cents, currency: o.currency,
      format: audioFormatOf(o.asset_path),
    }));
    return json({ ok: true, offers });
  }
  if (action !== "checkout") return json({ error: "unknown action" }, 400);

  const offerKey = String(body.offer_key || "").trim();
  if (!OFFER_KEY_RE.test(offerKey)) return json({ error: "invalid offer" }, 400);
  const { data: offer, error } = await admin.from("music_direct_offers")
    .select(OFFER_COLUMNS).eq("offer_key", offerKey).limit(1).maybeSingle();
  if (error) console.error("music direct offer lookup", error.code, error.message);
  const refusal = error ? "offer_unavailable" : offerSaleRefusal(offer as any);
  if (refusal) return json({ error: refusal === "offer_unavailable" ? "offer unavailable" : refusal.replace(/_/g, " ") }, refusal === "offer_unavailable" ? 404 : 409);
  const o = offer as any;
  const currency = String(o.currency).toLowerCase();
  /* what is delivered is the file as uploaded: the label says its real format */
  const format = audioFormatOf(o.asset_path);
  if (!format) return json({ error: "offer unavailable" }, 409);
  const label = formatLabel(format);

  const orderId = crypto.randomUUID();
  /* a pointer to the order, never proof of anything: fulfilment re-binds to the stored session */
  const metadata = { kind: MUSIC_DIRECT_KIND, music_direct_order_id: orderId, music_direct_offer_key: o.offer_key };
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_creation: "always",
      billing_address_collection: "auto",
      line_items: [{
        price_data: {
          currency,
          unit_amount: o.price_cents,
          product_data: {
            name: `${o.title} (${label} download)`,
            description: `Full-quality ${label} file by Matthew McCluster, delivered as uploaded (not converted) on matthew.mccluster.org.`,
            metadata: { music_direct_offer_key: o.offer_key, catalog_key: o.catalog_key, format },
          },
        },
        quantity: 1,
      }],
      metadata,
      payment_intent_data: { metadata },
      allow_promotion_codes: false,
      success_url: `${HOUSE}/purchase.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${HOUSE}/purchase.html?canceled=1&offer=${encodeURIComponent(o.offer_key)}`,
    });
  } catch (e) {
    console.error("music direct checkout", e);
    return json({ error: "checkout unavailable" }, 502);
  }

  /* the database re-checks: pending only, a stored session, the offer's own price */
  const { error: insertError } = await admin.from("music_direct_orders").insert({
    id: orderId,
    offer_key: o.offer_key,
    stripe_checkout_session_id: session.id,
    amount_cents: o.price_cents,
    currency,
    status: "pending",
    metadata,
  });
  if (insertError) {
    try { await stripe.checkout.sessions.expire(session.id); } catch (_) { /* best effort */ }
    console.error("music direct order insert", insertError.code, insertError.message);
    return json({ error: "could not record checkout" }, 500);
  }
  return json({ ok: true, url: session.url, order_id: orderId });
});
