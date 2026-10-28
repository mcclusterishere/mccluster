-- STAGED. Requires creator_team_decision_matrix.sql and existing clipping schema.
-- Distinguishes platform-appointed Super Creators from purchased subscriptions.
create table if not exists public.creator_super_verifications (
 user_id uuid primary key references auth.users(id) on delete cascade,
 status text not null check(status in ('active','revoked')),
 approved_by uuid not null references auth.users(id),
 approved_at timestamptz not null default now(),
 revoked_at timestamptz,
 notes text not null default '',
 check((status='active' and revoked_at is null) or (status='revoked' and revoked_at is not null))
);
create table if not exists public.creator_super_verification_audit (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id),
 actor_user_id uuid not null references auth.users(id),
 action text not null check(action in ('approved','revoked')),
 reason text not null check(length(trim(reason)) between 8 and 2000),
 occurred_at timestamptz not null default now()
);
create table if not exists public.creator_superuser_status (
 user_id uuid primary key references auth.users(id) on delete cascade,
 status text not null check(status in ('qualified','held','revoked')),
 qualifying_order_reference text not null,
 qualified_at timestamptz not null default now(),
 last_verified_at timestamptz not null default now()
);
create table if not exists public.creator_superuser_rewards (
 id uuid primary key default gen_random_uuid(),
 campaign_owner_user_id uuid not null references auth.users(id),
 beneficiary_user_id uuid not null references auth.users(id),
 program_version text not null default 'superuser-30d-v1',
 amount_cents integer not null default 100 check(amount_cents=100),
 state text not null default 'reserved' check(state in ('reserved','held','paid','void')),
 qualifying_order_reference text not null,
 created_at timestamptz not null default now(),
 unique(campaign_owner_user_id,beneficiary_user_id,program_version),
 check(campaign_owner_user_id<>beneficiary_user_id)
);
create index if not exists creator_superuser_rewards_owner_idx on public.creator_superuser_rewards(campaign_owner_user_id,state);
do $$
declare t text;
begin
 foreach t in array array['creator_super_verifications','creator_super_verification_audit','creator_superuser_status','creator_superuser_rewards'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- Super Creator review data is service mediated. No browser writes.
-- Verification approval and revocation must be performed only through an
-- audited owner-only server action. Payment is NOT a verification condition.
-- A confirmed settled nonrefunded purchase/gift can qualify a Superuser.
-- Webhook ingestion must verify signature, customer ownership and replay keys.
-- Refund/chargeback puts qualification and reserved rewards on hold.
-- A $50 fan reward pool caps at 50 unique $1 awards per sponsor per pilot.
create or replace function public.creator_superuser_reward_cap()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.campaign_owner_user_id::text||':'||new.program_version,0));
 select count(*) into v_count from public.creator_superuser_rewards
 where campaign_owner_user_id=new.campaign_owner_user_id
 and program_version=new.program_version and state in ('reserved','held','paid');
 if v_count>=50 then raise exception 'Fan incentive pool exhausted'; end if;
 if not exists(select 1 from public.creator_superuser_status s
   where s.user_id=new.beneficiary_user_id and s.status='qualified'
     and s.qualifying_order_reference=new.qualifying_order_reference)
 then raise exception 'Fan not verified as qualified'; end if;
 return new;
end $$;
revoke all on function public.creator_superuser_reward_cap() from public,anon,authenticated;
create trigger creator_superuser_reward_cap_trigger before insert on public.creator_superuser_rewards
for each row execute function public.creator_superuser_reward_cap();
-- Deny campaign creation by non-verified users even if they own an org.
-- Owner/admin bypass must be a separately audited server-side policy.
-- Existing clip_campaign_create also checks org ownership; cross-org
-- Super Creator delegation requires a subsequent RPC refactor.
create or replace function public.creator_clip_issuer_guard()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.creator_super_verifications v
  where v.user_id=new.created_by and v.status='active') then
  raise exception 'Verified Super Creator approval required to issue campaigns';
 end if;
 return new;
end $$;
revoke all on function public.creator_clip_issuer_guard() from public,anon,authenticated;
create trigger creator_clip_issuer_guard_trigger before insert on public.action_clip_campaigns
for each row execute function public.creator_clip_issuer_guard();
