-- PENDING ONLY. No owner, grant or production project is seeded.
-- Requires managed_project_identity_v1 and the existing identity/org authority.
begin;
create table public.canonical_artist_bindings (
 artist_id text primary key check(artist_id in ('https://matthew.mccluster.org/#matthew-mccluster','https://matthew.mccluster.org/catalogue.html#artist-equity-uprise')),
 owner_user_id uuid not null references auth.users(id),
 m_uid uuid not null references public.m_people(id),
 granted_by uuid not null references auth.users(id),
 provenance text not null check(length(provenance) between 10 and 500),
 granted_at timestamptz not null default now(),
 project_id uuid references public.managed_projects(id),
 bound_at timestamptz,
 revoked_at timestamptz,
 check((project_id is null)=(bound_at is null))
);
create table public.canonical_artist_binding_events (
 id bigint generated always as identity primary key,
 artist_id text not null references public.canonical_artist_bindings(artist_id),
 actor_user_id uuid not null references auth.users(id),
 action text not null check(action in ('grant','bind','revoke')),
 provenance text not null check(length(provenance) between 10 and 500),
 created_at timestamptz not null default now()
);
alter table public.canonical_artist_bindings enable row level security;
alter table public.canonical_artist_bindings force row level security;
alter table public.canonical_artist_binding_events enable row level security;
alter table public.canonical_artist_binding_events force row level security;
revoke all on public.canonical_artist_bindings,public.canonical_artist_binding_events from public,anon,authenticated,service_role;
grant select,insert,update on public.canonical_artist_bindings to service_role;
grant select,insert on public.canonical_artist_binding_events to service_role;
grant usage on sequence public.canonical_artist_binding_events_id_seq to service_role;
create function public.guard_canonical_artist_binding_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.artist_id,new.owner_user_id,new.m_uid,new.granted_by,new.provenance,new.granted_at) is distinct from
    (old.artist_id,old.owner_user_id,old.m_uid,old.granted_by,old.provenance,old.granted_at)
 or (old.project_id is not null and (new.project_id,new.bound_at) is distinct from (old.project_id,old.bound_at))
 or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
  raise exception 'Canonical grant and accepted binding are immutable';
 end if;
 return new;
end $$;
revoke all on function public.guard_canonical_artist_binding_v1() from public,anon,authenticated;
create trigger canonical_artist_identity before update on public.canonical_artist_bindings
 for each row execute function public.guard_canonical_artist_binding_v1();
create function public.canonical_artist_binding_v1(p_action text,p_artist text,p_actor uuid,p_owner uuid default null,p_project uuid default null,p_provenance text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare b public.canonical_artist_bindings; actor_m uuid; owner_m uuid;
begin
 select m_uid into actor_m from public.m_auth_user_links where auth_user_id=p_actor and is_primary;
 if actor_m is null or not exists(select 1 from public.m_people where id=actor_m and status='active') then raise exception 'active account required' using errcode='42501';end if;
 if p_action in ('grant','revoke') then
  if not exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id where o.slug='mccluster' and m.profile_id=p_actor and m.role='owner') then raise exception 'house owner required' using errcode='42501';end if;
  if p_provenance is null or length(p_provenance) not between 10 and 500 then raise exception 'review provenance required' using errcode='22023';end if;
 end if;
 if p_action='grant' then
  select m_uid into owner_m from public.m_auth_user_links where auth_user_id=p_owner and is_primary;
  if owner_m is null or not exists(select 1 from public.m_people where id=owner_m and status='active') then raise exception 'grantee unavailable' using errcode='42501';end if;
  insert into public.canonical_artist_bindings(artist_id,owner_user_id,m_uid,granted_by,provenance) values(p_artist,p_owner,owner_m,p_actor,p_provenance);
 else
  select * into b from public.canonical_artist_bindings where artist_id=p_artist for update;
  if not found then raise exception 'grant unavailable' using errcode='42501';end if;
  if p_action='revoke' then
   if b.revoked_at is not null then return;end if;
   update public.canonical_artist_bindings set revoked_at=now() where artist_id=p_artist;
  elsif p_action='bind' then
   if b.revoked_at is not null or b.owner_user_id<>p_actor or b.m_uid<>actor_m then raise exception 'grant unavailable' using errcode='42501';end if;
   perform 1 from public.managed_projects where id=p_project and owner_user_id=p_actor and m_uid=actor_m and removed_at is null for share;
   if not found then raise exception 'owned project required' using errcode='42501';end if;
   if b.project_id=p_project then return;end if;
   if b.project_id is not null then raise exception 'binding is immutable' using errcode='40001';end if;
   update public.canonical_artist_bindings set project_id=p_project,bound_at=now() where artist_id=p_artist;
   p_provenance:='Owner accepted immutable project binding';
  else raise exception 'unsupported action' using errcode='22023';end if;
 end if;
 insert into public.canonical_artist_binding_events(artist_id,actor_user_id,action,provenance) values(p_artist,p_actor,p_action,p_provenance);
exception when unique_violation then raise exception 'grant already exists; review existing authority' using errcode='40001';
end $$;
revoke all on function public.canonical_artist_binding_v1(text,text,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.canonical_artist_binding_v1(text,text,uuid,uuid,uuid,text) to service_role;
commit;
