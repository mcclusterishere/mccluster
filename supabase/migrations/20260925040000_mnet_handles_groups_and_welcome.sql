-- MNET: THE HANDLE EVERYONE ALREADY HAS, GROUPS, AND A WELCOME.
--
-- THE USERNAME ALREADY EXISTS AND IS CALLED mccluster_id. The member picks
-- it in the "McCluster ID" field at signup, platform_profiles_mccluster_id
-- _unique_ci makes it unique case insensitively, mnet_complete_surface
-- _profile refuses to finish without one, and js/mnet.js renders it as
-- @handle. Adding a second username column would have duplicated it, and
-- two names for one person is how a mention stops resolving.
--
-- So this adds no username. It closes the three gaps around the one that
-- is already there:
--
--   1. an account can still end up without a handle, because the
--      requirement lives in the save path rather than in the data;
--   2. the form finds out a handle is taken only by submitting and
--      failing, because nothing could answer "is this free" beforehand;
--   3. the welcome tells a new member to join a group, and there were no
--      groups.

-- ============================================================
-- 1. THE RULES, IN ONE PLACE
-- ============================================================

create or replace function public.mccluster_id_problem(p_id text)
returns text
language plpgsql
immutable
as $$
declare v text := btrim(coalesce(p_id, ''));
begin
  if v = '' then return 'Pick a username.'; end if;
  if length(v) < 3  then return 'Usernames are at least 3 characters.'; end if;
  if length(v) > 32 then return 'Usernames are at most 32 characters.'; end if;
  -- The shape the signup form has always advertised.
  if v !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then
    return 'Letters, numbers, dot, underscore and hyphen only.';
  end if;
  if v ~ '[._-]$'   then return 'It cannot end in punctuation.'; end if;
  if v ~ '[._-]{2}' then return 'No two punctuation marks in a row.'; end if;
  -- Names that would make a member look like part of the site itself.
  if lower(v) in (
    'admin','administrator','root','support','help','staff','team','mod',
    'moderator','mccluster','mnet','official','system','security','billing',
    'api','www','me','you','everyone','here','null','undefined','anonymous'
  ) then
    return 'That one is reserved.';
  end if;
  return null;
end;
$$;

comment on function public.mccluster_id_problem(text) is
  'Why a handle cannot be used, or null when it is fine. One rulebook, so the form, the claim and the backfill cannot drift apart.';

-- ============================================================
-- 2. NOBODY WITHOUT A HANDLE
--
-- Derived from what the member already told us: the display name first,
-- because that is the name they chose, and the local part of their email
-- only when the display name yields nothing usable. Collisions take a
-- numeric suffix rather than failing, so this cannot leave anybody out.
-- ============================================================

do $$
declare
  r record; v_base text; v_try text; v_n int;
begin
  for r in
    select pp.user_id,
           coalesce(np.display_name, '') as display_name,
           coalesce(u.email, '')          as email
      from public.platform_profiles pp
      left join auth.users u on u.id = pp.user_id
      left join public.m_auth_user_links l on l.auth_user_id = pp.user_id and l.is_primary = true
      left join public.network_profiles np on np.m_uid = l.m_uid
     where nullif(btrim(coalesce(pp.mccluster_id, '')), '') is null
  loop
    v_base := regexp_replace(r.display_name, '[^A-Za-z0-9]', '', 'g');
    if length(coalesce(v_base, '')) < 3 then
      v_base := regexp_replace(split_part(r.email, '@', 1), '[^A-Za-z0-9]', '', 'g');
    end if;
    if length(coalesce(v_base, '')) < 3 then
      v_base := 'member' || coalesce(nullif(v_base, ''), '');
    end if;
    v_base := left(v_base, 24);

    v_try := v_base; v_n := 1;
    while public.mccluster_id_problem(v_try) is not null
       or exists (select 1 from public.platform_profiles where lower(mccluster_id) = lower(v_try))
    loop
      v_n := v_n + 1;
      v_try := left(v_base, 24) || v_n::text;
      if v_n > 9999 then
        v_try := left('member' || replace(r.user_id::text, '-', ''), 32);
        exit;
      end if;
    end loop;

    update public.platform_profiles set mccluster_id = v_try where user_id = r.user_id;
  end loop;
end;
$$;

