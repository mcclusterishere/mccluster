# connect-onboard: the payouts door (dashboard deploy)

A signed-in creator taps "Set up payouts" on their desk; this function creates
(or resumes) their Stripe **Standard** account, and they become the merchant of
record with their own Stripe dashboard, paying their own Stripe fees (the
SaaS Stripe-owned pricing model) and returns a Stripe-hosted
onboarding link. When Stripe reports `charges_enabled`, the function stamps the
row and the creator's pay link goes live. Server resolves everything;
the client never supplies an account id.

## Deploy (Supabase dashboard, "Here" project)

1. Edge Functions → Deploy a new function → name exactly `connect-onboard`.
2. Paste the code below. **Enforce JWT verification: ON**, so only signed-in
   creators may call it.
3. No new secrets: uses `STRIPE_SK` plus platform-injected `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY`.

## index.ts

```ts
// CONNECT-ONBOARD (Here): Standard account + hosted onboarding link.
// SaaS Stripe-owned pricing: the creator is the merchant of record.
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

  // who's asking; GoTrue answers for the caller's token
  const auth = req.headers.get("Authorization") || "";
  const who = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SRV, Authorization: auth },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!who?.id) return json({ error: "sign_in_first" }, 401);

  // their desk
  const rows = await fetch(
    `${SB}/rest/v1/providers?uid=eq.${who.id}&select=slug,stripe_acct,charges_enabled&limit=1`,
    { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } },
  ).then((r) => r.json()).catch(() => []);
  const desk = Array.isArray(rows) ? rows[0] : null;
  if (!desk) return json({ error: "no_desk" }, 404); // claim a desk first

  const patch = (body: unknown) =>
    fetch(`${SB}/rest/v1/providers?slug=eq.${encodeURIComponent(desk.slug)}`, {
      method: "PATCH",
      headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  let acct = desk.stripe_acct as string | null;
  if (!acct) {
    const account = await stripe.accounts.create({ type: "standard", email: who.email || undefined });
    acct = account.id;
    await patch({ stripe_acct: acct });
  } else {
    const account = await stripe.accounts.retrieve(acct);
    if (account.charges_enabled) {
      if (!desk.charges_enabled) await patch({ charges_enabled: true });
      return json({ status: "live" });
    }
  }

  const link = await stripe.accountLinks.create({
    account: acct,
    type: "account_onboarding",
    refresh_url: `${SITE}/album.html`,
    return_url: `${SITE}/album.html`,
  });
  return json({ status: desk.stripe_acct ? "resume" : "started", url: link.url });
});
```
