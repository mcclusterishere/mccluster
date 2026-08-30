# backend-sub: the premium backend's subscription (dashboard deploy)

The SaaS bill. A signed-in creator taps "Go premium" on the free desk; this
function opens a Stripe Checkout **subscription** for the premium backend.
The webhook (docs/stripe-webhook.md) flips their plan when payment lands.
The plan column is server-only, so this is the only door to premium.

## One-time Stripe setup

Stripe Dashboard → Product catalog → **Add product**: "The Backend · Premium",
recurring monthly, your price. Copy the **price id** (`price_…`).

## Deploy (Supabase dashboard, "Here" project)

1. Edge Functions → Deploy a new function → name exactly `backend-sub`.
2. Paste the code below. **Enforce JWT verification: ON.**
3. Secrets: add `PREMIUM_PRICE_ID` = the `price_…` id from above.
   (`STRIPE_SK` is already set.)

## index.ts

```ts
// BACKEND-SUB (Here): the premium desk's subscription checkout.
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PRICE = Deno.env.get("PREMIUM_PRICE_ID")!;
const SITE = "https://mcclusterishere.github.io/Here";

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

  const auth = req.headers.get("Authorization") || "";
  const who = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SRV, Authorization: auth },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!who?.id) return json({ error: "sign_in_first" }, 401);

  const rows = await fetch(
    `${SB}/rest/v1/providers?uid=eq.${who.id}&select=slug,stripe_customer&limit=1`,
    { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } },
  ).then((r) => r.json()).catch(() => []);
  const desk = Array.isArray(rows) ? rows[0] : null;
  if (!desk) return json({ error: "no_desk" }, 404);

  let customer = desk.stripe_customer as string | null;
  if (!customer) {
    const c = await stripe.customers.create({ email: who.email || undefined, metadata: { uid: who.id } });
    customer = c.id;
    await fetch(`${SB}/rest/v1/providers?slug=eq.${encodeURIComponent(desk.slug)}`, {
      method: "PATCH",
      headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, "Content-Type": "application/json" },
      body: JSON.stringify({ stripe_customer: customer }),
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: PRICE, quantity: 1 }],
    metadata: { uid: who.id, kind: "backend_premium" },
    subscription_data: { metadata: { uid: who.id } },
    success_url: `${SITE}/album.html?premium=1`,
    cancel_url: `${SITE}/album.html`,
  });
  return json({ url: session.url });
});
```
