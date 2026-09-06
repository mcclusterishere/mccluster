// STRIPE-WEBHOOK — one Stripe event ledger for McCluster + connected orgs.
import Stripe from "npm:stripe@14";

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
      // Legacy creator/provider records remain supported while client orgs move
      // to org_stripe_accounts.
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
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.uid) await patchBy("providers", "uid", sub.metadata.uid, { plan: "free" });
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
