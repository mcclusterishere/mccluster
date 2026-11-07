-- PENDING ONLY. Dedicated presentation namespace on the canonical data plane.
-- Reuses existing owner predicates; grants no data/product/tenant authority.
begin;
create schema if not exists private;
create sequence if not exists public.owner_analytics_layout_revision_seq;
create table if not exists public.owner_analytics_layouts (
 org_id uuid primary key references public.orgs(id),
 revision bigint not null unique default nextval('public.owner_analytics_layout_revision_seq'),
 layout jsonb not null, actor uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create table if not exists public.owner_analytics_layout_history (
 revision bigint primary key, org_id uuid not null references public.orgs(id),
 layout jsonb not null, actor uuid not null references auth.users(id),
 at timestamptz not null default now()
);
alter table public.owner_analytics_layouts enable row level security;
alter table public.owner_analytics_layouts force row level security;
alter table public.owner_analytics_layout_history enable row level security;
alter table public.owner_analytics_layout_history force row level security;
revoke all on public.owner_analytics_layouts,public.owner_analytics_layout_history from public,anon,authenticated,service_role;
revoke all on sequence public.owner_analytics_layout_revision_seq from public,anon,authenticated,service_role;

create or replace function private.analytics_layout_validate_v1(v jsonb)
returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare keys text[]:=array['overview','audience','content','action','intelligence','inventory']; k text; allowed text[];
begin
 if jsonb_typeof(v) is distinct from 'object' or octet_length(v::text)>2048 then
  raise exception 'Invalid layout' using errcode='22023'; end if;
 if v->'version' is distinct from '1'::jsonb or jsonb_typeof(v->'order') is distinct from 'array'
  or jsonb_typeof(v->'defaults') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(v) x where x not in ('version','order','defaults')) then
  raise exception 'Expected version, order and defaults' using errcode='22023'; end if;
 if jsonb_array_length(v->'order')<>6 or v->'order'->0 is distinct from '"overview"'::jsonb
  or (select count(distinct x) from jsonb_array_elements_text(v->'order') x)<>6
  or exists(select 1 from jsonb_array_elements_text(v->'order') x where not x=any(keys) or x is null)
  or (select count(*) from jsonb_object_keys(v->'defaults'))<>6
  or exists(select 1 from jsonb_object_keys(v->'defaults') x where not x=any(keys)) then
  raise exception 'Keep all six views exactly once with Overview first' using errcode='22023'; end if;
 foreach k in array keys loop
  allowed:=case k when 'audience' then array['audience','identity'] when 'content' then array['content','adaptive']
   when 'intelligence' then array['intelligence','cameras'] when 'inventory' then array['inventory','forensics','setup'] else array[k] end;
  if jsonb_typeof(v->'defaults'->k) is distinct from 'string' or not (v->'defaults'->>k)=any(allowed) then
   raise exception 'Default detail must belong to its view' using errcode='22023'; end if;
 end loop;
end; $$;

-- No new owner list: compose canonical predicates, then fence enabled state and
-- membership changes with locks. Both RPCs use this single namespace boundary.
create or replace function private.analytics_layout_scope_v1(p_org uuid,p_write boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare house uuid;
begin
 if auth.uid() is null or not coalesce(public.mnet_is_admin(),false)
  or not coalesce(public.mccluster_is_house_owner(),false)
  or not coalesce(public.is_org_owner(p_org),false) then
  raise exception 'Owner access required' using errcode='42501'; end if;
 if p_write then
  perform 1 from public.orgs where id=p_org and enabled is true for update;
 else
  perform 1 from public.orgs where id=p_org and enabled is true for share;
 end if;
 if not found then raise exception 'Owner access required' using errcode='42501'; end if;
 select id into house from public.orgs where slug='mccluster' and enabled is true for share;
 if house is null then raise exception 'Owner access required' using errcode='42501'; end if;
 perform 1 from public.org_members where profile_id=auth.uid() and org_id in(p_org,house) order by org_id for share;
 -- Re-evaluate after any lock wait: a concurrent revocation must not be ignored.
 if not coalesce(public.mnet_is_admin(),false) or not coalesce(public.mccluster_is_house_owner(),false)
  or not coalesce(public.is_org_owner(p_org),false) then
  raise exception 'Owner access required' using errcode='42501'; end if;
end; $$;

create or replace function public.owner_analytics_layout_read_v1(p_org_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r public.owner_analytics_layouts%rowtype; v jsonb;
begin
 perform private.analytics_layout_scope_v1(p_org_id,false);
 select * into r from public.owner_analytics_layouts where org_id=p_org_id;
 v:=coalesce(r.layout,'{"version":1,"order":["overview","audience","content","action","intelligence","inventory"],"defaults":{"overview":"overview","audience":"audience","content":"content","action":"action","intelligence":"intelligence","inventory":"inventory"}}'::jsonb);
 perform private.analytics_layout_validate_v1(v);
 return jsonb_build_object('schema','analytics-layout/v1','org_id',p_org_id,'revision',coalesce(r.revision::text,'0'),'layout',v);
end; $$;

create or replace function public.owner_analytics_layout_save_v1(p_org_id uuid,p_expected_revision text,p_layout jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r text; next_revision bigint;
begin
 perform private.analytics_layout_scope_v1(p_org_id,true);
 perform private.analytics_layout_validate_v1(p_layout);
 select revision::text into r from public.owner_analytics_layouts where org_id=p_org_id;
 if p_expected_revision is distinct from coalesce(r,'0') then
  raise exception 'Layout changed. Reload before saving.' using errcode='PT409'; end if;
 next_revision:=nextval('public.owner_analytics_layout_revision_seq');
 insert into public.owner_analytics_layouts(org_id,revision,layout,actor) values(p_org_id,next_revision,p_layout,auth.uid())
 on conflict(org_id) do update set revision=excluded.revision,layout=excluded.layout,actor=excluded.actor,updated_at=now();
 insert into public.owner_analytics_layout_history(revision,org_id,layout,actor) values(next_revision,p_org_id,p_layout,auth.uid());
 return jsonb_build_object('schema','analytics-layout/v1','org_id',p_org_id,'revision',next_revision::text,'layout',p_layout);
end; $$;
revoke all on function private.analytics_layout_validate_v1(jsonb),private.analytics_layout_scope_v1(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.owner_analytics_layout_read_v1(uuid),public.owner_analytics_layout_save_v1(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.owner_analytics_layout_read_v1(uuid),public.owner_analytics_layout_save_v1(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
