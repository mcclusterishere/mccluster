-- PENDING/local-review only. No seed, billing action or production activation.
-- Reuses domain order/quote/contact, org ownership, platform_apps and creator billing.
begin;
create schema if not exists private;
create table if not exists private.creator_domain_trial_policies (
 version integer primary key check(version>0), enabled boolean not null default false,
 trigger_kind text not null check(trigger_kind='registration_verified'),
 duration_kind text not null check(duration_kind in ('calendar_month_utc','fixed_30_days')),
 eligibility text not null check(eligibility='once_per_org'),
 allow_sandbox boolean not null default false,
 freshness_seconds integer not null check(freshness_seconds between 1 and 3600)
);
create unique index if not exists creator_domain_trial_one_enabled on private.creator_domain_trial_policies(enabled) where enabled;
create table if not exists private.creator_domain_trial_modules (
 policy_version integer not null references private.creator_domain_trial_policies(version),
 app_id uuid not null references public.platform_apps(id) on delete restrict,
 advanced boolean not null default false, white_label boolean not null default false,
 stripe_price_id text check(stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
 primary key(policy_version,app_id)
);
create table if not exists private.creator_domain_trial_receipts (
 order_id uuid primary key references public.creator_domain_orders(id) on delete restrict,
 org_id uuid not null unique references public.orgs(id) on delete restrict,
 owner_user_id uuid not null references auth.users(id) on delete restrict,
 hostname text not null, registration_id text not null,
 registered_at timestamptz not null, domain_expires_at timestamptz not null,
 verified_at timestamptz not null, trial_starts_at timestamptz not null, trial_expires_at timestamptz not null,
 policy_snapshot jsonb not null, evidence jsonb not null,
 cancelled_at timestamptz,
 check(domain_expires_at>registered_at),check(trial_expires_at>trial_starts_at),
 check(trial_expires_at<=domain_expires_at)
);
-- These are registration/trial execution receipts, not a second billing ledger.
create table if not exists private.creator_domain_trial_events (
 event_key text primary key check(length(event_key) between 1 and 200),
 order_id uuid not null references private.creator_domain_trial_receipts(order_id) on delete restrict,
 org_id uuid not null, owner_user_id uuid not null,
 operation text not null check(operation in ('record','cancel')),
 payload jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin
 foreach t in array array['creator_domain_trial_policies','creator_domain_trial_modules','creator_domain_trial_receipts','creator_domain_trial_events'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('alter table private.%I force row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end$$;
create or replace function private.creator_trial_service_v1() returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'trial_service_required' using errcode='42501';end if;
end$$;
create or replace function private.creator_trial_owner_v1(p_user uuid,p_org uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.m_auth_user_links l join public.m_people m on m.id=l.m_uid
 where l.auth_user_id=p_user and l.is_primary and m.status='active' for share of l,m;
 if not found then raise exception 'trial_owner_required' using errcode='42501';end if;
 perform 1 from public.org_members where org_id=p_org and profile_id=p_user and role='owner' for share;
 if not found then raise exception 'trial_owner_required' using errcode='42501';end if;
end$$;
create or replace function private.creator_trial_end_v1(p_start timestamptz,p_duration text) returns timestamptz
language plpgsql immutable set search_path='' as $$
begin
 if p_duration='calendar_month_utc' then return ((p_start at time zone 'UTC')+interval '1 month') at time zone 'UTC';
 elsif p_duration='fixed_30_days' then return p_start+interval '720 hours';
 else raise exception 'trial_duration_required' using errcode='22023';end if;
end$$;
create or replace function private.creator_trial_receipt_guard_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') or tg_table_name='creator_domain_trial_events' then raise exception 'trial_receipt_immutable' using errcode='42501';end if;
 if (to_jsonb(new)-'cancelled_at') is distinct from (to_jsonb(old)-'cancelled_at')
 or (old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at)
 or (old.cancelled_at is null and new.cancelled_at is null) then raise exception 'trial_receipt_immutable' using errcode='42501';end if;
 return new;
end$$;
drop trigger if exists creator_trial_receipt_guard on private.creator_domain_trial_receipts;
create trigger creator_trial_receipt_guard before update or delete on private.creator_domain_trial_receipts for each row execute function private.creator_trial_receipt_guard_v1();
drop trigger if exists creator_trial_event_guard on private.creator_domain_trial_events;
create trigger creator_trial_event_guard before update or delete on private.creator_domain_trial_events for each row execute function private.creator_trial_receipt_guard_v1();
drop trigger if exists creator_trial_receipt_truncate on private.creator_domain_trial_receipts;
create trigger creator_trial_receipt_truncate before truncate on private.creator_domain_trial_receipts execute function private.creator_trial_receipt_guard_v1();
drop trigger if exists creator_trial_event_truncate on private.creator_domain_trial_events;
create trigger creator_trial_event_truncate before truncate on private.creator_domain_trial_events execute function private.creator_trial_receipt_guard_v1();
create or replace function public.creator_domain_trial_record_v1(p_owner uuid,p_org uuid,p_order uuid,p_event text,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare o public.creator_domain_orders; q public.creator_domain_quotes; c public.creator_domain_contacts;
 policy private.creator_domain_trial_policies; receipt private.creator_domain_trial_receipts; ev private.creator_domain_trial_events;
 observed timestamptz; registered timestamptz; expires timestamptz; at_time timestamptz; modules jsonb; snap jsonb;
begin
 perform private.creator_trial_service_v1();perform private.creator_trial_owner_v1(p_owner,p_org);
 if p_event is null or length(p_event) not between 1 and 200 or jsonb_typeof(p_evidence) is distinct from 'object' then raise exception 'trial_invalid_request' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(182704,3);
 select * into ev from private.creator_domain_trial_events where event_key=p_event;
 if found then
  if (ev.order_id,ev.org_id,ev.owner_user_id,ev.operation,ev.payload) is distinct from (p_order,p_org,p_owner,'record',p_evidence) then raise exception 'trial_event_conflict' using errcode='PT409';end if;
  select * into receipt from private.creator_domain_trial_receipts where order_id=p_order;
  return to_jsonb(receipt)-'evidence';
 end if;
 select * into receipt from private.creator_domain_trial_receipts where order_id=p_order;
 if found then
  if (receipt.org_id,receipt.owner_user_id,receipt.evidence) is distinct from (p_org,p_owner,p_evidence) then raise exception 'trial_receipt_conflict' using errcode='PT409';end if;
  insert into private.creator_domain_trial_events values(p_event,p_order,p_org,p_owner,'record',p_evidence,clock_timestamp());
  return to_jsonb(receipt)-'evidence';
 end if;
 select * into policy from private.creator_domain_trial_policies where enabled for share;
 if not found then raise exception 'trial_disabled' using errcode='55000';end if;
 if exists(select 1 from private.creator_domain_trial_receipts where org_id=p_org) then raise exception 'trial_already_used' using errcode='PT409';end if;
 select * into o from public.creator_domain_orders where id=p_order and auth_user_id=p_owner for share;
 if not found or o.status<>'fulfilled' or o.checkout_session_id is null or o.funded_event_id is null or o.funded_at is null then raise exception 'trial_registration_unverified' using errcode='42501';end if;
 select * into q from public.creator_domain_quotes where id=o.quote_id and auth_user_id=p_owner for share;
 select * into c from public.creator_domain_contacts where id=o.contact_id and auth_user_id=p_owner for share;
 if q.id is null or c.id is null or q.action<>'register' or q.years<>1 or o.paid_cents is distinct from q.total_cents then raise exception 'trial_order_not_qualifying' using errcode='42501';end if;
 if exists(select 1 from jsonb_object_keys(p_evidence) k where k not in ('source','mode','hostname','registration_id','registrant_contact_id','registrant_verified','charge_verified','registrar_cents','currency','term_years','registered_at','expires_at','observed_at'))
 or p_evidence->>'source' is distinct from 'verified_registrar_readback'
 or p_evidence->>'mode' not in ('live','sandbox') or p_evidence->>'mode' is null
 or (p_evidence->>'mode'='sandbox' and not policy.allow_sandbox)
 or p_evidence->>'hostname' is distinct from q.hostname
 or p_evidence->>'registrant_contact_id' is distinct from c.provider_contact_id
 or p_evidence->'registrant_verified' is distinct from 'true'::jsonb
 or p_evidence->'charge_verified' is distinct from 'true'::jsonb
 or p_evidence->'registrar_cents' is distinct from to_jsonb(q.registrar_cents)
 or p_evidence->>'currency' is distinct from q.currency
 or p_evidence->'term_years' is distinct from '1'::jsonb
 or coalesce(length(p_evidence->>'registration_id'),0) not between 1 and 200
 then raise exception 'trial_evidence_mismatch' using errcode='42501';end if;
 observed:=(p_evidence->>'observed_at')::timestamptz;registered:=(p_evidence->>'registered_at')::timestamptz;expires:=(p_evidence->>'expires_at')::timestamptz;
 at_time:=clock_timestamp();
 if observed is null or registered is null or expires is null or not isfinite(observed) or not isfinite(registered) or not isfinite(expires)
 or observed>at_time or observed<at_time-make_interval(secs=>policy.freshness_seconds)
 or registered>observed or registered<o.funded_at or expires<=at_time or expires<=registered
 then raise exception 'trial_evidence_stale' using errcode='42501';end if;
 select jsonb_object_agg(a.app_key,jsonb_build_object('app_id',a.id,'advanced',m.advanced,'white_label',m.white_label)) into modules
 from private.creator_domain_trial_modules m join public.platform_apps a on a.id=m.app_id and a.enabled where m.policy_version=policy.version;
 if modules is null then raise exception 'trial_modules_unconfigured' using errcode='55000';end if;
 snap:=to_jsonb(policy)||jsonb_build_object('modules',modules);
 insert into private.creator_domain_trial_receipts values(p_order,p_org,p_owner,q.hostname,p_evidence->>'registration_id',registered,expires,at_time,at_time,
 least(private.creator_trial_end_v1(at_time,policy.duration_kind),expires),snap,p_evidence,null) returning * into receipt;
 insert into private.creator_domain_trial_events values(p_event,p_order,p_org,p_owner,'record',p_evidence,at_time);
 return to_jsonb(receipt)-'evidence';
end$$;
create or replace function public.creator_domain_trial_cancel_v1(p_owner uuid,p_org uuid,p_order uuid,p_event text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.creator_domain_trial_receipts; ev private.creator_domain_trial_events;
begin
 perform private.creator_trial_service_v1();perform private.creator_trial_owner_v1(p_owner,p_org);
 if p_event is null or length(p_event) not between 1 and 200 then raise exception 'trial_invalid_request' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(182704,3);
 select * into r from private.creator_domain_trial_receipts where order_id=p_order and org_id=p_org and owner_user_id=p_owner;
 if not found then raise exception 'trial_not_found' using errcode='P0002';end if;
 select * into ev from private.creator_domain_trial_events where event_key=p_event;
 if found then
  if (ev.order_id,ev.org_id,ev.owner_user_id,ev.operation) is distinct from (p_order,p_org,p_owner,'cancel') then raise exception 'trial_event_conflict' using errcode='PT409';end if;
  return to_jsonb(r)-'evidence';
 end if;
 if r.cancelled_at is null then update private.creator_domain_trial_receipts set cancelled_at=clock_timestamp() where order_id=p_order returning * into r;end if;
 insert into private.creator_domain_trial_events values(p_event,p_order,p_org,p_owner,'cancel','{}',clock_timestamp());
 return to_jsonb(r)-'evidence';
end$$;
create or replace function private.creator_platform_access_at_v1(p_user uuid,p_org uuid,p_app text,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.platform_apps; r private.creator_domain_trial_receipts; policy private.creator_domain_trial_policies; mapping private.creator_domain_trial_modules;
 state text; entitled boolean:=false; paid boolean:=false; advanced boolean:=false; white_label boolean:=false; reason text:='unentitled'; order_status text;
begin
 perform private.creator_trial_owner_v1(p_user,p_org);
 select * into a from public.platform_apps where app_key=p_app;
 if not found then raise exception 'trial_app_not_found' using errcode='P0002';end if;
 select * into policy from private.creator_domain_trial_policies where enabled;
 select * into r from private.creator_domain_trial_receipts where org_id=p_org and owner_user_id=p_user;
 state:=case when r.order_id is null then 'not_granted' when r.cancelled_at is not null then 'cancelled' when p_now<r.trial_starts_at then 'pending' when p_now>=r.trial_expires_at then 'expired' else 'active' end;
 if r.order_id is not null then select status into order_status from public.creator_domain_orders where id=r.order_id;
  if state='active' and order_status is distinct from 'fulfilled' then state:='registration_blocked';end if;
 end if;
 if not a.enabled then reason:='module_disabled';
 elsif policy.version is null then reason:='trial_disabled';
 else
  select * into mapping from private.creator_domain_trial_modules where policy_version=policy.version and app_id=a.id;
  if mapping.stripe_price_id is not null then
   select exists(select 1 from public.creator_billing_subscriptions b where b.org_id=p_org and b.owner_user_id=p_user and b.stripe_price_id=mapping.stripe_price_id and b.status='active' and b.current_period_end>p_now) into paid;
  end if;
  entitled:=state='active' and p_now<r.domain_expires_at and r.policy_snapshot->'modules'->p_app->>'app_id'=a.id::text;
  advanced:=(entitled and coalesce((r.policy_snapshot->'modules'->p_app->>'advanced')::boolean,false)) or (paid and mapping.advanced);
  white_label:=(entitled and coalesce((r.policy_snapshot->'modules'->p_app->>'white_label')::boolean,false)) or (paid and mapping.white_label);
  reason:=case when paid then 'mapped_paid_subscription' when entitled then 'included_trial' else state end;
 end if;
 return jsonb_build_object('scope',jsonb_build_object('org_id',p_org,'app_key',p_app),
 'capabilities',jsonb_build_object('base_manage',jsonb_build_object('allowed',true,'reason','existing_owner_control'),
 'advanced',jsonb_build_object('allowed',coalesce(advanced,false),'reason',reason),
 'white_label',jsonb_build_object('allowed',coalesce(white_label,false),'reason',reason)),
 'trial',jsonb_build_object('state',state,'starts_at',r.trial_starts_at,'expires_at',r.trial_expires_at,'cancelled_at',r.cancelled_at,'policy',r.policy_snapshot-'modules'),
 'domain',jsonb_build_object('hostname',r.hostname,'registered_at',r.registered_at,'expires_at',r.domain_expires_at,'registration_state',order_status),
 'hosting',jsonb_build_object('allowed',null,'reason','economics_policy_unresolved'),
 'free_capabilities',jsonb_build_array('existing_account_access','existing_owned_site_control','existing_draft_data'),
 'existing_limits_unchanged',true,'automatic_paid_conversion',false);
end$$;
create or replace function public.creator_platform_access_v1(p_user uuid,p_org uuid,p_app text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform private.creator_trial_service_v1();return private.creator_platform_access_at_v1(p_user,p_org,p_app,clock_timestamp());end$$;
create or replace function public.creator_platform_require_v1(p_user uuid,p_org uuid,p_app text,p_capability text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 perform private.creator_trial_service_v1();
 if p_capability is null or p_capability not in ('base_manage','advanced','white_label') then raise exception 'trial_invalid_capability' using errcode='22023';end if;
 result:=private.creator_platform_access_at_v1(p_user,p_org,p_app,clock_timestamp());
 if not coalesce((result->'capabilities'->p_capability->>'allowed')::boolean,false) then raise exception 'module_unentitled' using errcode='42501';end if;
 return result;
end$$;
revoke all on function private.creator_trial_service_v1(),private.creator_trial_owner_v1(uuid,uuid),private.creator_trial_end_v1(timestamptz,text),private.creator_trial_receipt_guard_v1(),private.creator_platform_access_at_v1(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.creator_domain_trial_record_v1(uuid,uuid,uuid,text,jsonb),public.creator_domain_trial_cancel_v1(uuid,uuid,uuid,text),public.creator_platform_access_v1(uuid,uuid,text),public.creator_platform_require_v1(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.creator_domain_trial_record_v1(uuid,uuid,uuid,text,jsonb),public.creator_domain_trial_cancel_v1(uuid,uuid,uuid,text),public.creator_platform_access_v1(uuid,uuid,text),public.creator_platform_require_v1(uuid,uuid,text,text) to service_role;
commit;
