-- Shared music uses existing identity, creator, rights, storage and commerce.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
create temporary table eu_platform_before(name text primary key, value jsonb not null) on commit drop;
create or replace function pg_temp.eu_platform_legacy_fingerprint() returns jsonb
language plpgsql set search_path = '' as $$
declare r record; v jsonb; result jsonb := '{}'::jsonb; begin
 for r in select n.nspname, c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and ((n.nspname='auth' and c.relname in ('users','identities')) or
   (n.nspname='public' and (c.relname like 'action\_%' escape '\' or c.relname like 'music\_%' escape '\'
    or c.relname in ('m_people','m_auth_user_links','platform_profiles','platform_user_apps','platform_apps','platform_oauth_clients','creator_tracks','tenants','tenant_domains'))))
 loop
  execute pg_catalog.format('select jsonb_build_object(''count'',count(*),''checksum'',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),''''))) from %I.%I t',r.nspname,r.relname) into v;
  result:=result||jsonb_build_object(r.nspname||'.'||r.relname,v);
 end loop;
 select jsonb_build_object('functions',md5(coalesce(string_agg(pg_catalog.pg_get_functiondef(p.oid),'' order by p.oid),''))) into v
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prokind='f' and p.proname not like 'eu_platform\_%' escape '\';
 result:=result||v;
 select jsonb_build_object('policies',md5(coalesce(string_agg(to_jsonb(p)::text,'' order by schemaname,tablename,policyname),''))) into v
 from pg_catalog.pg_policies p where p.schemaname in ('public','private','storage') and p.tablename not like 'eu_platform\_%' escape '\';
 return result||v;
end $$;
insert into eu_platform_before values('legacy',pg_temp.eu_platform_legacy_fingerprint());


alter table public.eu_platform_module_bindings drop constraint eu_platform_module_bindings_adapter_check;
alter table public.eu_platform_module_bindings add constraint eu_platform_module_bindings_adapter_check
 check(adapter in ('shared_identity_v1','mccluster_actions_v1','shared_music_catalog_v1','pending_tenant_actions_v2','pending_creator_music_v2','shared_creator_music_v1'));

create function private.eu_platform_music_root() returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid; begin
 if auth.uid() is null then raise exception 'platform_account_required' using errcode='42501'; end if;
 select org_id into result from public.eu_platform_registry where platform_key='equity-uprise' and enabled;
 if result is null then raise exception 'platform_unavailable' using errcode='42501'; end if;
 return result;
end $$;
revoke all on function private.eu_platform_music_root() from public,anon;
grant execute on function private.eu_platform_music_root() to authenticated;

create function private.eu_platform_music_join(p_handle text,p_artist_name text,p_accept_terms boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); person uuid; root_id uuid; tenant uuid; profile_name text; result jsonb; linked_count integer; begin
 root_id:=private.eu_platform_music_root();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('eu_platform_music:'||actor::text,0));
 select count(*),min(m_uid::text)::uuid into linked_count,person from public.m_auth_user_links where auth_user_id=actor and is_primary;
 if linked_count<>1 or person is null then raise exception 'primary_identity_required' using errcode='42501'; end if;
 if (select count(*) from public.m_auth_user_links where m_uid=person and is_primary)<>1 then raise exception 'identity_review_required' using errcode='42501'; end if;
 result:=public.music_creator_onboarding_core(person,p_handle,p_artist_name,p_accept_terms,true);
 if coalesce((result->>'creator')::boolean,false) is not true then return result; end if;
 select artist_name into profile_name from public.music_creator_profiles where m_uid=person and status='active';
 if profile_name is null then raise exception 'active_creator_required' using errcode='42501'; end if;
 select tenant_org_id into tenant from private.eu_platform_artist_bindings where m_uid=person;
 if tenant is null then
  if exists(select 1 from public.orgs where slug='artist-'||person::text) then raise exception 'artist_space_requires_review'; end if;
  insert into public.orgs(slug,name,kind,settings) values('artist-'||person::text,profile_name,'business','{"platform":"equity-uprise","space_kind":"artist"}') returning id into tenant;
  insert into public.eu_platform_tenants(org_id,platform_org_id,tenant_kind,display_name) values(tenant,root_id,'artist',profile_name);
  insert into private.eu_platform_artist_bindings(m_uid,tenant_org_id,identity_state) values(person,tenant,'linked');
  insert into public.org_members(org_id,profile_id,role) values(tenant,actor,'owner');
  insert into public.eu_platform_module_bindings values(tenant,'identity',root_id,'shared_identity_v1',true,true);
 else
  if not exists(select 1 from public.eu_platform_tenants where org_id=tenant and platform_org_id=root_id and tenant_kind='artist' and enabled) then raise exception 'artist_space_unavailable' using errcode='42501'; end if;
  -- Existing ownership is not reassigned by signing in or typing a handle.
  if not exists(select 1 from private.eu_platform_artist_bindings b join public.org_members m on m.org_id=b.tenant_org_id where b.m_uid=person and b.identity_state='linked' and m.profile_id=actor and m.role='owner') then raise exception 'artist_space_requires_review' using errcode='42501'; end if;
 end if;
 insert into public.eu_platform_module_bindings values(tenant,'music',tenant,'shared_creator_music_v1',true,true)
 on conflict(tenant_org_id,module_key) do update set adapter=excluded.adapter,provider_org_id=excluded.provider_org_id,read_enabled=true,write_enabled=true;
 return result||jsonb_build_object('tenant_org_id',tenant,'platform_org_id',root_id);
end $$;
revoke all on function private.eu_platform_music_join(text,text,boolean) from public,anon;
grant execute on function private.eu_platform_music_join(text,text,boolean) to authenticated;
create function public.eu_platform_music_join(p_handle text default null,p_artist_name text default null,p_accept_terms boolean default false) returns jsonb
language sql security invoker set search_path='' as $$select private.eu_platform_music_join(p_handle,p_artist_name,p_accept_terms)$$;
revoke all on function public.eu_platform_music_join(text,text,boolean) from public,anon;
grant execute on function public.eu_platform_music_join(text,text,boolean) to authenticated;

create function public.eu_platform_music_space() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('tenant_org_id',t.org_id,'platform_org_id',t.platform_org_id,'m_uid',b.m_uid,'write_enabled',m.write_enabled,'adapter',m.adapter)
 from private.eu_platform_artist_bindings b join public.eu_platform_tenants t on t.org_id=b.tenant_org_id
 join public.eu_platform_module_bindings m on m.tenant_org_id=t.org_id and m.module_key='music'
 join public.eu_platform_registry p on p.org_id=t.platform_org_id
 where b.m_uid=public.current_m_uid() and b.identity_state='linked' and t.enabled and p.enabled
 and private.eu_platform_org_role(t.org_id)='owner' and m.adapter='shared_creator_music_v1';
$$;
revoke all on function public.eu_platform_music_space() from public,anon;
grant execute on function public.eu_platform_music_space() to authenticated;

-- Enable only the existing unambiguously linked owner spaces. Unclaimed stays pending.
update public.eu_platform_module_bindings m set adapter='shared_creator_music_v1',read_enabled=true,write_enabled=true
from private.eu_platform_artist_bindings b
where m.tenant_org_id=b.tenant_org_id and m.module_key='music' and m.provider_org_id=b.tenant_org_id and b.identity_state='linked'
and exists(select 1 from public.m_auth_user_links l join public.org_members o on o.org_id=b.tenant_org_id and o.profile_id=l.auth_user_id and o.role='owner' join public.music_creator_profiles c on c.m_uid=l.m_uid where l.m_uid=b.m_uid and l.is_primary and c.status='active')
and (select count(*) from public.m_auth_user_links l where l.m_uid=b.m_uid and l.is_primary)=1;

create table public.eu_platform_music_libraries(
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 platform_org_id uuid not null references public.eu_platform_registry(org_id) on delete restrict,
 revision bigint not null default 0 check(revision>=0),data jsonb not null default '{"favorites":[],"playlists":[]}',
 updated_at timestamptz not null default now(),primary key(user_id,platform_org_id),check(pg_column_size(data)<=131072)
);
create index eu_platform_music_libraries_platform_idx on public.eu_platform_music_libraries(platform_org_id);
alter table public.eu_platform_music_libraries enable row level security;
create policy eu_platform_music_library_self on public.eu_platform_music_libraries for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.eu_platform_registry p where p.org_id=platform_org_id and p.enabled));
revoke all on public.eu_platform_music_libraries from public,anon,authenticated;
grant select on public.eu_platform_music_libraries to authenticated;
grant select,insert,update,delete on public.eu_platform_music_libraries to service_role;

create function public.eu_platform_music_library_get() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare root_id uuid:=private.eu_platform_music_root(); begin
 return coalesce((select jsonb_build_object('revision',revision,'data',data) from public.eu_platform_music_libraries where user_id=auth.uid() and platform_org_id=root_id),'{"revision":0,"data":{"favorites":[],"playlists":[]}}'::jsonb);
end;
$$;
revoke all on function public.eu_platform_music_library_get() from public,anon;
grant execute on function public.eu_platform_music_library_get() to authenticated;

create function private.eu_platform_music_library_save(p_data jsonb,p_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare root_id uuid:=private.eu_platform_music_root(); actor uuid:=auth.uid(); current_rev bigint; item jsonb; tracks jsonb; seen text[]:='{}'; begin
 if p_data is null or pg_column_size(p_data)>131072 or jsonb_typeof(p_data)<>'object' or p_revision is null or p_revision<0 then raise exception 'invalid_music_library'; end if;
 if (select count(*) from jsonb_object_keys(p_data))<>2 or jsonb_typeof(p_data->'favorites') is distinct from 'array' or jsonb_typeof(p_data->'playlists') is distinct from 'array' then raise exception 'invalid_music_library'; end if;
 if jsonb_array_length(p_data->'favorites')>500 or jsonb_array_length(p_data->'playlists')>50 then raise exception 'music_library_limit'; end if;
 tracks:=p_data->'favorites';
 for item in select value from jsonb_array_elements(p_data->'playlists') loop
  if jsonb_typeof(item)<>'object' or (item->>'id') is null or (item->>'id')!~'^[a-zA-Z0-9_-]{8,64}$' or item->>'id'=any(seen) or length(btrim(coalesce(item->>'name','')))<1 or length(item->>'name')>80 or jsonb_typeof(item->'tracks') is distinct from 'array' then raise exception 'invalid_playlist'; end if;
  if (select count(*) from jsonb_object_keys(item))<>3 or jsonb_array_length(item->'tracks')>200 then raise exception 'invalid_playlist'; end if;
  seen:=array_append(seen,item->>'id');tracks:=tracks||(item->'tracks');
 end loop;
 for item in select value from jsonb_array_elements(tracks) loop
  if jsonb_typeof(item)<>'string' or length(item#>>'{}')<1 or length(item#>>'{}')>240 or (item#>>'{}')~'[[:cntrl:]]' then raise exception 'invalid_track_key'; end if;
 end loop;
 insert into public.eu_platform_music_libraries(user_id,platform_org_id) values(actor,root_id) on conflict do nothing;
 select revision into current_rev from public.eu_platform_music_libraries where user_id=actor and platform_org_id=root_id for update;
 if current_rev<>p_revision then raise exception 'music_library_changed_reload' using errcode='40001'; end if;
 update public.eu_platform_music_libraries set data=p_data,revision=revision+1,updated_at=now() where user_id=actor and platform_org_id=root_id;
 return jsonb_build_object('revision',current_rev+1,'data',p_data);
end $$;
revoke all on function private.eu_platform_music_library_save(jsonb,bigint) from public,anon;
grant execute on function private.eu_platform_music_library_save(jsonb,bigint) to authenticated;
create function public.eu_platform_music_library_save(p_data jsonb,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$select private.eu_platform_music_library_save(p_data,p_revision)$$;
revoke all on function public.eu_platform_music_library_save(jsonb,bigint) from public,anon;
grant execute on function public.eu_platform_music_library_save(jsonb,bigint) to authenticated;
do $$ declare before_state jsonb; after_state jsonb; begin
 select value into before_state from eu_platform_before where name='legacy';
 after_state:=pg_temp.eu_platform_legacy_fingerprint();
 if before_state<>after_state then raise exception 'Music compatibility invariant failed: legacy data or authorization changed'; end if;
 insert into private.eu_platform_release_checks(release_key,before_state,after_state) values('music-workspace-v1',before_state,after_state);
end $$;
notify pgrst,'reload schema';
commit;

