-- The Equity Uprise worker runtime and the media spend rollup that shipped callers need and
-- production never received (docs/control-plane/PRODUCTION-SCHEMA-RECONCILIATION-2026-10-28.md,
-- "What the repo builds that production lacks").
--
-- These objects exist only in supabase/replay_migrations/ (files written 2026-09-08 and
-- 2026-09-17 that production never ran), so every CI reset has them and production does not.
-- Shipped code calls them and fails in production today:
--   supabase/functions/eu-ddex-worker      eu_claim_ddex_jobs_service
--   supabase/functions/eu-external-worker  eu_claim_external_jobs_service
--   supabase/functions/eu-monitor          eu_claim_monitors_service
--   supabase/functions/eu-orcid-oauth      eu_oauth_state_create_service, eu_oauth_state_consume_service,
--                                          eu_vault_store_service
--   workers/mccluster/src/media/router.js  media_usage_rollup (GET /v1/media/usage)
-- scripts/test/rpc-names-exist.test.mjs now counts a name as existing only when the schema
-- manifest AND the latest production evidence have it, and lists these under
-- supabase/pending/live-callers.json "pending_only" naming this file, until it is promoted.
--
-- What it creates, each statement copied from the replay file named above its section, so
-- the bodies equal the ones in supabase/schema-manifest.json:
--   tables    private.eu_oauth_states, private.eu_runtime (service_role only, no client grant)
--   index     eu_monitors_identity_idx
--   functions private.eu_claim_ddex_jobs, eu_claim_external_jobs, eu_claim_monitors,
--             eu_cron_google, eu_cron_worker, eu_event_dispatch, eu_monitor_interval,
--             eu_out_event_communication_bridge, eu_runtime_secret;
--             public.eu_claim_ddex_jobs_service, eu_claim_external_jobs_service,
--             eu_claim_monitors_service, eu_cron_install_service, eu_oauth_state_consume_service,
--             eu_oauth_state_create_service, eu_oauth_state_gc_service,
--             eu_runtime_configure_service, eu_vault_store_service, media_usage_rollup.
--   Every public function is EXECUTE for service_role only (revoked from public, anon,
--   authenticated), as in the replay files.
--
-- Deliberately NOT created (an owner decision each, not a schema gap):
--   - triggers eu_events_dispatch (on eu_events) and eu_out_events_communication_bridge (on
--     out_events). Turning them on starts writing eu_jobs / eu_workflow_runs on every
--     eu_events insert and eu_communications on every out_events insert, and production
--     already bridges out_events through its own private.eu_out_event_bridge(). Their
--     functions are created, inert, so a later migration can attach them.
--   - public.touch_listener_state(): production's listener_state is touched by
--     private.listener_state_touch() (20261021125121_listener_state_v1); no caller.
--   - cron jobs: none is scheduled. eu_cron_install_service() schedules them only after
--     eu_runtime_configure_service() stores the project URL and worker secret in Vault.
-- So until the triggers and jobs are decided, the rebuilt database still differs from
-- production by those two triggers (listed in the reconciliation page).
--
-- Production dependencies (checked read-only 2026-10-29): eu_jobs has state, provider,
-- scheduled_at, lease_until, lease_owner, attempts, priority, created_at, updated_at;
-- eu_monitors has every column used and 0 rows; vault.create_secret(text,text,text[,uuid]),
-- vault.decrypted_secrets, net.http_post and the cron schema exist; media_jobs and
-- media_cost_events carry every column media_usage_rollup reads. Idempotent: create ... if
-- not exists and create or replace throughout.
--
-- Dependency order: none; it
-- needs nothing pending. Promotion: PROMOTION-ORDER.md group 0, last.
-- Rollback: supabase/pending/20261029100300_eu_runtime_and_media_rollup_v1.rollback.sql.
-- Test: bash scripts/test-schema-hygiene-db.sh (applied twice on a scratch database: the
-- service RPCs work for service_role and are refused to anon and authenticated).

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- private.eu_oauth_states and the ORCID OAuth service RPCs (replay 20260908213800, verbatim)
create table if not exists private.eu_oauth_states (
  state_hash text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  provider text not null,
  redirect_after text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz
);
create index if not exists eu_oauth_states_expiry_idx on private.eu_oauth_states(expires_at) where consumed_at is null;
revoke all on table private.eu_oauth_states from public, anon, authenticated;
grant select,insert,update,delete on private.eu_oauth_states to service_role;

