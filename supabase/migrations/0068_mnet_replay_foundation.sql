-- Reconstruct the canonical Mnet Phase 1 relational spine for clean migration replay.
-- These relations/functions already exist in production from the original Mnet rollout;
-- this idempotent migration makes source-controlled resets reproduce that state.

create table if not exists public.network_profiles (
  m_uid uuid primary key references public.m_people(id) on delete cascade,
  display_name text not null default '',
  bio text not null default '',
  avatar_url text not null default '',
  banner_url text not null default '',
  website_url text not null default '',
  visibility text not null default 'public' check (visibility in ('public','network','private')),
  discoverable boolean not null default true,
  activity_sharing boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  headline text not null default '',
  location_text text not null default '',
  pronouns text not null default '',
  links jsonb not null default '[]'::jsonb,
  categories text[] not null default '{}'::text[],
  skills text[] not null default '{}'::text[],
  services text[] not null default '{}'::text[],
  featured jsonb not null default '[]'::jsonb,
  allow_messages_from text not null default 'network',
  allow_mentions_from text not null default 'network',
  allow_tagging_from text not null default 'network',
  verification_state text not null default 'unverified',
  profile_version integer not null default 1
);

create table if not exists public.network_posts (
  id uuid primary key default gen_random_uuid(),
  author_m_uid uuid not null references public.m_people(id) on delete cascade,
  body text not null default '',
  post_type text not null default 'post' check (post_type in ('post','update','share','announcement')),
  visibility text not null default 'public' check (visibility in ('public','network','private')),
  media jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  reply_to_id uuid references public.network_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  source_app_id uuid references public.platform_apps(id) on delete set null,
  source_org_id uuid references public.orgs(id) on delete set null
);

create table if not exists public.network_follows (
  follower_m_uid uuid not null references public.m_people(id) on delete cascade,
  followed_m_uid uuid not null references public.m_people(id) on delete cascade,
  status text not null default 'following' check (status in ('following','muted','blocked')),
  created_at timestamptz not null default now(),
  primary key (follower_m_uid, followed_m_uid),
  check (follower_m_uid <> followed_m_uid)
);

create table if not exists public.network_reactions (
  post_id uuid not null references public.network_posts(id) on delete cascade,
  actor_m_uid uuid not null references public.m_people(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, actor_m_uid, reaction)
);

create table if not exists public.network_activity (
  id uuid primary key default gen_random_uuid(),
  actor_m_uid uuid not null references public.m_people(id) on delete cascade,
  source_app_id uuid references public.platform_apps(id) on delete set null,
  source_org_id uuid references public.orgs(id) on delete set null,
  verb text not null,
  object_type text not null,
  object_id text not null,
  summary text not null default '',
  visibility text not null default 'network' check (visibility in ('public','network','private','org')),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  event_id uuid,
  schema_version integer not null default 1,
  idempotency_key text,
  ingested_at timestamptz not null default now()
);

create table if not exists public.network_feed_items (
  id uuid primary key default gen_random_uuid(),
  actor_m_uid uuid not null references public.m_people(id) on delete cascade,
  source_app_id uuid references public.platform_apps(id) on delete set null,
  source_org_id uuid references public.orgs(id) on delete set null,
  item_type text not null check (item_type in ('post','activity')),
  post_id uuid unique references public.network_posts(id) on delete cascade,
  activity_id uuid unique references public.network_activity(id) on delete cascade,
  visibility text not null default 'network',
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (item_type='post' and post_id is not null and activity_id is null)
    or (item_type='activity' and activity_id is not null and post_id is null)
  )
);

