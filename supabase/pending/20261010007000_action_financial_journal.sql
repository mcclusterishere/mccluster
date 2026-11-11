-- STAGED: Action Network immutable double-entry journal. No production apply without tests.
create table if not exists public.an_fin_accounts(
 id uuid primary key default gen_random_uuid(),
 owner_kind text not null check(owner_kind in ('platform','campaign','participant','processor')),
 owner_ref text not null,
 purpose text not null check(purpose in ('cash','campaign_available','campaign_reserved','participant_payable','fee_revenue','reward_expense','processing_expense','clearing','risk_reserve')),
 currency text not null default 'usd' check(currency='usd'),
 created_at timestamptz not null default now(),
 unique(owner_kind,owner_ref,purpose,currency)
);
create table if not exists public.an_fin_journals(
 id uuid primary key default gen_random_uuid(),
 event_key text not null unique check(length(event_key) between 8 and 200),
 event_kind text not null,
 source_reference text not null,
 created_at timestamptz not null default now()
);
create table if not exists public.an_fin_lines(
 id bigint generated always as identity primary key,
 journal_id uuid not null references public.an_fin_journals(id) on delete restrict,
 account_id uuid not null references public.an_fin_accounts(id) on delete restrict,
 side text not null check(side in ('debit','credit')),
 amount_cents bigint not null check(amount_cents>0),
 created_at timestamptz not null default now()
);
create index if not exists an_fin_lines_account_idx on public.an_fin_lines(account_id,id);
-- PostgreSQL deferred constraint trigger validates every committed journal.
create or replace function public.an_fin_assert_balanced()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_delta bigint; v_lines integer;
begin
 v_id:=coalesce(new.journal_id,old.journal_id);
 select count(*),coalesce(sum(case when side='debit' then amount_cents else -amount_cents end),0)
 into v_lines,v_delta from public.an_fin_lines where journal_id=v_id;
 if v_lines<2 or v_delta<>0 then raise exception 'Unbalanced financial journal %',v_id; end if;
 return null;
end $$;
drop trigger if exists an_fin_balance_guard on public.an_fin_lines;
create constraint trigger an_fin_balance_guard after insert or update or delete on public.an_fin_lines
deferrable initially deferred for each row execute function public.an_fin_assert_balanced();
-- Ledger postings are immutable. Reversals must be new balanced journals.
create or replace function public.an_fin_deny_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Financial journals are immutable'; end $$;
drop trigger if exists an_fin_lines_immutable on public.an_fin_lines;
create trigger an_fin_lines_immutable before update or delete on public.an_fin_lines
for each row execute function public.an_fin_deny_mutation();
drop trigger if exists an_fin_journals_immutable on public.an_fin_journals;
create trigger an_fin_journals_immutable before update or delete on public.an_fin_journals
for each row execute function public.an_fin_deny_mutation();
-- Lock down all financial data to the trusted backend.
do $$ declare t text; begin
 foreach t in array array['an_fin_accounts','an_fin_journals','an_fin_lines'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- This function deliberately does not expose arbitrary account posting to clients.
-- Trusted finance service must validate source settlement, ownership, authorization,
-- balance sufficiency and idempotency BEFORE posting any journal.
