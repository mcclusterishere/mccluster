-- ============================================================
-- HARDENING THE FUNCTION SURFACE.
--
-- Found by Supabase's own database linter after 0017-0019 went live, and
-- both findings are real rather than noise.
--
-- 1. A TRIGGER FUNCTION IS NOT AN API.
--
--    Postgres grants EXECUTE on new functions to PUBLIC by default, and
--    PostgREST exposes anything executable in the `public` schema at
--    /rest/v1/rpc/<name>. That put six trigger functions — the guards
--    that decide what role a profile may claim, whether a host listing
--    goes live, and whether a campaign may leave draft — on the public
--    internet as callable endpoints.
--
--    Calling one directly generally errors ("trigger functions can only
--    be called as triggers"), so this was a thin surface rather than an
--    open door. Thin is not the standard: a function nobody is ever
--    meant to call should not be callable. Revoked.
--
--    Firing a trigger does NOT re-check EXECUTE on its function, so
--    every write still works. That is not an assumption — the full
--    39-assertion suite in supabase/tests/ was run against a cluster
--    with these revokes applied before this migration went near the
--    live project, and stayed green.
--
-- 2. A SECURITY DEFINER FUNCTION NEEDS A FIXED search_path.
--
--    eu_fellowships_touch() was the one function in 0017 written without
--    `set search_path`. Every other one has it. Fixed rather than
--    explained.
--
-- ---- WHAT IS DELIBERATELY LEFT ALONE ------------------------------------
--
-- The linter also reports four views as SECURITY DEFINER, at ERROR level.
-- All four are intentional and MUST stay that way:
--
--   eu_profiles_public       the policy on eu_profiles is `to authenticated`,
--   eu_perspectives_public   so a signed-out visitor has no row access at
--                            all. These views ARE the public projection —
--                            their own WHERE clause is the wall, and they
--                            drop the columns a stranger may not see
--                            (contact details always; location unless the
--                            person turned it on; the identity behind an
--                            anonymous perspective). Switching them to
--                            security_invoker would return zero rows to
--                            every signed-out visitor, which is not a
--                            security fix, it is an outage.
--
--   eu_counts                four COUNT(*)s. Nothing to leak.
--
--   shake_open_window        `taken` counts shake_orders, which anon
--                            cannot read. It exposes the NUMBER, never a
--                            row — that is the "3 left tonight" on the
--                            storefront. Under security_invoker the count
--                            would silently read 0 for every visitor.
--
-- If a future linter run flags these four again: this comment is the
-- answer. Read it before "fixing" them.
--
-- One more the linter finds that is NOT from these migrations:
-- public.seed_engagement_modules() is a pre-existing SECURITY DEFINER
-- plpgsql function that anon can call over RPC. It predates this work and
-- is left untouched here on purpose — changing somebody else's function
-- as a side effect of a shake shop is how migrations become dangerous.
-- Flagged for the owner rather than silently altered.
-- ============================================================

alter function public.eu_fellowships_touch() set search_path = public;

revoke execute on function public.eu_profiles_guard()     from anon, authenticated, public;
revoke execute on function public.eu_fellowships_guard()  from anon, authenticated, public;
revoke execute on function public.eu_fellowships_touch()  from anon, authenticated, public;
revoke execute on function public.eu_campaigns_guard()    from anon, authenticated, public;
revoke execute on function public.eu_perspectives_audit() from anon, authenticated, public;
revoke execute on function public.shake_orders_track()    from anon, authenticated, public;