-- ============================================================
-- 3. THE FORM CAN ASK BEFORE IT SUBMITS
--
-- Returns the reason rather than a bare boolean, so the field can say
-- WHICH problem it is instead of a blanket "unavailable". Advisory only:
-- the unique index decides, because somebody may claim the name between
-- the check and the save.
-- ============================================================

create or replace function public.mccluster_id_check(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v text := btrim(coalesce(p_id, ''));
  v_problem text := public.mccluster_id_problem(v);
  v_uid uuid := auth.uid();
begin
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'reason', v_problem);
  end if;
  if exists (
    select 1 from public.platform_profiles
     where lower(mccluster_id) = lower(v)
       and (v_uid is null or user_id <> v_uid)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'That username is taken.');
  end if;
  return jsonb_build_object('ok', true, 'reason', null);
end;
$$;

revoke all on function public.mccluster_id_check(text) from public, anon;
grant execute on function public.mccluster_id_check(text) to authenticated, service_role;

-- ============================================================
-- 4. GROUPS
--
-- A place inside the network rather than another network. A group holds
-- posts from the same table the feed reads, so nothing about a post
-- changes when it belongs to one.
-- ============================================================

create table if not exists public.network_groups (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,
  name         text not null,
  purpose      text not null default '',
  visibility   text not null default 'open'
               check (visibility in ('open', 'request', 'invite')),
  created_by   uuid references public.m_people(id) on delete set null,
  member_count int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists network_groups_slug_key
  on public.network_groups (lower(slug));

comment on table public.network_groups is
  'Rooms inside Mnet. open: anyone joins. request: a join is approved. invite: by invitation only.';

create table if not exists public.network_group_members (
  group_id  uuid not null references public.network_groups(id) on delete cascade,
  m_uid     uuid not null references public.m_people(id) on delete cascade,
  role      text not null default 'member' check (role in ('member', 'host')),
  state     text not null default 'joined' check (state in ('joined', 'requested', 'banned')),
  joined_at timestamptz not null default now(),
  primary key (group_id, m_uid)
);

create index if not exists network_group_members_m_uid_idx
  on public.network_group_members (m_uid) where state = 'joined';

-- A post can belong to a group. Null means the open feed, which is what
-- every post that already exists is.
alter table public.network_posts
  add column if not exists group_id uuid references public.network_groups(id) on delete set null;

create index if not exists network_posts_group_idx
  on public.network_posts (group_id, created_at desc) where group_id is not null;

-- member_count is read on every listing and would otherwise be a count()
-- over the members table each time.
create or replace function public.network_group_recount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.network_groups g
     set member_count = (
           select count(*) from public.network_group_members m
            where m.group_id = g.id and m.state = 'joined'
         ),
         updated_at = now()
   where g.id = coalesce(new.group_id, old.group_id);
  return null;
end;
$$;

drop trigger if exists zz_network_group_recount on public.network_group_members;
create trigger zz_network_group_recount
  after insert or update or delete on public.network_group_members
  for each row execute function public.network_group_recount();

alter table public.network_groups enable row level security;
alter table public.network_group_members enable row level security;

drop policy if exists "groups are visible across the network" on public.network_groups;
create policy "groups are visible across the network" on public.network_groups
  for select to authenticated using (true);

drop policy if exists "a member reads memberships they can see" on public.network_group_members;
create policy "a member reads memberships they can see" on public.network_group_members
  for select to authenticated
  using (
    m_uid = public.current_m_uid()
    or exists (
      select 1 from public.network_group_members mine
       where mine.group_id = network_group_members.group_id
         and mine.m_uid = public.current_m_uid()
         and mine.state = 'joined'
    )
  );

-- Joining and leaving are the member's own acts, and only for themselves.
drop policy if exists "a member joins for themselves" on public.network_group_members;
create policy "a member joins for themselves" on public.network_group_members
  for insert to authenticated
  with check (m_uid = public.current_m_uid() and state = 'joined' and role = 'member');

drop policy if exists "a member leaves for themselves" on public.network_group_members;
create policy "a member leaves for themselves" on public.network_group_members
  for delete to authenticated
  using (m_uid = public.current_m_uid());

-- The rooms the network opens with. Seeded rather than left empty, because
-- the welcome tells people to join one and an empty list makes that
-- instruction a dead end.
insert into public.network_groups (slug, name, purpose, visibility)
values
  ('the-listening-room', 'The Listening Room',
   'New records, what you have had on repeat, and what you found that nobody else has.', 'open'),
  ('first-listens', 'First Listens',
   'Hear things before they go out and say what actually lands. Honest reactions are the point.', 'open'),
  ('behind-the-record', 'Behind the Record',
   'How the songs got made. Sessions, mixes, and the versions that did not survive.', 'open'),
  ('the-workshop', 'The Workshop',
   'Creators trading craft: writing, recording, artwork, and the business underneath it.', 'open'),
  ('the-front-desk', 'The Front Desk',
   'Clients and customers. Questions about a build, a shoot, a domain, or an order.', 'open')
on conflict (lower(slug)) do nothing;

-- ============================================================
-- 5. THE WELCOME
--
-- From the desk, by direct message, when a member finishes their profile,
-- which is the first moment there is a handle to greet them by.
-- ============================================================

-- An explicit stamp. The alternative was inferring "already welcomed" from
-- the existence of a conversation, which is a guess: the member may have
-- messaged the desk themselves, and network_messages has no kind column to
-- tell one message from another.
alter table public.network_profiles
  add column if not exists welcomed_at timestamptz;

create or replace function public.mnet_send_welcome(p_m_uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin uuid; v_conv uuid; v_handle text; v_body text;
begin
  select a into v_admin from public.mnet_admin_m_uids() as a limit 1;
  -- No desk account means nobody to send it from, and silence beats a
  -- greeting signed by nobody.
  if v_admin is null or v_admin = p_m_uid then return; end if;

  if exists (select 1 from public.network_profiles
              where m_uid = p_m_uid and welcomed_at is not null) then
    return;
  end if;

  select pp.mccluster_id into v_handle
    from public.m_auth_user_links l
    join public.platform_profiles pp on pp.user_id = l.auth_user_id
   where l.m_uid = p_m_uid and l.is_primary = true
   limit 1;
  if nullif(btrim(coalesce(v_handle, '')), '') is null then return; end if;

  insert into public.network_conversations(kind, created_by_m_uid)
  values ('direct', v_admin)
  returning id into v_conv;

  insert into public.network_conversation_members(conversation_id, m_uid, role)
  values (v_conv, v_admin, 'owner'), (v_conv, p_m_uid, 'member')
  on conflict do nothing;

  v_body :=
    'Hey @' || v_handle || ', welcome to Mnet.' || chr(10) || chr(10) ||
    'This is the room where the music and the people around it sit in one place. ' ||
    'The fastest way in is to join a group. That is where conversations actually happen, ' ||
    'and it is how you find the people who are into what you are into.' || chr(10) || chr(10) ||
    'Say something when you land. I read this inbox.' || chr(10) || chr(10) ||
    'Matthew';

  insert into public.network_messages(conversation_id, sender_m_uid, body)
  values (v_conv, v_admin, v_body);

  update public.network_conversations
     set last_message_at = now(), updated_at = now()
   where id = v_conv;

  update public.network_profiles set welcomed_at = now() where m_uid = p_m_uid;
end;
$$;

revoke all on function public.mnet_send_welcome(uuid) from public, anon, authenticated;

comment on function public.mnet_send_welcome(uuid) is
  'The greeting from the desk, sent once, at the first moment there is a handle to greet somebody by.';

-- Everybody already on the network has already arrived, so they are marked
-- as welcomed rather than receiving a greeting months late.
update public.network_profiles
   set welcomed_at = coalesce(welcomed_at, now())
 where welcomed_at is null;

-- ============================================================
-- 6. THE SAVE PATH SENDS IT
--
-- Same signature as before. The only change is that finishing a profile
-- now also sends the greeting, guarded so a second save never sends a
-- second welcome and so a failure here can never fail the save.
-- ============================================================

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
  values('network.profile','person',v_m_uid::text,'profile.completed',
         jsonb_build_object('m_uid',v_m_uid,'app_id',v_app_id),
         concat('profile.completed:',v_m_uid,':',v_app_id))
  on conflict (idempotency_key) do nothing;

  perform public.mnet_follow_admins(v_m_uid);

  begin
    perform public.mnet_send_welcome(v_m_uid);
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'mccluster_id', v_mccluster_id);
end;
$$;

revoke all on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text) to authenticated, service_role;
