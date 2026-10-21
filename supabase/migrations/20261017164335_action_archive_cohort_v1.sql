-- Historical project records and claimable, organizer-attested provider pages.
-- Apply deliberately after review. No auth users, mission assignments, points,
-- payout entitlements, or global identity-verification states are manufactured.
begin;

create table if not exists public.action_archive_projects (
 slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
 public_data jsonb not null check (jsonb_typeof(public_data)='object'),
 media jsonb not null default '[]'::jsonb,
 published boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.action_archive_participants (
 project_slug text not null references public.action_archive_projects(slug) on delete cascade,
 slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
 public_data jsonb not null check (jsonb_typeof(public_data)='object'),
 owner_m_uid uuid references public.m_people(id) on delete set null,
 attestation text not null default 'organizer_attested' check (attestation='organizer_attested'),
 claimed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(project_slug,slug),
 unique(project_slug,owner_m_uid)
);
comment on table public.action_archive_participants is 'Unowned cohort directory profiles until linked to an existing M Account. Organizer participation attestation is not identity verification.';
create table if not exists public.action_archive_provider_pages (
 project_slug text not null,
 participant_slug text not null,
 title text not null check (char_length(title) between 1 and 120),
 headline text not null default '' check (char_length(headline)<=300),
 website_url text not null default '' check (website_url='' or (website_url like 'https://%' and char_length(website_url)<=2048)),
 bio text not null default '' check (char_length(bio)<=4000),
 publication_grant text not null default 'organizer_cohort' check (publication_grant='organizer_cohort'),
 published boolean not null default true,
 updated_at timestamptz not null default now(),
 primary key(project_slug,participant_slug),
 foreign key(project_slug,participant_slug) references public.action_archive_participants(project_slug,slug) on delete cascade
);
comment on table public.action_archive_provider_pages is 'Separate provider webpage content granted by the organizer for a historical cohort; account profile and webpage publication are distinct records. No paid subscription is implied.';
create table if not exists public.action_archive_works (
 project_slug text not null references public.action_archive_projects(slug) on delete cascade,
 slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,120}$'),
 status text not null default 'completed' check (status='completed'),
 published boolean not null default true,
 public_data jsonb not null check (jsonb_typeof(public_data)='object'),
 created_at timestamptz not null default now(),
 primary key(project_slug,slug)
);
comment on table public.action_archive_works is 'One historical completed mission per canonical song, with mixes retained as media assets. Never a joinable mission or a newly awarded completion.';
create table if not exists public.action_archive_events (
 project_slug text not null references public.action_archive_projects(slug) on delete cascade,
 slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,120}$'),
 status text not null default 'completed' check (status='completed'),
 published boolean not null default true,
 public_data jsonb not null check (jsonb_typeof(public_data)='object'),
 created_at timestamptz not null default now(),
 primary key(project_slug,slug)
);
create table if not exists public.action_archive_invites (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 project_slug text not null,
 participant_slug text not null,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 consumed_at timestamptz,
 consumed_by_m_uid uuid references public.m_people(id) on delete set null,
 created_at timestamptz not null default now(),
 foreign key(project_slug,participant_slug) references public.action_archive_participants(project_slug,slug) on delete cascade,
 check (expires_at>created_at)
);
create index if not exists action_archive_invites_participant_idx on public.action_archive_invites(project_slug,participant_slug);
create index if not exists action_archive_invites_consumer_idx on public.action_archive_invites(consumed_by_m_uid) where consumed_by_m_uid is not null;

alter table public.action_archive_projects enable row level security;
alter table public.action_archive_participants enable row level security;
alter table public.action_archive_provider_pages enable row level security;
alter table public.action_archive_works enable row level security;
alter table public.action_archive_events enable row level security;
alter table public.action_archive_invites enable row level security;
alter table public.action_archive_projects force row level security;
alter table public.action_archive_participants force row level security;
alter table public.action_archive_provider_pages force row level security;
alter table public.action_archive_works force row level security;
alter table public.action_archive_events force row level security;
alter table public.action_archive_invites force row level security;
revoke all on public.action_archive_projects,public.action_archive_participants,public.action_archive_provider_pages,
 public.action_archive_works,public.action_archive_events,public.action_archive_invites from public,anon,authenticated;
grant select on public.action_archive_projects,public.action_archive_provider_pages,
 public.action_archive_works,public.action_archive_events to anon,authenticated;
grant select(project_slug,slug,public_data,owner_m_uid,attestation) on public.action_archive_participants to anon,authenticated;
grant all on public.action_archive_projects,public.action_archive_participants,public.action_archive_provider_pages,
 public.action_archive_works,public.action_archive_events,public.action_archive_invites to service_role;
