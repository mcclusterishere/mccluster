# stripe-webhook: the truth-teller (dashboard deploy)

Stripe calls this when things actually happen: an Express account finishes
onboarding (`account.updated`), a premium subscription is paid
(`checkout.session.completed`), or one lapses (`customer.subscription.deleted`).
It stamps the server-only columns, `charges_enabled` and `plan`, so the desk
never lies. Nothing else can write those columns.

## Deploy (Supabase dashboard, "Here" project)

1. Edge Functions → Deploy a new function → name exactly `stripe-webhook`.
2. Paste the code below. **Enforce JWT verification: OFF**. Stripe signs its
   own calls; the function verifies the signature itself.
3. Stripe Dashboard → Developers → Webhooks → **Add endpoint**:
   `https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/stripe-webhook`
   with events `account.updated`, `checkout.session.completed`,
   `customer.subscription.deleted`. **Important:** when creating the endpoint,
   choose **"Listen to events on Connected accounts"** (not just your account);
   `account.updated` for creators only arrives on a Connect endpoint. Copy the
   **signing secret** (`whsec_…`).
4. Secrets: add `STRIPE_WEBHOOK_SECRET` = that `whsec_…` value.

## index.ts

```ts
// STRIPE-WEBHOOK (Here). Stripe reports, the desk records.
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const WH = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const patchBy = (col: string, val: string, body: unknown) =>
  fetch(`${SB}/rest/v1/providers?${col}=eq.${encodeURIComponent(val)}`, {
    method: "PATCH",
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

  if (event.type === "account.updated") {
    const a = event.data.object as Stripe.Account;
    await patchBy("stripe_acct", a.id, { charges_enabled: a.charges_enabled === true });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.mode === "subscription" && s.metadata?.uid) {
      await patchBy("uid", s.metadata.uid, { plan: "premium" });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.metadata?.uid) await patchBy("uid", sub.metadata.uid, { plan: "free" });
  }

  return new Response("ok", { status: 200 });
});
```
