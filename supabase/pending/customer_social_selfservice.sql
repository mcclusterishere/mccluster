-- REVIEW ONLY. Apply only after approval; then record the actual ledger version.
-- Reuses canonical org_channels, Vault, social_accounts and leased social_publish_jobs.
begin;
create schema if not exists private;
create table if not exists private.customer_social_sessions (
 state_hash text primary key, org_id uuid not null references public.orgs(id) on delete cascade,
 user_id uuid not null, expires_at timestamptz not null default now()+interval '10 minutes',
 claimed boolean not null default false, selection_hash text unique, secret_id uuid, token_expires_at timestamptz
);
create table if not exists private.customer_social_connections (
 org_id uuid primary key references public.orgs(id) on delete cascade,
 account_id uuid not null references public.social_accounts(id), secret_id uuid not null,
 connected_by uuid not null, connected_at timestamptz not null default now(), expires_at timestamptz
);
alter table private.customer_social_sessions enable row level security;
alter table private.customer_social_connections enable row level security;
revoke all on private.customer_social_sessions, private.customer_social_connections from public, anon, authenticated;

create or replace function public.customer_social_service(p_action text,p_org uuid,p_user uuid,p_data jsonb default '{}'::jsonb)
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
revoke all on function public.customer_social_service(text,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.customer_social_service(text,uuid,uuid,jsonb) to service_role;
-- Credential pointers are backend authority, not an owner-editable preference.
-- Invoker rights are deliberate: SECURITY DEFINER RPCs run as their owner,
-- whereas direct PostgREST writes retain the authenticated role.
create or replace function private.social_channel_credential_guard()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if current_user in ('anon','authenticated') then
   if tg_op='INSERT' then
     if new.token_env is not null or new.secret_id is not null then raise exception 'credential bindings require backend authority' using errcode='42501'; end if;
   elsif tg_op='UPDATE' then
     if new.token_env is distinct from old.token_env or new.secret_id is distinct from old.secret_id or new.account_id is distinct from old.account_id then raise exception 'credential bindings require backend authority' using errcode='42501'; end if;
   elsif old.token_env is not null or old.secret_id is not null then
     raise exception 'credential bindings require backend authority' using errcode='42501';
   end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function private.social_channel_credential_guard() from public,anon,authenticated;
drop trigger if exists social_channel_credential_guard on public.org_channels;
create trigger social_channel_credential_guard before insert or update or delete on public.org_channels for each row execute function private.social_channel_credential_guard();

-- Reuse the canonical publisher's scheduled pass to remove abandoned selections.
create or replace function public.customer_social_selection_gc()
returns integer language plpgsql security definer set search_path=pg_catalog,private as $$
declare n integer;
begin
 delete from vault.secrets where id in (select secret_id from private.customer_social_sessions where expires_at<now());
 delete from private.customer_social_sessions where expires_at<now();
 get diagnostics n=row_count;
 return n;
end;
$$;
revoke all on function public.customer_social_selection_gc() from public,anon,authenticated;
grant execute on function public.customer_social_selection_gc() to service_role;

-- Tenant deletion cascades must not orphan provider credentials in Vault.
create or replace function private.customer_social_delete_secret()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 delete from vault.secrets where id=old.secret_id;
 return old;
end;
$$;
revoke all on function private.customer_social_delete_secret() from public,anon,authenticated;
drop trigger if exists customer_social_session_secret_cleanup on private.customer_social_sessions;
create trigger customer_social_session_secret_cleanup after delete on private.customer_social_sessions for each row execute function private.customer_social_delete_secret();
drop trigger if exists customer_social_connection_secret_cleanup on private.customer_social_connections;
create trigger customer_social_connection_secret_cleanup after delete on private.customer_social_connections for each row execute function private.customer_social_delete_secret();

-- Enforce the paid boundary beneath every API route, including legacy social controls.
create or replace function private.customer_social_paid(p_org uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public,private as $$
 select exists(select 1 from public.creator_billing_subscriptions b
 join public.org_members m on m.org_id=b.org_id and m.profile_id=b.owner_user_id and m.role='owner'
 where b.org_id=p_org and b.status='active' and b.current_period_end>now());
$$;
revoke all on function private.customer_social_paid(uuid) from public, anon, authenticated;

create or replace function public.customer_social_credential_access(p_org uuid,p_secret uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare c private.customer_social_connections%rowtype;
begin
 select * into c from private.customer_social_connections where secret_id=p_secret;
 if c.org_id is null then return jsonb_build_object('managed',false,'allowed',true); end if;
 return jsonb_build_object('managed',true,'allowed',c.org_id=p_org and (c.expires_at is null or c.expires_at>now()) and private.customer_social_paid(c.org_id));
end;
$$;
revoke all on function public.customer_social_credential_access(uuid,uuid) from public, anon, authenticated;
grant execute on function public.customer_social_credential_access(uuid,uuid) to service_role;

create or replace function private.customer_social_job_gate()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if new.state in ('queued','processing') and exists(select 1 from private.customer_social_connections where org_id=new.org_id) then
   if tg_op='UPDATE' then
     -- Lease releases/status polling must still work after entitlement expires.
     if old.state=new.state and old.org_id=new.org_id and old.account_id=new.account_id and old.payload=new.payload then return new; end if;
   end if;
   if not private.customer_social_paid(new.org_id) then raise exception 'active site plan required' using errcode='42501'; end if;
 end if;
 return new;
end;
$$;
revoke all on function private.customer_social_job_gate() from public, anon, authenticated;
drop trigger if exists customer_social_job_gate on public.social_publish_jobs;
create trigger customer_social_job_gate before insert or update on public.social_publish_jobs for each row execute function private.customer_social_job_gate();
commit;
