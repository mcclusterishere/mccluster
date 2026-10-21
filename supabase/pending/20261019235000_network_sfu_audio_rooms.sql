-- MNET AUDIO ROOMS / CLOUDFLARE REALTIME SFU (PENDING — DO NOT APPLY ON MERGE)
-- Workers AUDIO_SFU_ROOMS_ENABLED remains false until reviewed production apply,
-- tested database governance, provider credentials, and privacy re-acknowledgement.
-- Service-role only. Browsers never call these tables or own the App Secret.
--
-- Every seat in a room has an opaque participant_id. The Worker shows people
-- to each other by participant_id and public display name only; m_uid never
-- leaves the Worker. A signed-out visitor is a seat with no m_uid: it stores
-- no identity, no IP and no country (the Worker checks the connection
-- country on every call and passes it here only to compare), may only
-- listen, and lapses unless the browser keeps checking in.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.network_audio_rooms (
 id uuid primary key default gen_random_uuid(),
 host_m_uid uuid not null,
 title text not null check (char_length(title) between 1 and 120),
 category_key text not null check (char_length(category_key) between 1 and 64),
 country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
 visitors_may_listen boolean not null default true,
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
 participant_id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.network_audio_rooms(id) on delete cascade,
 m_uid uuid,
 role text not null default 'listener' check (role in ('host','speaker','listener')),
 status text not null default 'joined' check (status in ('joined','left','kicked')),
 muted boolean not null default true,
 hand_raised_at timestamptz,
 sfu_publication_session_id text,
 sfu_publication_mid text,
 joined_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 left_at timestamptz,
 expires_at timestamptz,
 -- A visitor seat (no m_uid) always expires and can only ever listen.
 check ((m_uid is null) = (expires_at is not null)),
 check (m_uid is not null or (role='listener' and muted and hand_raised_at is null
   and sfu_publication_session_id is null)),
 check (hand_raised_at is null or role='listener'),
 check ((sfu_publication_session_id is null) = (sfu_publication_mid is null)),
 check (sfu_publication_session_id is null or char_length(sfu_publication_session_id) between 5 and 256),
 check (sfu_publication_mid is null or sfu_publication_mid ~ '^[a-zA-Z0-9]{1,16}$')
);
create unique index if not exists network_audio_member_identity
 on public.network_audio_members(room_id,m_uid) where m_uid is not null;
create unique index if not exists network_audio_pub_sfu_unique
 on public.network_audio_members(sfu_publication_session_id)
 where sfu_publication_session_id is not null;
create index if not exists network_audio_member_state
 on public.network_audio_members(room_id,role) where status='joined';

