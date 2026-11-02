-- PENDING ONLY. No production application authorized.
-- Requires site_content/history + their existing RPCs, member_fronts_v1,
-- managed_projects_v1 and managed_project_identity_v1; existing account/org schema.
-- Additive v2 APIs. First v2 mutation protects that object against legacy blind writes.
-- Existing moderation takedowns remain available and advance the revision.
begin;
set local lock_timeout = '5s';
lock table public.site_content, public.member_fronts, public.managed_projects in share row exclusive mode;
create schema if not exists private;
create table if not exists private.editor_heads (
 kind text not null check(kind in ('site','project','front')),
 key text not null, revision bigint not null check(revision>=0),
 protected boolean not null default false, primary key(kind,key)
);
-- Only an owner withdrawal through this contract can be recovered by that owner.
-- Existing moderation/legacy removals never acquire this provenance marker.
alter table private.editor_heads add column if not exists owner_withdrawn boolean not null default false;
create table if not exists private.editor_versions (
 kind text not null, key text not null, revision bigint not null,
 snapshot jsonb, actor uuid, operation text not null,
 restored_from bigint, at timestamptz not null default clock_timestamp(),
 primary key(kind,key,revision), foreign key(kind,key) references private.editor_heads(kind,key)
);
alter table private.editor_heads enable row level security;
alter table private.editor_heads force row level security;
alter table private.editor_versions enable row level security;
alter table private.editor_versions force row level security;
revoke all on private.editor_heads,private.editor_versions from public,anon,authenticated,service_role;

-- One short transaction lock across these three editor stores. Statement-level
-- triggers acquire it BEFORE row locks, including legacy writes and bulk updates.
-- This intentionally favors correctness over editor write throughput; no network
-- calls occur while held. Never replace with after-row lock acquisition.
create or replace function private.editor_lock_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform pg_catalog.pg_advisory_xact_lock(182704,2); return null; end $$;
create or replace function private.editor_immutable_v1() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'editor_history_immutable' using errcode='42501'; end $$;
drop trigger if exists editor_history_immutable on private.editor_versions;
create trigger editor_history_immutable before update or delete on private.editor_versions
 for each row execute function private.editor_immutable_v1();

create or replace function private.editor_capture_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; ident text; before_doc jsonb; after_doc jsonb;
 h private.editor_heads; ctx jsonb; is_v2 boolean; moderation boolean;
begin
 before_doc := case when tg_op='INSERT' then null else to_jsonb(old) end;
 after_doc := case when tg_op='DELETE' then null else to_jsonb(new) end;
 k := case tg_table_name when 'site_content' then 'site' when 'managed_projects' then 'project' else 'front' end;
 ident := case k when 'site' then jsonb_build_array(coalesce(after_doc->>'page',before_doc->>'page'),coalesce(after_doc->>'slot',before_doc->>'slot'))::text
   when 'project' then coalesce(after_doc->>'id',before_doc->>'id') else coalesce(after_doc->>'m_uid',before_doc->>'m_uid') end;
 -- No moving history between identities through direct legacy mutations.
 if tg_op='UPDATE' and ((k='site' and (before_doc->>'page',before_doc->>'slot') is distinct from (after_doc->>'page',after_doc->>'slot'))
   or (k='front' and (before_doc->>'m_uid',before_doc->>'auth_user_id') is distinct from (after_doc->>'m_uid',after_doc->>'auth_user_id'))) then
   raise exception 'editor_identity_immutable' using errcode='42501';
 end if;
 insert into private.editor_heads(kind,key,revision,protected) values(k,ident,0,false) on conflict do nothing;
 insert into private.editor_versions(kind,key,revision,snapshot,operation)
 values(k,ident,0,before_doc,'baseline') on conflict do nothing;
 select * into h from private.editor_heads where kind=k and key=ident;
 ctx := nullif(current_setting('mccluster.editor_context',true),'')::jsonb;
 is_v2 := coalesce(ctx->>'kind'=k and ctx->>'key'=ident,false);
 -- Preserve unconditional safety takedowns, but never permit resurrection or a
 -- changed draft/owner to ride along with a legacy takedown.
 moderation := k='front' and tg_op='UPDATE' and before_doc->>'removed_at' is null
   and after_doc->>'removed_at' is not null and after_doc->>'published' is null
   and after_doc->>'published_at' is null
   and (before_doc - array['removed_at','removed_reason','published','published_at','updated_at'])
       = (after_doc - array['removed_at','removed_reason','published','published_at','updated_at']);
 if (h.protected and not is_v2 and not coalesce(moderation,false))
    or (is_v2 and (ctx->>'expected')::bigint is distinct from h.revision) then
   raise exception 'editor_revision_conflict' using errcode='PT409';
 end if;
 update private.editor_heads set revision=h.revision+1,protected=h.protected or is_v2 where kind=k and key=ident;
 insert into private.editor_versions(kind,key,revision,snapshot,actor,operation,restored_from)
 values(k,ident,h.revision+1,after_doc,
   case when is_v2 and k<>'site' then (ctx->>'actor')::uuid else auth.uid() end,
   case when is_v2 then ctx->>'operation' when moderation then 'legacy_takedown' else 'legacy_'||lower(tg_op) end,
   case when is_v2 then (ctx->>'restore')::bigint end);
 return coalesce(new,old);