create or replace function public.eu_oauth_state_create_service(
  p_state_hash text, p_org uuid, p_m_uid uuid, p_provider text,
  p_redirect_after text default '', p_ttl_seconds integer default 600
)
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if p_state_hash is null or length(p_state_hash) < 32 then raise exception 'invalid state hash'; end if;
  insert into private.eu_oauth_states(state_hash,org_id,m_uid,provider,redirect_after,expires_at)
  values(p_state_hash,p_org,p_m_uid,left(p_provider,80),left(coalesce(p_redirect_after,''),1000),now()+make_interval(secs=>greatest(60,least(coalesce(p_ttl_seconds,600),1800))));
end;
$$;
revoke all on function public.eu_oauth_state_create_service(text,uuid,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.eu_oauth_state_create_service(text,uuid,uuid,text,text,integer) to service_role;

create or replace function public.eu_oauth_state_consume_service(p_state_hash text, p_provider text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare r private.eu_oauth_states%rowtype;
begin
  select * into r from private.eu_oauth_states
   where state_hash=p_state_hash and provider=p_provider and consumed_at is null and expires_at>now()
   for update;
  if r.state_hash is null then return null; end if;
  update private.eu_oauth_states set consumed_at=now() where state_hash=r.state_hash;
  return jsonb_build_object('org_id',r.org_id,'m_uid',r.m_uid,'redirect_after',r.redirect_after);
end;
$$;
revoke all on function public.eu_oauth_state_consume_service(text,text) from public, anon, authenticated;
grant execute on function public.eu_oauth_state_consume_service(text,text) to service_role;

create or replace function public.eu_vault_store_service(p_secret text,p_name text default null,p_description text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, vault as $$
declare v_id uuid;
begin
  if p_secret is null or length(p_secret)=0 then raise exception 'secret required'; end if;
  select vault.create_secret(p_secret,nullif(left(p_name,200),''),left(coalesce(p_description,''),500)) into v_id;
  return v_id;
end;
$$;
revoke all on function public.eu_vault_store_service(text,text,text) from public, anon, authenticated;
grant execute on function public.eu_vault_store_service(text,text,text) to service_role;

create or replace function public.eu_oauth_state_gc_service()
returns integer language plpgsql security definer set search_path = pg_catalog, private as $$
declare n integer;
begin
  delete from private.eu_oauth_states where expires_at < now()-interval '1 hour' or consumed_at < now()-interval '1 day';
  get diagnostics n=row_count; return n;
end;
$$;
revoke all on function public.eu_oauth_state_gc_service() from public, anon, authenticated;
grant execute on function public.eu_oauth_state_gc_service() to service_role;

-- ---------------------------------------------------------------- private.eu_runtime and the Vault-backed worker scheduler (replay 20260908214200, verbatim).
-- Creating these schedules nothing: cron jobs exist only after an operator calls
-- eu_runtime_configure_service() and then eu_cron_install_service() (both service-role only).
create table if not exists private.eu_runtime (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  project_url_secret_id uuid not null,
  worker_secret_id uuid not null,
  google_secret_id uuid,
  configured_at timestamptz not null default now()
);
revoke all on table private.eu_runtime from public,anon,authenticated;
grant select,insert,update,delete on private.eu_runtime to service_role;

create or replace function public.eu_runtime_configure_service(
 p_org uuid,p_project_url text,p_worker_secret text,p_google_secret text default null
) returns void language plpgsql security definer set search_path=pg_catalog,public,private,vault as $fn$
declare u uuid;w uuid;g uuid;
begin
 if p_project_url is null or p_project_url !~ '^https://[A-Za-z0-9.-]+$' then raise exception 'valid https project url required'; end if;
 if p_worker_secret is null or length(p_worker_secret)<24 then raise exception 'worker secret must be at least 24 characters'; end if;
 select vault.create_secret(rtrim(p_project_url,'/'),'eu-project-url-'||p_org,'Equity Uprise Edge Functions base URL') into u;
 select vault.create_secret(p_worker_secret,'eu-worker-secret-'||p_org,'Equity Uprise internal worker bearer') into w;
 if coalesce(p_google_secret,'')<>'' then select vault.create_secret(p_google_secret,'eu-google-secret-'||p_org,'Equity Uprise Google workspace internal bearer') into g; end if;
 insert into private.eu_runtime(org_id,project_url_secret_id,worker_secret_id,google_secret_id)
 values(p_org,u,w,g) on conflict(org_id) do update set project_url_secret_id=excluded.project_url_secret_id,worker_secret_id=excluded.worker_secret_id,google_secret_id=excluded.google_secret_id,configured_at=now();
end;$fn$;
revoke all on function public.eu_runtime_configure_service(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.eu_runtime_configure_service(uuid,text,text,text) to service_role;

create or replace function private.eu_runtime_secret(p_id uuid)
returns text language sql stable security definer set search_path=pg_catalog,vault as $fn$
 select decrypted_secret from vault.decrypted_secrets where id=p_id;
$fn$;
revoke all on function private.eu_runtime_secret(uuid) from public,anon,authenticated;

create or replace function private.eu_cron_worker(p_path text,p_limit integer default 20)
returns bigint language plpgsql security definer set search_path=pg_catalog,public,private,net as $fn$
declare r private.eu_runtime%rowtype; base text; secret text; req bigint;
begin
 select * into r from private.eu_runtime order by configured_at desc limit 1;
 if r.org_id is null then return null; end if;
 base:=private.eu_runtime_secret(r.project_url_secret_id); secret:=private.eu_runtime_secret(r.worker_secret_id);
 if coalesce(base,'')='' or coalesce(secret,'')='' then return null; end if;
 select net.http_post(url=>rtrim(base,'/')||'/functions/v1/'||p_path,
   headers=>jsonb_build_object('content-type','application/json','x-eu-worker-secret',secret),
   body=>jsonb_build_object('limit',greatest(1,least(coalesce(p_limit,20),50))),timeout_milliseconds=>15000) into req;
 return req;
end;$fn$;
revoke all on function private.eu_cron_worker(text,integer) from public,anon,authenticated;

create or replace function private.eu_cron_google(p_action text)
returns bigint language plpgsql security definer set search_path=pg_catalog,public,private,net as $fn$
declare r private.eu_runtime%rowtype; base text; secret text; req bigint;
begin
 select * into r from private.eu_runtime where google_secret_id is not null order by configured_at desc limit 1;
 if r.org_id is null then return null; end if;
 base:=private.eu_runtime_secret(r.project_url_secret_id); secret:=private.eu_runtime_secret(r.google_secret_id);
 if coalesce(base,'')='' or coalesce(secret,'')='' then return null; end if;
 select net.http_post(url=>rtrim(base,'/')||'/functions/v1/eu-google-workspace',
   headers=>jsonb_build_object('content-type','application/json','x-eu-google-secret',secret),
   body=>jsonb_build_object('action',p_action),timeout_milliseconds=>30000) into req;
 return req;
end;$fn$;
revoke all on function private.eu_cron_google(text) from public,anon,authenticated;

create or replace function public.eu_cron_install_service()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,cron as $fn$
declare j bigint;
begin
 if not exists(select 1 from private.eu_runtime) then raise exception 'configure eu_runtime first'; end if;
 begin perform cron.unschedule('eu-core-worker'); exception when others then null; end;
 begin perform cron.unschedule('eu-external-worker'); exception when others then null; end;
 begin perform cron.unschedule('eu-ddex-worker'); exception when others then null; end;
 begin perform cron.unschedule('eu-monitor'); exception when others then null; end;
 begin perform cron.unschedule('eu-google-watch-renew'); exception when others then null; end;
 begin perform cron.unschedule('eu-google-history-safety-sync'); exception when others then null; end;
 select cron.schedule('eu-core-worker','* * * * *',$cmd$select private.eu_cron_worker('eu-worker',20);$cmd$) into j;
 select cron.schedule('eu-external-worker','* * * * *',$cmd$select private.eu_cron_worker('eu-external-worker',20);$cmd$) into j;
 select cron.schedule('eu-ddex-worker','* * * * *',$cmd$select private.eu_cron_worker('eu-ddex-worker',10);$cmd$) into j;
 select cron.schedule('eu-monitor','*/10 * * * *',$cmd$select private.eu_cron_worker('eu-monitor',20);$cmd$) into j;
 if exists(select 1 from private.eu_runtime where google_secret_id is not null) then
   select cron.schedule('eu-google-watch-renew','17 8 * * *',$cmd$select private.eu_cron_google('gmail.watch.renew');$cmd$) into j;
   select cron.schedule('eu-google-history-safety-sync','47 * * * *',$cmd$select private.eu_cron_google('gmail.sync');$cmd$) into j;
 end if;
 return jsonb_build_object('installed',true,'core','every minute','external','every minute','ddex','every minute','monitors','every 10 minutes','gmail_watch','daily','gmail_sync','hourly');
end;$fn$;
revoke all on function public.eu_cron_install_service() from public,anon,authenticated;
grant execute on function public.eu_cron_install_service() to service_role;

-- ---------------------------------------------------------------- Monitor leasing (replay 20260908214000, verbatim). eu_monitors has no rows in production
-- (2026-10-29), so the unique index cannot meet a duplicate.
create unique index if not exists eu_monitors_identity_idx
  on public.eu_monitors(org_id,monitor_type,provider,coalesce(initiative_id,'00000000-0000-0000-0000-000000000000'::uuid),name);

create or replace function private.eu_monitor_interval(p_cadence text)
returns interval language sql immutable set search_path=pg_catalog as $$
 select case lower(coalesce(p_cadence,'daily'))
  when 'hourly' then interval '1 hour'
  when '6-hourly' then interval '6 hours'
  when '12-hourly' then interval '12 hours'
  when 'weekly' then interval '7 days'
  else interval '1 day' end;
$$;

create or replace function private.eu_claim_monitors(p_limit integer default 20)
returns setof public.eu_monitors
language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 return query
 with due as (
   select id from public.eu_monitors
   where enabled=true and coalesce(next_run_at,now())<=now()
   order by coalesce(next_run_at,created_at),created_at
   for update skip locked limit greatest(1,least(coalesce(p_limit,20),100))
 )
 update public.eu_monitors m set last_run_at=now(),next_run_at=now()+private.eu_monitor_interval(m.cadence),updated_at=now()
 from due where m.id=due.id returning m.*;
end;
$$;
revoke all on function private.eu_claim_monitors(integer) from public,anon,authenticated;
grant execute on function private.eu_claim_monitors(integer) to service_role;

create or replace function public.eu_claim_monitors_service(p_limit integer default 20)
returns setof public.eu_monitors language sql security definer set search_path=pg_catalog,public,private as $$
 select * from private.eu_claim_monitors(p_limit);
$$;
revoke all on function public.eu_claim_monitors_service(integer) from public,anon,authenticated;
grant execute on function public.eu_claim_monitors_service(integer) to service_role;

-- ---------------------------------------------------------------- External and DDEX job claims (replay 20260908214400, verbatim; production already has
-- private.eu_claim_jobs and eu_claim_jobs_service, which this file does not touch)
create or replace function private.eu_claim_external_jobs(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 180
)
returns setof public.eu_jobs
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  return query
  with due as (
    select j.id from public.eu_jobs j
    where j.state in ('queued','retry')
      and j.provider not in ('internal','crossref','openalex','ddex')
      and j.scheduled_at <= now()
      and (j.lease_until is null or j.lease_until < now())
    order by j.priority desc, j.scheduled_at, j.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,20),100))
  )
  update public.eu_jobs j
     set state='leased', lease_owner=left(coalesce(p_worker,'eu-external-worker'),120),
         lease_until=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,180),1800))),
         attempts=j.attempts+1, updated_at=now()
   from due where j.id=due.id
  returning j.*;
