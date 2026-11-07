-- PROPOSAL ONLY: isolated replay, never applied by the editor or a Worker.
-- Registry adapter of the owner-front publication pattern: private drafts,
-- database revisions, canonical published storage, atomic history and CAS.
-- No new product authority: every published policy is configured:false.
begin;
create sequence if not exists public.owner_widget_revision_seq;
create table if not exists public.owner_widget_drafts (
 app_id uuid not null references public.platform_apps(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 revision bigint not null default nextval('public.owner_widget_revision_seq'),
 base_revision text not null, config jsonb not null,
 updated_at timestamptz not null default now(), primary key(app_id,user_id)
);
create table if not exists public.owner_widget_history (
 id bigint primary key default nextval('public.owner_widget_revision_seq'),
 app_id uuid not null, before_value jsonb, value jsonb,
 actor uuid, at timestamptz not null default now()
);
create index if not exists owner_widget_history_app_revision on public.owner_widget_history(app_id,id desc);
alter table public.owner_widget_drafts enable row level security;
alter table public.owner_widget_drafts force row level security;
alter table public.owner_widget_history enable row level security;
alter table public.owner_widget_history force row level security;
revoke all on public.owner_widget_drafts,public.owner_widget_history from public,anon,authenticated;
revoke all on sequence public.owner_widget_revision_seq from public,anon,authenticated;

create or replace function public.owner_widget_assert_owner_v1()
returns void language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if auth.uid() is null or not coalesce(public.mnet_is_admin(),false) or not exists(
  select 1 from public.org_members m join public.orgs o on o.id=m.org_id
  where m.profile_id=auth.uid() and m.role='owner' and o.slug='mccluster' and o.enabled is true
 ) then raise exception 'Enabled house owner access required' using errcode='42501'; end if;
end; $$;

create or replace function public.owner_widget_validate_v1(v jsonb, app_key text)
returns void language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare w record;
begin
 if jsonb_typeof(v) is distinct from 'object' or octet_length(v::text)>12000 then
  raise exception 'Invalid definition' using errcode='22023'; end if;
 if v->'version' is distinct from '1'::jsonb or jsonb_typeof(v->'widgets') is distinct from 'object'
 or exists(select 1 from jsonb_object_keys(v) k where k not in ('version','widgets')) then
  raise exception 'Expected version 1 and widgets' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(v->'widgets'))>16 then
  raise exception 'At most sixteen widgets' using errcode='22023'; end if;
 for w in select key,value from jsonb_each(v->'widgets') loop
  if w.key !~ '^[a-z][a-z0-9._-]{0,79}$' or w.key in ('constructor','prototype','__proto__')
   or jsonb_typeof(w.value) is distinct from 'object' then
   raise exception 'Invalid widget identifier or policy' using errcode='22023'; end if;
  if w.value->'configured' is distinct from 'false'::jsonb
   or exists(select 1 from jsonb_object_keys(w.value) k where k not in ('configured','kind','capability')) then
   raise exception 'Only unconfigured definitions are supported; plans and activation need separate review' using errcode='22023'; end if;
  if w.value ? 'kind' and (jsonb_typeof(w.value->'kind') is distinct from 'string'
   or w.value->>'kind' not in ('included','internal','subscription')) then
   raise exception 'Invalid widget kind' using errcode='22023'; end if;
  if app_key='system' and w.value ? 'kind' and w.value->>'kind'<>'internal' then
   raise exception 'System is internal infrastructure' using errcode='22023'; end if;
  if w.value ? 'capability' and (jsonb_typeof(w.value->'capability') is distinct from 'string'
   or w.value->>'capability' !~ '^[a-z][a-z0-9._-]{0,79}$') then
   raise exception 'Invalid capability identifier' using errcode='22023'; end if;
 end loop;
end; $$;

-- Captures legacy/server writes too, preventing ABA conflicts and retaining history.
-- Does not modify existing writer privileges or activate metadata.
create or replace function public.owner_widget_history_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if tg_op='INSERT' then
  if new.settings ? 'widget_access_v1' then
   insert into public.owner_widget_history(app_id,value,actor) values(new.id,new.settings->'widget_access_v1',auth.uid()); end if;
 elsif old.settings->'widget_access_v1' is distinct from new.settings->'widget_access_v1' then
  insert into public.owner_widget_history(app_id,before_value,value,actor)
   values(new.id,old.settings->'widget_access_v1',new.settings->'widget_access_v1',auth.uid());
 end if;
 return new;
end; $$;
drop trigger if exists owner_widget_history_v1 on public.platform_apps;
create trigger owner_widget_history_v1 after insert or update of settings on public.platform_apps
for each row execute function public.owner_widget_history_v1();