create table if not exists public.network_audio_subscriptions (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.network_audio_rooms(id) on delete cascade,
 listener_participant_id uuid not null references public.network_audio_members(participant_id) on delete cascade,
 publisher_participant_id uuid not null references public.network_audio_members(participant_id) on delete cascade,
 sfu_session_id text not null unique check (char_length(sfu_session_id) between 5 and 256),
 sfu_mid text not null default '0' check (sfu_mid ~ '^[a-zA-Z0-9]{1,16}$'),
 status text not null default 'negotiating' check (status in ('negotiating','active','closed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(listener_participant_id <> publisher_participant_id)
);
-- Only one *active* subscription per listener/publisher pair.
-- A closed session can be replaced during a reconnect.
create unique index if not exists network_audio_active_sub_unique
 on public.network_audio_subscriptions(room_id,listener_participant_id,publisher_participant_id)
 where status <> 'closed';
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

-- A seat counts while it is joined; a visitor seat only while its browser
-- has checked in within two minutes and before it expires.
create or replace function public.network_audio_seat_counts(p_room_id uuid)
returns table(speakers bigint, listeners bigint, visitors bigint)
language sql stable security definer set search_path=''
as $$
 select count(*) filter (where m.role in ('host','speaker')),
        count(*) filter (where m.role='listener'),
        count(*) filter (where m.m_uid is null)
 from public.network_audio_members m
 where m.room_id=p_room_id and m.status='joined'
   and (m.m_uid is not null or (m.expires_at>now() and m.last_seen_at>now()-interval '2 minutes'));
$$;
revoke all on function public.network_audio_seat_counts(uuid) from public,anon,authenticated;
grant execute on function public.network_audio_seat_counts(uuid) to service_role;

-- The public directory: live rooms, newest first, with how many are on the
-- stage and listening. host_m_uid is returned to the Worker only, which turns
-- it into a display name and drops it.
create or replace function public.network_audio_directory(p_country text default null,p_room_id uuid default null)
returns table(id uuid,title text,category_key text,country_code text,visitors_may_listen boolean,
  max_speakers smallint,created_at timestamptz,host_m_uid uuid,speakers bigint,listeners bigint)
language sql stable security definer set search_path=''
as $$
 select r.id,r.title,r.category_key,r.country_code,r.visitors_may_listen,r.max_speakers,r.created_at,r.host_m_uid,
        c.speakers,c.listeners
 from public.network_audio_rooms r
 cross join lateral public.network_audio_seat_counts(r.id) c
 where r.status='live'
   and (p_country is null or r.country_code=p_country)
   and (p_room_id is null or r.id=p_room_id)
 order by r.created_at desc
 limit 40;
$$;
revoke all on function public.network_audio_directory(text,uuid) from public,anon,authenticated;
grant execute on function public.network_audio_directory(text,uuid) to service_role;

-- Atomic, capacity-checked member join. Never permits a kicked member back in.
-- Only the Worker service role can invoke it after independently verifying
-- bearer token, linked m_uid and two-way block boundaries.
create or replace function public.network_audio_join_room(p_room_id uuid,p_m_uid uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare room record; existing record; seats record; seat uuid;
begin
 if p_m_uid is null then raise exception 'audio_member_required' using errcode='AU403'; end if;
 select id,max_listeners,status,host_m_uid into room from public.network_audio_rooms
 where id=p_room_id for update;
 if room.id is null or room.status <> 'live' then raise exception 'audio_room_closed' using errcode='AU404'; end if;
 select participant_id,status into existing from public.network_audio_members
 where room_id=p_room_id and m_uid=p_m_uid;
 if existing.status='kicked' then raise exception 'audio_room_member_kicked' using errcode='AU403'; end if;
 if existing.status='joined' then
  update public.network_audio_members set last_seen_at=now() where participant_id=existing.participant_id;
  return existing.participant_id;
 end if;
 select * into seats from public.network_audio_seat_counts(p_room_id);
 if seats.speakers+seats.listeners >= room.max_listeners then raise exception 'audio_room_full' using errcode='AU409'; end if;
 insert into public.network_audio_members(room_id,m_uid,role,status,muted,joined_at,last_seen_at,left_at)
 values (p_room_id,p_m_uid,case when room.host_m_uid=p_m_uid then 'host' else 'listener' end,'joined',true,now(),now(),null)
 on conflict (room_id,m_uid) where m_uid is not null do update set status='joined',
    role=excluded.role, muted=true, hand_raised_at=null, joined_at=now(),last_seen_at=now(),left_at=null,
    sfu_publication_session_id=null,sfu_publication_mid=null
 returning participant_id into seat;
 return seat;
end $$;
revoke all on function public.network_audio_join_room(uuid,uuid) from public,anon,authenticated;
grant execute on function public.network_audio_join_room(uuid,uuid) to service_role;

-- A signed-out visitor takes a listening seat only in a live room whose
-- country is the country the Worker read from the connection, and only up to
-- half the room, so members can always get in. Nothing about the visitor is
-- stored: p_country is compared and discarded. Lapsed visitor seats in the
-- room are swept first.
create or replace function public.network_audio_join_visitor(p_room_id uuid,p_country text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare room record; seats record; seat uuid;
begin
 if p_country is null or p_country !~ '^[A-Z]{2}$' then raise exception 'audio_visitor_country_unknown' using errcode='AU403'; end if;
 select id,max_listeners,status,country_code,visitors_may_listen into room from public.network_audio_rooms
 where id=p_room_id for update;
 if room.id is null or room.status <> 'live' then raise exception 'audio_room_closed' using errcode='AU404'; end if;
 if not room.visitors_may_listen or room.country_code is distinct from p_country then
  raise exception 'audio_visitor_outside_region' using errcode='AU403';
 end if;
 delete from public.network_audio_members
 where room_id=p_room_id and m_uid is null
   and (status<>'joined' or expires_at<=now() or last_seen_at<=now()-interval '2 minutes');
 select * into seats from public.network_audio_seat_counts(p_room_id);
 if seats.speakers+seats.listeners >= room.max_listeners or seats.visitors >= greatest(1,room.max_listeners/2) then
  raise exception 'audio_room_full' using errcode='AU409';
 end if;
 insert into public.network_audio_members(room_id,m_uid,role,status,muted,expires_at)
 values (p_room_id,null,'listener','joined',true,now()+interval '4 hours')
 returning participant_id into seat;
 return seat;
end $$;
revoke all on function public.network_audio_join_visitor(uuid,text) from public,anon,authenticated;
grant execute on function public.network_audio_join_visitor(uuid,text) to service_role;

create or replace function public.network_audio_assign_speaker(
 p_room_id uuid,p_host_m_uid uuid,p_target uuid,p_speaker boolean)
returns text language plpgsql security definer set search_path=''
as $$
declare room record; existing record; count_speakers bigint;
begin
 select * into room from public.network_audio_rooms where id=p_room_id for update;
 if room.id is null or room.status<>'live' then raise exception 'audio_room_closed' using errcode='AU404'; end if;
 if room.host_m_uid<>p_host_m_uid then raise exception 'audio_host_required' using errcode='AU403'; end if;
 select * into existing from public.network_audio_members
 where room_id=p_room_id and participant_id=p_target for update;
 if existing.participant_id is null or existing.status<>'joined' then raise exception 'audio_member_not_joined' using errcode='AU404'; end if;
 -- Visitors cannot speak; the host cannot demote themself.
 if existing.m_uid is null or existing.m_uid=p_host_m_uid then raise exception 'audio_speaker_not_allowed' using errcode='AU403'; end if;
 if p_speaker then
  select count(*) into count_speakers from public.network_audio_members
   where room_id=p_room_id and status='joined' and role in ('host','speaker');
  if existing.role<>'speaker' and count_speakers>=room.max_speakers
   then raise exception 'audio_stage_full' using errcode='AU409'; end if;
 end if;
 -- A new speaker starts muted: the microphone opens only from their own Speak tap.
 update public.network_audio_members set role=case when p_speaker then 'speaker' else 'listener' end,
  muted=true, hand_raised_at=null, last_seen_at=now()
 where participant_id=p_target;
 return case when p_speaker then 'speaker' else 'listener' end;
end $$;
revoke all on function public.network_audio_assign_speaker(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.network_audio_assign_speaker(uuid,uuid,uuid,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