end;$fn$;

create or replace function private.eu_claim_ddex_jobs(
 p_worker text,p_limit integer default 10,p_lease_seconds integer default 300
) returns setof public.eu_jobs
language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 return query
 with due as (
   select id from public.eu_jobs
    where state in ('queued','retry') and provider='ddex' and scheduled_at<=now()
      and (lease_until is null or lease_until<now())
    order by priority desc,scheduled_at,created_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
 )
 update public.eu_jobs j set state='leased',lease_owner=left(coalesce(p_worker,'eu-ddex-worker'),120),
   lease_until=now()+make_interval(secs=>greatest(60,least(coalesce(p_lease_seconds,300),1800))),attempts=j.attempts+1,updated_at=now()
 from due where j.id=due.id returning j.*;
end;$fn$;
revoke all on function private.eu_claim_ddex_jobs(text,integer,integer) from public,anon,authenticated;
grant execute on function private.eu_claim_ddex_jobs(text,integer,integer) to service_role;

create or replace function public.eu_claim_ddex_jobs_service(
 p_worker text,p_limit integer default 10,p_lease_seconds integer default 300
) returns setof public.eu_jobs
language sql security definer set search_path=pg_catalog,public,private as $fn$
 select * from private.eu_claim_ddex_jobs(p_worker,p_limit,p_lease_seconds);
