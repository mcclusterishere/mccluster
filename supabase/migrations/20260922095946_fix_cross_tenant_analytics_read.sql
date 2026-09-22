-- A CROSS-TENANT READ, caught before it had anything to leak.
--
-- The policy read:
--
--   "analytics owners read site events"  SELECT  to authenticated
--     using (site_id is not null
--            and exists (select 1 from analytics_sites s where s.id = events.site_id))
--
-- That checks the site EXISTS. It never checks the caller owns it. Any
-- signed-in account -- a listener who made an account to download a song
-- -- could read every site's traffic: pages, IPs, cities, networks,
-- device identifiers.
--
-- It leaked nothing at the time only because no site-attributed events
-- existed yet; every row had site_id null. Verified by impersonating an
-- ordinary confirmed listener: 0 rows. The first client onboarded turns
-- this from latent to live, and the first client is exactly the point at
-- which it becomes somebody else's data and somebody else's regulator.
--
-- Ownership on analytics_sites is expressed three ways -- owner_user_id,
-- org_id, site_account_id -- so all three are honoured rather than
-- picking one and quietly locking the others out of their own data.
--
-- Proven after applying, with a real site and a real event, both removed
-- in the same transaction: stranger sees 0, site owner sees 1.

drop policy if exists "analytics owners read site events" on public.events;

create policy "analytics owners read site events" on public.events
  for select to authenticated
  using (
    site_id is not null
    and exists (
      select 1 from public.analytics_sites s
       where s.id = events.site_id
         and (
              s.owner_user_id = auth.uid()
           or (s.org_id is not null and private.is_org_member(s.org_id))
           or (s.site_account_id is not null and exists (
                 select 1 from public.site_accounts a
                  where a.id = s.site_account_id
                    and a.user_id = auth.uid()))
         )
    )
  );

comment on policy "analytics owners read site events" on public.events is
  'Was: site EXISTS. Any signed-in account could read every site''s traffic. Now: the caller must own the site, be a member of its org, or hold its site account.';
