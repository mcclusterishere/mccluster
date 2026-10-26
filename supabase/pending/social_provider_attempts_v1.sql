-- PENDING ONLY: existing social_growth_engine, social_hardening/reconciliation,
-- social_outbox and creator_action_distribution precede this adapter.
-- No provider, credential, scope or publication is activated.
begin;
create schema if not exists private;
create table private.social_provider_attempts (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity unique,
 job_id uuid not null references public.social_publish_jobs(id) on delete restrict,
 org_id uuid not null,account_id uuid not null,
 platform text not null,external_account_id text not null,
 payload_digest text not null,credential_binding text,
 stage text not null check(stage in ('container','publish','legacy')),
 state text not null check(state in ('sending','accepted','unknown','terminal')),
 lease_owner text not null,
 source_container_id text,external_id text,
 observed_status text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index social_provider_attempts_job on private.social_provider_attempts(job_id,sequence desc);
alter table private.social_provider_attempts enable row level security;
revoke all on private.social_provider_attempts from public,anon,authenticated,service_role;
revoke all on sequence private.social_provider_attempts_sequence_seq from public,anon,authenticated,service_role;
-- Pre-migration no-ID jobs have no durable proof that no POST happened. Preserve
-- the original job and quarantine, rather than infer safety from attempts=0.
insert into private.social_provider_attempts(job_id,org_id,account_id,platform,external_account_id,payload_digest,stage,state,lease_owner)
select j.id,j.org_id,j.account_id,a.platform,a.external_account_id,
 encode(sha256(convert_to(j.payload::text,'UTF8')),'hex'),'legacy','unknown','migration'
from public.social_publish_jobs j join public.social_accounts a on a.id=j.account_id and a.org_id=j.org_id
where a.platform='instagram' and j.state in ('queued','processing','failed')
 and j.external_creation_id is null and j.external_media_id is null;
update public.social_publish_jobs j set state='failed',last_error='provider_acceptance_unknown',lease_owner=null,lease_expires_at=null
where exists(select 1 from private.social_provider_attempts a where a.job_id=j.id);

create function private.guard_social_attempt_job_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.social_provider_attempts where job_id=old.id)
 and (new.id,new.org_id,new.account_id,new.payload,new.publish_mode,new.campaign_id,new.variant_id,new.content_id) is distinct from
     (old.id,old.org_id,old.account_id,old.payload,old.publish_mode,old.campaign_id,old.variant_id,old.content_id) then
  raise exception 'Attempted delivery identity is immutable' using errcode='42501';
 end if;
 return new;
end $$;
create trigger social_attempt_job_identity before update on public.social_publish_jobs
 for each row execute function private.guard_social_attempt_job_v1();
create function private.guard_social_attempt_account_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.social_provider_attempts where account_id=old.id)
 and (new.id,new.org_id,new.platform,new.external_account_id) is distinct from
     (old.id,old.org_id,old.platform,old.external_account_id) then
  raise exception 'Attempted account identity is immutable; connect a separate account' using errcode='42501';
 end if;
 return new;
end $$;
create trigger social_attempt_account_identity before update on public.social_accounts
 for each row execute function private.guard_social_attempt_account_v1();
revoke all on function private.guard_social_attempt_job_v1(),private.guard_social_attempt_account_v1() from public,anon,authenticated,service_role;