$fn$;
revoke all on function public.eu_claim_ddex_jobs_service(text,integer,integer) from public,anon,authenticated;
grant execute on function public.eu_claim_ddex_jobs_service(text,integer,integer) to service_role;
revoke all on function private.eu_claim_external_jobs(text,integer,integer) from public, anon, authenticated;
grant execute on function private.eu_claim_external_jobs(text,integer,integer) to service_role;

create or replace function public.eu_claim_external_jobs_service(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 180
)
returns setof public.eu_jobs
language sql security definer set search_path = pg_catalog, public, private as $$
  select * from private.eu_claim_external_jobs(p_worker,p_limit,p_lease_seconds);
$$;
revoke all on function public.eu_claim_external_jobs_service(text,integer,integer) from public, anon, authenticated;
grant execute on function public.eu_claim_external_jobs_service(text,integer,integer) to service_role;

-- ---------------------------------------------------------------- Event dispatch trigger function (replay 20260908213900). The trigger itself is NOT created:
-- see the header.
create or replace function private.eu_event_dispatch()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  w public.eu_workflows%rowtype;
  run_id uuid;
  a jsonb;
  cap_risk text;
  st text;
  approval uuid;
  rid text;
begin
  -- Built-in derivative: every approved publication gets a deterministic PDF.
  if new.event_type='publication.approved' and new.entity_type='eu_publications' then
    select id into approval from public.control_approvals
     where org_id=new.org_id and capability='publication.publish'
       and resource_type='eu_publications' and resource_id=new.entity_id
       and state='approved' and expires_at>now()
     order by decided_at desc nulls last limit 1;
    insert into public.eu_jobs(org_id,initiative_id,event_id,job_type,provider,action,capability,resource_type,resource_id,payload,state,approval_id,idempotency_key,priority)
    values(new.org_id,new.initiative_id,new.id,'publication.render-pdf','pdf-native','render','publication.publish','eu_publications',new.entity_id,
      jsonb_build_object('publication_id',new.entity_id,'version_label',coalesce(new.data->>'version','1.0')),
      case when approval is null then 'waiting-approval' else 'queued' end,approval,
      'publication:'||new.entity_id||':'||coalesce(new.data->>'version','1.0')||':pdf-native',7)
    on conflict (org_id,idempotency_key) where idempotency_key is not null do nothing;
  end if;

  -- Once canonical publication has actually rendered, start recurring citation monitoring.
  if new.event_type='publication.published' and new.entity_type='eu_publications' then
    insert into public.eu_monitors(org_id,initiative_id,name,monitor_type,provider,query,cadence,enabled,next_run_at)
    values(new.org_id,new.initiative_id,'Citations · '||coalesce(new.data->>'stable_id',new.entity_id),'citation','openalex',
      jsonb_build_object('publication_id',new.entity_id),'daily',true,now()+interval '6 hours')
    on conflict do nothing;
  end if;

  -- User-defined workflows. Conditions currently support exact JSON containment;
  -- richer policy belongs in Edge Functions, not a trigger that can block writes.
  for w in
    select * from public.eu_workflows
     where org_id=new.org_id and enabled=true and trigger_event=new.event_type
       and (initiative_id is null or initiative_id=new.initiative_id)
       and (conditions='{}'::jsonb or new.data @> conditions)
  loop
    insert into public.eu_workflow_runs(org_id,workflow_id,trigger_event_id,state,input)
    values(new.org_id,w.id,new.id,'running',jsonb_build_object('event_id',new.id,'event_type',new.event_type,'entity_type',new.entity_type,'entity_id',new.entity_id,'data',new.data))
    returning id into run_id;

    for a in select * from jsonb_array_elements(coalesce(w.actions,'[]'::jsonb))
    loop
      if coalesce(a->>'do','job') <> 'job' then continue; end if;
      select risk into cap_risk from public.control_capabilities where capability=coalesce(a->>'capability','');
      rid:=case when coalesce(a->>'resource_id','') in ('','$entity') then new.entity_id else a->>'resource_id' end;
      st:=case when cap_risk='high' or w.approval_mode='per-run' then 'waiting-approval' else 'queued' end;
      insert into public.eu_jobs(org_id,initiative_id,workflow_run_id,event_id,job_type,provider,action,capability,resource_type,resource_id,payload,state,idempotency_key,priority)
      values(new.org_id,new.initiative_id,run_id,new.id,
        coalesce(a->>'job_type','workflow.action'),coalesce(a->>'provider','internal'),coalesce(a->>'action','run'),coalesce(a->>'capability',''),
        coalesce(a->>'resource_type',new.entity_type),rid,
        coalesce(a->'payload','{}'::jsonb)||jsonb_build_object('event_id',new.id,'event_data',new.data,'entity_type',new.entity_type,'entity_id',new.entity_id),
        st,'workflow:'||w.id||':event:'||new.id||':action:'||coalesce(a->>'key',md5(a::text)),coalesce((a->>'priority')::smallint,5))
      on conflict (org_id,idempotency_key) where idempotency_key is not null do nothing;
    end loop;
    update public.eu_workflow_runs set state=case when exists(select 1 from public.eu_jobs where workflow_run_id=run_id and state='waiting-approval') then 'waiting-approval' else 'queued' end where id=run_id;
  end loop;
  return new;
