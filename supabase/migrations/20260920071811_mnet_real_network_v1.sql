-- Mnet Real Network v1
-- Adds the missing production primitives: media, moderation reports, direct messaging,
-- realtime delivery, discovery, and block/mute-aware feed semantics.

-- Historical production has the canonical public McCluster handle on
-- platform_profiles, but clean source-controlled resets can predate that column.
-- Reconcile the identity column before Mnet discovery compiles against it.
alter table public.platform_profiles
  add column if not exists mccluster_id text;

create unique index if not exists platform_profiles_mccluster_id_unique_ci
  on public.platform_profiles (lower(mccluster_id))
  where mccluster_id is not null and btrim(mccluster_id) <> '';

create table if not exists public.network_media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_m_uid uuid not null references public.m_people(id) on delete cascade default public.current_m_uid(),
  bucket_id text not null default 'mnet-media',
  object_path text not null unique,
  media_type text not null check (media_type in ('image','video','audio','file')),
  mime_type text not null,
  byte_size bigint,
  width integer,
  height integer,
  duration_ms integer,
  alt_text text not null default '',
  status text not null default 'ready' check (status in ('staged','ready','attached','blocked','deleted')),
  post_id uuid references public.network_posts(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists network_media_owner_idx on public.network_media_assets(owner_m_uid,created_at desc);
create index if not exists network_media_post_idx on public.network_media_assets(post_id) where post_id is not null;

create table if not exists public.network_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_m_uid uuid not null references public.m_people(id) on delete cascade default public.current_m_uid(),
  target_type text not null check (target_type in ('post','profile','message','media')),
  target_id text not null,
  reason text not null check (reason in ('spam','harassment','hate','violence','sexual','impersonation','copyright','privacy','self_harm','other')),
  details text not null default '',
  status text not null default 'open' check (status in ('open','reviewing','actioned','dismissed')),
  resolution text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists network_reports_status_idx on public.network_reports(status,created_at);
create index if not exists network_reports_reporter_idx on public.network_reports(reporter_m_uid,created_at desc);

create table if not exists public.network_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct','group')),
  created_by_m_uid uuid not null references public.m_people(id) on delete cascade,
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists public.network_conversation_members (
  conversation_id uuid not null references public.network_conversations(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  member_state text not null default 'active' check (member_state in ('active','requested','left')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  last_read_at timestamptz,
  primary key (conversation_id,m_uid)
);
create index if not exists network_conversation_members_uid_idx on public.network_conversation_members(m_uid,member_state,conversation_id);

create table if not exists public.network_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.network_conversations(id) on delete cascade,
  sender_m_uid uuid not null references public.m_people(id) on delete cascade,
  body text not null default '',
  media jsonb not null default '[]'::jsonb,
  reply_to_id uuid references public.network_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (char_length(body) <= 20000)
);
create index if not exists network_messages_conversation_idx on public.network_messages(conversation_id,created_at desc);

alter table public.network_media_assets enable row level security;
alter table public.network_reports enable row level security;
alter table public.network_conversations enable row level security;
alter table public.network_conversation_members enable row level security;
alter table public.network_messages enable row level security;

drop policy if exists network_media_owner_read on public.network_media_assets;
create policy network_media_owner_read on public.network_media_assets for select to authenticated
using (owner_m_uid=public.current_m_uid());
drop policy if exists network_media_owner_insert on public.network_media_assets;
create policy network_media_owner_insert on public.network_media_assets for insert to authenticated
with check (owner_m_uid=public.current_m_uid());
drop policy if exists network_media_owner_update on public.network_media_assets;
create policy network_media_owner_update on public.network_media_assets for update to authenticated
using (owner_m_uid=public.current_m_uid()) with check (owner_m_uid=public.current_m_uid());
drop policy if exists network_media_owner_delete on public.network_media_assets;
create policy network_media_owner_delete on public.network_media_assets for delete to authenticated
using (owner_m_uid=public.current_m_uid());

drop policy if exists network_reports_self_read on public.network_reports;
create policy network_reports_self_read on public.network_reports for select to authenticated
using (reporter_m_uid=public.current_m_uid());
drop policy if exists network_reports_self_insert on public.network_reports;
create policy network_reports_self_insert on public.network_reports for insert to authenticated
with check (reporter_m_uid=public.current_m_uid());

drop policy if exists network_conversations_member_read on public.network_conversations;
create policy network_conversations_member_read on public.network_conversations for select to authenticated
using (exists (
  select 1 from public.network_conversation_members m
  where m.conversation_id=network_conversations.id
    and m.m_uid=public.current_m_uid()
    and m.member_state<>'left'
));

drop policy if exists network_conversation_members_member_read on public.network_conversation_members;
create policy network_conversation_members_member_read on public.network_conversation_members for select to authenticated
using (exists (
  select 1 from public.network_conversation_members me
  where me.conversation_id=network_conversation_members.conversation_id
    and me.m_uid=public.current_m_uid()
    and me.member_state<>'left'
));

drop policy if exists network_messages_member_read on public.network_messages;
create policy network_messages_member_read on public.network_messages for select to authenticated
using (deleted_at is null and exists (
  select 1 from public.network_conversation_members m
  where m.conversation_id=network_messages.conversation_id
    and m.m_uid=public.current_m_uid()
    and m.member_state<>'left'
));

revoke all on public.network_media_assets,public.network_reports,public.network_conversations,public.network_conversation_members,public.network_messages from public,anon;
grant select,insert,update,delete on public.network_media_assets to authenticated;
grant select,insert on public.network_reports to authenticated;
grant select on public.network_conversations,public.network_conversation_members,public.network_messages to authenticated;
grant all on public.network_media_assets,public.network_reports,public.network_conversations,public.network_conversation_members,public.network_messages to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('mnet-media','mnet-media',false,524288000,array[
  'image/jpeg','image/png','image/webp','image/avif','image/gif',
  'video/mp4','video/webm','video/quicktime',
  'audio/mpeg','audio/mp4','audio/wav','audio/x-m4a',
  'application/pdf'
])
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "mnet media owner upload" on storage.objects;
create policy "mnet media owner upload" on storage.objects for insert to authenticated
with check (bucket_id='mnet-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "mnet media owner update" on storage.objects;
create policy "mnet media owner update" on storage.objects for update to authenticated
using (bucket_id='mnet-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='mnet-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "mnet media owner delete" on storage.objects;
create policy "mnet media owner delete" on storage.objects for delete to authenticated
using (bucket_id='mnet-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "mnet media owner read" on storage.objects;
create policy "mnet media owner read" on storage.objects for select to authenticated
using (bucket_id='mnet-media' and (storage.foldername(name))[1]=auth.uid()::text);

create table if not exists public.network_blocks (
  blocker_m_uid uuid not null references public.m_people(id) on delete cascade,
  blocked_m_uid uuid not null references public.m_people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_m_uid, blocked_m_uid),
  check (blocker_m_uid <> blocked_m_uid)
);

create table if not exists public.network_mutes (
  muter_m_uid uuid not null references public.m_people(id) on delete cascade,
  muted_m_uid uuid not null references public.m_people(id) on delete cascade,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (muter_m_uid, muted_m_uid),
  check (muter_m_uid <> muted_m_uid)
);
create index if not exists network_mutes_expiry_idx
  on public.network_mutes(muter_m_uid, expires_at)
  where expires_at is not null;

create table if not exists public.network_bookmarks (
  m_uid uuid not null references public.m_people(id) on delete cascade,
  post_id uuid not null references public.network_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (m_uid, post_id)
);
create index if not exists network_bookmarks_created_idx
  on public.network_bookmarks(m_uid, created_at desc);

create table if not exists public.network_connections (
  id uuid primary key default gen_random_uuid(),
  requester_m_uid uuid not null references public.m_people(id) on delete cascade,
  addressee_m_uid uuid not null references public.m_people(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_m_uid <> addressee_m_uid)
);
create unique index if not exists network_connections_pair_idx
  on public.network_connections (
    least(requester_m_uid, addressee_m_uid),
    greatest(requester_m_uid, addressee_m_uid)
  );

alter table public.network_blocks enable row level security;
alter table public.network_mutes enable row level security;
alter table public.network_bookmarks enable row level security;
alter table public.network_connections enable row level security;

drop policy if exists network_blocks_owner_read on public.network_blocks;
create policy network_blocks_owner_read on public.network_blocks for select to authenticated
using (blocker_m_uid=public.current_m_uid());
drop policy if exists network_blocks_owner_insert on public.network_blocks;
create policy network_blocks_owner_insert on public.network_blocks for insert to authenticated
with check (blocker_m_uid=public.current_m_uid());
drop policy if exists network_blocks_owner_delete on public.network_blocks;
create policy network_blocks_owner_delete on public.network_blocks for delete to authenticated
using (blocker_m_uid=public.current_m_uid());

drop policy if exists network_mutes_owner_read on public.network_mutes;
create policy network_mutes_owner_read on public.network_mutes for select to authenticated
using (muter_m_uid=public.current_m_uid());
drop policy if exists network_mutes_owner_insert on public.network_mutes;
create policy network_mutes_owner_insert on public.network_mutes for insert to authenticated
with check (muter_m_uid=public.current_m_uid());
drop policy if exists network_mutes_owner_update on public.network_mutes;
create policy network_mutes_owner_update on public.network_mutes for update to authenticated
using (muter_m_uid=public.current_m_uid()) with check (muter_m_uid=public.current_m_uid());
drop policy if exists network_mutes_owner_delete on public.network_mutes;
create policy network_mutes_owner_delete on public.network_mutes for delete to authenticated
using (muter_m_uid=public.current_m_uid());

drop policy if exists network_bookmarks_owner_read on public.network_bookmarks;
create policy network_bookmarks_owner_read on public.network_bookmarks for select to authenticated
using (m_uid=public.current_m_uid());
drop policy if exists network_bookmarks_owner_insert on public.network_bookmarks;
create policy network_bookmarks_owner_insert on public.network_bookmarks for insert to authenticated
with check (m_uid=public.current_m_uid());
drop policy if exists network_bookmarks_owner_delete on public.network_bookmarks;
create policy network_bookmarks_owner_delete on public.network_bookmarks for delete to authenticated
using (m_uid=public.current_m_uid());

drop policy if exists network_connections_member_read on public.network_connections;
create policy network_connections_member_read on public.network_connections for select to authenticated
using (requester_m_uid=public.current_m_uid() or addressee_m_uid=public.current_m_uid());

revoke all on public.network_blocks, public.network_mutes, public.network_bookmarks, public.network_connections from public, anon;
grant select,insert,delete on public.network_blocks to authenticated;
grant select,insert,update,delete on public.network_mutes to authenticated;
grant select,insert,delete on public.network_bookmarks to authenticated;
grant select on public.network_connections to authenticated;
grant all on public.network_blocks, public.network_mutes, public.network_bookmarks, public.network_connections to service_role;

create or replace function public.mnet_is_blocked_pair(p_a uuid,p_b uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(
    select 1 from public.network_blocks b
    where (b.blocker_m_uid=p_a and b.blocked_m_uid=p_b)
       or (b.blocker_m_uid=p_b and b.blocked_m_uid=p_a)
  );
$$;
revoke all on function public.mnet_is_blocked_pair(uuid,uuid) from public,anon;
grant execute on function public.mnet_is_blocked_pair(uuid,uuid) to authenticated,service_role;

create or replace function public.mnet_discover(p_query text default '', p_limit integer default 25)
returns table(
  m_uid uuid, mccluster_id text, display_name text, headline text, bio text,
  avatar_url text, banner_url text, verification_state text,
  follower_count bigint, following_count bigint, following boolean
)
language sql stable security definer set search_path=pg_catalog,public,auth as $$
  with me as (select public.current_m_uid() m_uid),
  candidates as (
    select np.m_uid, pp.mccluster_id, np.display_name, np.headline, np.bio,
           np.avatar_url, np.banner_url, np.verification_state
    from public.network_profiles np
    join public.m_auth_user_links l on l.m_uid=np.m_uid and l.is_primary=true
    join public.platform_profiles pp on pp.user_id=l.auth_user_id
    cross join me
    where np.discoverable=true
      and np.visibility='public'
      and np.m_uid<>me.m_uid
      and not public.mnet_is_blocked_pair(me.m_uid,np.m_uid)
      and (
        nullif(trim(coalesce(p_query,'')),'') is null
        or pp.mccluster_id ilike '%'||trim(p_query)||'%'
        or np.display_name ilike '%'||trim(p_query)||'%'
        or np.headline ilike '%'||trim(p_query)||'%'
      )
  )
  select c.*,
    (select count(*) from public.network_follows f where f.followed_m_uid=c.m_uid and f.status='following'),
    (select count(*) from public.network_follows f where f.follower_m_uid=c.m_uid and f.status='following'),
    exists(select 1 from public.network_follows f cross join me where f.follower_m_uid=me.m_uid and f.followed_m_uid=c.m_uid and f.status='following')
  from candidates c
  order by
    case when lower(c.mccluster_id)=lower(trim(coalesce(p_query,''))) then 0 else 1 end,
    c.display_name asc
  limit greatest(1,least(coalesce(p_limit,25),100));
$$;
revoke all on function public.mnet_discover(text,integer) from public,anon;
grant execute on function public.mnet_discover(text,integer) to authenticated,service_role;

create or replace function public.mnet_open_direct(p_target_m_uid uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare
  v_me uuid;
  v_conversation uuid;
  v_pref text;
  v_target_state text := 'requested';
  v_network boolean := false;
begin
  v_me := public.current_m_uid();
  if v_me is null then raise exception 'identity_missing'; end if;
  if p_target_m_uid is null or p_target_m_uid=v_me then raise exception 'invalid_target'; end if;
  if not exists(select 1 from public.network_profiles where m_uid=p_target_m_uid) then raise exception 'target_not_found'; end if;
  if public.mnet_is_blocked_pair(v_me,p_target_m_uid) then raise exception 'blocked'; end if;

  select c.id into v_conversation
  from public.network_conversations c
  where c.kind='direct'
    and exists(select 1 from public.network_conversation_members a where a.conversation_id=c.id and a.m_uid=v_me and a.member_state<>'left')
    and exists(select 1 from public.network_conversation_members b where b.conversation_id=c.id and b.m_uid=p_target_m_uid and b.member_state<>'left')
    and (select count(*) from public.network_conversation_members z where z.conversation_id=c.id and z.member_state<>'left')=2
  order by c.created_at desc limit 1;
  if v_conversation is not null then return v_conversation; end if;

  select coalesce(allow_messages_from,'network') into v_pref from public.network_profiles where m_uid=p_target_m_uid;
  if v_pref='nobody' then raise exception 'messages_not_allowed'; end if;
  select (
    exists(select 1 from public.network_connections c where
      ((c.requester_m_uid=v_me and c.addressee_m_uid=p_target_m_uid) or (c.requester_m_uid=p_target_m_uid and c.addressee_m_uid=v_me))
      and c.status='accepted')
    or (
      exists(select 1 from public.network_follows f where f.follower_m_uid=v_me and f.followed_m_uid=p_target_m_uid and f.status='following')
      and exists(select 1 from public.network_follows f where f.follower_m_uid=p_target_m_uid and f.followed_m_uid=v_me and f.status='following')
    )
  ) into v_network;
  if v_pref='everyone' or v_network then v_target_state := 'active'; end if;

  insert into public.network_conversations(kind,created_by_m_uid)
  values('direct',v_me) returning id into v_conversation;
  insert into public.network_conversation_members(conversation_id,m_uid,role,member_state)
  values(v_conversation,v_me,'owner','active'),(v_conversation,p_target_m_uid,'member',v_target_state);
  return v_conversation;
end $$;
revoke all on function public.mnet_open_direct(uuid) from public,anon;
grant execute on function public.mnet_open_direct(uuid) to authenticated,service_role;

create or replace function public.mnet_accept_conversation(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_me uuid;
begin
  v_me:=public.current_m_uid();
  if v_me is null then raise exception 'identity_missing'; end if;
  update public.network_conversation_members
     set member_state='active',joined_at=coalesce(joined_at,now()),left_at=null
   where conversation_id=p_conversation_id and m_uid=v_me and member_state='requested';
  return found;
end $$;
revoke all on function public.mnet_accept_conversation(uuid) from public,anon;
grant execute on function public.mnet_accept_conversation(uuid) to authenticated,service_role;

create or replace function public.mnet_send_message(p_conversation_id uuid,p_body text,p_media jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_me uuid; v_id uuid; v_state text;
begin
  v_me:=public.current_m_uid();
  if v_me is null then raise exception 'identity_missing'; end if;
  select member_state into v_state from public.network_conversation_members
   where conversation_id=p_conversation_id and m_uid=v_me and member_state<>'left';
  if v_state is null then raise exception 'conversation_forbidden'; end if;
  if coalesce(char_length(trim(p_body)),0)=0 and coalesce(jsonb_array_length(coalesce(p_media,'[]'::jsonb)),0)=0 then
    raise exception 'message_required';
  end if;
  if char_length(coalesce(p_body,''))>20000 then raise exception 'message_too_long'; end if;
  if exists(
    select 1
    from public.network_conversation_members other
    where other.conversation_id=p_conversation_id and other.m_uid<>v_me and public.mnet_is_blocked_pair(v_me,other.m_uid)
  ) then raise exception 'blocked'; end if;
  insert into public.network_messages(conversation_id,sender_m_uid,body,media)
  values(p_conversation_id,v_me,trim(coalesce(p_body,'')),coalesce(p_media,'[]'::jsonb))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.mnet_send_message(uuid,text,jsonb) from public,anon;
grant execute on function public.mnet_send_message(uuid,text,jsonb) to authenticated,service_role;

create or replace function public.mnet_mark_conversation_read(p_conversation_id uuid)
returns timestamptz language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_me uuid; v_at timestamptz:=now();
begin
  v_me:=public.current_m_uid();
  if v_me is null then raise exception 'identity_missing'; end if;
  update public.network_conversation_members set last_read_at=v_at
   where conversation_id=p_conversation_id and m_uid=v_me and member_state<>'left';
  if not found then raise exception 'conversation_forbidden'; end if;
  return v_at;
end $$;
revoke all on function public.mnet_mark_conversation_read(uuid) from public,anon;
grant execute on function public.mnet_mark_conversation_read(uuid) to authenticated,service_role;

create or replace function public.mnet_touch_conversation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.network_conversations
     set last_message_at=new.created_at,updated_at=now()
   where id=new.conversation_id;
  return new;
end $$;
drop trigger if exists mnet_touch_conversation_trg on public.network_messages;
create trigger mnet_touch_conversation_trg after insert on public.network_messages
for each row execute function public.mnet_touch_conversation();

create or replace function public.mnet_notify_message()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.network_notifications(recipient_m_uid,actor_m_uid,type,object_type,object_id,body,metadata)
  select m.m_uid,new.sender_m_uid,'message','conversation',new.conversation_id::text,
         case when nullif(trim(new.body),'') is null then 'Sent you media' else left(new.body,240) end,
         jsonb_build_object('conversation_id',new.conversation_id,'message_id',new.id)
  from public.network_conversation_members m
  where m.conversation_id=new.conversation_id
    and m.m_uid<>new.sender_m_uid
    and m.member_state<>'left';
  return new;
end $$;
drop trigger if exists mnet_notify_message_trg on public.network_messages;
create trigger mnet_notify_message_trg after insert on public.network_messages
for each row execute function public.mnet_notify_message();

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
    and not public.mnet_is_blocked_pair(me.m_uid,f.actor_m_uid)
    and not exists(
      select 1 from public.network_mutes nm
      where nm.muter_m_uid=me.m_uid and nm.muted_m_uid=f.actor_m_uid
        and (nm.expires_at is null or nm.expires_at>now())
    )
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
revoke all on function public.mnet_surface_feed(text,integer,timestamptz) from public,anon;
grant execute on function public.mnet_surface_feed(text,integer,timestamptz) to authenticated,service_role;

do $$ begin alter publication supabase_realtime add table public.network_posts; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.network_reactions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.network_follows; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.network_notifications; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.network_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.network_conversation_members; exception when duplicate_object then null; end $$;
