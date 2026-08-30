# pay-now v4: creators keep 100% (dashboard redeploy)

The pitch rail: **creators never pay processing.** The buyer sees one all-in
price (the creator's rate + the platform's 10% spread; `MCC_STRIPE.quote()`
already paints it); the charge runs on the platform's account; and
`transfer_data.amount` guarantees the creator their **exact named rate, to the
penny**. Stripe's processing fee comes out of the platform's spread, never the
creator's money.

The honest trade: the platform is the merchant of record on creator payments, and
refunds and chargebacks hit the house, and the spread is the insurance premium
that funds that risk. (The direct-charge edition where creators carry their own
fees and liability lives in git history as v3, one revert away if the policy
ever changes.)

Deploy: open the existing `pay-now` function → Code → replace with the code
below → Deploy. Settings stay: **JWT OFF**, `STRIPE_SK` set. Requires
`docs/connect-saas.sql`; creators must have finished onboarding
(`charges_enabled` stamped) to be payable.

## The math (on a $100 creator rate)

- Buyer pays **$110.00** (the one price they ever see)
- Creator receives **$100.00**. Exactly, always
- Stripe takes ~$3.49 from the platform's side
- The platform keeps ~$6.51 of spread

## index.ts

```ts
// PAY-NOW v4 (Here): creators keep 100%. The buyer's all-in price
// carries the platform's 10% spread; the charge runs on the platform
// account and transfer_data.amount locks the creator's exact rate.
// Stripe's fee comes out of the spread, never the creator's money.
// Server resolves the payee and computes the split; nothing
// client-supplied is trusted but the buyer's all-in amount.
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://mcclusterishere.github.io/Here";
const RATE = 0.10; // the all-in spread; must match MCC_STRIPE.RATE in js/payments.js
const HOUSE: Record<string, boolean> = { mccluster: true, "equity-uprise": true };

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

  const { slug, amount, title } = await req.json().catch(() => ({}));
  const s = String(slug || "").toLowerCase().trim();
  const gross = Math.max(0, Number(amount) || 0); // the buyer's one all-in number
  if (!s || gross < 1) return json({ error: "bad_request" }, 400);
  const grossCents = Math.round(gross * 100);

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: String(title || "Payment").slice(0, 250) },
        unit_amount: grossCents,
      },
      quantity: 1,
    }],
    metadata: { slug: s, kind: "direct" },
    success_url: `${SITE}/pay.html?to=${encodeURIComponent(s)}&done=1`,
    cancel_url: `${SITE}/pay.html?to=${encodeURIComponent(s)}`,
  };

  if (!HOUSE[s]) {
    // a creator: resolve their rail server-side
    const rows = await fetch(
      `${SB}/rest/v1/providers?slug=eq.${encodeURIComponent(s)}&select=stripe_acct,charges_enabled&limit=1`,
      { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } },
    ).then((r) => r.json()).catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.stripe_acct || row.charges_enabled !== true) {
      return json({ error: "not_live" }, 409); // finishing payout setup
    }
    // the guarantee: the creator's exact rate, un-quoted from the buyer's
    // all-in price server-side; the client never dictates the split
    const netCents = Math.round(grossCents / (1 + RATE));
    params.payment_intent_data = {
      transfer_data: { destination: row.stripe_acct, amount: netCents },
    };
  }

  const session = await stripe.checkout.sessions.create(params);
  return json({ url: session.url });
});
```

## Notes

- **Tiny payments:** Stripe's fixed 30¢ eats the spread under ~$4. The $1
  floor keeps the worst case at pennies of platform loss; raise the floor if
  that ever matters.
- **Receiving transfers** requires the creator's onboarding to be complete;
  the `charges_enabled` gate covers it; anyone mid-onboarding gets the honest
  409 and the widget's "finishing payout setup" state.
- The `account.updated` webhook events for connected accounts only arrive if
  the Stripe webhook endpoint has **"Listen to events on Connected accounts"**
  selected; see docs/stripe-webhook.md.
