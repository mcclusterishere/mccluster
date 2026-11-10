-- Pending review and authorized deployment. Never grants paid access.
-- COM-3: the reservation is an active-owner guard; attempts are permanent receipts.
-- Run this entire file transactionally. No provider result is inferred from time.
begin;
create table if not exists public.creator_checkout_reservations (
 owner_user_id uuid primary key references auth.users(id),
 request_id text not null,
 price_id text not null,
 checkout_session_id text,
 expires_at timestamptz not null
);
create table if not exists public.creator_checkout_attempts (
 owner_user_id uuid not null references auth.users(id),
 request_id text not null,
 price_id text not null,
 provider_payload jsonb,
 idempotency_key text not null unique,
 state text not null check (state in ('reserved','uncertain','session_bound','rejected','requires_owner','expired')),
 checkout_session_id text unique,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 retry_until timestamptz not null,
 dispatch_count integer not null default 0 check (dispatch_count >= 0),
 had_uncertain boolean not null default false,
 released_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key (owner_user_id,request_id),
 unique (owner_user_id,request_id,price_id,expires_at),
 check (provider_payload is null or jsonb_typeof(provider_payload)='object'),
 check (checkout_session_id is null or checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
 check (state not in ('session_bound','expired') or checkout_session_id is not null),
 check (state not in ('rejected','expired') or released_at is not null)
);
create index if not exists creator_checkout_attempts_recovery_queue
 on public.creator_checkout_attempts(created_at,owner_user_id) where state in ('reserved','uncertain','requires_owner');
create table if not exists public.creator_checkout_recovery_audit (
 id bigint generated always as identity primary key,
 owner_user_id uuid not null,
 request_id text not null,
 actor_user_id uuid references auth.users(id),
 action text not null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 foreign key(owner_user_id,request_id) references public.creator_checkout_attempts(owner_user_id,request_id)
);
-- Upgrade an earlier pending draft without inventing its original request body.
-- Known sessions can still be reconciled by GET. Unknown sessions require owner
-- attention and keep their guard; an old idempotency key must never get a new body.
insert into public.creator_checkout_attempts(owner_user_id,request_id,price_id,idempotency_key,state,
 checkout_session_id,created_at,expires_at,retry_until,had_uncertain)
 select owner_user_id,request_id,price_id,'creator-checkout-'||owner_user_id::text||'-'||request_id,
 case when checkout_session_id is null then 'requires_owner' else 'session_bound' end,
 checkout_session_id,expires_at-interval '35 minutes',expires_at,expires_at,true
 from public.creator_checkout_reservations on conflict (owner_user_id,request_id) do nothing;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.creator_checkout_reservations'::regclass and conname='creator_checkout_reservation_attempt_fk') then
  alter table public.creator_checkout_reservations add constraint creator_checkout_reservation_attempt_fk
   foreign key(owner_user_id,request_id,price_id,expires_at)
   references public.creator_checkout_attempts(owner_user_id,request_id,price_id,expires_at);
 end if;
end $$;
alter table public.creator_checkout_reservations enable row level security;
alter table public.creator_checkout_attempts enable row level security;
alter table public.creator_checkout_recovery_audit enable row level security;
revoke all on public.creator_checkout_reservations,public.creator_checkout_attempts,public.creator_checkout_recovery_audit from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.creator_checkout_reservations to service_role;
grant select,insert,update on public.creator_checkout_attempts to service_role;
grant select,insert on public.creator_checkout_recovery_audit to service_role;
revoke all on sequence public.creator_checkout_recovery_audit_id_seq from public,anon,authenticated,service_role;
grant usage on sequence public.creator_checkout_recovery_audit_id_seq to service_role;

create or replace function public.protect_creator_checkout_attempt()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'checkout attempt receipts cannot be deleted'; end if;
 if row(new.owner_user_id,new.request_id,new.price_id,new.provider_payload,new.idempotency_key,new.created_at,new.expires_at,new.retry_until)
  is distinct from row(old.owner_user_id,old.request_id,old.price_id,old.provider_payload,old.idempotency_key,old.created_at,old.expires_at,old.retry_until) then
  raise exception 'checkout attempt identity is immutable';
 end if;
 if new.dispatch_count<old.dispatch_count or (old.had_uncertain and not new.had_uncertain)
  or (old.checkout_session_id is not null and new.checkout_session_id is distinct from old.checkout_session_id)
  or (old.state in ('rejected','expired') and new.state<>old.state)
  or (old.released_at is not null and new.released_at is distinct from old.released_at) then
  raise exception 'checkout attempt history cannot be erased';
 end if;
 new.updated_at=now();
 return new;
end $$;
drop trigger if exists creator_checkout_attempt_immutable on public.creator_checkout_attempts;
create trigger creator_checkout_attempt_immutable before update or delete on public.creator_checkout_attempts
 for each row execute function public.protect_creator_checkout_attempt();
create or replace function public.protect_creator_checkout_recovery_audit()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin raise exception 'checkout recovery audit is append-only'; end $$;
drop trigger if exists creator_checkout_recovery_audit_immutable on public.creator_checkout_recovery_audit;
create trigger creator_checkout_recovery_audit_immutable before update or delete on public.creator_checkout_recovery_audit
 for each row execute function public.protect_creator_checkout_recovery_audit();
revoke all on function public.protect_creator_checkout_attempt(),public.protect_creator_checkout_recovery_audit() from public,anon,authenticated;

-- Remove the old overload, so a three-argument call resolves to the safe default:
-- only an existing original identity may omit its payload, never a new attempt.
drop function if exists public.reserve_creator_checkout(uuid,text,text);
create or replace function public.reserve_creator_checkout(p_owner uuid,p_request text,p_price text,p_payload jsonb default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare attempt public.creator_checkout_attempts; reservation public.creator_checkout_reservations; expiry timestamptz;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if p_owner is null or p_request is null or p_request !~ '^[a-zA-Z0-9-]{16,80}$' or p_price is null or p_price !~ '^price_[A-Za-z0-9]+$' then raise exception 'invalid checkout request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if exists(select 1 from public.creator_billing_subscriptions where owner_user_id=p_owner and status in ('active','trialing','past_due','unpaid','incomplete','paused')) then
  return jsonb_build_object('blocked',true,'reason','existing_subscription');
 end if;
 select * into attempt from public.creator_checkout_attempts where owner_user_id=p_owner and request_id=p_request for update;
 if found then
  if attempt.price_id<>p_price or (p_payload is not null and
    ((p_payload-'expires_at') is distinct from (attempt.provider_payload-'expires_at') or
     (p_payload ? 'expires_at' and p_payload->'expires_at' is distinct from attempt.provider_payload->'expires_at'))) then
   return jsonb_build_object('blocked',true,'reason','checkout_identity_conflict');
  end if;
  if attempt.state in ('rejected','expired') or attempt.released_at is not null then
   return jsonb_build_object('blocked',true,'reason','checkout_request_retired','state',attempt.state);
  end if;
 end if;
 select * into reservation from public.creator_checkout_reservations where owner_user_id=p_owner for update;
 if found then
  if reservation.request_id<>p_request or reservation.price_id<>p_price then
   return jsonb_build_object('blocked',true,'reason','checkout_pending','expires_at',reservation.expires_at);
  end if;
  if attempt.owner_user_id is null then raise exception 'checkout receipt missing'; end if;
  if attempt.state='session_bound' and attempt.expires_at<=now() then
   return jsonb_build_object('blocked',true,'reason','checkout_reconciliation_required','state',attempt.state);
  end if;
  if attempt.state='requires_owner' or (attempt.checkout_session_id is null and (attempt.provider_payload is null or attempt.retry_until<=now())) then
   update public.creator_checkout_attempts set state='requires_owner',had_uncertain=true where owner_user_id=p_owner and request_id=p_request;
   return jsonb_build_object('blocked',true,'reason','checkout_requires_owner','state','requires_owner');
  end if;
  if attempt.checkout_session_id is null then
   -- Claim each possible provider dispatch BEFORE I/O. A process crash cannot
   -- make the next rejection look like the first request's definitive answer.
   update public.creator_checkout_attempts set dispatch_count=dispatch_count+1
    where owner_user_id=p_owner and request_id=p_request returning * into attempt;
   insert into public.creator_checkout_recovery_audit(owner_user_id,request_id,action,details)
    values(p_owner,p_request,'provider_dispatch',jsonb_build_object('dispatch_count',attempt.dispatch_count));
  end if;
 else
  -- A receipt without its guard must never be reanimated, even if corrupted by
  -- a future operator tool. Only a genuinely new identity may create a guard.
  if attempt.owner_user_id is not null then
   return jsonb_build_object('blocked',true,'reason','checkout_requires_owner','state',attempt.state);
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ? 'expires_at'
   or p_payload->>'mode' is distinct from 'subscription'
   or p_payload->>'client_reference_id' is distinct from p_owner::text
   or p_payload#>>'{metadata,mccluster_user_id}' is distinct from p_owner::text
   or p_payload#>>'{subscription_data,metadata,mccluster_user_id}' is distinct from p_owner::text
   or p_payload#>>'{metadata,creator_request_id}' is distinct from p_request
   or p_payload#>'{metadata}' is distinct from p_payload#>'{subscription_data,metadata}'
   or coalesce(p_payload#>>'{metadata,creator_plan}','') not in ('starter','plus','pro','business')
   or coalesce(p_payload#>>'{metadata,creator_period}','') not in ('monthly','annual')
   or coalesce(p_payload#>>'{metadata,creator_provider_mode}','') not in ('test','live')
   or p_payload->'line_items' is distinct from jsonb_build_array(jsonb_build_object('price',p_price,'quantity',1)) then
   raise exception 'canonical checkout payload required';
  end if;
  expiry=date_trunc('second',now()+interval '35 minutes');
  insert into public.creator_checkout_attempts(owner_user_id,request_id,price_id,provider_payload,idempotency_key,state,expires_at,retry_until,dispatch_count)
   values(p_owner,p_request,p_price,p_payload||jsonb_build_object('expires_at',extract(epoch from expiry)::bigint),
    'creator-checkout-'||p_owner::text||'-'||p_request,'reserved',expiry,now()+interval '23 hours',1) returning * into attempt;
  insert into public.creator_checkout_reservations(owner_user_id,request_id,price_id,expires_at) values(p_owner,p_request,p_price,expiry);
  insert into public.creator_checkout_recovery_audit(owner_user_id,request_id,action,details)
   values(p_owner,p_request,'provider_dispatch','{"dispatch_count":1}'::jsonb);
 end if;
 return jsonb_build_object('blocked',false,'request_id',attempt.request_id,'price_id',attempt.price_id,'expires_at',attempt.expires_at,
  'retry_until',attempt.retry_until,'state',attempt.state,'checkout_session_id',attempt.checkout_session_id,
  'provider_payload',attempt.provider_payload,'idempotency_key',attempt.idempotency_key);
end $$;
revoke all on function public.reserve_creator_checkout(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_creator_checkout(uuid,text,text,jsonb) to service_role;

-- Only a complete, first-dispatch pre-execution rejection can remove a guard.
-- Provider bodies/messages are not audit data. Keep only the classification and
-- provider request id; the worker validates status/type and the request-id header.
create or replace function public.mark_creator_checkout_outcome(p_owner uuid,p_request text,p_outcome text,p_details jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare attempt public.creator_checkout_attempts; target_state text; released boolean=false; evidence jsonb;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if p_outcome is null or p_outcome not in ('uncertain','rejected','requires_owner') or jsonb_typeof(p_details) is distinct from 'object' then raise exception 'invalid checkout outcome'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into attempt from public.creator_checkout_attempts where owner_user_id=p_owner and request_id=p_request for update;
 if not found then return jsonb_build_object('recorded',false,'released',false); end if;
 evidence=jsonb_strip_nulls(jsonb_build_object('status',p_details->'status','type',p_details->'type','pre_execution',p_details->'pre_execution','provider_request_id',left(p_details->>'provider_request_id',255)));
 if attempt.state in ('rejected','expired') or (attempt.state='session_bound' and p_outcome<>'requires_owner') then
  -- An out-of-order negative response cannot erase a known provider session.
  -- Explicit identity/mode mismatch can queue a bound session for the owner
  -- without ever replacing that session id or releasing its active guard.
  insert into public.creator_checkout_recovery_audit(owner_user_id,request_id,action,details)
   values(p_owner,p_request,'ignored_provider_outcome',evidence||jsonb_build_object('outcome',p_outcome,'state',attempt.state));
  return jsonb_build_object('recorded',true,'state',attempt.state,'released',attempt.state='rejected');
 end if;
 target_state=case when p_outcome='requires_owner' or attempt.state='requires_owner' then 'requires_owner' else 'uncertain' end;
 if p_outcome='rejected' and attempt.state='reserved' and attempt.dispatch_count=1 and not attempt.had_uncertain
  and attempt.checkout_session_id is null and p_details->'status'='400'::jsonb
  and p_details->>'type'='invalid_request_error' and p_details->'pre_execution'='true'::jsonb
  and coalesce(p_details->>'provider_request_id','') ~ '^req_[A-Za-z0-9]+$' then
  delete from public.creator_checkout_reservations where owner_user_id=p_owner and request_id=p_request and checkout_session_id is null;
  if found then target_state='rejected'; released=true; end if;
 end if;
 update public.creator_checkout_attempts set state=target_state,
  had_uncertain=had_uncertain or target_state in ('uncertain','requires_owner'),
  released_at=case when released then now() else released_at end
  where owner_user_id=p_owner and request_id=p_request;
 insert into public.creator_checkout_recovery_audit(owner_user_id,request_id,action,details)
  values(p_owner,p_request,'provider_outcome',evidence||jsonb_build_object('outcome',p_outcome,'state',target_state,'released',released));
 return jsonb_build_object('recorded',true,'state',target_state,'released',released);
end $$;
revoke all on function public.mark_creator_checkout_outcome(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.mark_creator_checkout_outcome(uuid,text,text,jsonb) to service_role;

-- Worker authorization is canonical: only isHouseOwner may invoke the operator
-- route. The RPC takes that verified actor for a durable receipt, not authority.
-- There is deliberately no override/release action, and no free-text SQL action.
create or replace function public.audit_creator_checkout_recovery(p_owner uuid,p_request text,p_actor uuid,p_action text,p_details jsonb default '{}'::jsonb)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if p_actor is null or p_action is null or p_action not in ('reconcile_requested','reconcile_completed','reconcile_failed')
  or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>8192 then raise exception 'invalid recovery audit'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if not exists(select 1 from public.creator_checkout_attempts where owner_user_id=p_owner and request_id=p_request) then return false; end if;
 insert into public.creator_checkout_recovery_audit(owner_user_id,request_id,actor_user_id,action,details)
  values(p_owner,p_request,p_actor,p_action,p_details);
 return true;
end $$;
revoke all on function public.audit_creator_checkout_recovery(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.audit_creator_checkout_recovery(uuid,text,uuid,text,jsonb) to service_role;

-- Persist the provider ID without allowing a competing attempt to replace it.
create or replace function public.bind_creator_checkout(p_owner uuid,p_request text,p_session text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare attempt public.creator_checkout_attempts;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if p_session is null or p_session !~ '^cs_[A-Za-z0-9_]+$' then raise exception 'invalid session'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into attempt from public.creator_checkout_attempts where owner_user_id=p_owner and request_id=p_request for update;
 if not found or attempt.state in ('rejected','expired') or (attempt.checkout_session_id is not null and attempt.checkout_session_id<>p_session) then return false; end if;
 if exists(select 1 from public.creator_checkout_attempts where checkout_session_id=p_session and (owner_user_id<>p_owner or request_id<>p_request)) then return false; end if;
 update public.creator_checkout_reservations set checkout_session_id=p_session
  where owner_user_id=p_owner and request_id=p_request and (checkout_session_id is null or checkout_session_id=p_session);
 if not found then return false; end if;
 update public.creator_checkout_attempts set checkout_session_id=p_session,state='session_bound'
  where owner_user_id=p_owner and request_id=p_request;
 insert into public.creator_checkout_recovery_audit(owner_user_id,request_id,action,details)
  values(p_owner,p_request,'session_bound',jsonb_build_object('checkout_session_id',p_session));
 return true;
end $$;
revoke all on function public.bind_creator_checkout(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bind_creator_checkout(uuid,text,text) to service_role;

-- Worker must retrieve and verify this exact Stripe session is expired before
-- calling, including its owner/request/price metadata. Never free on time alone.
create or replace function public.release_expired_creator_checkout(p_owner uuid,p_session text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare reservation public.creator_checkout_reservations;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into reservation from public.creator_checkout_reservations where owner_user_id=p_owner and checkout_session_id=p_session and expires_at<=now() for update;
 if not found then return false; end if;
 -- A delayed signed webhook may already have recorded the subscription. Even a
 -- later expired-session answer must not remove the one-subscription protection.
 if exists(select 1 from public.creator_billing_subscriptions where owner_user_id=p_owner and status in ('active','trialing','past_due','unpaid','incomplete','paused')) then return false; end if;
 update public.creator_checkout_attempts set state='expired',released_at=now()
  where owner_user_id=p_owner and request_id=reservation.request_id and checkout_session_id=p_session and state='session_bound';
 if not found then return false; end if;
 delete from public.creator_checkout_reservations where owner_user_id=p_owner and request_id=reservation.request_id and checkout_session_id=p_session;
 insert into public.creator_checkout_recovery_audit(owner_user_id,request_id,action,details)
  values(p_owner,reservation.request_id,'verified_session_expired',jsonb_build_object('checkout_session_id',p_session));
 return true;
end $$;
revoke all on function public.release_expired_creator_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.release_expired_creator_checkout(uuid,text) to service_role;
commit;
