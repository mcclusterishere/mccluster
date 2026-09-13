-- Sprint P0: Supabase/control-plane containment.
-- Canonical Supabase project: Here (zmnhbrjyhxzhkxmhkexs).
--
-- These statements reconcile security changes already applied to the live
-- project on 2026-09-13. They are intentionally narrow: remove anonymous
-- execution from identity/role/membership helpers and remove client table
-- privileges from sensitive backend-only tables. Deliberate public read RPCs
-- and compatibility views are left unchanged.

-- Identity / role / membership helpers are authenticated control-plane
-- predicates, not anonymous RPC contracts.
revoke execute on function public.current_m_uid() from public, anon;
grant execute on function public.current_m_uid() to authenticated, service_role;

revoke execute on function public.eu_is_admin() from public, anon;
grant execute on function public.eu_is_admin() to authenticated, service_role;

revoke execute on function public.eu_is_staff() from public, anon;
grant execute on function public.eu_is_staff() to authenticated, service_role;

revoke execute on function public.eu_match_fellowships(uuid, integer, text[]) from public, anon;
grant execute on function public.eu_match_fellowships(uuid, integer, text[]) to authenticated, service_role;

revoke execute on function public.eu_role() from public, anon;
grant execute on function public.eu_role() to authenticated, service_role;

revoke execute on function public.inbox_is_staff() from public, anon;
grant execute on function public.inbox_is_staff() to authenticated, service_role;

revoke execute on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;

revoke execute on function public.is_org_owner(uuid) from public, anon;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;

revoke execute on function public.shake_is_crew() from public, anon;
grant execute on function public.shake_is_crew() to authenticated, service_role;

-- These RLS-enabled tables intentionally have no client policies. Remove
-- ambient table grants as a second barrier so adding a future policy cannot
-- silently expose identity-verification, invitation, or Stripe event data.
revoke all privileges on table public.identity_verifications from anon, authenticated;
revoke all privileges on table public.l3_owner_invites from anon, authenticated;
revoke all privileges on table public.stripe_events from anon, authenticated;
