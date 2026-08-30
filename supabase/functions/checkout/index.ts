// CHECKOUT — offering-driven, single seller, server-priced.
//
// The browser sends ONLY an offering slug (plus an amount when — and
// only when — the offering is configured price_type='custom'). The
// server loads the offering row and takes the authoritative price,
// currency, title, seller, and provider from the database. A query
// parameter never sets a charge amount on a fixed-price offering.
//
// Replaces the pay-anyone model: there are no payees to resolve,
// no Connect accounts, no destination charges. One seller —
// the offering's legal_entity_id names which McCluster account.
//
// Secrets: STRIPE_SK (and SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID if
// any offering routes square). Deploy with JWT verification OFF.

import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://matthew.mccluster.org";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const { offer, amount, note } = await req.json().catch(() => ({}));
  const slug = String(offer || "").toLowerCase().trim();
  if (!slug) return json({ error: "no_offering" }, 400);

  // the authoritative record — service role, server side only
  const r = await fetch(
    `${SB}/rest/v1/offerings?slug=eq.${encodeURIComponent(slug)}&status=eq.live&select=*`,
    { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } },
  );
  const rows = await r.json().catch(() => []);
  const o = Array.isArray(rows) ? rows[0] : null;
  if (!o) return json({ error: "unknown_offering" }, 404);
  if (o.inventory_policy === "unavailable") return json({ error: "unavailable" }, 409);

  // the price: the row's, or a bounded custom amount where configured
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

  // RECURRING WHERE THE ROW ASKS FOR IT. This was mode: "payment" only,
  // which is right for a print and useless for hosting: a $33/month
  // service could be described on the site and then charged exactly once.
  // billing_interval is null on every offering that existed before, so
  // those keep the behaviour they had. A custom amount can never be
  // recurring -- the migration's check constraint enforces that too, and
  // this guard means a row edited around it still cannot bill a subscriber
  // an arbitrary number every month.
  const interval = o.billing_interval === "month" || o.billing_interval === "year"
    ? o.billing_interval : null;
  if (interval && o.price_type === "custom") return json({ error: "misconfigured_offering" }, 500);

  if (o.payment_provider === "square") {
    if (!SQ_TOKEN || !SQ_LOCATION) return json({ error: "square_not_armed" }, 503);
    // A SQUARE RECURRING OFFERING CANNOT BE SOLD FROM HERE, AND SAYS SO.
    //
    // Square's quick-pay payment link is a ONE-TIME charge. Its
    // subscriptions are a different object entirely: they need a customer
    // record and a card on file, and they are started against a
    // SUBSCRIPTION_PLAN_VARIATION (offerings.provider_plan_id), not a
    // checkout link. Falling through to quick_pay would take one month's
    // money for a subscription and never charge again -- a silent, wrong,
    // paid outcome, which is the worst kind. Refuse instead, loudly, and
    // let the desk start it against the plan.
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

  const session = await stripe.checkout.sessions.create({
    mode: interval ? "subscription" : "payment",
    // CARD, NAMED EXPLICITLY.
    //
    // Left unset, Stripe picks the methods from the account's dynamic
    // payment-methods settings — and when that resolves to nothing it does
    // not degrade, it refuses the whole session:
    //
    //   No valid payment method types for this Checkout Session.
    //
    // Which is a 400 from Stripe, a 500 from here, and a dead button on
    // every price on the site. It was live and every checkout was failing.
    // Naming the method takes the account's dashboard configuration out of
    // the path for the one method that is always there.
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
    // A PHONE NUMBER, COLLECTED WHERE SOMEBODY IS ALREADY TYPING.
    //
    // Every customer here ends up needing a conversation -- a draft to
    // approve, a domain to confirm, a time to pick -- and chasing that by
    // email is how a week goes by. Stripe already asks for a card and an
    // email on this screen, so one more field is the cheapest possible
    // place to get a number, and it arrives with the buyer's consent
    // attached instead of scraped off a form somewhere.
    phone_number_collection: { enabled: true },
    // the receipt is the one message a buyer reliably opens, so the next
    // step travels on it: one tap, nothing to type, we already know them
    custom_text: {
      submit: { message: "After this you will get a link to pick a time. Nothing to fill in." },
    },
    metadata: { offering: slug, legal_entity: o.legal_entity_id, revenue_type: o.revenue_type },
    // session metadata does not reach the subscription, and the
    // subscription is the object that keeps billing after this checkout is
    // long gone -- so month eleven has to be able to say what it is for
    ...(interval
      ? { subscription_data: { metadata: { offering: slug, legal_entity: o.legal_entity_id, revenue_type: o.revenue_type } } }
      : {}),
    // the session id travels back so the success page can greet them by
    // name and hand them a booking link that already knows who they are.
    // Stripe substitutes the placeholder; it is not a template string.
    success_url: `${SITE}/pay.html?offer=${encodeURIComponent(slug)}&done=1&s={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/pay.html?offer=${encodeURIComponent(slug)}`,
  });
  return json({ url: session.url, provider: "stripe" });
});