end;
$$;
revoke all on function private.eu_event_dispatch() from public, anon, authenticated;

-- ---------------------------------------------------------------- Outbound communication bridge trigger function (replay 20260908214300). The trigger itself is
-- NOT created: production already bridges out_events with private.eu_out_event_bridge().
create or replace function private.eu_out_event_communication_bridge()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare
  r public.out_recipients%rowtype;
  c public.out_contacts%rowtype;
  campaign public.out_campaigns%rowtype;
  stakeholder public.eu_stakeholders%rowtype;
  link public.eu_stakeholder_links%rowtype;
  comm_id uuid;
  dir text:='out';
begin
  if new.recipient_id is null then return new; end if;
  select * into r from public.out_recipients where id=new.recipient_id;
  if r.id is null or r.contact_id is null then return new; end if;
  select * into c from public.out_contacts where id=r.contact_id;
  select * into stakeholder from public.eu_stakeholders where org_id=new.org_id and out_contact_id=c.id limit 1;
  if stakeholder.id is null then return new; end if;
  select * into link from public.eu_stakeholder_links where stakeholder_id=stakeholder.id order by updated_at desc limit 1;
  if link.id is null then return new; end if;
  select * into campaign from public.out_campaigns where id=r.campaign_id;

  -- One communication row per outbound recipient/provider message. Delivery,
  -- click, bounce, etc. update classification instead of creating copies.
  select id into comm_id from public.eu_communications
   where org_id=new.org_id and provider='resend' and out_recipient_id=r.id limit 1;
  if comm_id is null and lower(new.type)='sent' then
    insert into public.eu_communications(
      org_id,initiative_id,stakeholder_id,stakeholder_link_id,channel,provider,direction,
      external_message_id,out_recipient_id,from_address,to_addresses,subject,body_excerpt,
      classification,occurred_at,raw_ref
    ) values(
      new.org_id,link.initiative_id,stakeholder.id,link.id,'email','resend',dir,
      coalesce(r.provider_id,''),r.id,
      coalesce((select from_email from public.out_sender_identities where id=campaign.sender_id),''),
      jsonb_build_array(r.address),coalesce(campaign.subject,''),left(coalesce(campaign.body_text,''),8000),
      jsonb_build_object('delivery_state','sent','campaign_id',campaign.id,'campaign_name',campaign.name),
      new.at,jsonb_build_object('out_event_id',new.id,'out_recipient_id',r.id,'campaign_id',campaign.id,'provider_id',r.provider_id)
    ) returning id into comm_id;
  elsif comm_id is not null then
    update public.eu_communications set classification=classification||jsonb_build_object(
      'delivery_state',lower(new.type),'last_provider_event_at',new.at,'last_provider_event_id',new.id,
      'provider_detail',coalesce(new.detail,'{}'::jsonb)
    ) where id=comm_id;
  end if;
  return new;
