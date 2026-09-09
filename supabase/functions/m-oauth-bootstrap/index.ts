// M-OAUTH-BOOTSTRAP — register this project's OAuth clients, once.
//
// Supabase Auth is the protocol source of truth for OAuth clients;
// `platform_oauth_clients` is only a mirror kept for policy and audit
// (0034 says so). A row there with `client_id` null means the app is
// *meant* to be a client and has not been created yet, so
// /auth/v1/oauth/authorize answers 404 for it and the consent screen at
// oauth/consent/ cannot be reached. This closes that gap: it reads the
// mirror, creates the missing clients through the admin API, and writes
// the resulting client_id back so the two agree.
//
// It is idempotent. An app whose name and redirect set already match an
// existing client is adopted rather than duplicated, and an app with no
// https redirect is skipped with the reason rather than registered with
// a redirect nobody vetted — an unvetted redirect URI on a public client
// is an open redirect that arrives carrying a session.
//
// ---------------------------------------------------------------
// TWO THINGS TO KNOW BEFORE TOUCHING THIS
// ---------------------------------------------------------------
//
// 1. THE NONCE IS THE ONLY AUTHENTICATION, AND IT IS NOW A SECRET.
//    `verify_jwt` is false, because this runs before any client exists
//    to sign in against. The deployed version carried the nonce as a
//    string literal in this file. That is fine while the source is
//    private and wrong the moment it is committed: the literal is a
//    credential that lets anyone who reads the repository create OAuth
//    clients on this project. It is read from the environment here.
//
//    CONSEQUENCE: the repository copy and the deployed copy differ
//    until someone sets M_OAUTH_BOOTSTRAP_NONCE as a function secret
//    and redeploys. That divergence is deliberate and is recorded in
//    docs/control-plane/SSO.md. Deploying this file without setting the
//    secret makes the endpoint refuse everything, which is the safe
//    direction to fail.
//
// 2. IT CANNOT SUCCEED YET. As of 2026-09-07 it answers
//    {"error":"oauth_admin_unavailable","detail":"OAuth server is
//    disabled"} — the OAuth 2.1 server is switched off in the project's
//    auth settings. That switch, not this function, is what currently
//    blocks "Continue with McCluster".
//
// This is a one-shot bootstrap. Once every intended app shows a
// client_id, delete the function rather than leaving an unauthenticated
// client-creation endpoint deployed forever.

import { createClient } from "npm:@supabase/supabase-js@2";

const NONCE = Deno.env.get("M_OAUTH_BOOTSTRAP_NONCE") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

Deno.serve(async (req) => {
  const u = new URL(req.url);

  // No configured nonce means refuse everything. The alternative — an
  // empty NONCE matching an empty query parameter — would leave this
  // wide open, which is exactly the failure this shape avoids.
  if (!NONCE) return json({ error: "not_found" }, 404);

  // Same 404 for wrong method and wrong nonce, so the endpoint does not
  // confirm its own existence to someone guessing.
  if (req.method !== "GET" || u.searchParams.get("nonce") !== NONCE) {
    return json({ error: "not_found" }, 404);
  }

  const SB = Deno.env.get("SUPABASE_URL")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!SB || !SRV) return json({ error: "server_not_configured" }, 503);
  const db = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });

  const list = await db.auth.admin.oauth.listClients();
  if (list.error) return json({ error: "oauth_admin_unavailable", detail: list.error.message }, 409);
  const existing = (list.data || []) as any[];

  const { data: rows, error: qerr } = await db
    .from("platform_oauth_clients")
    .select("app_id,client_id,client_type,redirect_uris,platform_apps!inner(app_key,name,enabled)")
    .is("client_id", null);
  if (qerr) return json({ error: "registry_lookup_failed", detail: qerr.message }, 500);

  const made: any[] = [];
  const skipped: any[] = [];
  for (const row of rows || []) {
    const app = Array.isArray((row as any).platform_apps)
      ? (row as any).platform_apps[0]
      : (row as any).platform_apps;
    // https only, and only what the mirror already vetted. A redirect
    // that was not written down deliberately does not get registered.
    const redirects = Array.isArray((row as any).redirect_uris)
      ? (row as any).redirect_uris.filter((x: unknown) => typeof x === "string" && /^https:\/\//.test(x as string))
      : [];
    if (!app?.enabled || redirects.length === 0) {
      skipped.push({ app_key: app?.app_key || row.app_id, reason: "no_production_redirects" });
      continue;
    }

    // Adopt an identical existing client instead of creating a second
    // one, so re-running this does not litter the project.
    const duplicate = existing.find(
      (c: any) =>
        c?.name === app.name &&
        JSON.stringify((c?.redirect_uris || []).slice().sort()) === JSON.stringify(redirects.slice().sort()),
    );
    let client: any = duplicate || null;
    if (!client) {
      const created = await db.auth.admin.oauth.createClient({
        name: `M · ${app.name}`,
        redirect_uris: redirects,
        // Public client with no secret: these are browser apps, which
        // cannot hold one. PKCE is what protects the exchange.
        client_type: "public",
        token_endpoint_auth_method: "none",
      } as any);
      if (created.error) {
        skipped.push({ app_key: app.app_key, reason: created.error.message });
        continue;
      }
      client = created.data;
    }
    const clientId = client?.client_id || client?.id;
    if (!clientId) {
      skipped.push({ app_key: app.app_key, reason: "client_id_missing" });
      continue;
    }

    const now = new Date().toISOString();
    const { error: u1 } = await db
      .from("platform_oauth_clients")
      .update({ client_id: clientId, registered_at: now, updated_at: now })
      .eq("app_id", row.app_id);
    const { error: u2 } = await db
      .from("platform_apps")
      .update({ oauth_client_id: clientId, updated_at: now })
      .eq("id", row.app_id);
    if (u1 || u2) {
      skipped.push({ app_key: app.app_key, reason: (u1 || u2)?.message || "mirror_update_failed" });
      continue;
    }
    made.push({ app_key: app.app_key, client_id: clientId, redirect_uris: redirects });
  }

  return json({ ok: true, existing_count: existing.length, registered: made, skipped });
});
