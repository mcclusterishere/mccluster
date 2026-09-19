-- ============================================================
-- THE CATALOGUE COMES WITH THE SERVICE.
--
-- Anybody on a management engagement can use the McCluster catalogue in
-- their own business at no charge: on their website, in their store, and
-- under their own social posts. It is not an upsell and it is not a
-- stock library, it is the actual records licensed from the artist.
--
-- THE GRANT IS DERIVED, NEVER STORED. A licence that exists as a row
-- somebody has to remember to delete is a licence that outlives the
-- subscription paying for it. customer_licences reads the engagement
-- instead, so ending the service ends the grant in the same query, with
-- no cleanup to forget and no way for the two to disagree.
--
-- Cruising is deliberately NOT active for this purpose. The licence runs
-- with the management service and cruising is the absence of it. That is
-- said on the page before anybody buys, in the same words.
--
-- The merch scope is granted=false on purpose. Selling somebody else's
-- merchandise out of your storefront involves pieces, a split and supply,
-- and none of those are things a database row should decide on its own.
-- It shows on the site as "Arranged" rather than "Included".
-- ============================================================

create table if not exists public.licence_scopes (
  id          text primary key,
  name        text not null,
  what        text not null,
  granted     boolean not null default true,
  ordinal     int not null default 0
);

comment on table public.licence_scopes is
  'What the bundled customer licence covers. Mirrors customer_license.covers in data/offers.json, which is what the site renders; this is what the grant is checked against. granted=false means the scope exists but is arranged in the agreement rather than given automatically.';

insert into public.licence_scopes (id, name, what, granted, ordinal) values
  ('website',  'On your website', 'The catalogue playing on their own site: background beds, a hero film, a landing page that opens with a record.', true, 1),
  ('premises', 'In your store',   'Played in their place of business. A shop, a studio, a salon, a restaurant floor.', true, 2),
  ('social',   'Under your posts','Their own social content on their own accounts, scored with the catalogue.', true, 3),
  ('merch',    'The swag, in your store', 'Stocking and selling McCluster merchandise from a physical storefront. Pieces, split and supply are set in the agreement, so this is never granted automatically.', false, 4)
on conflict (id) do nothing;

create or replace view public.customer_licences as
select
  e.id                as engagement_id,
  e.client_name,
  e.client_email,
  e.site_slug,
  e.offer_id,
  e.mode,
  e.started_on,
  e.free_until,
  s.id                as scope_id,
  s.name              as scope_name,
  s.what              as scope_what,
  s.granted           as automatic,
  case
    when e.offer_id <> 'anti-social'                     then 'not_included'
    when e.decision = 'cruise'                           then 'ended'
    when not s.granted                                   then 'by_agreement'
    when current_date <= e.free_until                    then 'active_free'
    when e.decision = 'upgrade'                          then 'active'
    else                                                      'lapsed'
  end as state
from public.engagements e
cross join public.licence_scopes s;

comment on view public.customer_licences is
  'One row per scope per engagement. Derived from the engagement, so a licence cannot outlive the service that pays for it. lapsed means the free month ran out with no decision, which is a conversation, not a breach.';

alter table public.licence_scopes enable row level security;
drop policy if exists ls_read on public.licence_scopes;
create policy ls_read on public.licence_scopes for select to anon, authenticated using (true);
drop policy if exists ls_admin on public.licence_scopes;
create policy ls_admin on public.licence_scopes for all to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

grant select on public.licence_scopes to anon, authenticated;
grant all    on public.licence_scopes to authenticated;
alter view public.customer_licences set (security_invoker = on);
grant select on public.customer_licences to authenticated;
