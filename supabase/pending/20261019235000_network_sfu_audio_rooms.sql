-- MNET AUDIO ROOMS / CLOUDFLARE REALTIME SFU (PENDING — DO NOT APPLY ON MERGE)
-- Workers AUDIO_SFU_ROOMS_ENABLED remains false until reviewed production apply,
-- tested database governance, provider credentials, and privacy re-acknowledgement.
-- Service-role only. Browsers never call these tables or own the App Secret.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.network_audio_rooms (
 id uuid primary key default gen_random_uuid(),
 host_m_uid uuid not null,
 title text not null check (char_length(title) between 1 and 120),
 category_key text not null check (char_length(category_key) between 1 and 64),
 country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
 status text not null default 'live' check (status in ('live','ended')),
 max_speakers smallint not null default 4 check (max_speakers between 1 and 4),
 max_listeners smallint not null default 100 check (max_listeners between 1 and 250),
 created_at timestamptz not null default now(),
 ended_at timestamptz
);
create index if not exists network_audio_live_region_v1
 on public.network_audio_rooms (country_code,created_at desc)
 where status='live';
create index if not exists network_audio_host_v1
 on public.network_audio_rooms (host_m_uid,created_at desc);

create table if not exists public.network_audio_members (
 room_id uuid not null references public.network_audio_rooms(id) on delete cascade,
 m_uid uuid not null,
 role text not null default 'listener' check (role in ('host','speaker','listener')),
 status text not null default 'joined' check (status in ('joined','left','kicked')),
 muted boolean not null default true,
 sfu_publication_session_id text,
 sfu_publication_mid text,
 joined_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 left_at timestamptz,
 primary key (room_id,m_uid),
 check ((sfu_publication_session_id is null) = (sfu_publication_mid is null)),
 check (sfu_publication_session_id is null or char_length(sfu_publication_session_id) between 5 and 256),
 check (sfu_publication_mid is null or sfu_publication_mid ~ '^[a-zA-Z0-9]{1,16}$')
);
create unique index if not exists network_audio_pub_sfu_unique
 on public.network_audio_members(sfu_publication_session_id)
 where sfu_publication_session_id is not null;
create index if not exists network_audio_member_state
 on public.network_audio_members(m_uid,room_id) where status='joined';

create table if not exists public.network_audio_subscriptions (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.network_audio_rooms(id) on delete cascade,
 listener_m_uid uuid not null,
 publisher_m_uid uuid not null,
 sfu_session_id text not null unique check (char_length(sfu_session_id) between 5 and 256),
 sfu_mid text not null default '0' check (sfu_mid ~ '^[a-zA-Z0-9]{1,16}$'),
 status text not null default 'negotiating' check (status in ('negotiating','active','closed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(room_id,listener_m_uid,publisher_m_uid)
);
create index if not exists network_audio_sub_room_state
 on public.network_audio_subscriptions(room_id,status);

alter table public.network_audio_rooms enable row level security;
alter table public.network_audio_members enable row level security;
alter table public.network_audio_subscriptions enable row level security;
revoke all on public.network_audio_rooms from public,anon,authenticated;
revoke all on public.network_audio_members from public,anon,authenticated;
revoke all on public.network_audio_subscriptions from public,anon,authenticated;
grant all on public.network_audio_rooms to service_role;
grant all on public.network_audio_members to service_role;
grant all on public.network_audio_subscriptions to service_role;
-- No permissive policies: even accidentally exposing the Data API does not
-- authorize direct browser reads or writes. All public views are Worker projections.

-- Atomic, capacity-checked room join. Never permits a kicked member back in.
-- Only the Worker service role can invoke it after independently verifying
-- bearer token, linked m_uid and two-way block boundaries.
create or replace function public.network_audio_join_room(p_room_id uuid,p_m_uid uuid)
returns text language plpgsql security definer set search_path=''
as $$
declare room record; existing text; total bigint;
begin
 select id,max_listeners,status,host_m_uid into room from public.network_audio_rooms
 where id=p_room_id for update;
 if room.id is null or room.status <> 'live' then raise exception 'audio_room_closed' using errcode='AU404'; end if;
 select status into existing from public.network_audio_members where room_id=p_room_id and m_uid=p_m_uid;
 if existing='kicked' then raise exception 'audio_room_member_kicked' using errcode='AU403'; end if;
 if existing='joined' then
  update public.network_audio_members set last_seen_at=now() where room_id=p_room_id and m_uid=p_m_uid;
  return 'joined';
 end if;
 select count(*) into total from public.network_audio_members where room_id=p_room_id and status='joined';
 if total >= room.max_listeners then raise exception 'audio_room_full' using errcode='AU409'; end if;
 insert into public.network_audio_members(room_id,m_uid,role,status,muted,joined_at,last_seen_at,left_at)
 values (p_room_id,p_m_uid,case when room.host_m_uid=p_m_uid then 'host' else 'listener' end,'joined',true,now(),now(),null)
 on conflict (room_id,m_uid) do update set status='joined',
    role=excluded.role, muted=true, joined_at=now(),last_seen_at=now(),left_at=null,
    sfu_publication_session_id=null,sfu_publication_mid=null;
 return 'joined';
end $$;
revoke all on function public.network_audio_join_room(uuid,uuid) from public,anon,authenticated;
grant execute on function public.network_audio_join_room(uuid,uuid) to service_role;

create or replace function public.network_audio_assign_speaker(
 p_room_id uuid,p_host_m_uid uuid,p_target_m_uid uuid,p_speaker boolean)
returns text language plpgsql security definer set search_path=''
as $$
declare room record; existing record; count_speakers bigint;
begin
 select * into room from public.network_audio_rooms where id=p_room_id for update;
 if room.id is null or room.status<>'live' then raise exception 'audio_room_closed' using errcode='AU404'; end if;
 if room.host_m_uid<>p_host_m_uid or p_target_m_uid=p_host_m_uid then
  raise exception 'audio_host_required' using errcode='AU403';
 end if;
 select * into existing from public.network_audio_members
 where room_id=p_room_id and m_uid=p_target_m_uid for update;
 if existing.m_uid is null or existing.status<>'joined' then raise exception 'audio_member_not_joined' using errcode='AU404'; end if;
 if p_speaker then
  select count(*) into count_speakers from public.network_audio_members
   where room_id=p_room_id and status='joined' and role in ('host','speaker');
  if existing.role<>'speaker' and count_speakers>=room.max_speakers
   then raise exception 'audio_stage_full' using errcode='AU409'; end if;
 end if;
 update public.network_audio_members set role=case when p_speaker then 'speaker' else 'listener' end,
  muted=not p_speaker, last_seen_at=now()
 where room_id=p_room_id and m_uid=p_target_m_uid;
 return case when p_speaker then 'speaker' else 'listener' end;
end $$;
revoke all on function public.network_audio_assign_speaker(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.network_audio_assign_speaker(uuid,uuid,uuid,boolean) to service_role;
commit;