drop policy if exists action_archive_projects_public on public.action_archive_projects;
create policy action_archive_projects_public on public.action_archive_projects for select to anon,authenticated using(published);
drop policy if exists action_archive_participants_public on public.action_archive_participants;
create policy action_archive_participants_public on public.action_archive_participants for select to anon,authenticated
 using(exists(select 1 from public.action_archive_projects p where p.slug=project_slug and p.published));
drop policy if exists action_archive_provider_pages_public on public.action_archive_provider_pages;
create policy action_archive_provider_pages_public on public.action_archive_provider_pages for select to anon,authenticated
 using(published and exists(select 1 from public.action_archive_projects p where p.slug=project_slug and p.published));
drop policy if exists action_archive_works_public on public.action_archive_works;
create policy action_archive_works_public on public.action_archive_works for select to anon,authenticated
 using(published and exists(select 1 from public.action_archive_projects p where p.slug=project_slug and p.published));
drop policy if exists action_archive_events_public on public.action_archive_events;
create policy action_archive_events_public on public.action_archive_events for select to anon,authenticated
 using(published and exists(select 1 from public.action_archive_projects p where p.slug=project_slug and p.published));

-- Invoker read preserves RLS and explicitly checks publication for service callers too.
create or replace function public.action_archive_get(p_project_slug text)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'project',p.public_data,
  'participants',coalesce((select jsonb_agg(m.public_data || jsonb_build_object(
    'slug',m.slug,'owner_m_uid',m.owner_m_uid,
    'claim_status',case when m.owner_m_uid is null then 'unclaimed' else 'claimed' end,
    'attestation',m.attestation,
    'provider_page',(select jsonb_build_object('title',s.title,'headline',s.headline,'bio',s.bio,'website_url',s.website_url,'publication_grant',s.publication_grant)
      from public.action_archive_provider_pages s where s.project_slug=m.project_slug and s.participant_slug=m.slug and s.published)
   ) order by m.slug) from public.action_archive_participants m where m.project_slug=p.slug),'[]'::jsonb),
  'works',coalesce((select jsonb_agg(w.public_data || jsonb_build_object('status','completed') order by w.slug)
    from public.action_archive_works w where w.project_slug=p.slug and w.published),'[]'::jsonb),
  'event',(select e.public_data || jsonb_build_object('status','completed') from public.action_archive_events e where e.project_slug=p.slug and e.published order by e.slug limit 1),
  'media',p.media
 ) from public.action_archive_projects p where p.slug=p_project_slug and p.published;
$$;
revoke all on function public.action_archive_get(text) from public;
grant execute on function public.action_archive_get(text) to anon,authenticated,service_role;