create function public.social_provider_attempt_v1(p_action text,p_job uuid,p_lease text default null,p_stage text default null,p_expected jsonb default '{}',p_attempt uuid default null,p_external text default null,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.social_publish_jobs;a public.social_accounts;c public.org_channels;
 v private.social_provider_attempts;binding text;digest text;access jsonb;uncertain boolean;post public.social_posts;
begin
 select * into j from public.social_publish_jobs where id=p_job for update;
 if not found then raise exception 'Delivery unavailable' using errcode='42501';end if;
 select * into a from public.social_accounts where id=j.account_id and org_id=j.org_id for share;
 if not found then raise exception 'Account unavailable' using errcode='42501';end if;
 digest:=encode(sha256(convert_to(j.payload::text,'UTF8')),'hex');
 select * into v from private.social_provider_attempts where job_id=j.id order by sequence desc limit 1;
 if p_action='status' then
  return case when v.id is null then null else jsonb_build_object('id',v.id,'stage',v.stage,'state',v.state,'external_id',v.external_id,'observed_status',v.observed_status) end;
 end if;
 if p_action='retry' then
  if not exists(select 1 from public.org_members where org_id=j.org_id and profile_id=p_actor and role='owner') then raise exception 'Owner required' using errcode='42501';end if;
  if v.state in ('sending','unknown') or j.external_media_id is not null then raise exception 'Provider acceptance requires reconciliation; retry is blocked' using errcode='40001';end if;
  return jsonb_build_object('allowed',true,'state',v.state,'stage',v.stage,'external_id',v.external_id);
 end if;
 if p_action='begin' then
  if a.platform<>'instagram' then return jsonb_build_object('action','unsupported');end if;
  if nullif(btrim(p_lease),'') is null or j.state not in ('queued','processing') or j.lease_owner is distinct from p_lease or j.lease_expires_at<=now() or j.lease_expires_at is null then raise exception 'Delivery lease changed' using errcode='40001';end if;
  if a.status<>'connected' or p_expected->>'account_id' is distinct from a.id::text
   or p_expected->>'platform' is distinct from a.platform or p_expected->>'external_account_id' is distinct from a.external_account_id
   or p_expected->'payload' is distinct from j.payload then raise exception 'Delivery identity changed' using errcode='40001';end if;
  select * into c from public.org_channels where org_id=j.org_id and channel=a.platform and enabled for share;
  if not found or (c.account_id is not null and c.account_id<>a.external_account_id) then raise exception 'Credential binding unavailable' using errcode='42501';end if;
  binding:=case when c.secret_id is not null then 'vault:'||c.secret_id::text when c.token_env is not null then 'env:'||c.token_env else null end;
  if binding is null or binding is distinct from p_expected->>'credential_binding' then raise exception 'Credential binding changed' using errcode='42501';end if;
  if c.secret_id is not null and to_regprocedure('public.customer_social_credential_access(uuid,uuid)') is not null then
   access:=public.customer_social_credential_access(j.org_id,c.secret_id);
   if access->>'managed'='true' and access->>'allowed' is distinct from 'true' then raise exception 'Customer connection unavailable' using errcode='42501';end if;
  end if;
  if v.id is not null then
   if (v.org_id,v.account_id,v.platform,v.external_account_id,v.payload_digest) is distinct from (j.org_id,a.id,a.platform,a.external_account_id,digest) then raise exception 'Attempt identity changed' using errcode='40001';end if;
   if v.state in ('sending','unknown') then return jsonb_build_object('action','hold','id',v.id);end if;
   if v.state='accepted' and (v.stage=p_stage or v.stage='publish') then return jsonb_build_object('action','recover','id',v.id,'stage',v.stage,'external_id',v.external_id);end if;
  end if;
  if p_stage not in ('container','publish') then raise exception 'Unsupported send stage' using errcode='22023';end if;
  if p_stage='container' and (j.external_creation_id is not null or (v.id is not null and v.state<>'terminal')) then raise exception 'Container recovery required' using errcode='40001';end if;
  if p_stage='publish' and (j.external_creation_id is null or (v.id is not null and (v.stage<>'container' or v.state<>'accepted' or v.external_id<>j.external_creation_id))) then raise exception 'Known container required' using errcode='40001';end if;
  insert into private.social_provider_attempts(job_id,org_id,account_id,platform,external_account_id,payload_digest,credential_binding,stage,state,lease_owner,source_container_id)
  values(j.id,j.org_id,a.id,a.platform,a.external_account_id,digest,binding,p_stage,'sending',p_lease,j.external_creation_id) returning * into v;
  return jsonb_build_object('action','send','id',v.id,'stage',v.stage);
 end if;
 if p_action='terminal' then
  if nullif(btrim(p_lease),'') is null or j.lease_owner is distinct from p_lease or j.lease_expires_at is null or j.lease_expires_at<=now() or p_external is null or p_external not in ('ERROR','EXPIRED','PUBLISHED') then raise exception 'Status observation unavailable' using errcode='40001';end if;
  if v.id is null then
   if j.external_creation_id is null then raise exception 'Known container required' using errcode='40001';end if;
   insert into private.social_provider_attempts(job_id,org_id,account_id,platform,external_account_id,payload_digest,stage,state,lease_owner,external_id)
   values(j.id,j.org_id,a.id,a.platform,a.external_account_id,digest,'container','accepted',p_lease,j.external_creation_id) returning * into v;
  end if;
  if v.state='accepted' and v.stage='publish' then return jsonb_build_object('state','accepted','external_id',v.external_id);end if;
  uncertain:=p_external='PUBLISHED' or (v.stage='publish' and v.state in ('sending','unknown'));
  update private.social_provider_attempts set state=case when uncertain then 'unknown' else 'terminal' end,observed_status=p_external,updated_at=now() where id=v.id;
  update public.social_publish_jobs set state='failed',last_error=case when p_external='PUBLISHED' then 'provider_published_receipt_unknown' when uncertain then 'provider_acceptance_unknown' else 'Instagram creation container '||lower(p_external) end,lease_owner=null,lease_expires_at=null where id=j.id;
  return jsonb_build_object('state',case when uncertain then 'unknown' else 'terminal' end);
 end if;
 if p_action='finalize' then
  -- Receipt is committed separately. Bookkeeping failure rolls back only this
  -- transaction; the existing queue can reclaim the known receipt without POST.
  if v.stage is distinct from 'publish' or v.state is distinct from 'accepted' or j.external_media_id is distinct from v.external_id then raise exception 'Known publish receipt required' using errcode='40001';end if;
  if j.state<>'published' and (nullif(btrim(p_lease),'') is null or j.lease_owner is distinct from p_lease or j.lease_expires_at is null or j.lease_expires_at<=now()) then raise exception 'Delivery lease changed' using errcode='40001';end if;
  insert into public.social_posts(org_id,account_id,campaign_id,variant_id,publish_job_id,content_id,external_media_id,publish_mode,caption,metadata)
  values(j.org_id,j.account_id,j.campaign_id,j.variant_id,j.id,j.content_id,v.external_id,j.publish_mode,coalesce(j.payload->>'caption',''),jsonb_build_object('meta_creation_id',j.external_creation_id))
  on conflict(account_id,external_media_id) do nothing;
  select * into post from public.social_posts where account_id=j.account_id and external_media_id=v.external_id;
  if post.publish_job_id is distinct from j.id or post.org_id is distinct from j.org_id then raise exception 'Receipt belongs to a different delivery' using errcode='40001';end if;
  if j.content_id is not null then
   update public.social_content_items set status='published',updated_at=now() where id=j.content_id and org_id=j.org_id;
   if not found then raise exception 'Content unavailable for finalization' using errcode='40001';end if;
  end if;
  update public.social_publish_jobs set state='published',last_error=null,lease_owner=null,lease_expires_at=null,updated_at=now() where id=j.id;
  return jsonb_build_object('state','published','media_id',v.external_id,'post_id',post.id,'content_id',j.content_id);
 end if;
 if v.id is null or v.id is distinct from p_attempt or v.lease_owner is distinct from p_lease then raise exception 'Attempt changed' using errcode='40001';end if;
 if p_action='receipt' then
  if p_external is null or length(p_external) not between 1 and 160 or p_external!~'^[A-Za-z0-9_-]+$' then raise exception 'Invalid provider receipt' using errcode='22023';end if;
  if v.state='accepted' then
   if v.external_id<>p_external then raise exception 'Receipt changed' using errcode='40001';end if;
   return jsonb_build_object('state','accepted','stage',v.stage,'external_id',v.external_id);
  end if;
  if v.state not in ('sending','unknown') then raise exception 'Attempt closed' using errcode='40001';end if;
  -- A late receipt can record the original attempt's fact, never authorize a new POST.
  update private.social_provider_attempts set state='accepted',external_id=p_external,updated_at=now() where id=v.id;
  update public.social_publish_jobs set state=case when v.stage='container' and j.state='cancelled' then 'cancelled' else 'processing' end,
   external_creation_id=case when v.stage='container' then p_external else external_creation_id end,
   external_media_id=case when v.stage='publish' then p_external else external_media_id end,
   attempts=attempts+1,last_error=null,lease_owner=null,lease_expires_at=null,updated_at=now() where id=j.id;
  return jsonb_build_object('state','accepted','stage',v.stage,'external_id',p_external);
 elsif p_action='unknown' then
  if v.state='accepted' then return jsonb_build_object('state','accepted','stage',v.stage,'external_id',v.external_id);end if;
  update private.social_provider_attempts set state='unknown',updated_at=now() where id=v.id;
  update public.social_publish_jobs set state='failed',last_error='provider_acceptance_unknown',lease_owner=null,lease_expires_at=null where id=j.id;
  return jsonb_build_object('state','unknown');
 end if;
 raise exception 'Unsupported attempt action' using errcode='22023';
end $$;
revoke all on function public.social_provider_attempt_v1(text,uuid,text,text,jsonb,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.social_provider_attempt_v1(text,uuid,text,text,jsonb,uuid,text,uuid) to service_role;
-- The canonical outbox remains the only queue. Unsupported adapters and held
-- attempts cannot consume the due-work window or be blindly leased again.
create or replace function public.claim_social_publish_jobs(p_lease_owner text,p_limit integer default 10,p_lease_seconds integer default 120)
returns setof public.social_publish_jobs language plpgsql security definer set search_path='' as $$
declare stale public.social_publish_jobs;
begin
 if nullif(btrim(p_lease_owner),'') is null then raise exception 'Lease owner required';end if;
 for stale in select j.* from public.social_publish_jobs j where j.state in ('queued','processing')
  and (j.lease_expires_at is null or j.lease_expires_at<=now())
  and exists(select 1 from private.social_provider_attempts a where a.job_id=j.id and a.state in ('sending','unknown'))
  order by j.scheduled_at,j.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,10),25)) loop
  update private.social_provider_attempts set state='unknown',updated_at=now() where job_id=stale.id and state='sending';
  update public.social_publish_jobs set state='failed',last_error='provider_acceptance_unknown',lease_owner=null,lease_expires_at=null where id=stale.id;
 end loop;
 return query with candidates as (
  select j.id from public.social_publish_jobs j join public.social_accounts a on a.id=j.account_id and a.org_id=j.org_id
  where j.state in ('queued','processing') and j.scheduled_at<=now() and a.platform='instagram' and (a.status='connected' or (j.external_media_id is not null and exists(select 1 from private.social_provider_attempts r where r.job_id=j.id and r.stage='publish' and r.state='accepted' and r.external_id=j.external_media_id)))
  and (j.lease_expires_at is null or j.lease_expires_at<=now())
  and not exists(select 1 from private.social_provider_attempts p where p.job_id=j.id and p.state in ('sending','unknown'))
  order by j.scheduled_at,j.created_at for update of j skip locked limit greatest(1,least(coalesce(p_limit,10),25))
 ) update public.social_publish_jobs j set lease_owner=p_lease_owner,lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),600))),updated_at=now()
 from candidates c where j.id=c.id returning j.*;
end $$;
revoke all on function public.claim_social_publish_jobs(text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_social_publish_jobs(text,integer,integer) to service_role;
commit;
