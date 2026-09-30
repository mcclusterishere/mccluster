// ARTIST-CHECKOUT — buy from an artist room (artist.html?a=<slug>).
//
// DIRECT CHARGE on the artist's Stripe connected account: the artist is the
// merchant of record (their statement descriptor, their sales tax, their
// refunds and disputes). McCluster, a public charity, receives only the
// disclosed application fee. Same pattern as l3-checkout.
//
// Price, credit and fee are computed in the database (artist_open_order),
// never taken from the client. The client may only name a product, a
// referral code, and whether to spend their store credit.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SK = Deno.env.get("STRIPE_SK")!;
const stripe = new Stripe(SK);
const LIVEMODE = SK.startsWith("sk_live_");
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
  if (userError || !user?.id || !user.email) return json({ error: "sign_in_first" }, 401);

  const body = await req.json().catch(() => ({}));
  const slug = String(body.artist || "").trim().toLowerCase();
  const productId = String(body.product_id || "").trim();
  const refRaw = String(body.ref || "").trim().toLowerCase();
  const ref = /^[a-z0-9-]{6,48}$/.test(refRaw) ? refRaw : null;
  const useCredit = body.use_credit === true;
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) return json({ error: "bad_artist" }, 400);
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return json({ error: "bad_product" }, 400);

  // The buyer's one McCluster identity.
  const { data: link } = await admin.from("m_auth_user_links")
    .select("m_uid").eq("auth_user_id", user.id).eq("is_primary", true).limit(1).maybeSingle();
  if (!link?.m_uid) return json({ error: "identity_missing" }, 409);

  const { data: room } = await admin.from("artist_ecosystems")
    .select("slug,org_id,display_name,status,config").eq("slug", slug).eq("status", "live").maybeSingle();
  if (!room) return json({ error: "room_not_live" }, 404);

  // The artist's own connected account, onboarded through org-connect-onboard.
  const { data: seller } = await admin.from("org_stripe_accounts")
    .select("stripe_account_id,onboarding_status,charges_enabled")
    .eq("org_id", room.org_id).eq("livemode", LIVEMODE).limit(1).maybeSingle();
  if (!seller?.stripe_account_id || seller.onboarding_status !== "ready" || !seller.charges_enabled) {
    return json({ error: "artist_payouts_not_ready" }, 409);
  }

  const { data: product } = await admin.from("artist_products")
    .select("id,sku,title,description,image_url,ships").eq("id", productId).eq("artist_slug", slug).maybeSingle();
  if (!product) return json({ error: "product_unavailable" }, 404);

  const { data: order, error: openError } = await admin.rpc("artist_open_order", {
    p_slug: slug, p_product: productId, p_m_uid: link.m_uid, p_email: user.email,
    p_account: seller.stripe_account_id, p_livemode: LIVEMODE, p_referral: ref, p_use_credit: useCredit,
  });
  if (openError || !order?.id) {
    const msg = String(openError?.message || "");
    return json({ error: /sold out/.test(msg) ? "sold_out" : "product_unavailable" }, 409);
  }

  const metadata = {
    kind: "artist_sale",
    artist_order_id: order.id,
    artist_slug: slug,
    artist_product_id: productId,
    customer_m_uid: link.m_uid,
    application_fee_cents: String(order.application_fee_cents),
    credit_applied_cents: String(order.credit_applied_cents),
  };
  const creditNote = order.credit_applied_cents > 0
    ? ` Includes $${(order.credit_applied_cents / 100).toFixed(2)} store credit.` : "";

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: order.currency,
          unit_amount: order.amount_cents,
          product_data: {
            name: `${room.display_name} — ${product.title}`,
            description: ((product.description || "") + creditNote).trim().slice(0, 450) || undefined,
            images: /^https:\/\//.test(product.image_url || "") ? [product.image_url] : undefined,
            metadata: { artist_product_id: productId, sku: product.sku },
          },
        },
        quantity: 1,
      }],
      ...(product.ships ? { shipping_address_collection: { allowed_countries: ["US"] } } : {}),
      // Sales tax is the artist's: only on when their account has Stripe Tax set up.
      ...(room.config?.stripe_tax === true ? { automatic_tax: { enabled: true, liability: { type: "self" } } } : {}),
      metadata,
      payment_intent_data: { application_fee_amount: order.application_fee_cents, metadata },
      success_url: `${SITE}/artist.html?a=${encodeURIComponent(slug)}&purchase=success`,
      cancel_url: `${SITE}/artist.html?a=${encodeURIComponent(slug)}&purchase=canceled`,
    }, { stripeAccount: seller.stripe_account_id, idempotencyKey: `artist-order-${order.id}` });
  } catch (checkoutError) {
    console.error("artist checkout", checkoutError);
    await admin.rpc("artist_cancel_order", { p_order: order.id, p_status: "failed" });
    return json({ error: "checkout_unavailable" }, 502);
  }

  await admin.rpc("artist_attach_session", { p_order: order.id, p_session: session.id });
  return json({ ok: true, url: session.url, order_id: order.id });
});
