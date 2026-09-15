-- Reconstruct production RPCs that later hardening migrations explicitly grant
-- but that were missing from source-controlled replay history.

-- The music analytics RPCs depend on this historical event exhaust table,
-- which exists in production but was also absent from the replay chain.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz default now(),
  name text not null,
  path text default '',
  props jsonb default '{}'::jsonb,
  uid uuid
);

alter table public.events enable row level security;
drop policy if exists "anyone writes the exhaust" on public.events;
create policy "anyone writes the exhaust" on public.events
  for insert to anon, authenticated with check (true);
drop policy if exists "only the desk reads it" on public.events;
create policy "only the desk reads it" on public.events
  for select to public using (public.eu_is_admin());

create or replace function public.music_pulse()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'streams_total', (select count(*) from public.events where name = 'album_play'),
    'streams_7d',    (select count(*) from public.events where name = 'album_play'
                        and at > now() - interval '7 days'),
    'streams_prev7d',(select count(*) from public.events where name = 'album_play'
                        and at <= now() - interval '7 days'
                        and at >  now() - interval '14 days'),
    'saves_total',   (select count(*) from public.events where name = 'rotation_add'),
    'top_track',     (select props->>'track' from public.events
                       where name = 'album_play' and props ? 'track'
                       group by 1 order by count(*) desc limit 1)
  );
$$;

create or replace function public.play_counts()
returns table(track text, plays bigint)
language sql
stable
security definer
set search_path = public
as $$
  select props->>'track' as track, count(*) as plays
  from public.events
  where name = 'album_play' and props ? 'track'
  group by props->>'track'
$$;

create or replace function public.eu_match_fellowships(
  p_profile uuid default null,
  p_limit integer default 12,
  p_extra text[] default '{}'::text[]
)
returns table(
  fellowship_id uuid,
  slug text,
  title text,
  org text,
  summary text,
  url text,
  deadline date,
  score numeric,
  reasons text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select case
             when p_profile is not null
                  and (p_profile = auth.uid() or coalesce(auth.role(), '') = 'service_role')
               then p_profile
             else auth.uid()
           end as id
  ),
  me as (
    select
      coalesce(p.interests, '{}'::text[]) as interests,
      coalesce(nullif(p.region, ''), '')  as region
    from public.eu_profiles p, target
    where p.id = target.id
  ),
  spoken as (
    select coalesce(array_agg(distinct v.topic_slug), '{}'::text[]) as topics
    from public.eu_perspectives v, target
    where v.profile_id = target.id
  ),
  spoken_tags as (
    select coalesce(array_agg(distinct tg), '{}'::text[]) as tags
    from public.eu_topics t, spoken
    cross join lateral unnest(t.tags) tg
    where t.slug = any (spoken.topics)
  ),
  want as (
    select
      coalesce((select interests from me), '{}'::text[])
        || coalesce((select tags from spoken_tags), '{}'::text[])
        || coalesce(p_extra, '{}'::text[])                 as tags,
      coalesce((select topics from spoken), '{}'::text[]) as topics,
      coalesce((select region from me), '')                as region
  ),
  scored as (
    select
      f.*,
      array(select unnest(f.focus_tags) intersect select unnest(w.tags)) as hit_tags,
      array(select unnest(f.topic_slugs) intersect select unnest(w.topics)) as hit_topics,
      (w.region <> '' and f.region = w.region) as hit_region,
      (f.deadline is null or f.deadline >= current_date) as open_now
    from public.eu_fellowships f, want w
    where f.status = 'published'
  )
  select
    s.id, s.slug, s.title, s.org, s.summary, s.url, s.deadline,
    round(
      (cardinality(s.hit_tags) * 3.0)
      + (cardinality(s.hit_topics) * 2.5)
      + (case when s.hit_region then 1.5 else 0 end)
      + (case when s.open_now then 1.0 else -2.0 end)
      + (case when s.remote then 0.4 else 0 end)
      + (case when s.verification = 'verified' then 0.6
              when s.verification = 'link-checked' then 0.3 else 0 end)
    , 2) as score,
    (
      select array_remove(array[
        case when cardinality(s.hit_tags) > 0
             then 'Matches what you care about: ' || array_to_string(s.hit_tags, ', ') end,
        case when cardinality(s.hit_topics) > 0
             then 'Works on a topic you spoke on' end,
        case when s.hit_region then 'Runs where you are' end,
        case when s.deadline is not null and s.deadline >= current_date
             then 'Deadline ' || to_char(s.deadline, 'Mon DD, YYYY') end,
        case when s.deadline is null and s.deadline_note <> '' then s.deadline_note end
      ], null)
    ) as reasons
  from scored s
  where cardinality(s.hit_tags) > 0 or cardinality(s.hit_topics) > 0 or s.hit_region
  order by score desc, s.deadline nulls last, s.title
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

