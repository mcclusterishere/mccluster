// CHECKOUT — offering-driven, server-priced, Connect-aware.
//
// The browser sends ONLY an offering slug (plus an amount when — and
// only when — the offering is configured price_type='custom'). The server
// loads the authoritative offering record. `mccluster-primary` charges the
// McCluster platform account. Any other Stripe payment_account_reference is
// resolved to an onboarded org_stripe_accounts row and charged DIRECTLY on
// that connected account, so the client business owns its customer charge.
//
// No browser parameter can choose a seller, connected account, fee, currency,
// or fixed price. Those all come from server-side records.

import Stripe from "npm:stripe@14";

const SK = Deno.env.get("STRIPE_SK")!;
const stripe = new Stripe(SK);
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://matthew.mccluster.org";
const LIVEMODE = /_(live)_/.test(SK || "");

const SQ_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") ?? "";
const SQ_LOCATION = Deno.env.get("SQUARE_LOCATION_ID") ?? "";
const SQ_BASE = (Deno.env.get("SQUARE_ENV") ?? "production") === "sandbox"
  ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function rows(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } });
  if (!r.ok) throw new Error(`database ${r.status}`);
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const { offer, amount, note } = await req.json().catch(() => ({}));
  const slug = String(offer || "").toLowerCase().trim();
  if (!slug) return json({ error: "no_offering" }, 400);

  let offeringRows: any[];
  try {
    offeringRows = await rows(`offerings?slug=eq.${encodeURIComponent(slug)}&status=eq.live&select=*`);
  } catch {
    return json({ error: "offering_lookup_failed" }, 503);
  }
  const o = offeringRows[0] || null;
  if (!o) return json({ error: "unknown_offering" }, 404);
  if (o.inventory_policy === "unavailable") return json({ error: "unavailable" }, 409);

  let usd: number;
  if (o.price_type === "custom") {
    usd = Number(amount) || 0;
    const min = Number(o.custom_min ?? 1), max = Number(o.custom_max ?? 25000);
    if (usd < min || usd > max) return json({ error: "amount_out_of_bounds", min, max }, 400);
  } else {
    usd = Number(o.price);
    if (!(usd > 0)) return json({ error: "misconfigured_offering" }, 500);
  }
  const cents = Math.round(usd * 100);
  const label = String(o.title).slice(0, 200) + (note ? " · " + String(note).slice(0, 80) : "");
  const interval = o.billing_interval === "month" || o.billing_interval === "year" ? o.billing_interval : null;
  if (interval && o.price_type === "custom") return json({ error: "misconfigured_offering" }, 500);

  if (o.payment_provider === "square") {
    if (!SQ_TOKEN || !SQ_LOCATION) return json({ error: "square_not_armed" }, 503);
    if (interval) {
      return json({
        error: "square_subscription_not_self_serve",
        plan: o.provider_plan_id ?? null,
        detail: "This is a recurring Square offering. Start it from the Square plan against a customer with a card on file.",
      }, 409);
    }
    const sq = await fetch(`${SQ_BASE}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SQ_TOKEN}`, "Content-Type": "application/json", "Square-Version": "2025-01-23" },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        quick_pay: { name: label, price_money: { amount: cents, currency: "USD" }, location_id: SQ_LOCATION },
        checkout_options: {
          redirect_url: `${SITE}/pay.html?offer=${encodeURIComponent(slug)}&done=1`,
          ask_for_shipping_address: o.fulfillment_type === "physical_shipping",
        },
      }),
    });
    const j = await sq.json().catch(() => ({}));
    if (!sq.ok || !j?.payment_link?.url) return json({ error: "square_declined" }, 502);
    return json({ url: j.payment_link.url, provider: "square" });
  }

  const accountRef = String(o.payment_account_reference || "mccluster-primary").trim();
  let connectedAccount: string | null = null;
  let connectedOrgId: string | null = null;

  if (accountRef !== "mccluster-primary") {
    let accountRows: any[];
    try {
      accountRows = await rows(
        `org_stripe_accounts?account_reference=eq.${encodeURIComponent(accountRef)}` +
        `&livemode=eq.${LIVEMODE}&select=org_id,stripe_account_id,charges_enabled,payouts_enabled,details_submitted,onboarding_status&limit=1`,
      );
    } catch {
      return json({ error: "seller_lookup_failed" }, 503);
    }
    const seller = accountRows[0] || null;
    if (!seller || !seller.stripe_account_id) return json({ error: "seller_not_connected" }, 409);
    if (seller.charges_enabled !== true || seller.onboarding_status !== "ready") {
      return json({ error: "seller_not_ready", onboarding_status: seller.onboarding_status || "not_started" }, 409);
    }
    connectedAccount = String(seller.stripe_account_id);
    connectedOrgId = String(seller.org_id);
  }

  const metadata: Record<string, string> = {
    offering: slug,
    legal_entity: String(o.legal_entity_id || ""),
    revenue_type: String(o.revenue_type || ""),
    payment_account_reference: accountRef,
  };
  if (connectedOrgId) metadata.mccluster_org_id = connectedOrgId;

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: interval ? "subscription" : "payment",
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: o.currency || "usd",
        product_data: { name: label, description: String(o.short_description || "").slice(0, 250) || undefined },
        unit_amount: cents,
        ...(interval ? { recurring: { interval } } : {}),
      },
      quantity: 1,
    }],
    shipping_address_collection: o.fulfillment_type === "physical_shipping"
      ? { allowed_countries: ["US"] } : undefined,
    phone_number_collection: { enabled: true },
    custom_text: { submit: { message: "After this you will get a link to pick a time. Nothing to fill in." } },
    metadata,
    ...(interval ? { subscription_data: { metadata } } : {}),
    success_url: `${SITE}/pay.html?offer=${encodeURIComponent(slug)}&done=1&s={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/pay.html?offer=${encodeURIComponent(slug)}`,
  };

  try {
    const session = connectedAccount
      ? await stripe.checkout.sessions.create(params, { stripeAccount: connectedAccount })
      : await stripe.checkout.sessions.create(params);
    return json({
      url: session.url,
      provider: "stripe",
      seller: connectedAccount ? "connected" : "mccluster",
    });
  } catch (e) {
    console.error("checkout create failed", e);
    return json({ error: "stripe_declined" }, 502);
  }
});
