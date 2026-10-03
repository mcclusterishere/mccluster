-- ACTION NETWORK LIVE GOVERNANCE V1
-- Live is a governed program surface, not an unrestricted follower feature.
-- Host access comes from a narrow operator-issued grant (or the owner desk),
-- rooms are persistent Home or Mission rooms, and discovery ranks measured
-- outcomes without using money/support as a ranking signal.

create table public.network_live_categories(
 key text primary key check(key~'^[a-z][a-z0-9-]{1,31}$'),
 label text not null check(char_length(label) between 2 and 40),
 description text not null default '' check(char_length(description)<=240),
 sort smallint not null default 0,enabled boolean not null default true);
insert into public.network_live_categories(key,label,description,sort) values
 ('music','Music','Perform, write, produce, rehearse or listen together.',10),
 ('build','Build','Make, design, code, repair or prototype something.',20),
 ('learn','Learn','Teach, study, research or explain something useful.',30),
 ('field','Field','Do verified community or mission work in the real world.',40),
 ('forum','Forum','Interview, brief, discuss or debate around a defined subject.',50);
alter table public.network_live_categories enable row level security;
revoke all on public.network_live_categories from public,anon,authenticated;
grant select on public.network_live_categories to anon,authenticated;
grant all on public.network_live_categories to service_role;
create policy "public reads enabled live categories" on public.network_live_categories for select to anon,authenticated using(enabled);

