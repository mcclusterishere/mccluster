-- Claim each Stripe transfer exactly once. An uncertain network outcome is reconciled,
-- never automatically retried by a second caller.
create or replace function public.action_creator_claim_transfer(p_intent_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_count integer;
begin
 if current_user not in ('postgres','service_role') then raise exception 'server only'; end if;
 update public.action_creator_payout_intents
 set state='transferring',updated_at=now()
 where id=p_intent_id and state='reserved';
 get diagnostics v_count = row_count;
 return v_count=1;
end $$;
revoke all on function public.action_creator_claim_transfer(uuid) from public,anon,authenticated;
grant execute on function public.action_creator_claim_transfer(uuid) to service_role;

-- A Stripe bank payout belongs to a connected account, not to an individual transfer.
create table if not exists public.action_creator_bank_payout_events(
 id uuid primary key default gen_random_uuid(),
 event_id text not null unique,
 stripe_payout_id text not null,
 stripe_account_id text not null,
 status text not null check(status in ('paid','failed','canceled')),
 amount_cents bigint not null check(amount_cents>=0),
 currency text not null,
 created_at timestamptz not null default now()
);
alter table public.action_creator_bank_payout_events enable row level security;
alter table public.action_creator_bank_payout_events force row level security;
revoke all on public.action_creator_bank_payout_events from anon,authenticated;
create or replace function public.action_creator_record_bank_payout(
 p_event_id text,p_payout_id text,p_account_id text,p_status text,p_amount_cents bigint,p_currency text
) returns boolean language plpgsql security invoker set search_path=public as $$
declare v_count integer;
begin
 if current_user not in ('postgres','service_role') then raise exception 'server only'; end if;
 if p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_payout_id !~ '^po_[A-Za-z0-9]+$'
 or p_account_id !~ '^acct_[A-Za-z0-9]+$' or p_status not in ('paid','failed','canceled')
 or p_amount_cents<0 then raise exception 'invalid payout event'; end if;
 if not exists(select 1 from public.action_creator_connect_accounts
 where stripe_account_id=p_account_id and livemode=false) then return false; end if;
 insert into public.action_creator_bank_payout_events(event_id,stripe_payout_id,stripe_account_id,status,amount_cents,currency)
 values(p_event_id,p_payout_id,p_account_id,p_status,p_amount_cents,p_currency)
 on conflict(event_id) do nothing;
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;
revoke all on function public.action_creator_record_bank_payout(text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.action_creator_record_bank_payout(text,text,text,text,bigint,text) to service_role;
