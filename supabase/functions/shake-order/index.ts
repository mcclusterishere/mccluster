// SHAKE-ORDER — the only thing allowed to write an order.
//
// The database has no insert policy on shake_orders for anybody, so this
// function is the sole door. That is deliberate: everything below exists
// to make sure the number charged is a number the SHOP decided, not one
// the browser sent.
//
// ---- WHAT IT REFUSES ---------------------------------------------------
//
//   a price from the client        every cent is recomputed from
//                                  shake_products and its options jsonb
//   an option that isn't on sale   a choice not present in the product's
//                                  own options is rejected, not charged
//   a stop that isn't served       stop_id must be an active shake_stop
//   an order to a closed shop      shake_open_window is the single source
//                                  of truth for "are we open"
//   an order past capacity         max_orders on the window
//   a "paid" claim from the client the return trip re-asks Stripe
//
// ---- ACTIONS -----------------------------------------------------------
//
//   quote    price a cart, create nothing (the storefront's running total)
//   create   price it, write the order, open a Stripe Checkout Session
//   confirm  ask Stripe whether that session actually paid, then flip
//   track    read one order back by its claim token
//
// ---- DEPLOY ------------------------------------------------------------
//
//   supabase secrets set STRIPE_SK=sk_live_...
//   supabase functions deploy shake-order --no-verify-jwt
//
// JWT verification is off at the gateway because a customer does not need
// an account to buy a shake. A signed-in buyer is still resolved inside
// the function, so their order attaches to their profile.