-- Current site catalogue gets stable database identities. This table is a
-- discovery pointer, not a replacement for creator_tracks or rights records.
create table public.music_catalog_objects(
 id uuid primary key default gen_random_uuid(),
 catalog_key text not null unique check(catalog_key~'^[a-z0-9-]+:[a-z0-9-]+$'),
 album_slug text not null check(album_slug~'^[a-z0-9][a-z0-9-]{0,119}$'),
 album_title text not null check(char_length(album_title) between 1 and 200),
 track_title text not null check(char_length(track_title) between 1 and 200),
 artist_name text not null check(char_length(artist_name) between 1 and 200),
 credit_line text not null default '' check(char_length(credit_line)<=500),
 audio_path text not null default '' check(char_length(audio_path)<=1000),
 artwork_path text not null default '' check(char_length(artwork_path)<=1000),
 canonical_url text not null check(canonical_url~'^https://'),
 source_kind text not null default 'site_catalog' check(source_kind in('site_catalog','creator_track')),
 creator_track_id uuid references public.creator_tracks(id) on delete set null,
 status text not null default 'active' check(status in('active','archived')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index music_catalog_objects_album_idx on public.music_catalog_objects(album_slug,track_title);
create index music_catalog_objects_creator_track_idx on public.music_catalog_objects(creator_track_id) where creator_track_id is not null;
alter table public.music_catalog_objects enable row level security;
revoke all on public.music_catalog_objects from public,anon,authenticated;
grant select on public.music_catalog_objects to anon,authenticated;
grant all on public.music_catalog_objects to service_role;
create policy "public reads active music objects" on public.music_catalog_objects for select to anon,authenticated using(status='active');
insert into public.music_catalog_objects(catalog_key,album_slug,album_title,track_title,artist_name,credit_line,audio_path,artwork_path,canonical_url,source_kind,status)
values ('here:who-did-the-shoot','here','I AM HERE','Who Did The Shoot','McCluster','Have no fear.','assets/audio/who-did-the-shoot.mp3','assets/frames/hero_0001.jpg','https://matthew.mccluster.org/album.html?album=here&t=Who%20Did%20The%20Shoot','site_catalog','active'),
('here:runway-walk','here','I AM HERE','Runway Walk','McCluster','Have no fear.','assets/audio/runway-walk.mp3','assets/frames/vauntlive_0001.jpg','https://matthew.mccluster.org/album.html?album=here&t=Runway%20Walk','site_catalog','active'),
('here:write-a-song','here','I AM HERE','Write a Song','McCluster','Have no fear.','assets/audio/write-a-song.mp3','assets/frames/studio360_0001.jpg','https://matthew.mccluster.org/album.html?album=here&t=Write%20a%20Song','site_catalog','active'),
('here:here','here','I AM HERE','Here','McCluster','the title track','assets/audio/here.mp3','assets/frames/keynote_0001.jpg','https://matthew.mccluster.org/album.html?album=here&t=Here','site_catalog','active'),
('here:antisocial','here','I AM HERE','Antisocial','McCluster','Have no fear.','assets/audio/antisocial.mp3','assets/frames/nightscroll_0001.jpg','https://matthew.mccluster.org/album.html?album=here&t=Antisocial','site_catalog','active'),
('here:lightroom','here','I AM HERE','Lightroom','McCluster','Have no fear.','assets/audio/lightroom.mp3','assets/frames/editors_0001.jpg','https://matthew.mccluster.org/album.html?album=here&t=Lightroom','site_catalog','active'),
('prim3:got-wifi','prim3','PRIM3','Got WiFi?','McCluster','Music to build to.','assets/audio/got-wifi.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=Got%20WiFi%3F','site_catalog','active'),
('equity-uprise:environmental-injustice','equity-uprise','Docket 516R','Environmental Injustice','Equity Uprise','McCluster ft. Angel Kastro & Ocho','assets/audio/environmental-injustice.mp3','assets/frames/uprise_0001.jpg','https://matthew.mccluster.org/album.html?album=equity-uprise&t=Environmental%20Injustice','site_catalog','active'),
('equity-uprise:environmental-injustice-brave-mix','equity-uprise','Docket 516R','Environmental Injustice (Brave mix)','Equity Uprise','McCluster ft. Angel Kastro & Ocho · the GA edition','assets/audio/environmental-injustice-brave.mp3','assets/frames/uprise_0001.jpg','https://matthew.mccluster.org/album.html?album=equity-uprise&t=Environmental%20Injustice%20(Brave%20mix)','site_catalog','active'),
('equity-uprise:please-set-me-free','equity-uprise','Docket 516R','Please Set Me Free','Equity Uprise','Los Fidel · beat by McCluster','assets/audio/please-set-me-free.mp3','assets/frames/church_0001.jpg','https://matthew.mccluster.org/album.html?album=equity-uprise&t=Please%20Set%20Me%20Free','site_catalog','active'),
('equity-uprise:money-or-the-power','equity-uprise','Docket 516R','Money or the Power','Equity Uprise','ft. Ocho, McCluster & Old Jay · prod. PAX','assets/audio/money-or-the-power.mp3','assets/frames/moneyglitch_0001.jpg','https://matthew.mccluster.org/album.html?album=equity-uprise&t=Money%20or%20the%20Power','site_catalog','active'),
('heal-the-3:deep-end','heal-the-3','Heal the 3','Deep End','McCluster','the dark side · McCluster × VVS Madè','assets/audio/deep-end.m4a','assets/frames/warroom_0001.jpg','https://matthew.mccluster.org/album.html?album=heal-the-3&t=Deep%20End','site_catalog','active'),
('heal-the-3:heal-the-3rd-world','heal-the-3','Heal the 3','Heal the 3rd World','McCluster','the light side · McCluster × VVS Madè','assets/audio/heal-the-3rd-world.m4a','assets/frames/angel_0001.jpg','https://matthew.mccluster.org/album.html?album=heal-the-3&t=Heal%20the%203rd%20World','site_catalog','active'),
('vaunt-ep:vaunt-acoustic','vaunt-ep','Vaunt EP','Vaunt (Acoustic)','McCluster','Recorded for the runway.','assets/audio/vaunt.mp3','assets/frames/vauntlive_0001.jpg','https://matthew.mccluster.org/album.html?album=vaunt-ep&t=Vaunt%20(Acoustic)','site_catalog','active'),
('whip-equipped:dealer-plates-a-side','whip-equipped','Whip Equipped','Dealer Plates (A-Side)','McCluster','Scored by Dealer Plates.','assets/audio/dealer-plates.mp3','assets/frames/whip_0001.jpg','https://matthew.mccluster.org/album.html?album=whip-equipped&t=Dealer%20Plates%20(A-Side)','site_catalog','active'),
('whip-equipped:dealer-plates-b-side','whip-equipped','Whip Equipped','Dealer Plates (B-Side)','McCluster','Scored by Dealer Plates.','assets/audio/dealer-plates-b.mp3','assets/img/wing-whip-poster.jpg','https://matthew.mccluster.org/album.html?album=whip-equipped&t=Dealer%20Plates%20(B-Side)','site_catalog','active'),
('singles:upset','singles','Singles','Upset','McCluster','Between the albums.','assets/audio/upset.mp3','assets/frames/coffeecam_0001.jpg','https://matthew.mccluster.org/album.html?album=singles&t=Upset','site_catalog','active'),
('cia-mind-control:you-the-feds','cia-mind-control','CIA Mind Control','You the Feds','KKK','','assets/audio/you-the-feds.m4a','assets/img/cia-mind-control-cover.jpg','https://matthew.mccluster.org/album.html?album=cia-mind-control&t=You%20the%20Feds','site_catalog','active'),
('cia-mind-control:pull-up','cia-mind-control','CIA Mind Control','Pull Up','KKK','','assets/audio/pull-up.mp3','assets/img/cia-mind-control-cover.jpg','https://matthew.mccluster.org/album.html?album=cia-mind-control&t=Pull%20Up','site_catalog','active'),
('cia-mind-control:niggy-nigg-niggr','cia-mind-control','CIA Mind Control','Niggy Nigg Niggr','KKK','','assets/audio/niggy-nigg-preview.mp3','assets/img/cia-mind-control-cover.jpg','https://matthew.mccluster.org/album.html?album=cia-mind-control&t=Niggy%20Nigg%20Niggr','site_catalog','active')
on conflict(catalog_key) do update set album_slug=excluded.album_slug,album_title=excluded.album_title,track_title=excluded.track_title,
 artist_name=excluded.artist_name,credit_line=excluded.credit_line,audio_path=excluded.audio_path,artwork_path=excluded.artwork_path,
 canonical_url=excluded.canonical_url,source_kind=excluded.source_kind,status=excluded.status,updated_at=now();

-- This is a capability grant, not a public-facing role. The only grant bases
-- are an active cohort seat, a client project/org membership, or staff.
create table public.network_live_host_grants(
 id uuid primary key default gen_random_uuid(),m_uid uuid not null references public.m_people(id) on delete cascade,
 basis text not null check(basis in('cohort','client_project','staff')),
 cohort_id uuid references public.action_cohorts(id) on delete cascade,org_id uuid references public.orgs(id) on delete cascade,
 allowed_categories text[] not null,max_stage_seats smallint not null default 4 check(max_stage_seats between 1 and 8),
 support_allowed boolean not null default false,status text not null default 'active' check(status in('active','revoked')),
 starts_at timestamptz not null default now(),expires_at timestamptz,note text not null default '' check(char_length(note)<=500),
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(cardinality(allowed_categories) between 1 and 5),check(expires_at is null or expires_at>starts_at),
 check((basis='cohort' and cohort_id is not null and org_id is null) or (basis='client_project' and org_id is not null and cohort_id is null) or (basis='staff' and cohort_id is null and org_id is null)));
create index network_live_host_grants_muid_idx on public.network_live_host_grants(m_uid,status,starts_at,expires_at);
create index network_live_host_grants_cohort_idx on public.network_live_host_grants(cohort_id) where cohort_id is not null;
create index network_live_host_grants_org_idx on public.network_live_host_grants(org_id) where org_id is not null;
create unique index network_live_host_grants_active_scope_uq on public.network_live_host_grants(
 m_uid,basis,coalesce(cohort_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(org_id,'00000000-0000-0000-0000-000000000000'::uuid)) where status='active';
create or replace function public.network_live_host_grant_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from unnest(new.allowed_categories)x where not exists(select 1 from public.network_live_categories c where c.key=x and c.enabled)) then raise exception 'unknown or disabled live category';end if;
 if new.basis='cohort' and not exists(select 1 from public.action_cohort_members cm join public.action_cohorts c on c.id=cm.cohort_id where cm.cohort_id=new.cohort_id and cm.m_uid=new.m_uid and c.status='active') then raise exception 'live cohort grant requires an active cohort seat';end if;
 if new.basis='client_project' and not exists(select 1 from public.m_auth_user_links l join public.org_members om on om.profile_id=l.auth_user_id where l.m_uid=new.m_uid and om.org_id=new.org_id) then raise exception 'live client-project grant requires organization membership';end if;
 new.updated_at:=now();return new;
end$$;
create trigger network_live_host_grant_guard_trg before insert or update on public.network_live_host_grants for each row execute function public.network_live_host_grant_guard();
alter table public.network_live_host_grants enable row level security;
revoke all on public.network_live_host_grants from public,anon,authenticated;grant all on public.network_live_host_grants to service_role;

create table public.network_live_rooms(
 id uuid primary key default gen_random_uuid(),slug text not null unique check(slug~'^[a-z0-9][a-z0-9-]{2,79}$'),
 owner_m_uid uuid references public.m_people(id) on delete set null,title text not null check(char_length(title) between 1 and 120),
 description text not null default '' check(char_length(description)<=1000),room_kind text not null check(room_kind in('home','mission')),
 category_key text not null references public.network_live_categories(key),action_mission_id uuid references public.action_missions(id) on delete set null,
 cohort_id uuid references public.action_cohorts(id) on delete set null,music_object_id uuid references public.music_catalog_objects(id) on delete set null,
 seat_limit smallint not null default 4 check(seat_limit between 1 and 8),support_enabled boolean not null default false,
 support_purpose text not null default '' check(char_length(support_purpose)<=300),support_goal_credits bigint check(support_goal_credits is null or support_goal_credits>0),
 status text not null default 'active' check(status in('active','paused','archived')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((room_kind='mission' and action_mission_id is not null) or(room_kind='home' and action_mission_id is null)),check(not support_enabled or char_length(btrim(support_purpose))>=8));
create index network_live_rooms_owner_idx on public.network_live_rooms(owner_m_uid,status);
create index network_live_rooms_category_idx on public.network_live_rooms(category_key,status);
create index network_live_rooms_mission_idx on public.network_live_rooms(action_mission_id) where action_mission_id is not null;
create index network_live_rooms_cohort_idx on public.network_live_rooms(cohort_id) where cohort_id is not null;
create index network_live_rooms_music_idx on public.network_live_rooms(music_object_id) where music_object_id is not null;
alter table public.network_live_rooms enable row level security;revoke all on public.network_live_rooms from public,anon,authenticated;
grant select on public.network_live_rooms to anon,authenticated;grant all on public.network_live_rooms to service_role;
create policy "public reads active live rooms" on public.network_live_rooms for select to anon,authenticated using(status='active');

-- Snapshot the room's governed context onto each broadcast so history cannot
-- change because somebody later edits the persistent room.
alter table public.network_live_sessions
 add column room_id uuid references public.network_live_rooms(id) on delete set null,
 add column room_kind text not null default 'home' check(room_kind in('home','mission')),
 add column category_key text not null default 'forum' references public.network_live_categories(key),
 add column action_mission_id uuid references public.action_missions(id) on delete set null,
 add column music_object_id uuid references public.music_catalog_objects(id) on delete set null,
 add column cohort_id uuid references public.action_cohorts(id) on delete set null,
 add column seat_limit smallint not null default 1 check(seat_limit between 1 and 8),
 add column support_enabled boolean not null default false;
create index network_live_sessions_room_idx on public.network_live_sessions(room_id,created_at desc) where room_id is not null;
create index network_live_sessions_category_idx on public.network_live_sessions(category_key,status,last_seen_at desc);
create index network_live_sessions_mission_idx on public.network_live_sessions(action_mission_id) where action_mission_id is not null;
create index network_live_sessions_music_idx on public.network_live_sessions(music_object_id) where music_object_id is not null;
create index network_live_sessions_cohort_idx on public.network_live_sessions(cohort_id) where cohort_id is not null;
grant select(id,host_m_uid,title,status,whep_url,post_id,started_at,last_seen_at,room_id,room_kind,category_key,action_mission_id,music_object_id,cohort_id,seat_limit,support_enabled) on public.network_live_sessions to anon,authenticated;

-- Private audience presence powers aggregate retention/conversion metrics;
-- viewer identities are never part of the public live-room projection.
create table public.network_live_audience(session_id uuid not null references public.network_live_sessions(id) on delete cascade,viewer_m_uid uuid not null references public.m_people(id) on delete cascade,
 first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),primary key(session_id,viewer_m_uid));
create index network_live_audience_session_seen_idx on public.network_live_audience(session_id,last_seen_at desc);create index network_live_audience_viewer_idx on public.network_live_audience(viewer_m_uid,last_seen_at desc);
alter table public.network_live_audience enable row level security;revoke all on public.network_live_audience from public,anon,authenticated;grant all on public.network_live_audience to service_role;

-- Stage roles stay deliberately tiny. Host is implicit in the session and
-- audience is not a role. Realtime transport can later activate these seats.
create table public.network_live_stage_members(session_id uuid not null references public.network_live_sessions(id) on delete cascade,m_uid uuid not null references public.m_people(id) on delete cascade,
 stage_role text not null check(stage_role in('cohost','guest')),state text not null default 'requested' check(state in('requested','invited','accepted','left','removed')),
 requested_at timestamptz not null default now(),joined_at timestamptz,left_at timestamptz,primary key(session_id,m_uid));
create index network_live_stage_state_idx on public.network_live_stage_members(session_id,state,requested_at);
alter table public.network_live_stage_members enable row level security;revoke all on public.network_live_stage_members from public,anon,authenticated;grant all on public.network_live_stage_members to service_role;

alter table public.action_mission_assignments add column source_live_session_id uuid references public.network_live_sessions(id) on delete set null;
create index action_assignments_source_live_idx on public.action_mission_assignments(source_live_session_id,status) where source_live_session_id is not null;

-- Accepted fellowship alone is no longer a broadcasting entitlement.
create or replace function public.live_host_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_muid uuid:=public.current_m_uid();v_categories text[];v_seats smallint;v_support boolean;
begin
 if v_user is null or v_muid is null then return jsonb_build_object('can_host',false,'basis','none','allowed_categories','[]'::jsonb,'max_stage_seats',0,'support_allowed',false);end if;
 if(select public.eu_is_admin())then return jsonb_build_object('can_host',true,'basis','owner','allowed_categories',to_jsonb(array['music','build','learn','field','forum']::text[]),'max_stage_seats',8,'support_allowed',false);end if;
 select array_agg(distinct cat order by cat),max(g.max_stage_seats)::smallint,coalesce(bool_or(g.support_allowed),false) into v_categories,v_seats,v_support
 from public.network_live_host_grants g cross join lateral unnest(g.allowed_categories)cat
 where g.m_uid=v_muid and g.status='active' and g.starts_at<=now() and(g.expires_at is null or g.expires_at>now())
  and(g.basis<>'cohort' or exists(select 1 from public.action_cohort_members cm join public.action_cohorts c on c.id=cm.cohort_id where cm.m_uid=v_muid and cm.cohort_id=g.cohort_id and c.status='active'))
  and(g.basis<>'client_project' or exists(select 1 from public.m_auth_user_links l join public.org_members om on om.profile_id=l.auth_user_id where l.m_uid=v_muid and om.org_id=g.org_id));
 return jsonb_build_object('can_host',coalesce(cardinality(v_categories),0)>0,'basis',case when coalesce(cardinality(v_categories),0)>0 then 'grant' else 'none'end,
  'allowed_categories',to_jsonb(coalesce(v_categories,'{}'::text[])),'max_stage_seats',coalesce(v_seats,0),'support_allowed',coalesce(v_support,false));
end$$;
revoke all on function public.live_host_context() from public,anon;grant execute on function public.live_host_context() to authenticated;
create or replace function public.live_can_host() returns boolean language sql stable security definer set search_path='' as $$select coalesce((public.live_host_context()->>'can_host')::boolean,false)$$;
revoke all on function public.live_can_host() from public,anon;grant execute on function public.live_can_host() to authenticated;

-- Discovery is evidence-based and deliberately excludes support/credits.
-- Mission rooms score verified-action conversion; Home rooms score 60s
-- engaged-viewer retention. Wilson's 95% lower bound penalizes tiny samples.
create or replace function private.live_wilson_lower_bound(p_success bigint,p_total bigint,p_z numeric default 1.96) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;s numeric;phat numeric;z2 numeric;denom numeric;center numeric;margin numeric;
begin
 n:=greatest(coalesce(p_total,0),0);if n=0 then return 0;end if;
 s:=least(greatest(coalesce(p_success,0),0),p_total);phat:=s/n;z2:=power(p_z,2);denom:=1+z2/n;center:=phat+z2/(2*n);
 margin:=p_z*sqrt((phat*(1-phat)+z2/(4*n))/n);
 return greatest(0::numeric,least(1::numeric,(center-margin)/denom));
end$$;
revoke all on function private.live_wilson_lower_bound(bigint,bigint,numeric) from public,anon,authenticated;grant execute on function private.live_wilson_lower_bound(bigint,bigint,numeric) to service_role;

create or replace function public.network_live_session_metrics(p_session_ids uuid[])
returns table(session_id uuid,unique_viewers bigint,engaged_viewers bigint,joined bigint,submitted bigint,verified bigint,score numeric,score_basis text)
language sql stable security invoker set search_path='' as $$
 with sessions as(select s.id,s.room_kind from public.network_live_sessions s where s.id=any(coalesce(p_session_ids[1:50],'{}'::uuid[]))),
 audience as(select a.session_id,count(*)::bigint unique_viewers,count(*)filter(where a.last_seen_at-a.first_seen_at>=interval '60 seconds')::bigint engaged_viewers from public.network_live_audience a where a.session_id=any(coalesce(p_session_ids[1:50],'{}'::uuid[]))group by a.session_id),
 conversions as(select a.source_live_session_id session_id,count(*)::bigint joined,count(*)filter(where a.submitted_at is not null)::bigint submitted,count(*)filter(where a.status='verified')::bigint verified from public.action_mission_assignments a where a.source_live_session_id=any(coalesce(p_session_ids[1:50],'{}'::uuid[]))group by a.source_live_session_id)
 select s.id,coalesce(v.unique_viewers,0),coalesce(v.engaged_viewers,0),coalesce(c.joined,0),coalesce(c.submitted,0),coalesce(c.verified,0),
  case when s.room_kind='mission' then private.live_wilson_lower_bound(coalesce(c.verified,0),coalesce(v.unique_viewers,0),1.96) else private.live_wilson_lower_bound(coalesce(v.engaged_viewers,0),coalesce(v.unique_viewers,0),1.96)end,
  case when s.room_kind='mission' then 'verified_actions_per_viewer' else 'engaged_viewers_60s'end
 from sessions s left join audience v on v.session_id=s.id left join conversions c on c.session_id=s.id
$$;
revoke all on function public.network_live_session_metrics(uuid[]) from public,anon,authenticated;grant execute on function public.network_live_session_metrics(uuid[]) to service_role;

create or replace function public.join_action_mission_live(p_mission_id uuid,p_live_session_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_result jsonb;v_assignment_id uuid;v_prior_status text;v_prior_source uuid;v_attributed boolean:=false;
begin
 if v_user is null then raise exception 'sign in to take a mission';end if;
 if not exists(select 1 from public.network_live_sessions s where s.id=p_live_session_id and s.status='live' and s.last_seen_at>now()-interval '2 minutes' and s.room_kind='mission' and s.action_mission_id=p_mission_id)then raise exception 'that live room is not offering this mission';end if;
 select a.status,a.source_live_session_id into v_prior_status,v_prior_source from public.action_mission_assignments a where a.mission_id=p_mission_id and a.user_id=v_user;
 v_result:=public.join_action_mission(p_mission_id);v_assignment_id:=(v_result->>'assignment_id')::uuid;
 if v_prior_status is null or(v_prior_status='withdrawn' and v_prior_source is null)then update public.action_mission_assignments set source_live_session_id=p_live_session_id where id=v_assignment_id and user_id=v_user;v_attributed:=true;end if;
 return v_result||jsonb_build_object('source_live_session_id',case when v_attributed then p_live_session_id else v_prior_source end);
end$$;
revoke all on function public.join_action_mission_live(uuid,uuid) from public,anon;grant execute on function public.join_action_mission_live(uuid,uuid) to authenticated,service_role;

-- Preserve creator/content attribution and add the live-session dimension to
-- the same server-minted verified completion event.
create or replace function public.action_record_verified_mission() returns trigger language plpgsql security definer set search_path='' as $$
declare v_campaign text;
begin
 if new.status<>'verified' or old.status='verified' then return new;end if;
 select m.campaign_id into v_campaign from public.action_missions m where m.id=new.mission_id;if v_campaign is null then return new;end if;
 insert into public.action_events(campaign_id,user_id,kind,detail,at)values(v_campaign,new.user_id,'mission',jsonb_strip_nulls(jsonb_build_object(
  'assignment_id',new.id,'mission_id',new.mission_id,'source_content_id',new.source_content_id,'source_channel',new.source_channel,'source_live_session_id',new.source_live_session_id)),coalesce(new.verified_at,now()))on conflict do nothing;
 return new;
end$$;
