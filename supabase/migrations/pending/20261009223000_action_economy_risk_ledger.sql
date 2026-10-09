-- Gap 2: immutable accounting and chargeback/payout controls (STAGED, NOT DEPLOYED).
-- No live checkout, gifting, or payout routes are authorized by this migration.
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.action_economy_accounts (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid references auth.users(id),
 kind text not null check (kind in ('viewer_units','creator_pending_usd','creator_available_usd','creator_reserved_usd','creator_paid_usd','platform_units_issued','platform_units_consumed','platform_usd_liability','platform_usd_reversals')),
 currency text not null check (currency in ('A','USD_CENTS')),
 created_at timestamptz not null default now(),
 unique(owner_user_id,kind,currency),
 constraint action_economy_account_currency check ((kind in ('viewer_units','platform_units_issued','platform_units_consumed') and currency='A') or (kind not in ('viewer_units','platform_units_issued','platform_units_consumed') and currency='USD_CENTS')),
 constraint action_economy_account_owner check ((kind like 'platform_%' and owner_user_id is null) or (kind not like 'platform_%' and owner_user_id is not null))
);
create unique index if not exists action_economy_platform_account_unique on public.action_economy_accounts(kind,currency) where owner_user_id is null;
create table if not exists public.action_economy_events (
 id uuid primary key default gen_random_uuid(),
 event_key text not null unique,
 event_type text not null check (event_type in ('purchase','gift','earn','release','reserve','withdrawal','chargeback','refund','recovery')),
 external_reference text,
 created_at timestamptz not null default now(),
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}
);
create table if not exists public.action_economy_entries (
 id bigint generated always as identity primary key,
 event_id uuid not null references public.action_economy_events(id),
 account_id uuid not null references public.action_economy_accounts(id),
 amount bigint not null check(amount<>0),
 created_at timestamptz not null default now(),
 unique(event_id,account_id)
);
create index if not exists action_economy_entries_account_idx on public.action_economy_entries(account_id,id);
create table if not exists public.action_economy_risk_holds (
 id uuid primary key default gen_random_uuid(),
 creator_user_id uuid not null references auth.users(id),
 reason text not null check(reason in ('chargeback','fraud_review','identity_review','payout_review')),
 status text not null default 'active' check(status in ('active','released')),
 source_event_id uuid references public.action_economy_events(id),
 created_at timestamptz not null default now(),
 released_at timestamptz
);
create index if not exists action_economy_risk_holds_active_idx on public.action_economy_risk_holds(creator_user_id) where status='active';
-- Server-only writes and reads; no exposed client policies.
do $$
declare t text;
begin
 foreach t in array array['action_economy_accounts','action_economy_events','action_economy_entries','action_economy_risk_holds'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end $$;
-- Prevent edits and deletes even if a privileged app accidentally attempts them.
create or replace function public.action_economy_immutable()
returns trigger language plpgsql as $$
begin
 raise exception 'Action economy ledger records are immutable';
end $$;
drop trigger if exists action_economy_events_immutable on public.action_economy_events;
create trigger action_economy_events_immutable before update or delete on public.action_economy_events
for each row execute function public.action_economy_immutable();
drop trigger if exists action_economy_entries_immutable on public.action_economy_entries;
create trigger action_economy_entries_immutable before update or delete on public.action_economy_entries
for each row execute function public.action_economy_immutable();
-- Atomic posting: same-unit double-entry balance, event idempotency, and
-- no negative balances for spendable user accounts.
create or replace function public.action_economy_post(
 p_key text,p_type text,p_lines jsonb,p_reference text default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_id uuid;
 v_existing public.action_economy_events%rowtype;
 v_hash text;
 v_line record;
 v_count integer;
 v_sum_a numeric;
 v_sum_usd numeric;
 v_balance numeric;
begin
 if current_user <> 'service_role' then raise exception 'Service role required'; end if;
 if p_key is null or length(p_key)<8 or length(p_key)>200 or
 p_type not in ('purchase','gift','earn','release','reserve','withdrawal','chargeback','refund','recovery') or
 jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 or jsonb_array_length(p_lines)>20
 then raise exception 'Invalid posting'; end if;
 -- Canonicalize lines by account ID. Identical retries are accepted; conflicting retries fail.
 if exists(select 1 from jsonb_array_elements(p_lines) l
   where jsonb_typeof(l.value)<>'object'
      or (l.value->>'account_id') is null
      or (l.value->>'amount') is null
      or (l.value->>'amount') !~ '^-?[0-9]{1,18}$')
 then raise exception 'Invalid ledger line'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) l
   group by l.value->>'account_id' having count(*)>1)
 then raise exception 'Duplicate ledger account'; end if;
 -- Serialize same-key submissions even before inserting the event.
 perform pg_advisory_xact_lock(hashtextextended(p_key,20261009));
 select encode(extensions.digest(convert_to(jsonb_build_object(
  'type',p_type,'reference',p_reference,
  'lines',(select jsonb_agg(jsonb_build_object('account_id',z.account_id,'amount',z.amount) order by z.account_id)
           from (select (l.value->>'account_id')::uuid account_id,(l.value->>'amount')::bigint amount
                 from jsonb_array_elements(p_lines) l) z)
 )::text,'UTF8'),'sha256'),'hex') into v_hash;
 select * into v_existing from public.action_economy_events where event_key=p_key;
 if found then
  if v_existing.request_hash<>v_hash then raise exception 'Idempotency key payload mismatch'; end if;
  return v_existing.id;
 end if;
 -- Lock all accounts in deterministic UUID order to avoid lock inversion.
 for v_line in
  select a.id,a.kind,a.currency,z.amount from
  (select (l.value->>'account_id')::uuid account_id,(l.value->>'amount')::bigint amount
   from jsonb_array_elements(p_lines) l) z
  join public.action_economy_accounts a on a.id=z.account_id
  order by a.id for update of a
 loop
  if v_line.amount=0 then raise exception 'Zero ledger line'; end if;
  select coalesce(sum(amount),0) into v_balance from public.action_economy_entries where account_id=v_line.id;
  if v_line.kind in ('viewer_units','creator_available_usd','creator_pending_usd','creator_reserved_usd')
   and v_balance+v_line.amount<0 then raise exception 'Insufficient balance'; end if;
 end loop;
 select count(*),
 coalesce(sum(case when a.currency='A' then z.amount else 0 end),0),
 coalesce(sum(case when a.currency='USD_CENTS' then z.amount else 0 end),0)
 into v_count,v_sum_a,v_sum_usd
 from (select (l.value->>'account_id')::uuid account_id,(l.value->>'amount')::bigint amount
 from jsonb_array_elements(p_lines) l) z
 join public.action_economy_accounts a on a.id=z.account_id;
 if v_count<>jsonb_array_length(p_lines) or v_sum_a<>0 or v_sum_usd<>0
 then raise exception 'Missing account or unbalanced posting'; end if;
 insert into public.action_economy_events(event_key,event_type,external_reference,request_hash)
 values(p_key,p_type,p_reference,v_hash) returning id into v_id;
 insert into public.action_economy_entries(event_id,account_id,amount)
 select v_id,(l.value->>'account_id')::uuid,(l.value->>'amount')::bigint
 from jsonb_array_elements(p_lines) l;
 return v_id;
