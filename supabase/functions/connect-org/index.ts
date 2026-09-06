import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

function accountState(a: Stripe.Account) {
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
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SK = Deno.env.get("STRIPE_SK")!;
  if (!SB || !SRV || !SK) return json({ error: "server_not_configured" }, 503);

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "authentication_required" }, 401);

  const db = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await db.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "invalid_session" }, 401);

  let orgSlug = "";
  if (req.method === "GET") orgSlug = new URL(req.url).searchParams.get("org") || "";
  else {
    const body = await req.json().catch(() => ({}));
    orgSlug = String(body?.org_slug || body?.org || "");
  }
  orgSlug = orgSlug.trim().toLowerCase();
  if (!orgSlug) return json({ error: "org_required" }, 400);

  const { data: org, error: orgError } = await db.from("orgs").select("id,slug,name,enabled").eq("slug", orgSlug).maybeSingle();
  if (orgError || !org || !org.enabled) return json({ error: "org_not_found" }, 404);

  const { data: membership } = await db.from("org_members").select("role").eq("org_id", org.id).eq("profile_id", user.id).maybeSingle();
  if (!membership || membership.role !== "owner") return json({ error: "owner_required" }, 403);

  const stripe = new Stripe(SK);
  const livemode = /_(live)_/.test(SK);
  const { data: row, error: rowError } = await db.from("org_stripe_accounts")
    .select("org_id,livemode,account_reference,stripe_account_id,charges_enabled,payouts_enabled,details_submitted,onboarding_status,requirements")
    .eq("org_id", org.id).eq("livemode", livemode).maybeSingle();
  if (rowError) return json({ error: "account_lookup_failed" }, 500);

  let account: Stripe.Account;
  if (row?.stripe_account_id) {
    const existing = await stripe.accounts.retrieve(row.stripe_account_id);
    if ((existing as Stripe.DeletedAccount).deleted) return json({ error: "connected_account_deleted" }, 409);
    account = existing as Stripe.Account;
  } else {
    if (req.method === "GET") return json({ org: org.slug, livemode, account: null, onboarding_status: row?.onboarding_status || "not_started" });
    account = await stripe.accounts.create({
      type: "express",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { mccluster_org_id: org.id, mccluster_org_slug: org.slug, platform: "mccluster" },
    });
  }

  const state = accountState(account);
  const { error: saveError } = await db.from("org_stripe_accounts").upsert({
    org_id: org.id,
    livemode,
    account_reference: row?.account_reference || org.slug,
    stripe_account_id: account.id,
    charges_enabled: state.charges_enabled,
    payouts_enabled: state.payouts_enabled,
    details_submitted: state.details_submitted,
    onboarding_status: state.onboarding_status,
    requirements: state.requirements,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "org_id,livemode" });
  if (saveError) return json({ error: "account_save_failed" }, 500);

  if (req.method === "GET" || state.onboarding_status === "ready") return json({ org: org.slug, livemode, account: account.id, ...state });

  const site = "https://matthew.mccluster.org/account.html";
  const link = await stripe.accountLinks.create({
    account: account.id,
    type: "account_onboarding",
    refresh_url: `${site}?stripe=refresh&org=${encodeURIComponent(org.slug)}`,
    return_url: `${site}?stripe=return&org=${encodeURIComponent(org.slug)}`,
  });
  return json({ org: org.slug, livemode, account: account.id, ...state, onboarding_url: link.url });
});