end;$fn$;
revoke all on function private.eu_out_event_communication_bridge() from public,anon,authenticated;

-- ---------------------------------------------------------------- Media spend rollup (replay 20260917120000, verbatim)
create or replace function public.media_usage_rollup(
  p_org_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_group_by text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_group text := lower(coalesce(nullif(trim(p_group_by), ''), 'day'));
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_rows jsonb;
  v_totals jsonb;
begin
  if p_org_id is null then
    raise exception using errcode = '22023', message = 'org_id is required';
  end if;
  if v_group not in ('day', 'provider', 'capability', 'model') then
    raise exception using errcode = '22023', message = 'group_by must be day, provider, capability, or model';
  end if;
  if v_to < v_from then
    raise exception using errcode = '22023', message = 'to must not precede from';
  end if;

  -- One row per job, with its ledger events pivoted. Reservation and settlement
  -- are separate events, so a job can hold a reservation that never settled.
  with events as (
    select
      e.job_id,
      max(case when e.event_type = 'reserved' then e.amount_cents end) as reserved_cents,
      max(case when e.event_type = 'released' then e.amount_cents end) as released_cents,
      max(case when e.event_type = 'actual' then e.amount_cents end) as actual_cents
    from public.media_cost_events e
    where e.org_id = p_org_id
      and e.created_at >= v_from
      and e.created_at <= v_to
    group by e.job_id
  ),
  joined as (
    select
      j.id,
      j.provider,
      j.capability,
      j.provider_model_id,
      j.status,
      j.created_at,
      coalesce(ev.reserved_cents, 0) as reserved_cents,
      coalesce(ev.released_cents, 0) as released_cents,
      coalesce(ev.actual_cents, 0) as actual_cents,
      -- A settled job counts its actual. An unsettled, unreleased reservation
      -- is still money committed against the provider balance.
      case
        when ev.actual_cents is not null then ev.actual_cents
        when ev.released_cents is not null then 0
        else coalesce(ev.reserved_cents, 0)
      end as committed_cents,
      (ev.actual_cents is null and ev.released_cents is null and ev.reserved_cents is not null) as in_flight
    from events ev
    join public.media_jobs j on j.id = ev.job_id
    where j.org_id = p_org_id
  ),
  grouped as (
    select
      case v_group
        when 'day' then to_char(date_trunc('day', created_at), 'YYYY-MM-DD')
        when 'provider' then coalesce(provider, 'unknown')
        when 'capability' then coalesce(capability, 'unknown')
        else coalesce(provider_model_id, 'unknown')
      end as key,
      count(*)::int as jobs,
      sum(reserved_cents)::int as reserved_cents,
      sum(released_cents)::int as released_cents,
      sum(actual_cents)::int as actual_cents,
      sum(committed_cents)::int as committed_cents,
      count(*) filter (where in_flight)::int as in_flight_jobs
    from joined
    group by 1
  )
  -- One statement: the CTEs above are visible only to the statement that defines them,
  -- so the rows and the totals are read together (a second statement saw no "joined").
  select
    (select coalesce(jsonb_agg(to_jsonb(g) order by g.key desc), '[]'::jsonb) from grouped g),
    (select jsonb_build_object(
    'jobs', coalesce(count(*), 0)::int,
    'reserved_cents', coalesce(sum(reserved_cents), 0)::int,
    'released_cents', coalesce(sum(released_cents), 0)::int,
    'actual_cents', coalesce(sum(actual_cents), 0)::int,
    'committed_cents', coalesce(sum(committed_cents), 0)::int,
    'in_flight_jobs', coalesce(count(*) filter (where in_flight), 0)::int,
    -- Stated so a reader knows how much of the committed figure is still an
    -- estimate rather than a settled provider charge.
    'unsettled_cents', coalesce(sum(case when in_flight then committed_cents else 0 end), 0)::int
  ) from joined)
  into v_rows, v_totals;

  return jsonb_build_object(
    'ok', true,
    'org_id', p_org_id,
    'from', v_from,
    'to', v_to,
    'group_by', v_group,
    'totals', v_totals,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.media_usage_rollup(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.media_usage_rollup(uuid, timestamptz, timestamptz, text) to service_role;

comment on function public.media_usage_rollup(uuid, timestamptz, timestamptz, text) is
  'Aggregates media_cost_events for an org. Committed = settled actuals plus unreleased reservations. Reads the ledger only; invents no figure.';
