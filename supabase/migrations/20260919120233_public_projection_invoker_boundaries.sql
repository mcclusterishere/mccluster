create or replace function public.eu_profiles_public_projection()
returns table (
  id uuid, handle text, display_name text, kind text, role text, headline text, bio text,
  location text, region text, links jsonb, interests text[], goals text, open_to text[],
  avatar_url text, created_at timestamptz
)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select p.id, p.handle, p.display_name, p.kind, p.role, p.headline, p.bio,
         case when p.show_location then p.location else ''::text end,
         p.region, p.links, p.interests, p.goals, p.open_to, p.avatar_url, p.created_at
  from public.eu_profiles p
  where p.visibility = 'public' and p.status = 'active'
$$;

create or replace function public.eu_perspectives_public_projection()
returns table (
  id uuid, topic_slug text, body text, answers jsonb, priority integer, region text,
  created_at timestamptz, display_name text, profile_id uuid, handle text
)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select v.id, v.topic_slug, v.body, v.answers, v.priority, v.region, v.created_at,
         case when v.anonymous then ''::text else v.display_name end,
         case when v.anonymous then null::uuid else v.profile_id end,
         case when v.anonymous then null::text else pr.handle end
  from public.eu_perspectives v
  left join public.eu_profiles pr
    on pr.id = v.profile_id and pr.visibility = 'public' and pr.status = 'active'
  where v.status = 'approved' and v.consent_public
$$;

create or replace function public.eu_counts_projection()
returns table (profiles bigint, perspectives bigint, fellowships bigint, topics bigint)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select
    (select count(*) from public.eu_profiles where visibility='public' and status='active')::bigint,
    (select count(*) from public.eu_perspectives where status='approved')::bigint,
    (select count(*) from public.eu_fellowships where status='published')::bigint,
    (select count(*) from public.eu_topics where status='active')::bigint
$$;

create or replace function public.shake_open_window_projection()
returns table (
  id uuid, opens_at timestamptz, closes_at timestamptz, note text,
  max_orders integer, fee_cents integer, taken bigint
)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select w.id, w.opens_at, w.closes_at, w.note, w.max_orders, w.fee_cents,
         (select count(*) from public.shake_orders o
           where o.window_id = w.id and o.status <> 'canceled')::bigint
  from public.shake_windows w
  where w.status='open' and now() >= w.opens_at and now() <= w.closes_at
  order by w.closes_at desc limit 1
$$;

revoke all on function public.eu_profiles_public_projection() from public;
revoke all on function public.eu_perspectives_public_projection() from public;
revoke all on function public.eu_counts_projection() from public;
revoke all on function public.shake_open_window_projection() from public;
grant execute on function public.eu_profiles_public_projection() to anon, authenticated;
grant execute on function public.eu_perspectives_public_projection() to anon, authenticated;
grant execute on function public.eu_counts_projection() to anon, authenticated;
grant execute on function public.shake_open_window_projection() to anon, authenticated;

create or replace view public.eu_profiles_public with (security_invoker = true) as
select * from public.eu_profiles_public_projection();
create or replace view public.eu_perspectives_public with (security_invoker = true) as
select * from public.eu_perspectives_public_projection();
create or replace view public.eu_counts with (security_invoker = true) as
select * from public.eu_counts_projection();
create or replace view public.shake_open_window with (security_invoker = true) as
select * from public.shake_open_window_projection();

revoke all on public.eu_profiles_public, public.eu_perspectives_public,
              public.eu_counts, public.shake_open_window from anon, authenticated;
grant select on public.eu_profiles_public, public.eu_perspectives_public,
                public.eu_counts, public.shake_open_window to anon, authenticated;

comment on function public.eu_profiles_public_projection() is
  'Explicit public projection boundary for eu_profiles_public; fixed output and fixed search_path.';
comment on function public.eu_perspectives_public_projection() is
  'Explicit public projection boundary for approved/consented perspectives; preserves anonymity masking.';
comment on function public.eu_counts_projection() is
  'Aggregate-only public projection boundary used by eu_counts.';
comment on function public.shake_open_window_projection() is
  'Aggregate-only public projection boundary used by shake_open_window; exposes order count, never order rows.';
