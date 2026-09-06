-- ============================================================
-- ONE McCLUSTER ACCOUNT, EVERY McCLUSTER-POWERED SITE
--
-- Two layers, and they are not alternatives — the first is the foundation
-- the second is branded on top of.
--
-- LAYER 1 — shared identity (works as soon as Google is enabled).
--   Every property authenticates against THIS Supabase project. A person who
--   signs in on matthew.mccluster.org and later on a client's site is the
--   same auth.users row, same id, on both. That is what makes one account
--   work everywhere. It is not a shared cookie: a session is per-origin, and
--   no current browser will carry one across domains. Signing in on a
--   client's site is one tap, not a second account.
--
-- LAYER 2 — "Continue with McCluster" (needs client registration).
--   This project already answers OIDC discovery at
--   /auth/v1/.well-known/openid-configuration, so McCluster is a real
--   identity provider and oauth/consent/ is its consent screen. What is
--   missing is registered clients: every row in platform_oauth_clients has
--   client_id null and registered_at null, so /auth/v1/oauth/authorize
--   answers 404 for all of them and that consent screen cannot be reached.
--
-- This migration does the part SQL can do — records which apps are meant to
-- be clients and which redirect URIs are legitimate for each. Actually
-- creating the client in Supabase Auth is a dashboard/Management API step;
-- see docs/control-plane/SSO.md. platform_oauth_clients is a MIRROR for
-- policy and audit, not the protocol source of truth, and 0034 says so.
-- ============================================================

-- The house's own site was never registered as an app that signs people in.
insert into public.platform_apps (app_key, name, product_family, kind, public_url)
values ('mccluster-web', 'McCluster', 'mccluster', 'web', 'https://matthew.mccluster.org')
on conflict (app_key) do update set public_url = excluded.public_url, updated_at = now();

-- Redirect URIs are an allowlist, and the only thing standing between this
-- flow and an open redirect that arrives carrying a session. Both the apex
-- and www forms are listed for Esmer because his canonical hostname is not
-- confirmed yet; an unused entry costs nothing, a missing one breaks login.
update public.platform_apps
   set oauth_redirect_uris = '["https://matthew.mccluster.org/auth/","https://mccluster.org/auth/"]'::jsonb,
       updated_at = now()
 where app_key = 'mccluster-web';

update public.platform_apps
   set oauth_redirect_uris = '["https://www.esmermusic.com/auth/","https://esmermusic.com/auth/"]'::jsonb,
       public_url = coalesce(public_url, 'https://www.esmermusic.com'),
       updated_at = now()
 where app_key = 'esmer-web';

-- Mirror rows. client_id stays null until Supabase Auth issues one — writing
-- a made-up id here would make the registry lie about what exists.
insert into public.platform_oauth_clients (app_id, client_type, redirect_uris, scopes, environment)
select a.id, 'public', a.oauth_redirect_uris, array['openid','profile','email'], 'production'
from public.platform_apps a
where a.app_key in ('mccluster-web', 'esmer-web')
on conflict (app_id) do update
  set redirect_uris = excluded.redirect_uris,
      updated_at = now();

comment on table public.platform_oauth_clients is
  'Mirror of OAuth clients for policy and audit. Supabase Auth > OAuth Apps is the protocol source of truth. client_id null means the client has NOT been registered there yet and /auth/v1/oauth/authorize will 404 for it.';