create table if not exists public.network_outbox (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.mnet_surface_config (
  app_id uuid primary key references public.platform_apps(id) on delete cascade,
  network_enabled boolean not null default true,
  entry_mode text not null default 'profile_then_feed' check (entry_mode in ('profile_then_feed','feed','disabled')),
  default_feed_scope text not null default 'app' check (default_feed_scope in ('app','family','global')),
  profile_required_fields jsonb not null default '["mccluster_id","display_name"]'::jsonb,
  feed_label text not null default 'Network',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mnet_onboarding_state (
  m_uid uuid not null references public.m_people(id) on delete cascade,
  app_id uuid not null references public.platform_apps(id) on delete cascade,
  status text not null default 'profile_required' check (status in ('profile_required','feed_ready','disabled')),
  profile_completed_at timestamptz,
  feed_entered_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  context jsonb not null default '{}'::jsonb,
  primary key (m_uid, app_id)
);

alter table public.network_profiles enable row level security;
alter table public.network_posts enable row level security;
alter table public.network_follows enable row level security;
alter table public.network_reactions enable row level security;
alter table public.network_activity enable row level security;
alter table public.network_feed_items enable row level security;
alter table public.network_outbox enable row level security;
alter table public.mnet_surface_config enable row level security;
alter table public.mnet_onboarding_state enable row level security;

grant all on table public.network_profiles, public.network_posts, public.network_follows,
  public.network_reactions, public.network_activity, public.network_feed_items,
  public.network_outbox, public.mnet_surface_config, public.mnet_onboarding_state to service_role;

-- Production trigger that ensures every authenticated M identity can acquire a
-- corresponding network profile without granting client-side write authority.
create or replace function public.ensure_network_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_m_uid uuid;
  v_name text;
begin
  select l.m_uid into v_m_uid
  from public.m_auth_user_links l
  where l.auth_user_id = new.id
  order by l.is_primary desc, l.linked_at asc
  limit 1;
  if v_m_uid is null then return new; end if;
  v_name := coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', '');
  insert into public.network_profiles(m_uid,display_name,avatar_url)
  values(v_m_uid,v_name,coalesce(new.raw_user_meta_data->>'avatar_url',new.raw_user_meta_data->>'picture',''))
  on conflict (m_uid) do update set
    display_name=case when public.network_profiles.display_name='' then excluded.display_name else public.network_profiles.display_name end,
    avatar_url=case when public.network_profiles.avatar_url='' then excluded.avatar_url else public.network_profiles.avatar_url end,
    updated_at=now();
  return new;
end;
$$;

revoke all on function public.ensure_network_profile_for_auth_user() from public, anon, authenticated;
grant execute on function public.ensure_network_profile_for_auth_user() to service_role;

drop trigger if exists zz_network_profile_after_auth on auth.users;
create trigger zz_network_profile_after_auth
after insert or update on auth.users
for each row execute function public.ensure_network_profile_for_auth_user();

create or replace function public.mnet_surface_bootstrap(p_app_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_m_uid uuid;
  v_app public.platform_apps%rowtype;
  v_cfg public.mnet_surface_config%rowtype;
  v_profile public.network_profiles%rowtype;
  v_platform public.platform_profiles%rowtype;
  v_state public.mnet_onboarding_state%rowtype;
  v_complete boolean := false;
  v_next text;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  select * into v_app from public.platform_apps where app_key=p_app_key and enabled=true limit 1;
  if not found then raise exception 'unknown_app'; end if;
  select * into v_cfg from public.mnet_surface_config where app_id=v_app.id;
  if not found or not v_cfg.network_enabled or v_cfg.entry_mode='disabled' then raise exception 'network_disabled'; end if;
  select public.current_m_uid() into v_m_uid;
  if v_m_uid is null then raise exception 'identity_missing'; end if;
  select * into v_profile from public.network_profiles where m_uid=v_m_uid;
  select * into v_platform from public.platform_profiles where user_id=v_uid;
  v_complete := nullif(btrim(coalesce(v_platform.mccluster_id,'')),'') is not null
    and nullif(btrim(coalesce(v_profile.display_name,'')),'') is not null;
  insert into public.mnet_onboarding_state(m_uid,app_id,status,profile_completed_at,last_seen_at)
  values(v_m_uid,v_app.id,case when v_complete then 'feed_ready' else 'profile_required' end,
    case when v_complete then now() end,now())
  on conflict (m_uid,app_id) do update set
    status=case when excluded.status='feed_ready' then 'feed_ready' else public.mnet_onboarding_state.status end,
    profile_completed_at=coalesce(public.mnet_onboarding_state.profile_completed_at,excluded.profile_completed_at),
    last_seen_at=now()
  returning * into v_state;
  v_next := case when v_cfg.entry_mode='feed' or v_state.status='feed_ready' then 'feed' else 'profile' end;
  return jsonb_build_object(
    'app',jsonb_build_object('id',v_app.id,'app_key',v_app.app_key,'name',v_app.name,'product_family',v_app.product_family,'public_url',v_app.public_url),
    'surface',to_jsonb(v_cfg),
    'identity',jsonb_build_object('m_uid',v_m_uid,'mccluster_id',v_platform.mccluster_id),
    'profile',to_jsonb(v_profile),
    'onboarding',to_jsonb(v_state),
    'next_step',v_next,
    'feed',jsonb_build_object('scope',v_cfg.default_feed_scope,'source_app_id',case when v_cfg.default_feed_scope='app' then v_app.id else null end,'product_family',case when v_cfg.default_feed_scope='family' then v_app.product_family else null end)
  );
end;
$$;

create or replace function public.mnet_mark_feed_entered(p_app_key text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_m_uid uuid; v_app_id uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select public.current_m_uid() into v_m_uid;
  select id into v_app_id from public.platform_apps where app_key=p_app_key and enabled=true limit 1;
  if v_m_uid is null or v_app_id is null then raise exception 'invalid_context'; end if;
  update public.mnet_onboarding_state
  set feed_entered_at=coalesce(feed_entered_at,now()),last_seen_at=now()
  where m_uid=v_m_uid and app_id=v_app_id and status='feed_ready';
end;
$$;

create or replace function public.mnet_complete_surface_profile(
  p_app_key text,
  p_display_name text,
  p_headline text default '',
  p_bio text default '',
  p_avatar_url text default '',
  p_banner_url text default '',
  p_website_url text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_uid uuid := auth.uid(); v_m_uid uuid; v_app_id uuid; v_mccluster_id text;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if nullif(btrim(coalesce(p_display_name,'')),'') is null then raise exception 'display_name_required'; end if;
  select id into v_app_id from public.platform_apps where app_key=p_app_key and enabled=true limit 1;
  if v_app_id is null then raise exception 'unknown_app'; end if;
  select public.current_m_uid() into v_m_uid;
  if v_m_uid is null then raise exception 'identity_missing'; end if;
  select mccluster_id into v_mccluster_id from public.platform_profiles where user_id=v_uid;
  if nullif(btrim(coalesce(v_mccluster_id,'')),'') is null then raise exception 'mccluster_id_required'; end if;
  insert into public.network_profiles(m_uid,display_name)
  values(v_m_uid,btrim(p_display_name))
  on conflict (m_uid) do nothing;
  update public.network_profiles
  set display_name=btrim(p_display_name),headline=coalesce(p_headline,''),bio=coalesce(p_bio,''),
      avatar_url=coalesce(p_avatar_url,''),banner_url=coalesce(p_banner_url,''),website_url=coalesce(p_website_url,''),
      updated_at=now(),profile_version=profile_version+1
  where m_uid=v_m_uid;
  insert into public.mnet_onboarding_state(m_uid,app_id,status,profile_completed_at,last_seen_at)
  values(v_m_uid,v_app_id,'feed_ready',now(),now())
  on conflict (m_uid,app_id) do update set
    status='feed_ready',profile_completed_at=coalesce(public.mnet_onboarding_state.profile_completed_at,now()),last_seen_at=now();
  insert into public.network_outbox(topic,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('network.profile','person',v_m_uid::text,'profile.completed',jsonb_build_object('m_uid',v_m_uid,'app_id',v_app_id),concat('profile.completed:',v_m_uid,':',v_app_id))
  on conflict (idempotency_key) do nothing;
  return public.mnet_surface_bootstrap(p_app_key);
end;
$$;

create or replace function public.mnet_surface_feed(
  p_app_key text,
  p_limit integer default 50,
  p_before timestamptz default null
)
returns table(
  id uuid,item_type text,actor_m_uid uuid,source_app_id uuid,source_org_id uuid,
  visibility text,occurred_at timestamptz,payload jsonb,post_id uuid,activity_id uuid
)
language sql
security definer
set search_path = public, auth
as $$
  with ctx as (
    select pa.id app_id, pa.product_family, c.default_feed_scope
    from public.platform_apps pa
    join public.mnet_surface_config c on c.app_id=pa.id
    where pa.app_key=p_app_key and pa.enabled=true and c.network_enabled=true limit 1
  ), me as (select public.current_m_uid() m_uid)
  select f.id,f.item_type,f.actor_m_uid,f.source_app_id,f.source_org_id,f.visibility,f.occurred_at,f.payload,f.post_id,f.activity_id
  from public.network_feed_items f
  cross join ctx
  cross join me
  left join public.platform_apps source_app on source_app.id=f.source_app_id
  where (p_before is null or f.occurred_at < p_before)
    and (
      f.visibility='public'
      or f.actor_m_uid=me.m_uid
      or (f.visibility in ('network','followers') and exists(
        select 1 from public.network_follows nf
        where nf.follower_m_uid=me.m_uid and nf.followed_m_uid=f.actor_m_uid and nf.status='following'
      ))
      or (f.visibility='org' and f.source_org_id is not null and exists(
        select 1 from public.org_members om where om.org_id=f.source_org_id and om.profile_id=auth.uid()
      ))
    )
    and (
      ctx.default_feed_scope='global'
      or (ctx.default_feed_scope='app' and f.source_app_id=ctx.app_id)
      or (ctx.default_feed_scope='family' and source_app.product_family=ctx.product_family)
      or f.source_app_id is null
    )
  order by f.occurred_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;

revoke all on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text) from public, anon;
revoke all on function public.mnet_mark_feed_entered(text) from public, anon;
revoke all on function public.mnet_surface_bootstrap(text) from public, anon;
revoke all on function public.mnet_surface_feed(text,integer,timestamptz) from public, anon;
grant execute on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text) to authenticated, service_role;
grant execute on function public.mnet_mark_feed_entered(text) to authenticated, service_role;
grant execute on function public.mnet_surface_bootstrap(text) to authenticated, service_role;
grant execute on function public.mnet_surface_feed(text,integer,timestamptz) to authenticated, service_role;