end $$;

-- Baseline existing data without rewriting public content or historical audit.
insert into private.editor_heads(kind,key,revision)
 select 'site',jsonb_build_array(page,slot)::text,0 from public.site_content
 union all select 'project',id::text,0 from public.managed_projects
 union all select 'front',m_uid::text,0 from public.member_fronts
 on conflict do nothing;
insert into private.editor_versions(kind,key,revision,snapshot,operation)
 select 'site',jsonb_build_array(page,slot)::text,0,to_jsonb(t),'baseline' from public.site_content t
 union all select 'project',id::text,0,to_jsonb(t),'baseline' from public.managed_projects t
 union all select 'front',m_uid::text,0,to_jsonb(t),'baseline' from public.member_fronts t
 on conflict do nothing;
do $$ declare t text; begin
 foreach t in array array['site_content','managed_projects','member_fronts'] loop
 execute format('drop trigger if exists editor_lock_v1 on public.%I',t);
 execute format('create trigger editor_lock_v1 before insert or update or delete on public.%I for each statement execute function private.editor_lock_v1()',t);
 execute format('drop trigger if exists editor_capture_v1 on public.%I',t);
 execute format('create trigger editor_capture_v1 after insert or update or delete on public.%I for each row execute function private.editor_capture_v1()',t);
 execute format('drop trigger if exists editor_no_truncate_v1 on public.%I',t);
 execute format('create trigger editor_no_truncate_v1 before truncate on public.%I for each statement execute function private.editor_immutable_v1()',t);
 end loop;
end $$;

