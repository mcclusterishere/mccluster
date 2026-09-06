// ORG-CONNECT-ONBOARD — McCluster client organizations get their own Stripe Express account.
// The signed-in M Account must be an owner of the org. Stripe credentials stay server-side.
import Stripe from "npm:stripe@14";

const SK = Deno.env.get("STRIPE_SK")!;
const stripe = new Stripe(SK);
const LIVEMODE = SK.startsWith("sk_live_");
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RETURN = "https://matthew.mccluster.org/account.html";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function rest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SRV);
  headers.set("Authorization", `Bearer ${SRV}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`${SB}/rest/v1/${path}`, { ...init, headers });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const who = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SRV, Authorization: auth },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!who?.id) return json({ error: "sign_in_first" }, 401);

  const { org_id } = await req.json().catch(() => ({}));
  const orgId = String(org_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return json({ error: "bad_org" }, 400);

  const membership = await rest(
    `org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(who.id)}&role=eq.owner&select=org_id&limit=1`,
  ).then((r) => r.json()).catch(() => []);
  if (!Array.isArray(membership) || !membership[0]) return json({ error: "owner_required" }, 403);

  const orgRows = await rest(
    `orgs?id=eq.${encodeURIComponent(orgId)}&select=id,name,slug&limit=1`,
  ).then((r) => r.json()).catch(() => []);
  const org = Array.isArray(orgRows) ? orgRows[0] : null;
  if (!org) return json({ error: "org_not_found" }, 404);

  const rows = await rest(
    `org_stripe_accounts?org_id=eq.${encodeURIComponent(orgId)}&livemode=eq.${LIVEMODE ? "true" : "false"}&select=stripe_account_id,onboarding_status,charges_enabled,payouts_enabled,details_submitted&limit=1`,
  ).then((r) => r.json()).catch(() => []);
  const saved = Array.isArray(rows) ? rows[0] : null;

  let account: Stripe.Account;
  if (saved?.stripe_account_id) {
    account = await stripe.accounts.retrieve(saved.stripe_account_id) as Stripe.Account;
  } else {
    account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: who.email || undefined,
      business_profile: { name: org.name || undefined },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { mccluster_org_id: orgId, mccluster_org_slug: String(org.slug || "") },
    });
  }

  const ready = account.charges_enabled === true && account.payouts_enabled === true && account.details_submitted === true;
  const disabled = Boolean(account.requirements?.disabled_reason);
  const status = ready ? "ready" : disabled ? "disabled" : "onboarding";

  await rest("org_stripe_accounts?on_conflict=org_id,livemode", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      org_id: orgId,
      livemode: LIVEMODE,
      account_reference: String(org.slug || orgId),
      stripe_account_id: account.id,
      charges_enabled: account.charges_enabled === true,
      payouts_enabled: account.payouts_enabled === true,
      details_submitted: account.details_submitted === true,
      onboarding_status: status,
      requirements: account.requirements || {},
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]),
  });

  if (ready) return json({ status: "ready", account: account.id, livemode: LIVEMODE });

  const link = await stripe.accountLinks.create({
    account: account.id,
    type: "account_onboarding",
    refresh_url: `${RETURN}?stripe=refresh&org=${encodeURIComponent(orgId)}`,
    return_url: `${RETURN}?stripe=return&org=${encodeURIComponent(orgId)}`,
  });

  return json({ status: "onboarding", url: link.url, livemode: LIVEMODE });
});