create or replace function public.owner_widget_snapshot_v1(p_app_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.platform_apps%rowtype; r text;
begin
 perform public.owner_widget_assert_owner_v1();
 if p_app_key is null then
  return jsonb_build_object('schema','owner-widget-definitions/v1','apps',coalesce((
   select jsonb_agg(jsonb_build_object('app_key',x.app_key,'name',x.name) order by x.app_key)
   from (select app_key,name from public.platform_apps order by app_key limit 100) x),'[]'::jsonb));
 end if;
 select * into a from public.platform_apps where app_key=p_app_key for share;
 if not found then raise exception 'Registered app not found' using errcode='22023'; end if;
 select coalesce(max(id)::text,'0') into r from public.owner_widget_history where app_id=a.id;
 return jsonb_build_object('schema','owner-widget-definitions/v1','app_key',a.app_key,'revision',r,
  'value',a.settings->'widget_access_v1',
  'draft',(select jsonb_build_object('revision',revision::text,'base_revision',base_revision,'config',config)
   from public.owner_widget_drafts where app_id=a.id and user_id=auth.uid()),
  'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id::text,'value',h.value,'at',h.at) order by h.id desc)
   from (select id,value,at from public.owner_widget_history where app_id=a.id order by id desc limit 25) h),'[]'::jsonb));
end; $$;

create or replace function public.owner_widget_edit_v1(p_app_key text,p_action text,
 p_expected_revision text,p_expected_draft text,p_value jsonb default null,p_history_id text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.platform_apps%rowtype; d public.owner_widget_drafts%rowtype; r text; v jsonb;
begin
 perform public.owner_widget_assert_owner_v1();
 if p_action not in ('save','discard','preview','publish','restore') or p_action is null then
  raise exception 'Unknown editor action' using errcode='22023'; end if;
 -- Same app row lock for every path; conflicts with all ordinary registry writers.
 select * into a from public.platform_apps where app_key=p_app_key for update;
 if not found then raise exception 'Registered app not found' using errcode='22023'; end if;
 select coalesce(max(id)::text,'0') into r from public.owner_widget_history where app_id=a.id;
 if p_expected_revision is distinct from r then
  raise exception 'Published definition changed. Reload before editing.' using errcode='40001'; end if;
 select * into d from public.owner_widget_drafts where app_id=a.id and user_id=auth.uid();
 if p_expected_draft is distinct from d.revision::text then
  raise exception 'Private draft changed. Reload before editing.' using errcode='40001'; end if;
 if p_action='discard' then
  delete from public.owner_widget_drafts where app_id=a.id and user_id=auth.uid();
 elsif p_action in ('save','preview','restore') then
  v:=p_value;
  if p_action='restore' then
   select value into v from public.owner_widget_history where app_id=a.id and id::text=p_history_id;
   if not found then raise exception 'History entry not found for this app' using errcode='22023'; end if;
   v:=coalesce(v,'{"version":1,"widgets":{}}'::jsonb);
  end if;
  perform public.owner_widget_validate_v1(v,a.app_key);
  if p_action='preview' then
   return jsonb_build_object('schema','owner-widget-preview/v1','config',v,'state','unconfigured','grants_access',false);
  end if;
  insert into public.owner_widget_drafts(app_id,user_id,base_revision,config) values(a.id,auth.uid(),r,v)
   on conflict(app_id,user_id) do update set revision=nextval('public.owner_widget_revision_seq'),
   base_revision=r,config=v,updated_at=now();
 elsif p_action='publish' then
  if d.revision is null or d.base_revision is distinct from r then
   raise exception 'Save and review a current draft before publishing' using errcode='40001'; end if;
  perform public.owner_widget_validate_v1(d.config,a.app_key);
  -- Refuse replacing active or unknown legacy authority. A separate reviewed
  -- migration must govern existing policies, never an implicit editor reset.
  if a.settings ? 'widget_access_v1' then
   perform public.owner_widget_validate_v1(a.settings->'widget_access_v1',a.app_key);
  end if;
  if jsonb_typeof(a.settings) is distinct from 'object' then
   raise exception 'Registry settings require review' using errcode='22023'; end if;
  update public.platform_apps set settings=jsonb_set(settings,'{widget_access_v1}',d.config),updated_at=now() where id=a.id;
  delete from public.owner_widget_drafts where app_id=a.id and user_id=auth.uid() and revision=d.revision;
 end if;
 return public.owner_widget_snapshot_v1(a.app_key);
end; $$;
revoke all on function public.owner_widget_assert_owner_v1() from public,anon,authenticated;
revoke all on function public.owner_widget_validate_v1(jsonb,text) from public,anon,authenticated;
revoke all on function public.owner_widget_history_v1() from public,anon,authenticated;
revoke all on function public.owner_widget_snapshot_v1(text) from public,anon,authenticated;
revoke all on function public.owner_widget_edit_v1(text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.owner_widget_snapshot_v1(text) to authenticated;
grant execute on function public.owner_widget_edit_v1(text,text,text,text,jsonb,text) to authenticated;
commit;
