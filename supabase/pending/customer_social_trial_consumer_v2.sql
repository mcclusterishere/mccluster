-- PENDING. Default-off atomic customer-social entitlement consumer; no policy seed.
begin;
create table if not exists private.customer_social_consumer_policy (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 safety_disabled boolean not null default false,
 app_id uuid not null references public.platform_apps(id) on delete restrict
);
alter table private.customer_social_consumer_policy enable row level security;
alter table private.customer_social_consumer_policy force row level security;
revoke all on private.customer_social_consumer_policy from public,anon,authenticated,service_role;
create or replace function private.customer_social_policy_guard_v2() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'social_consumer_mapping_immutable' using errcode='42501';end if;
 if new.app_id is distinct from old.app_id then raise exception 'social_consumer_mapping_immutable' using errcode='42501';end if;
 return new;
end$$;
drop trigger if exists customer_social_policy_guard_v2 on private.customer_social_consumer_policy;
create trigger customer_social_policy_guard_v2 before update or delete on private.customer_social_consumer_policy for each row execute function private.customer_social_policy_guard_v2();
drop trigger if exists customer_social_policy_truncate_v2 on private.customer_social_consumer_policy;
create trigger customer_social_policy_truncate_v2 before truncate on private.customer_social_consumer_policy execute function private.customer_social_policy_guard_v2();