create or replace function public.m_my_identities()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  with me as (
    select l.m_uid
    from public.m_auth_user_links l
    where l.auth_user_id = auth.uid()
  ), linked as (
    select l.auth_user_id
    from public.m_auth_user_links l, me
    where l.m_uid = me.m_uid
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'provider', i.provider,
        'provider_id', i.provider_id,
        'email', i.email,
        'auth_user_id', i.user_id,
        'created_at', i.created_at,
        'last_sign_in_at', i.last_sign_in_at
      ) order by i.created_at
    ),
    '[]'::jsonb
  )
  from auth.identities i
  where i.user_id in (select auth_user_id from linked);
$$;

create or replace function public.m_touch_app(
  p_app_key text,
  p_device_key text,
  p_org_slug text default 'mccluster',
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_m_uid uuid;
  v_app public.platform_apps%rowtype;
  v_org public.orgs%rowtype;
  v_device_id uuid;
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select l.m_uid into v_m_uid from public.m_auth_user_links l where l.auth_user_id = v_user_id;
  if v_m_uid is null then
    raise exception 'M identity missing' using errcode = '23503';
  end if;
  if p_app_key is null or char_length(btrim(p_app_key)) = 0 then
    raise exception 'app key required' using errcode = '22023';
  end if;
  if p_device_key is null or char_length(p_device_key) < 20 or char_length(p_device_key) > 200 then
    raise exception 'invalid device key' using errcode = '22023';
  end if;
  if jsonb_typeof(v_meta) is distinct from 'object' then
    raise exception 'metadata must be an object' using errcode = '22023';
  end if;
  if pg_column_size(v_meta) > 8192 then
    raise exception 'metadata too large' using errcode = '22023';
  end if;

  select * into v_app from public.platform_apps where app_key = btrim(p_app_key) and enabled = true;
  if not found then raise exception 'unknown or disabled app' using errcode = '22023'; end if;

  select * into v_org from public.orgs
  where slug = coalesce(nullif(btrim(p_org_slug), ''), 'mccluster') and enabled = true;
  if not found then raise exception 'unknown or disabled organization' using errcode = '22023'; end if;

  insert into public.m_devices (user_id, m_uid, device_key, last_app_id, last_org_id, metadata)
  values (v_user_id, v_m_uid, p_device_key, v_app.id, v_org.id, v_meta)
  on conflict (m_uid, device_key) do update
    set user_id = excluded.user_id,
        last_seen_at = now(),
        last_app_id = excluded.last_app_id,
        last_org_id = excluded.last_org_id,
        metadata = public.m_devices.metadata || excluded.metadata
  returning id into v_device_id;

  insert into public.platform_user_apps (user_id, app_id, org_id, last_seen_at)
  values (v_user_id, v_app.id, v_org.id, now())
  on conflict (user_id, app_id, org_id) do update set last_seen_at = now();

  insert into public.m_person_apps (m_uid, app_id, org_id, last_seen_at)
  values (v_m_uid, v_app.id, v_org.id, now())
  on conflict (m_uid, app_id, org_id) do update set last_seen_at = now();

  return jsonb_build_object(
    'm_uid', v_m_uid,
    'auth_user_id', v_user_id,
    'device_id', v_device_id,
    'app_key', v_app.app_key,
    'org_slug', v_org.slug
  );
end;
$$;