create or replace function private.editor_apply_v2(
 p_actor uuid,p_kind text,p_key text,p_action text,p_expected bigint,p_data jsonb,p_restore bigint
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare ident text; doc jsonb; prior jsonb; h private.editor_heads; mid uuid; handle text;
 visibility text; config jsonb; v_page text; v_slot text; previous_context text; hist jsonb;
begin
 if p_actor is null or p_kind not in ('site','project','front') or p_kind is null
   or p_action not in ('read','history','save','publish','restore','unpublish','reset','takedown','withdraw','recover') or p_action is null then
   raise exception 'editor_invalid_request' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(182704,2);
 if p_kind='site' then
   if p_actor is distinct from auth.uid() or not coalesce(public.mnet_is_admin(),false) then
     raise exception 'editor_forbidden' using errcode='42501'; end if;
   v_page := lower(trim((p_key::jsonb)->>0)); v_slot := trim((p_key::jsonb)->>1);
   if v_page is null or v_page !~ '^[a-z0-9._/-]{1,120}$' or v_slot is null or length(v_slot) not between 1 and 200 then
     raise exception 'editor_invalid_key' using errcode='22023'; end if;
   ident := jsonb_build_array(v_page,v_slot)::text;
   select to_jsonb(t) into doc from public.site_content t where t.page=v_page and t.slot=v_slot;
 else
   select l.m_uid into mid from public.m_auth_user_links l join public.m_people m on m.id=l.m_uid
     where l.auth_user_id=p_actor and l.is_primary and m.status='active' for share of l,m;
   if mid is null then raise exception 'editor_forbidden' using errcode='42501'; end if;
   if p_kind='project' then
     select to_jsonb(t) into doc from public.managed_projects t where slug=p_key and owner_user_id=p_actor and m_uid=mid;
     if doc is null then raise exception 'editor_not_found' using errcode='P0002'; end if;
     ident:=doc->>'id';
     if coalesce(doc->>'presentation','front')<>'front' then raise exception 'use_tile_revision_api' using errcode='22023'; end if;
   else
     if p_key='me' then
       select to_jsonb(t) into doc from public.member_fronts t where m_uid=mid and auth_user_id=p_actor;
       if doc is null and exists(select 1 from public.member_fronts where m_uid=mid) then
         raise exception 'editor_forbidden' using errcode='42501';end if;
       ident:=mid::text;
       select lower(mccluster_id) into handle from public.platform_profiles where user_id=p_actor for share;
       if handle is null or handle !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then raise exception 'handle_required' using errcode='22023';end if;
     else
       -- A named target is moderation only, using the existing house-org owner gate.
       if p_action not in ('read','history','takedown') or not exists(
         select 1 from public.org_members om join public.orgs o on o.id=om.org_id
          where o.slug='mccluster' and om.profile_id=p_actor and om.role='owner') then
          raise exception 'editor_forbidden' using errcode='42501'; end if;
       select to_jsonb(t) into doc from public.member_fronts t where t.handle=p_key;
       if doc is null then raise exception 'editor_not_found' using errcode='P0002'; end if;
       ident:=doc->>'m_uid';
     end if;
   end if;
 end if;
 select * into h from private.editor_heads where kind=p_kind and key=ident;
 if p_action not in ('read','history') then
   if p_expected is null or p_expected<0 or p_expected<>coalesce(h.revision,0) then
     raise exception 'editor_revision_conflict' using errcode='PT409';end if;
   if p_action='restore' then
     select snapshot into prior from private.editor_versions where kind=p_kind and key=ident and revision=p_restore;
     if not found then raise exception 'editor_revision_not_found' using errcode='P0002';end if;
   end if;
   previous_context:=current_setting('mccluster.editor_context',true);
   perform set_config('mccluster.editor_context',jsonb_build_object('kind',p_kind,'key',ident,'expected',p_expected,'actor',p_actor,'operation',p_action,'restore',p_restore)::text,true);
   if p_kind='site' then
     if p_action in ('publish','unpublish','takedown','withdraw','recover') then raise exception 'editor_invalid_action' using errcode='22023';end if;
     if p_action='reset' or (p_action='restore' and prior is null) then
       if doc is null then raise exception 'editor_no_change' using errcode='22023';end if;
       perform public.site_content_revert(v_page,v_slot);
     else
       if p_action='restore' then p_data:=prior;end if;
       if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_data->'value') is distinct from 'string' then
         raise exception 'editor_invalid_content' using errcode='22023';end if;
       if p_action='restore' then
         insert into public.site_content(page,slot,value,kind,original,fragile,updated_by,updated_via)
         values(v_page,v_slot,p_data->>'value',p_data->>'kind',p_data->>'original',(p_data->>'fragile')::boolean,p_actor,'editor-v2-restore')
         on conflict(page,slot) do update set value=excluded.value,kind=excluded.kind,original=excluded.original,
           fragile=excluded.fragile,updated_by=excluded.updated_by,updated_via=excluded.updated_via,updated_at=clock_timestamp();
       else
         perform public.site_content_set(v_page,v_slot,p_data->>'value',coalesce(p_data->>'kind','text'),coalesce(p_data->>'original',''),coalesce((p_data->>'fragile')::boolean,false),'editor-v2');
       end if;
     end if;
   else
     if p_action='reset' or (p_action='takedown' and (p_kind<>'front' or p_key='me')) then raise exception 'editor_invalid_action' using errcode='22023';end if;
     if p_action in ('withdraw','recover') and p_kind<>'project' then raise exception 'editor_invalid_action' using errcode='22023';end if;
     if p_action='recover' and (not coalesce(h.owner_withdrawn,false) or doc->>'removed_at' is null) then raise exception 'editor_not_owner_withdrawn' using errcode='42501';end if;
     if doc->>'removed_at' is not null and p_action not in ('unpublish','takedown','recover') then raise exception 'editor_removed' using errcode='42501';end if;
     config:=case when p_action='restore' then prior->'draft' else p_data end;
     if p_action in ('save','publish','restore') and (jsonb_typeof(config) is distinct from 'object' or pg_column_size(config)>65536) then
       raise exception 'editor_invalid_config' using errcode='22023';end if;
     if p_action='publish' then
       select t.visibility into visibility from public.network_profiles t where m_uid=mid for share;
       if visibility is distinct from 'public' then raise exception 'editor_private_profile' using errcode='42501';end if;
     end if;
     if p_kind='project' then
       if doc->>'registry_key' is not null and config->>'layout'='offers' then raise exception 'protected_presentation' using errcode='42501';end if;
       update public.managed_projects set
         draft=case when p_action in ('save','publish','restore') then config else draft end,
         published=case when p_action='publish' then config when p_action in ('unpublish','withdraw','recover') then null else published end,
         published_at=case when p_action='publish' then clock_timestamp() when p_action in ('unpublish','withdraw','recover') then null else published_at end,
         removed_at=case when p_action='withdraw' then clock_timestamp() when p_action='recover' then null else removed_at end,
         updated_at=clock_timestamp() where id=(doc->>'id')::uuid;
       if p_action in ('withdraw','recover') then
         update private.editor_heads set owner_withdrawn=(p_action='withdraw') where kind=p_kind and key=ident;
       end if;
     else
       if doc is null then
         if p_action not in ('save','publish') then raise exception 'editor_not_found' using errcode='P0002';end if;
         insert into public.member_fronts(m_uid,auth_user_id,handle,draft,published,published_at)
           values(mid,p_actor,handle,config,case when p_action='publish' then config end,case when p_action='publish' then clock_timestamp() end);
       else
         update public.member_fronts set
           draft=case when p_action in ('save','publish','restore') then config else draft end,
           published=case when p_action='publish' then config when p_action in ('unpublish','takedown') then null else published end,
           published_at=case when p_action='publish' then clock_timestamp() when p_action in ('unpublish','takedown') then null else published_at end,
           removed_at=case when p_action='takedown' then clock_timestamp() else removed_at end,
           removed_reason=case when p_action='takedown' then left(p_data->>'reason',300) else removed_reason end,
           updated_at=clock_timestamp() where m_uid=ident::uuid;
       end if;
     end if;
   end if;
   perform set_config('mccluster.editor_context',coalesce(previous_context,''),true);
   select * into h from private.editor_heads where kind=p_kind and key=ident;
   select snapshot into doc from private.editor_versions where kind=p_kind and key=ident and revision=h.revision;
 end if;
 if p_action='history' then
   select coalesce(jsonb_agg(to_jsonb(v) - array['kind','key'] order by v.revision desc),'[]'::jsonb) into hist
   from (select * from private.editor_versions where kind=p_kind and key=ident order by revision desc limit 50) v;
 end if;
 return jsonb_build_object('ok',true,'revision',coalesce(h.revision,0),'protected',coalesce(h.protected,false),'owner_withdrawn',coalesce(h.owner_withdrawn,false),'snapshot',doc,'history',hist);