-- Lock all mutable authorization inputs until the surrounding mutation commits.
-- Same advisory lock as registration/cancellation: neither can cross this decision.
create or replace function private.customer_social_access_v2(p_org uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare policy private.customer_social_consumer_policy; app public.platform_apps; projection jsonb; eligible boolean; mode text;
begin
 perform 1 from public.org_members where org_id=p_org and profile_id=p_user and role='owner' for share;
 if not found then raise exception 'owner required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(182704,3);
 -- Table SHARE prevents concurrent insertion of the first policy while legacy work commits.
 lock table private.customer_social_consumer_policy in share mode;
 select * into policy from private.customer_social_consumer_policy where singleton for share;
 mode:=case when coalesce(policy.enabled,false) then 'module' else 'legacy_paid' end;
 if coalesce(policy.safety_disabled,false) then
  return jsonb_build_object('org_id',p_org,'mode',mode,'eligible',false,'app_key',null,'reason','safety_disabled');
 end if;
 if mode='legacy_paid' then
  perform 1 from public.creator_billing_subscriptions where org_id=p_org for share;
  eligible:=private.customer_social_paid(p_org);
  return jsonb_build_object('org_id',p_org,'mode',mode,'eligible',eligible,'app_key',null,'reason','legacy_paid');
 end if;
 perform private.creator_trial_owner_v1(p_user,p_org);
 select * into app from public.platform_apps where id=policy.app_id for share;
 lock table private.creator_domain_trial_policies in share mode;
 perform 1 from private.creator_domain_trial_policies where enabled for share;
 lock table private.creator_domain_trial_modules in share mode;
 perform 1 from private.creator_domain_trial_receipts where org_id=p_org for share;
 perform 1 from public.creator_domain_orders where id in(select order_id from private.creator_domain_trial_receipts where org_id=p_org) for share;
 perform 1 from public.creator_billing_subscriptions where org_id=p_org for share;
 projection:=private.creator_platform_access_at_v1(p_user,p_org,app.app_key,clock_timestamp());
 eligible:=coalesce((projection->'capabilities'->'advanced'->>'allowed')::boolean,false);
 return jsonb_build_object('org_id',p_org,'mode',mode,'eligible',eligible,'app_key',app.app_key,'access',projection);
end$$;
create or replace function public.customer_social_access_v2(p_org uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin perform private.creator_trial_service_v1();return private.customer_social_access_v2(p_org,p_user);end$$;

-- Exact existing implementation moved behind guarded wrappers.
create or replace function private.customer_social_service_legacy_v1(p_action text,p_org uuid,p_user uuid,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
 s private.customer_social_sessions%rowtype;
 c private.customer_social_connections%rowtype;
 j public.social_publish_jobs%rowtype;
 v_secret uuid; v_account uuid; v_token text; v_key text;
begin
 if not exists(select 1 from public.org_members where org_id=p_org and profile_id=p_user and role='owner') then
   raise exception 'owner required' using errcode='42501';
 end if;
 -- Serialize connection changes and queue submission for this tenant.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,6742));
 select * into c from private.customer_social_connections where org_id=p_org;
 -- Expired staged credentials are removed during mutations; status is read-only.
 if p_action<>'status' then
 delete from vault.secrets where id in (select secret_id from private.customer_social_sessions where org_id=p_org and expires_at<now());
 delete from private.customer_social_sessions where org_id=p_org and expires_at<now();
 end if;
 if p_action='status' then
   if c.org_id is null then return null; end if;
   return (select jsonb_build_object('account_id',a.id,'handle',a.handle,'status',case when c.expires_at<=now() then 'reconnect_required' else a.status end,'connected_at',c.connected_at,'expires_at',c.expires_at) from public.social_accounts a where a.id=c.account_id and a.org_id=p_org);
 elsif p_action='begin' then
   -- Existing operator credentials are deliberately not overwritten.
   if c.org_id is null and exists(select 1 from public.org_channels where org_id=p_org and channel='instagram' and (secret_id is not null or token_env is not null)) then raise exception 'operator managed' using errcode='55000'; end if;
   delete from vault.secrets where id in (select secret_id from private.customer_social_sessions where org_id=p_org and user_id=p_user);
   delete from private.customer_social_sessions where org_id=p_org and user_id=p_user;
   insert into private.customer_social_sessions(state_hash,org_id,user_id) values(p_data->>'state_hash',p_org,p_user);
   return '{}'::jsonb;
 elsif p_action='claim' then
   update private.customer_social_sessions set claimed=true where state_hash=p_data->>'state_hash' and org_id=p_org and user_id=p_user and not claimed and expires_at>now() returning * into s;
   if s.state_hash is null then raise exception 'expired state' using errcode='P0002'; end if;
   return '{}'::jsonb;
 elsif p_action='stage' then
   select * into s from private.customer_social_sessions where state_hash=p_data->>'state_hash' and org_id=p_org and user_id=p_user and claimed and selection_hash is null and expires_at>now() for update;
   if s.state_hash is null then raise exception 'expired state' using errcode='P0002'; end if;
   select vault.create_secret(p_data->>'token',null,'Customer Instagram selection; expires in ten minutes') into v_secret;
   update private.customer_social_sessions set secret_id=v_secret,selection_hash=p_data->>'selection_hash',token_expires_at=(p_data->>'expires_at')::timestamptz where state_hash=s.state_hash;
   return '{}'::jsonb;
 elsif p_action in ('selection','install') then
   select * into s from private.customer_social_sessions where selection_hash=p_data->>'selection_hash' and org_id=p_org and user_id=p_user and expires_at>now() for update;
   if s.secret_id is null then raise exception 'expired selection' using errcode='P0002'; end if;
   if p_action='selection' then
     select decrypted_secret into v_token from vault.decrypted_secrets where id=s.secret_id;
     return jsonb_build_object('token',v_token);
   end if;
   if c.org_id is null and exists(select 1 from public.org_channels where org_id=p_org and channel='instagram' and (secret_id is not null or token_env is not null)) then raise exception 'operator managed' using errcode='55000'; end if;
   perform 1 from public.social_publish_jobs where org_id=p_org and state in ('queued','processing') for update;
   -- Never redirect an in-flight job to a different external account or delete its credential.
   if exists(select 1 from public.social_publish_jobs where org_id=p_org and state in ('queued','processing')) then raise exception 'publishing active' using errcode='55000'; end if;
   select vault.create_secret(p_data->>'token',null,'Customer Instagram Page publishing credential') into v_secret;
   insert into public.social_accounts(org_id,platform,external_account_id,handle,credential_ref,status,capabilities)
   values(p_org,'instagram',p_data->>'external_id',p_data->>'handle','vault:'||v_secret::text,'connected','{"reels":true}'::jsonb)
   on conflict(org_id,platform,external_account_id) do update set handle=excluded.handle,credential_ref=excluded.credential_ref,status='connected',updated_at=now()
   returning id into v_account;
   if c.account_id is not null and c.account_id<>v_account then
     update public.social_accounts set status='disconnected',credential_ref=null where id=c.account_id;
     update public.social_publish_jobs set state='cancelled',updated_at=now() where account_id=c.account_id and state in ('draft','failed');
   end if;
   insert into public.org_channels(org_id,channel,enabled,secret_id,account_id,account_label,connected_at)
   values(p_org,'instagram',true,v_secret,p_data->>'external_id',p_data->>'handle',now())
   on conflict(org_id,channel) do update set enabled=true,secret_id=excluded.secret_id,token_env=null,account_id=excluded.account_id,account_label=excluded.account_label,connected_at=now(),updated_at=now();
   insert into private.customer_social_connections(org_id,account_id,secret_id,connected_by,expires_at)
   values(p_org,v_account,v_secret,p_user,s.token_expires_at)
   on conflict(org_id) do update set account_id=excluded.account_id,secret_id=excluded.secret_id,connected_by=p_user,connected_at=now(),expires_at=excluded.expires_at;
   delete from vault.secrets where id in (s.secret_id,c.secret_id);
   delete from private.customer_social_sessions where state_hash=s.state_hash;
   return jsonb_build_object('connected',true,'account_id',v_account);
 elsif p_action='disconnect' then
   perform 1 from public.social_publish_jobs where org_id=p_org and state in ('queued','processing') for update;
   -- Claimed jobs may already have a token in memory. Do not falsely promise immediate revocation.
   if c.org_id is not null and exists(select 1 from public.social_publish_jobs where account_id=c.account_id and (state='processing' or (lease_expires_at is not null and lease_expires_at>now()))) then raise exception 'publishing active' using errcode='55000'; end if;
   if c.org_id is not null then
     update public.social_publish_jobs set state='cancelled',updated_at=now() where account_id=c.account_id and state in ('draft','queued','failed');
     update public.org_channels set enabled=false,secret_id=null,updated_at=now() where org_id=p_org and channel='instagram' and secret_id=c.secret_id;
     update public.social_accounts set status='disconnected',credential_ref=null where id=c.account_id and org_id=p_org;
     delete from private.customer_social_connections where org_id=p_org;
     delete from vault.secrets where id=c.secret_id;
   end if;
   delete from vault.secrets where id in (select secret_id from private.customer_social_sessions where org_id=p_org);
   delete from private.customer_social_sessions where org_id=p_org;
   return jsonb_build_object('disconnected',true,'provider_revoked',false);
 elsif p_action in ('ready','enqueue') then
   if c.org_id is null or c.expires_at<=now() or not exists(select 1 from public.org_channels where org_id=p_org and channel='instagram' and enabled and secret_id=c.secret_id) then raise exception 'reconnect required' using errcode='P0002'; end if;
   if p_action='ready' then return '{}'::jsonb; end if;
   v_key := 'customer-social:'||p_org::text||':'||(p_data->>'key');
   select * into j from public.social_publish_jobs where dedupe_key=v_key;
   if j.id is not null then
     if j.payload->>'request_hash' is distinct from p_data->>'hash' then raise exception 'idempotency conflict' using errcode='23505'; end if;
     return to_jsonb(j);
   end if;
   if not exists(select 1 from storage.objects where bucket_id='social-outbox' and name=p_data->'payload'->>'storage_path' and split_part(name,'/',1)=p_org::text and (metadata->>'size')::bigint between 1 and 524288000 and metadata->>'mimetype' in ('video/mp4','video/quicktime')) then raise exception 'upload not complete' using errcode='P0002'; end if;
   insert into public.social_publish_jobs(org_id,account_id,publish_mode,state,dedupe_key,payload)
   values(p_org,c.account_id,'reel','queued',v_key,(p_data->'payload')||jsonb_build_object('request_hash',p_data->>'hash')) returning * into j;
   return to_jsonb(j);
 end if;
 raise exception 'unknown action' using errcode='22023';
end;
$$;
create or replace function public.customer_social_service_v2(p_action text,p_org uuid,p_user uuid,p_data jsonb,p_mode text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare authz jsonb;
begin
 perform private.creator_trial_service_v1();
 perform pg_catalog.pg_advisory_xact_lock(182704,3);
 if p_action not in ('status','disconnect') then
  authz:=private.customer_social_access_v2(p_org,p_user);
  if p_mode is distinct from authz->>'mode' then raise exception 'social_consumer_mode_mismatch' using errcode='55000';end if;
  if not coalesce((authz->>'eligible')::boolean,false) then raise exception 'social_module_unentitled' using errcode='42501';end if;
 end if;
 return private.customer_social_service_legacy_v1(p_action,p_org,p_user,p_data);
end$$;
create or replace function public.customer_social_service(p_action text,p_org uuid,p_user uuid,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin return public.customer_social_service_v2(p_action,p_org,p_user,p_data,'legacy_paid');end$$;

create or replace function public.customer_social_credential_access(p_org uuid,p_secret uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare c private.customer_social_connections; authz jsonb;
begin
 perform private.creator_trial_service_v1();
 perform pg_catalog.pg_advisory_xact_lock(182704,3);
 select * into c from private.customer_social_connections where secret_id=p_secret for share;
 if c.org_id is null then return jsonb_build_object('managed',false,'allowed',true,'mode','legacy_paid');end if;
 if c.org_id is distinct from p_org then return jsonb_build_object('managed',true,'allowed',false,'mode','module');end if;
 begin authz:=private.customer_social_access_v2(c.org_id,c.connected_by);
 exception when insufficient_privilege then return jsonb_build_object('managed',true,'allowed',false,'mode','module');end;
 return jsonb_build_object('managed',true,'allowed',coalesce((authz->>'eligible')::boolean,false) and (c.expires_at is null or c.expires_at>clock_timestamp()),'mode',authz->>'mode','app_key',authz->>'app_key');
end$$;

-- Managed token release is part of the same transaction as the locked entitlement decision.
create or replace function public.customer_social_token_v2(p_org uuid,p_secret uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare decision jsonb; token text;
begin
 perform private.creator_trial_service_v1();
 decision:=public.customer_social_credential_access(p_org,p_secret);
 if not coalesce((decision->>'managed')::boolean,false) then return jsonb_build_object('managed',false,'mode','legacy_paid','token',null);end if;
 if not coalesce((decision->>'allowed')::boolean,false) then raise exception 'social_module_unentitled' using errcode='42501';end if;
 select decrypted_secret into token from vault.decrypted_secrets where id=p_secret;
 if token is null then raise exception 'social_credential_missing' using errcode='P0002';end if;
 return jsonb_build_object('managed',true,'mode',decision->>'mode','token',token);
end$$;
revoke all on function public.customer_social_token_v2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.customer_social_token_v2(uuid,uuid) to service_role;

create or replace function private.customer_social_job_gate() returns trigger
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare c private.customer_social_connections; authz jsonb; marked boolean;
begin
 marked:=new.payload->>'source'='customer-social' or starts_with(coalesce(new.dedupe_key,''),'customer-social:');
 if tg_op='UPDATE' then
  if old.payload->>'source'='customer-social' or starts_with(coalesce(old.dedupe_key,''),'customer-social:') then
   marked:=true;
   if (new.org_id,new.account_id,new.dedupe_key,new.payload->>'source') is distinct from (old.org_id,old.account_id,old.dedupe_key,old.payload->>'source') then raise exception 'social_job_scope_immutable' using errcode='42501';end if;
  end if;
 end if;
 if new.state in ('queued','processing') then
  perform pg_catalog.pg_advisory_xact_lock(182704,3);
  select * into c from private.customer_social_connections where org_id=new.org_id for share;
  if c.org_id is null and coalesce(marked,false) then raise exception 'social_connection_required' using errcode='42501';end if;
  if c.org_id is not null then
   if c.account_id is distinct from new.account_id then raise exception 'social_account_scope_mismatch' using errcode='42501';end if;
   if tg_op='UPDATE' then
    -- Preserve status/lease release bookkeeping; actual queued→processing claims reauthorize.
    if old.state=new.state and old.org_id=new.org_id and old.account_id=new.account_id and old.payload=new.payload then return new;end if;
   end if;
   authz:=private.customer_social_access_v2(new.org_id,c.connected_by);
   if not coalesce((authz->>'eligible')::boolean,false) then raise exception 'social_module_unentitled' using errcode='42501';end if;
  end if;
 end if;
 return new;
end$$;
revoke all on function private.customer_social_policy_guard_v2(),private.customer_social_access_v2(uuid,uuid),private.customer_social_service_legacy_v1(text,uuid,uuid,jsonb),private.customer_social_job_gate() from public,anon,authenticated,service_role;
revoke all on function public.customer_social_access_v2(uuid,uuid),public.customer_social_service_v2(text,uuid,uuid,jsonb,text),public.customer_social_service(text,uuid,uuid,jsonb),public.customer_social_credential_access(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.customer_social_access_v2(uuid,uuid),public.customer_social_service_v2(text,uuid,uuid,jsonb,text),public.customer_social_service(text,uuid,uuid,jsonb),public.customer_social_credential_access(uuid,uuid) to service_role;
-- private.customer_social_paid remains unchanged: world_social_delivery stays paid-only.
commit;
