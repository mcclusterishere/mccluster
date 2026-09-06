// STRIPE-WEBHOOK (Here) — Stripe reports, the desk records.
// Syncs both legacy creator rails and org-level Connect accounts.
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const WH = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const headers = { apikey: SRV, Authorization: `Bearer ${SRV}`, "Content-Type": "application/json" };

const patchProviderBy = (col: string, val: string, body: unknown) =>
  fetch(`${SB}/rest/v1/providers?${col}=eq.${encodeURIComponent(val)}`, {
    method: "PATCH", headers, body: JSON.stringify(body),
  });

const patchOrgStripe = (accountId: string, body: unknown) =>
  fetch(`${SB}/rest/v1/org_stripe_accounts?stripe_account_id=eq.${encodeURIComponent(accountId)}`, {
    method: "PATCH", headers, body: JSON.stringify(body),
  });

const recordEvent = (event: Stripe.Event) =>
  fetch(`${SB}/rest/v1/stripe_events?on_conflict=event_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify([{
      event_id: event.id,
      event_type: event.type,
      stripe_account_id: event.account || null,
      processed_at: new Date().toISOString(),
    }]),
  });

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
    if (event.type === "account.updated") {
      const a = event.data.object as Stripe.Account;
      const ready = a.charges_enabled === true && a.payouts_enabled === true && a.details_submitted === true;
      const disabled = Boolean(a.requirements?.disabled_reason);
      const status = ready ? "ready" : disabled ? "disabled" : "restricted";

      await Promise.all([
        patchProviderBy("stripe_acct", a.id, { charges_enabled: a.charges_enabled === true }),
        patchOrgStripe(a.id, {
          charges_enabled: a.charges_enabled === true,
          payouts_enabled: a.payouts_enabled === true,
          details_submitted: a.details_submitted === true,
          onboarding_status: status,
          requirements: a.requirements || {},
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      ]);
    }

    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "subscription" && s.metadata?.uid) {
        await patchProviderBy("uid", s.metadata.uid, { plan: "premium" });
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.uid) await patchProviderBy("uid", sub.metadata.uid, { plan: "free" });
    }

    // Record only after successful handling so a Stripe retry can still recover
    // from a transient database or network failure.
    await recordEvent(event);
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("stripe webhook failed", event.id, e);
    return new Response("retry", { status: 500 });
  }
});