end $$;

create or replace function public.site_content_v2(p_page text,p_slot text,p_action text default 'read',p_expected bigint default null,p_data jsonb default null,p_restore bigint default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.editor_apply_v2(auth.uid(),'site',jsonb_build_array(p_page,p_slot)::text,p_action,p_expected,p_data,p_restore)
$$;
create or replace function public.editor_owned_v2(p_actor uuid,p_kind text,p_key text,p_action text default 'read',p_expected bigint default null,p_data jsonb default null,p_restore bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_kind not in ('project','front') or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then
   raise exception 'editor_forbidden' using errcode='42501';end if;
 return private.editor_apply_v2(p_actor,p_kind,p_key,p_action,p_expected,p_data,p_restore);
end $$;
revoke all on function private.editor_lock_v1(),private.editor_immutable_v1(),private.editor_capture_v1(),private.editor_apply_v2(uuid,text,text,text,bigint,jsonb,bigint) from public,anon,authenticated,service_role;
revoke all on function public.site_content_v2(text,text,text,bigint,jsonb,bigint),public.editor_owned_v2(uuid,text,text,text,bigint,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function public.site_content_v2(text,text,text,bigint,jsonb,bigint) to authenticated;
grant execute on function public.editor_owned_v2(uuid,text,text,text,bigint,jsonb,bigint) to service_role;
commit;