import Stripe from "npm:stripe@14";
import { priceCart as computeCart, type Line, type Product } from "./price.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://matthew.mccluster.org";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SRV,
      Authorization: `Bearer ${SRV}`,
      "Content-Type": "application/json",
      Prefer: (init.headers as Record<string, string> | undefined)?.Prefer ?? "return=representation",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!r.ok) throw new Error(`db ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : await r.json().catch(() => null);
}

// A bearer token here belongs to the customer. Resolve it against GoTrue
// rather than decoding it — an unverified `sub` is a suggestion.
async function callerProfile(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token === SRV) return null;
  try {
    const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRV, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    if (typeof u?.id !== "string") return null;
    // signed in is not the same as having a profile row, and profile_id is
    // a foreign key — attach only if the row is really there
    const rows = await db(`eu_profiles?id=eq.${u.id}&select=id`);
    return rows?.length ? u.id : null;
  } catch { return null; }
}

/* Fetch the menu as the DATABASE has it, then hand both to the pure
   pricer in ./price.ts. The lookup is the only part that needs the
   network; the arithmetic is testable on its own and is tested. */
async function priceCart(lines: Line[]) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("empty cart");
  const slugs = [...new Set(lines.map((l) => String(l.slug)))];
  const products = await db(
    `shake_products?slug=in.(${slugs.map(encodeURIComponent).join(",")})&select=slug,name,price_cents,options,available`,
  );
  const bySlug = new Map<string, Product>((products ?? []).map((p: Product) => [p.slug, p]));
  return computeCart(lines, bySlug);
}

async function openWindow() {
  const rows = await db("shake_open_window?select=*");
  return rows?.[0] ?? null;
}

const code = () => "SHK-" + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(Math.random() * 90 + 10);
const token = () => crypto.randomUUID().replace(/-/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "create");

    // ---- quote --------------------------------------------------------
    if (action === "quote") {
      const w = await openWindow();
      const { items, subtotal } = await priceCart(body.items ?? []);
      const fee = w ? w.fee_cents : 0;
      return json({ open: !!w, items, subtotal_cents: subtotal, fee_cents: fee, total_cents: subtotal + fee });
    }

    // ---- track --------------------------------------------------------
    if (action === "track") {
      const t = String(body.claim_token ?? "");
      if (!t) return json({ error: "no order to track" }, 400);
      const rows = await db(
        `shake_orders?claim_token=eq.${encodeURIComponent(t)}&select=code,status,items,total_cents,stop_name,room_detail,placed_at,delivered_at`,
      );
      if (!rows?.length) return json({ error: "no such order" }, 404);
      return json({ order: rows[0] });
    }

    // ---- confirm ------------------------------------------------------
    // The browser comes back from Stripe saying it paid. We ask Stripe.
    if (action === "confirm") {
      const sessionId = String(body.session_id ?? "");
      const claim = String(body.claim_token ?? "");
      if (!sessionId || !claim) return json({ error: "missing session" }, 400);

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const rows = await db(`shake_orders?claim_token=eq.${encodeURIComponent(claim)}&select=*`);
      const order = rows?.[0];
      if (!order) return json({ error: "no such order" }, 404);
      // the session has to be the one we opened for THIS order
      if (order.payment_ref !== sessionId) return json({ error: "session mismatch" }, 400);

      if (session.payment_status === "paid" && order.status === "pending_payment") {
        await db(`shake_orders?id=eq.${order.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "paid" }),
        });
        return json({ status: "paid", code: order.code });
      }
      return json({ status: order.status, code: order.code, paid: session.payment_status === "paid" });
    }

    // ---- create -------------------------------------------------------
    const w = await openWindow();
    if (!w) return json({ error: "The shop is closed right now.", closed: true }, 409);
    if (w.taken >= w.max_orders) {
      return json({ error: "Tonight's run is full. Try the next window.", full: true }, 409);
    }

    const stops = await db(`shake_stops?id=eq.${encodeURIComponent(String(body.stop_id ?? ""))}&select=id,name,active`);
    const stop = stops?.[0];
    if (!stop || !stop.active) return json({ error: "Pick a building we deliver to." }, 400);

    const name = String(body.customer_name ?? "").trim().slice(0, 80);
    const room = String(body.room_detail ?? "").trim().slice(0, 120);
    const phone = String(body.contact_phone ?? "").trim().slice(0, 40);
    if (!name) return json({ error: "We need a name for the order." }, 400);
    if (!room) return json({ error: "Which room should it come to?" }, 400);
    if (!phone) return json({ error: "A phone number, so the runner can find you." }, 400);

    const { items, subtotal } = await priceCart(body.items ?? []);
    const total = subtotal + w.fee_cents;
    if (total <= 0) return json({ error: "pricing error" }, 400);

    const profileId = await callerProfile(req);
    const claim = token();
    const orderCode = code();

    const created = await db("shake_orders", {
      method: "POST",
      body: JSON.stringify({
        code: orderCode,
        window_id: w.id,
        profile_id: profileId,
        claim_token: claim,
        customer_name: name,
        contact_phone: phone,
        contact_email: String(body.contact_email ?? "").trim().slice(0, 200),
        stop_id: stop.id,
        stop_name: stop.name,
        room_detail: room,
        items,
        subtotal_cents: subtotal,
        fee_cents: w.fee_cents,
        total_cents: total,
        status: "pending_payment",
        payment_provider: "stripe",
        note: String(body.note ?? "").trim().slice(0, 400),
      }),
    });
    const order = created[0];

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // one line per item, so the customer's receipt reads like the order
      line_items: (items as any[]).map((i) => ({
        quantity: i.qty,
        price_data: {
          currency: "usd",
          unit_amount: i.each_cents,
          product_data: {
            name: i.name + (i.choice_labels.length ? ` (${i.choice_labels.join(", ")})` : ""),
          },
        },
      })).concat(
        w.fee_cents
          ? [{ quantity: 1, price_data: { currency: "usd", unit_amount: w.fee_cents, product_data: { name: "Delivery" } } }]
          : [],
      ),
      success_url: `${SITE}/shakes.html?order=${claim}&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/shakes.html?order=${claim}&canceled=1`,
      metadata: { order_code: orderCode, stop: stop.name, room },
    });

    await db(`shake_orders?id=eq.${order.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ payment_ref: session.id }),
    });

    return json({ code: orderCode, claim_token: claim, total_cents: total, pay_url: session.url });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    console.error("shake-order", msg);
    // the validation messages above are written to be read by a customer;
    // anything else is ours and stays vague
    const mine = /don't sell|sold out|pick a|isn't an option|empty cart|odd quantity|a lot of shakes/.test(msg);
    return json({ error: mine ? msg : "Something went wrong taking that order." }, mine ? 400 : 500);
  }
});
