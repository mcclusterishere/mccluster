// STRIPE-WEBHOOK — one Stripe event ledger for McCluster + connected orgs.
//
// Every paid checkout (offerings and music) also becomes the canonical
// commercial record: the buyer as a lead, a paid order, a provider-verified
// payment and its follow-up, through the commerce_record_stripe_* database
// functions (supabase/migrations/*_commerce_stripe_reconciler_v1.sql).
// Refunds, renewal invoices and ended subscriptions update the same records.
// A failure answers 500, so Stripe retries; every write is idempotent.
import Stripe from "npm:stripe@14";
import { checkoutRecord, invoiceRecord, refundRecord, subscriptionEndedRecord } from "./commerce.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const WH = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const dbHeaders = { apikey: SRV, Authorization: `Bearer ${SRV}`, "Content-Type": "application/json" };

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...dbHeaders, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`database ${r.status}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

const patchBy = (table: string, col: string, val: string, body: unknown) =>
  db(`${table}?${col}=eq.${encodeURIComponent(val)}`, { method: "PATCH", body: JSON.stringify(body) });

const rpc = (name: string, p: unknown) => db(`rpc/${name}`, { method: "POST", body: JSON.stringify({ p }) });

/* A subscription checkout is paid by its first invoice. Its payment intent is
   what a later refund names, and the subscription's period end is when the
   renewal falls due, so both are read from Stripe before recording. */
async function withSubscriptionDetails(record: Record<string, any>, event: Stripe.Event) {
  if (!record.subscription) return record;
  const opts = typeof event.account === "string" ? { stripeAccount: event.account } : undefined;
  if (record.invoice && !record.payment_intent) {
    const invoice = await stripe.invoices.retrieve(record.invoice, opts);
    const pi = (invoice as any).payment_intent;
    record.payment_intent = typeof pi === "string" ? pi : pi?.id ?? null;
  }
  const sub = await stripe.subscriptions.retrieve(record.subscription, opts);
  const end = (sub as any).current_period_end ?? (sub as any).items?.data?.[0]?.current_period_end;
  record.current_period_end = typeof end === "number" ? new Date(end * 1000).toISOString() : null;
  return record;
}

async function recordCheckout(session: Stripe.Checkout.Session, event: Stripe.Event) {
  const record = checkoutRecord(session as any, event as any);
  if (!record) return;
  await rpc("commerce_record_stripe_checkout", await withSubscriptionDetails(record, event));
}

function stateFor(a: Stripe.Account) {
  const ready = a.charges_enabled === true && a.payouts_enabled === true && a.details_submitted === true;
  const restricted = a.details_submitted === true && !ready;
  return {
    charges_enabled: a.charges_enabled === true,
    payouts_enabled: a.payouts_enabled === true,
    details_submitted: a.details_submitted === true,
    onboarding_status: ready ? "ready" : restricted ? "restricted" : "onboarding",
    requirements: {
      currently_due: a.requirements?.currently_due || [],
      eventually_due: a.requirements?.eventually_due || [],
      past_due: a.requirements?.past_due || [],
      pending_verification: a.requirements?.pending_verification || [],
      disabled_reason: a.requirements?.disabled_reason || null,
    },
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function grantMusicOrder(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.music_order_id || "";
  if (!orderId || session.metadata?.kind !== "music_license_sale" || session.payment_status !== "paid") return;
  const rows = await db(`music_orders?id=eq.${encodeURIComponent(orderId)}&select=id,offer_id,track_id,customer_user_id,customer_email,status&limit=1`);
  const order = rows?.[0];
  if (!order) throw new Error(`music order ${orderId} not found`);
  const email = String(session.customer_details?.email || session.customer_email || order.customer_email || "").toLowerCase();
  await db(`music_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "paid",
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      customer_email: email,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  const existing = await db(`music_entitlements?order_id=eq.${encodeURIComponent(orderId)}&select=id&limit=1`);
  if (!existing?.length) {
    await db("music_entitlements", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        order_id: orderId,
        offer_id: order.offer_id,
        track_id: order.track_id,
        user_id: order.customer_user_id || session.metadata?.customer_user_id || null,
        customer_email: email,
      }),
    });
  }
}

async function revokeMusicByPaymentIntent(paymentIntent: string) {
  if (!paymentIntent) return;
  const rows = await db(`music_orders?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntent)}&select=id&limit=1`);
  const order = rows?.[0];
  if (!order) return;
  const at = new Date().toISOString();
  await db(`music_orders?id=eq.${encodeURIComponent(order.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "refunded", refunded_at: at, updated_at: at }),
  });
  await db(`music_entitlements?order_id=eq.${encodeURIComponent(order.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ revoked_at: at }),
  });
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature") || "";
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, WH);
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  try {
    const seen = await db(`stripe_events?event_id=eq.${encodeURIComponent(event.id)}&select=event_id&limit=1`);
    if (Array.isArray(seen) && seen.length) return new Response("ok", { status: 200 });

    if (event.type === "account.updated") {
      const a = event.data.object as Stripe.Account;
      await patchBy("providers", "stripe_acct", a.id, { charges_enabled: a.charges_enabled === true });
      await db(`org_stripe_accounts?stripe_account_id=eq.${encodeURIComponent(a.id)}&livemode=eq.${event.livemode}`, {
        method: "PATCH",
        body: JSON.stringify(stateFor(a)),
      });
    }

    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "subscription" && s.metadata?.uid) {
        await patchBy("providers", "uid", s.metadata.uid, { plan: "premium" });
      }
      await grantMusicOrder(s);
      await recordCheckout(s, event);
    }

    /* card payments complete at once; bank debits and similar arrive here */
    if (event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data.object as Stripe.Checkout.Session;
      await grantMusicOrder(s);
      await recordCheckout(s, event);
    }

    if (event.type === "checkout.session.expired") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.metadata?.kind === "music_license_sale" && s.metadata.music_order_id) {
        await db(`music_orders?id=eq.${encodeURIComponent(s.metadata.music_order_id)}&status=eq.pending`, {
          method: "PATCH",
          body: JSON.stringify({ status: "canceled", updated_at: new Date().toISOString() }),
        });
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const p = event.data.object as Stripe.PaymentIntent;
      if (p.metadata?.kind === "music_license_sale" && p.metadata.music_order_id) {
        await db(`music_orders?id=eq.${encodeURIComponent(p.metadata.music_order_id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "failed", stripe_payment_intent_id: p.id, updated_at: new Date().toISOString() }),
        });
      }
    }

    if (event.type === "charge.refunded") {
      const c = event.data.object as Stripe.Charge;
      await revokeMusicByPaymentIntent(typeof c.payment_intent === "string" ? c.payment_intent : "");
      const refund = refundRecord(c as any, event as any);
      if (refund) await rpc("commerce_record_stripe_refund", refund);
    }

    if (event.type === "invoice.paid") {
      const invoice = invoiceRecord(event.data.object as any, event as any);
      if (invoice) await rpc("commerce_record_stripe_invoice", invoice);
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.uid) await patchBy("providers", "uid", sub.metadata.uid, { plan: "free" });
      const ended = subscriptionEndedRecord(sub as any, event as any);
      if (ended) await rpc("commerce_record_stripe_subscription_ended", ended);
    }

    await db("stripe_events", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({
        event_id: event.id,
        event_type: event.type,
        stripe_account_id: typeof event.account === "string" ? event.account : null,
      }),
    });
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("stripe webhook failed", e);
    return new Response("retry", { status: 500 });
  }
});