create or replace function public.action_archive_payload_is_public(p_data jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare v_key text; v_value jsonb;
begin
 if jsonb_typeof(p_data)='object' then
  for v_key,v_value in select key,value from jsonb_each(p_data) loop
   if lower(v_key)=any(array['email','phone','token','token_hash','claim_token','access_token','refresh_token','contracts','private_evidence','private_note']) then return false; end if;
   if not public.action_archive_payload_is_public(v_value) then return false; end if;
  end loop;
 elsif jsonb_typeof(p_data)='array' then
  for v_value in select value from jsonb_array_elements(p_data) loop
   if not public.action_archive_payload_is_public(v_value) then return false; end if;
  end loop;
 end if;
 return true;
end $$;
revoke all on function public.action_archive_payload_is_public(jsonb) from public,anon,authenticated;
grant execute on function public.action_archive_payload_is_public(jsonb) to service_role;

-- Feed only a public-reviewed payload. Private source files, contacts, contracts,
-- invitation tokens and disputes must never be included in this public document.
create or replace function public.action_archive_seed(p_payload jsonb,p_identity_links jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 v_project text:=p_payload#>>'{project,slug}'; v_row jsonb; v_slug text;
 v_muid uuid; v_existing uuid; v_event jsonb; v_owner_name text;
begin
 if current_user not in ('service_role','postgres') then raise exception 'service role required' using errcode='42501'; end if;
 if v_project is null or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'project') is distinct from 'object'
   or jsonb_typeof(p_payload->'participants') is distinct from 'array' or jsonb_typeof(p_payload->'works') is distinct from 'array'
   or jsonb_typeof(p_identity_links) is distinct from 'object' then raise exception 'invalid archive payload'; end if;
 if not public.action_archive_payload_is_public(p_payload) then raise exception 'private fields are not allowed in the public archive'; end if;
 insert into public.action_archive_projects(slug,public_data,media,published)
 values(v_project,p_payload->'project',coalesce(p_payload->'media','[]'::jsonb),true)
 on conflict(slug) do update set public_data=excluded.public_data,media=excluded.media,updated_at=now();
 for v_row in select value from jsonb_array_elements(p_payload->'participants') loop
  v_slug:=coalesce(v_row->>'slug',v_row->>'id');
  v_muid:=nullif(p_identity_links->>v_slug,'')::uuid;
  select owner_m_uid into v_existing from public.action_archive_participants where project_slug=v_project and slug=v_slug for update;
  if v_existing is not null and v_muid is not null and v_existing<>v_muid then raise exception 'existing identity cannot be reassigned'; end if;
  -- Prevent private operational material from being added to public participant rows.
  if v_row ?| array['email','phone','token','token_hash','contracts','private_evidence'] then raise exception 'private participant fields are not allowed'; end if;
  insert into public.action_archive_participants(project_slug,slug,public_data,owner_m_uid,claimed_at)
  values(v_project,v_slug,v_row - array['owner_m_uid','claim_token'],v_muid,case when v_muid is not null then now() end)
  on conflict(project_slug,slug) do update set public_data=excluded.public_data,
   owner_m_uid=coalesce(action_archive_participants.owner_m_uid,excluded.owner_m_uid),
   claimed_at=coalesce(action_archive_participants.claimed_at,excluded.claimed_at),updated_at=now();
  v_owner_name:=coalesce(nullif(v_row->>'display_name',''),nullif(v_row->>'name',''),v_slug);
  insert into public.action_archive_provider_pages(project_slug,participant_slug,title,headline,bio)
  values(v_project,v_slug,left(v_owner_name,120),'Equity Uprise · Docket 516R',
   coalesce(v_row->>'bio','Completed the Write the Change mission with the Equity Uprise cohort.'))
  on conflict(project_slug,participant_slug) do nothing;
 end loop;
 update public.action_archive_works set published=false where project_slug=v_project;
 update public.action_archive_events set published=false where project_slug=v_project;
 for v_row in select value from jsonb_array_elements(p_payload->'works') loop
  v_slug:=coalesce(v_row->>'slug',v_row->>'id');
  insert into public.action_archive_works(project_slug,slug,public_data)
  values(v_project,v_slug,v_row || jsonb_build_object('status','completed'))
  on conflict(project_slug,slug) do update set public_data=excluded.public_data,published=true;
 end loop;
 v_event:=p_payload->'event';
 if v_event is not null and v_event<>'null'::jsonb then
  v_slug:=coalesce(v_event->>'slug',v_event->>'id');
  insert into public.action_archive_events(project_slug,slug,public_data)
  values(v_project,v_slug,v_event || jsonb_build_object('status','completed'))
  on conflict(project_slug,slug) do update set public_data=excluded.public_data,published=true;
 end if;
 return jsonb_build_object('project_slug',v_project,
  'participants',(select count(*) from public.action_archive_participants where project_slug=v_project),
  'provider_pages',(select count(*) from public.action_archive_provider_pages where project_slug=v_project),
  'completed_works',(select count(*) from public.action_archive_works where project_slug=v_project and published),
  'events',(select count(*) from public.action_archive_events where project_slug=v_project and published));
end $$;
revoke all on function public.action_archive_seed(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.action_archive_seed(jsonb,jsonb) to service_role;

-- Random tokens are generated by the trusted client/Worker, hashed before storage.
-- Issuing a replacement revokes all older unused invitations for that person.
create or replace function public.action_archive_issue_invite(p_project_slug text,p_participant_slug text,p_token_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_muid uuid;
begin
 if current_user not in ('service_role','postgres') then raise exception 'service role required' using errcode='42501'; end if;
 if p_expires_at<=now() or p_expires_at>now()+interval '30 days' then raise exception 'invitation expiry must be within 30 days'; end if;
 select owner_m_uid into v_muid from public.action_archive_participants where project_slug=p_project_slug and slug=p_participant_slug for update;
 if not found or v_muid is not null then raise exception 'participant is unavailable or already claimed'; end if;
 update public.action_archive_invites set revoked_at=now() where project_slug=p_project_slug and participant_slug=p_participant_slug and consumed_at is null and revoked_at is null;
 insert into public.action_archive_invites(token_hash,project_slug,participant_slug,expires_at)
 values(p_token_hash,p_project_slug,p_participant_slug,p_expires_at);
 return jsonb_build_object('project_slug',p_project_slug,'participant_slug',p_participant_slug,'expires_at',p_expires_at);
end $$;
revoke all on function public.action_archive_issue_invite(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.action_archive_issue_invite(text,text,text,timestamptz) to service_role;

create or replace function public.action_archive_invite_preview(p_token_hash text)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('project_slug',i.project_slug,'participant_slug',i.participant_slug,
   'display_name',m.public_data->>'display_name','project_title',p.public_data->>'title','expires_at',i.expires_at)
 from public.action_archive_invites i
 join public.action_archive_participants m on m.project_slug=i.project_slug and m.slug=i.participant_slug
 join public.action_archive_projects p on p.slug=i.project_slug and p.published
 where i.token_hash=p_token_hash and i.consumed_at is null and i.revoked_at is null and i.expires_at>now() and m.owner_m_uid is null;
$$;
revoke all on function public.action_archive_invite_preview(text) from public,anon,authenticated;
grant execute on function public.action_archive_invite_preview(text) to service_role;

-- Only the Worker may pass p_auth_user_id, after /auth/v1/user validates the bearer.
-- Existing identities are linked; no email match, auth creation or identity merge.
create or replace function public.action_archive_claim(p_token_hash text,p_auth_user_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_inv public.action_archive_invites%rowtype; v_muid uuid; v_owner uuid;
begin
 if current_user not in ('service_role','postgres') then raise exception 'service role required' using errcode='42501'; end if;
 select l.m_uid into v_muid from public.m_auth_user_links l join public.m_people p on p.id=l.m_uid and p.status='active'
 where l.auth_user_id=p_auth_user_id and l.is_primary=true;
 if v_muid is null then raise exception 'M_ACCOUNT_PROFILE_REQUIRED'; end if;
 select * into v_inv from public.action_archive_invites where token_hash=p_token_hash;
 if not found or v_inv.revoked_at is not null or v_inv.consumed_at is not null or v_inv.expires_at<=now() then raise exception 'INVITATION_UNAVAILABLE'; end if;
 select owner_m_uid into v_owner from public.action_archive_participants where project_slug=v_inv.project_slug and slug=v_inv.participant_slug for update;
 if v_owner is not null then raise exception 'PROFILE_ALREADY_CLAIMED'; end if;
 select * into v_inv from public.action_archive_invites where token_hash=p_token_hash for update;
 if not found or v_inv.revoked_at is not null or v_inv.consumed_at is not null or v_inv.expires_at<=now() then raise exception 'INVITATION_UNAVAILABLE'; end if;
 if exists(select 1 from public.action_archive_participants where project_slug=v_inv.project_slug and owner_m_uid=v_muid) then raise exception 'ACCOUNT_ALREADY_LINKED_TO_COHORT'; end if;
 update public.action_archive_participants set owner_m_uid=v_muid,claimed_at=now(),updated_at=now()
 where project_slug=v_inv.project_slug and slug=v_inv.participant_slug;
 update public.action_archive_invites set consumed_at=now(),consumed_by_m_uid=v_muid where token_hash=p_token_hash;
 update public.action_archive_invites set revoked_at=now() where project_slug=v_inv.project_slug and participant_slug=v_inv.participant_slug and token_hash<>p_token_hash and consumed_at is null and revoked_at is null;
 return jsonb_build_object('project_slug',v_inv.project_slug,'participant_slug',v_inv.participant_slug,'m_uid',v_muid);
end $$;
revoke all on function public.action_archive_claim(text,uuid) from public,anon,authenticated;
grant execute on function public.action_archive_claim(text,uuid) to service_role;

create or replace function public.action_archive_update_provider(p_project_slug text,p_participant_slug text,p_auth_user_id uuid,p_headline text,p_bio text,p_website_url text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_muid uuid; v_result jsonb;
begin
 if current_user not in ('service_role','postgres') then raise exception 'service role required' using errcode='42501'; end if;
 select l.m_uid into v_muid from public.m_auth_user_links l join public.m_people p on p.id=l.m_uid and p.status='active'
 where l.auth_user_id=p_auth_user_id and l.is_primary=true;
 if v_muid is null or not exists(select 1 from public.action_archive_participants where project_slug=p_project_slug and slug=p_participant_slug and owner_m_uid=v_muid) then raise exception 'PROVIDER_PAGE_FORBIDDEN' using errcode='42501'; end if;
 update public.action_archive_provider_pages set headline=coalesce(p_headline,''),bio=coalesce(p_bio,''),website_url=coalesce(p_website_url,''),updated_at=now()
 where project_slug=p_project_slug and participant_slug=p_participant_slug
 returning jsonb_build_object('title',title,'headline',headline,'bio',bio,'website_url',website_url,'publication_grant',publication_grant) into v_result;
 if v_result is null then raise exception 'PROVIDER_PAGE_UNAVAILABLE'; end if;
 return v_result;
end $$;
revoke all on function public.action_archive_update_provider(text,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.action_archive_update_provider(text,text,uuid,text,text,text) to service_role;

commit;