end $$;
revoke all on function public.action_economy_post(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.action_economy_post(text,text,jsonb,text) to service_role;
),
 metadata jsonb not null default '{}'::jsonb
);
create table if not exists public.action_economy_entries (
 id bigint generated always as identity primary key,
 event_id uuid not null references public.action_economy_events(id),
 account_id uuid not null references public.action_economy_accounts(id),
 amount bigint not null check(amount<>0),
 created_at timestamptz not null default now(),
 unique(event_id,account_id)
);
create index if not exists action_economy_entries_account_idx on public.action_economy_entries(account_id,id);
create table if not exists public.action_economy_risk_holds (
 id uuid primary key default gen_random_uuid(),
 creator_user_id uuid not null references auth.users(id),
 reason text not null check(reason in ('chargeback','fraud_review','identity_review','payout_review')),
 status text not null default 'active' check(status in ('active','released')),
 source_event_id uuid references public.action_economy_events(id),
 created_at timestamptz not null default now(),
 released_at timestamptz
);
create index if not exists action_economy_risk_holds_active_idx on public.action_economy_risk_holds(creator_user_id) where status='active';
-- Server-only writes and reads; no exposed client policies.
do $$
declare t text;
begin
 foreach t in array array['action_economy_accounts','action_economy_events','action_economy_entries','action_economy_risk_holds'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end $$;
-- Prevent edits and deletes even if a privileged app accidentally attempts them.
create or replace function public.action_economy_immutable()
returns trigger language plpgsql as $$
begin
 raise exception 'Action economy ledger records are immutable';
end $$;
drop trigger if exists action_economy_events_immutable on public.action_economy_events;
create trigger action_economy_events_immutable before update or delete on public.action_economy_events
for each row execute function public.action_economy_immutable();
drop trigger if exists action_economy_entries_immutable on public.action_economy_entries;
create trigger action_economy_entries_immutable before update or delete on public.action_economy_entries
for each row execute function public.action_economy_immutable();
-- Atomic posting: same-unit double-entry balance, event idempotency, and
-- no negative balances for spendable user accounts.
create or replace function public.action_economy_post(
 p_key text,p_type text,p_lines jsonb,p_reference text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_id uuid;
 v_line jsonb;
 v_account public.action_economy_accounts%rowtype;
 v_sum_a bigint:=0;
 v_sum_usd bigint:=0;
 v_count integer:=0;
 v_amount bigint;
 v_existing uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if p_key is null or length(p_key)<8 or p_type not in ('purchase','gift','earn','release','reserve','withdrawal','chargeback','refund','recovery')
    or jsonb_typeof(p_lines) <> 'array' then raise exception 'Invalid posting'; end if;
 select id into v_existing from public.action_economy_events where event_key=p_key;
 if v_existing is not null then return v_existing; end if;
 insert into public.action_economy_events(event_key,event_type,external_reference)
 values(p_key,p_type,p_reference) on conflict(event_key) do nothing returning id into v_id;
 if v_id is null then
  select id into v_id from public.action_economy_events where event_key=p_key;
  return v_id;
 end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_count:=v_count+1;
  if v_count>20 then raise exception 'Too many ledger lines'; end if;
  select * into v_account from public.action_economy_accounts
   where id=(v_line->>'account_id')::uuid for update;
  if not found then raise exception 'Unknown ledger account'; end if;
  v_amount:=(v_line->>'amount')::bigint;
  if v_amount=0 then raise exception 'Zero ledger line'; end if;
  if v_account.currency='A' then v_sum_a:=v_sum_a+v_amount;
  else v_sum_usd:=v_sum_usd+v_amount; end if;
  if v_account.kind in ('viewer_units','creator_available_usd','creator_pending_usd','creator_reserved_usd')
    and (select coalesce(sum(amount),0) from public.action_economy_entries where account_id=v_account.id)+v_amount<0
  then raise exception 'Insufficient balance'; end if;
  insert into public.action_economy_entries(event_id,account_id,amount)
  values(v_id,v_account.id,v_amount);
 end loop;
 if v_count<2 or v_sum_a<>0 or v_sum_usd<>0 then raise exception 'Unbalanced posting'; end if;
 return v_id;
end $$;
revoke all on function public.action_economy_post(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.action_economy_post(text,text,jsonb,text) to service_role;
