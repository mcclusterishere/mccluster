// ============================================================
// SUPERSEDED — SCHEDULED FOR RETIREMENT, STILL DEPLOYED AND LIVE
//
// docs/here-inventory.md and docs/architecture/current-state.md both
// already record this function as superseded by `checkout`, to be
// retired once `checkout` deployed. `checkout` deployed. This did not
// get retired, and has been serving traffic ever since.
//
// It belongs to the marketplace era of `mcclusterishere/Here`, which
// CLAUDE.md rule 11 says publishes nothing. Its SITE constant still
// points at that dead GitHub Pages origin, so its success and cancel
// redirects land nowhere.
//
// It reads `public.providers`, which holds ZERO rows, and
// `public.payments` also holds zero — no payment has ever completed
// through this path.
//
// This copy exists so that deleting the deployed function is a
// reversible act rather than a loss. Read the retirement note in
// docs/control-plane/AUTHZ.md before changing anything here.
// ============================================================
// CONNECT-ONBOARD (Here) — Standard account + hosted onboarding link.
// SaaS Stripe-owned pricing: the creator is the merchant of record.
//
// Superseded by workers/mccluster/src/connect.js, which does the same
// job against `org_stripe_accounts` and the org model rather than the
// dead `providers` table.
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

  const auth = req.headers.get("Authorization") || "";
  const who = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SRV, Authorization: auth },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!who?.id) return json({ error: "sign_in_first" }, 401);

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
