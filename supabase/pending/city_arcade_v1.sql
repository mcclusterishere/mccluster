-- Local review schema, not applied to canonical Supabase or migration history.
-- Same service-only invoker/RLS pattern as pending/prim3_level_builder_v1.sql.
begin;
create function public.arcade_document_valid(d jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare t jsonb; k text; v numeric;
begin
 if d->'version' is distinct from '1'::jsonb or not coalesce(d->>'gameId' in ('gauranfucking-tea-tea-rush','designer-kicks-sole-run'),false)
 or not coalesce(d->>'locationId' in ('bridgeport-main-elm','bridgeport-main-golden-hill'),false)
 or (select count(*) from jsonb_object_keys(d))<>4 then return false; end if;
 if d->>'gameId'='designer-kicks-sole-run' then
  t:=d->'sole';
  if jsonb_typeof(t) is distinct from 'object' or t->'version' is distinct from '1'::jsonb then return false; end if;
  foreach k in array array['duration','speed','reward'] loop
   if jsonb_typeof(t->k) is distinct from 'number' then return false; end if;v:=(t->>k)::numeric;
   if (k='duration' and v not between 45 and 300) or (k='speed' and v not between 5 and 25) or (k='reward' and v not between 0 and 500) then return false;end if;
  end loop;
  if jsonb_typeof(t->'route') is distinct from 'array' or jsonb_array_length(t->'route')<>4
   or (select count(distinct value) from jsonb_array_elements_text(t->'route'))<>4
   or exists(select 1 from jsonb_array_elements_text(t->'route') a where a is null or a not in ('main-elm','main-fairfield','middle-golden-hill','main-golden-hill','main-south')) then return false;end if;
  if jsonb_typeof(t->'blockedRoads') is distinct from 'array' or jsonb_array_length(t->'blockedRoads')>4
   or exists(select 1 from jsonb_array_elements_text(t->'blockedRoads') a where a is null or a !~ '^bridgeport-osm-[0-9]+-[0-9]+$') then return false;end if;
  if jsonb_typeof(t->'encounters') is distinct from 'array' or jsonb_array_length(t->'encounters')>3 then return false;end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(t->'encounters')) then return false;end if;
  for t in select value from jsonb_array_elements(t->'encounters') loop
   if coalesce(t->>'id','') !~ '^[-a-z0-9]{1,40}$' or not coalesce(t->>'stopId' in ('main-elm','main-fairfield','middle-golden-hill','main-golden-hill','main-south'),false)
    or jsonb_typeof(t->'name') is distinct from 'string' or length(t->>'name') not between 1 and 60
    or jsonb_typeof(t->'roast') is distinct from 'string' or length(t->>'roast') not between 1 and 200
    or jsonb_typeof(t->'clues') is distinct from 'array' or jsonb_array_length(t->'clues')<>2
    or exists(select 1 from jsonb_array_elements(t->'clues') a where jsonb_typeof(a) is distinct from 'string' or length(a#>>'{}') not between 1 and 120)
    or not coalesce(t->'evidence' in ('0'::jsonb,'1'::jsonb),false)
    or coalesce(t->>'reward','') !~ '^[0-9]+$' or (t->>'reward')::numeric not between 0 and 500
    or coalesce(t->>'penaltySeconds','') !~ '^[0-9]+$' or (t->>'penaltySeconds')::numeric not between 0 and 15 then return false;end if;
  end loop;
  return true;
 end if;
 t:=d->'tea';
 if jsonb_typeof(t) is distinct from 'object' or t->'version' is distinct from '1'::jsonb then return false; end if;
 foreach k in array array['duration','speed','brewSeconds','reward'] loop
  if jsonb_typeof(t->k) is distinct from 'number' then return false; end if;
  v:=(t->>k)::numeric;
  if (k='duration' and v not between 30 and 180) or (k='speed' and v not between 100 and 300)
   or (k='brewSeconds' and v not between 0.5 and 3) or (k='reward' and v not between 0 and 500) then return false; end if;
 end loop;
 if jsonb_typeof(t->'spawn'->'x') is distinct from 'number' or jsonb_typeof(t->'spawn'->'y') is distinct from 'number'
 or (t->'spawn'->>'x')::numeric not between 20 and 580 or (t->'spawn'->>'y')::numeric not between 130 and 300 then return false; end if;
 if jsonb_typeof(t->'route') is distinct from 'array' or jsonb_array_length(t->'route') not between 1 and 12 then return false; end if;
 if exists(select 1 from jsonb_array_elements(t->'route') a where jsonb_typeof(a) is distinct from 'string' or a#>>'{}' not in ('Lemon','Mint','Berry','Ginger')) then return false; end if;
 return true;
exception when others then return false;
end $$;
create table public.arcade_missions (
 id text primary key check(id in ('bridgeport-main-elm','bridgeport-main-golden-hill','sole-bridgeport-main-elm','sole-bridgeport-main-golden-hill')),
 revision integer not null check(revision>0), document jsonb not null check(public.arcade_document_valid(document)),
 actor uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 check((case when document->>'gameId'='designer-kicks-sole-run' then 'sole-' else '' end)||(document->>'locationId')=id)
);
create table public.arcade_mission_versions (
 mission_id text not null references public.arcade_missions(id), revision integer not null,
 document jsonb not null check(public.arcade_document_valid(document)), actor uuid not null references auth.users(id),
 created_at timestamptz not null default now(), primary key(mission_id,revision)
);
create table public.arcade_runs (
 id uuid primary key, actor uuid not null references auth.users(id), mission_id text not null,
 revision integer not null, status text not null default 'running' check(status in ('running','won','failed')),
 served integer, score numeric, encounters jsonb not null default '[]'::jsonb, started_at timestamptz not null default now(), finished_at timestamptz,
 foreign key(mission_id,revision) references public.arcade_mission_versions(mission_id,revision),
 check(served is null or served between 0 and 12), check(score is null or score between 0 and 6000)
);
create index arcade_runs_actor_time on public.arcade_runs(actor,started_at desc);
alter table public.arcade_missions enable row level security;
alter table public.arcade_mission_versions enable row level security;
alter table public.arcade_runs enable row level security;
revoke all on public.arcade_missions,public.arcade_mission_versions,public.arcade_runs from public,anon,authenticated;
revoke all on public.arcade_missions,public.arcade_mission_versions,public.arcade_runs from service_role;
grant select,insert,update on public.arcade_missions,public.arcade_runs to service_role;
grant select,insert on public.arcade_mission_versions to service_role;
create function public.arcade_command(p_action text,p_actor uuid,p_id text,p_document jsonb default null,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.arcade_missions%rowtype; r public.arcade_runs%rowtype; d jsonb; n integer; points numeric; total integer; extras jsonb;
begin
 if p_actor is null or not exists(select 1 from public.org_members mm join public.orgs o on o.id=mm.org_id
 where o.slug='mccluster' and mm.profile_id=p_actor and mm.role='owner') then raise exception 'House owner required' using errcode='42501'; end if;
 if p_action='history' then
  return coalesce((select jsonb_agg(row_to_json(q)) from (select id,mission_id,status,served,score,revision,finished_at from public.arcade_runs where actor=p_actor and status<>'running' order by finished_at desc limit 20) q),'[]'::jsonb);
 end if;
 if p_action='finish' then
  select * into r from public.arcade_runs where id=p_id::uuid and actor=p_actor for update;
  if not found then raise exception 'Run not found' using errcode='P0002'; end if;
  select document into d from public.arcade_mission_versions where mission_id=r.mission_id and revision=r.revision;
  if jsonb_typeof(p_document->'served') is distinct from 'number' or p_document->>'served' !~ '^[0-9]+$'
   or not coalesce(p_document->>'status' in ('won','failed'),false) then raise exception 'Invalid result' using errcode='22023'; end if;
  n:=(p_document->>'served')::integer;total:=case when d->>'gameId'='designer-kicks-sole-run' then 4 else jsonb_array_length(d->'tea'->'route') end;
  extras:=coalesce(p_document->'encounters','[]'::jsonb);
  if jsonb_typeof(extras)<>'array' or jsonb_array_length(extras)>3 or (select count(*)<>count(distinct value) from jsonb_array_elements_text(extras)) then raise exception 'Invalid encounters' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements_text(extras) a where a is null or not exists(select 1 from jsonb_array_elements(coalesce(d->'sole'->'encounters','[]'::jsonb)) e where e->>'id'=a)) then raise exception 'Unknown encounter' using errcode='22023';end if;
  if n not between 0 and total or (p_document->>'status'='won' and n<>total) then raise exception 'Invalid result' using errcode='22023'; end if;
  if r.status<>'running' then
   if r.status=p_document->>'status' and r.served=n and r.encounters=extras then return to_jsonb(r); end if;
   raise exception 'Result already saved' using errcode='40001';
  end if;
  -- Self-reported private practice result, never a trusted reward or currency award.
  points:=n*(coalesce(d->'tea',d->'sole')->>'reward')::numeric;
  if d->>'gameId'='designer-kicks-sole-run' then select points+coalesce(sum((e->>'reward')::numeric),0) into points from jsonb_array_elements(d->'sole'->'encounters') e where extras ? (e->>'id');end if;
  update public.arcade_runs set status=p_document->>'status',served=n,score=points,encounters=extras,finished_at=now() where id=r.id returning * into r;
  return to_jsonb(r);
 end if;
 if p_id is null or p_id not in ('bridgeport-main-elm','bridgeport-main-golden-hill','sole-bridgeport-main-elm','sole-bridgeport-main-golden-hill') then raise exception 'Unknown location' using errcode='22023'; end if;
 -- Serialize even first creation, so two writers cannot both create revision 1.
 perform pg_advisory_xact_lock(hashtext('arcade:'||p_id));
 select * into m from public.arcade_missions where id=p_id for update;
 if p_action='read' then return case when found then to_jsonb(m) else 'null'::jsonb end; end if;
 if p_action='save' then
  if not public.arcade_document_valid(p_document) or ((case when p_document->>'gameId'='designer-kicks-sole-run' then 'sole-' else '' end)||(p_document->>'locationId')) is distinct from p_id then raise exception 'Invalid mission' using errcode='23514'; end if;
  if p_revision is null or p_revision<>coalesce(m.revision,0) then raise exception 'Revision conflict' using errcode='40001'; end if;
  insert into public.arcade_missions(id,revision,document,actor) values(p_id,1,p_document,p_actor)
   on conflict(id) do update set revision=arcade_missions.revision+1,document=excluded.document,actor=p_actor,updated_at=now() returning * into m;
  insert into public.arcade_mission_versions values(m.id,m.revision,m.document,p_actor,now());
  return to_jsonb(m);
 end if;
 if p_action='start' then
  if m.id is null then raise exception 'Save a mission first' using errcode='P0002'; end if;
  if p_revision is null or p_revision<>m.revision then raise exception 'Revision conflict' using errcode='40001'; end if;
  insert into public.arcade_runs(id,actor,mission_id,revision) values(gen_random_uuid(),p_actor,m.id,m.revision) returning * into r;
  return to_jsonb(r)||jsonb_build_object('document',m.document);
 end if;
 raise exception 'Invalid action' using errcode='22023';
end $$;
revoke all on function public.arcade_document_valid(jsonb),public.arcade_command(text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.arcade_document_valid(jsonb),public.arcade_command(text,uuid,text,jsonb,integer) to service_role;
commit;
