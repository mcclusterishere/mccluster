-- ============================================================
-- ESMER SHIPS FROM esmer.mccluster.org
--
-- 0058 registered esmer-web with esmermusic.com redirect URIs, on the
-- reasoning that it is the domain existing press already links to and
-- that ownership was still pending. It is still pending — the domain
-- does not resolve at all — so the site could not ship there.
--
-- It now ships from esmer.mccluster.org: GitHub Pages out of
-- mcclusterishere/esmer, on a host McCluster already controls, which
-- needed one DNS record and no confirmation from the client.
--
-- The esmermusic.com URIs are KEPT rather than replaced. A redirect
-- allowlist is the only thing standing between an OAuth flow and an
-- open redirect that arrives carrying a session, so entries are added
-- deliberately — but an entry for a domain nobody controls cannot be
-- redirected TO, and if Justin confirms control later the site moves
-- there with the allowlist already correct. An unused entry costs
-- nothing; a missing one is a login that fails at the last step.
-- ============================================================

update public.platform_apps
   set public_url = 'https://esmer.mccluster.org',
       oauth_redirect_uris = jsonb_build_array(
         'https://esmer.mccluster.org/auth/',
         'https://www.esmermusic.com/auth/',
         'https://esmermusic.com/auth/'
       ),
       updated_at = now()
 where app_key = 'esmer-web';

-- ------------------------------------------------------------
-- Verify. A registered app whose redirect list does not contain the
-- host it actually serves from is a login that dies on the callback,
-- and it fails silently at the provider rather than in our logs.
-- ------------------------------------------------------------
do $$
declare
  uris jsonb;
begin
  select oauth_redirect_uris into uris
    from public.platform_apps where app_key = 'esmer-web';

  if uris is null then
    raise exception 'esmer-web is not registered; 0058 should have created it';
  end if;

  if not (uris ? 'https://esmer.mccluster.org/auth/') then
    raise exception 'esmer-web cannot redirect to the host it serves from';
  end if;

  -- Every entry must be https. A single http entry turns the allowlist
  -- into a downgrade path for a session-bearing redirect.
  if exists (
    select 1 from jsonb_array_elements_text(uris) u
     where u not like 'https://%'
  ) then
    raise exception 'esmer-web has a non-https redirect URI';
  end if;
end $$;
