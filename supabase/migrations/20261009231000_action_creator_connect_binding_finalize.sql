-- Creator Connect account binding and transactional transfer finalization.
create table if not exists public.action_creator_connect_accounts (
  org_id uuid not null references public.orgs(id),
  creator_m_uid uuid not null,
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode boolean not null default false check (livemode = false),
  verified_at timestamptz not null default now(),
  primary key(org_id,creator_m_uid),
  unique(stripe_account_id)
);
alter table public.action_creator_connect_accounts enable row level security;
alter table public.action_creator_connect_accounts force row level security;
revoke all on public.action_creator_connect_accounts from anon,authenticated;
create or replace function public.action_creator_finalize_transfer(p_intent_id uuid,p_transfer_id text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare p public.action_creator_payout_intents%rowtype;
begin
  if current_user not in ('postgres','service_role') then raise exception 'server only'; end if;
  select * into p from public.action_creator_payout_intents where id=p_intent_id for update;
  if not found then raise exception 'intent not found'; end if;
  if p.state='transferred' then
    if p.stripe_transfer_id=p_transfer_id then return false; end if;
    raise exception 'conflicting transfer';
  end if;
  if p.state not in ('reserved','transferring') or p_transfer_id !~ '^tr_[A-Za-z0-9]+$' then raise exception 'invalid transfer state'; end if;
  update public.action_creator_payout_intents set state='transferred',stripe_transfer_id=p_transfer_id,updated_at=now() where id=p.id;
  update public.action_creator_funding set reserved_cents=reserved_cents-p.amount_cents,spent_cents=spent_cents+p.amount_cents,updated_at=now()
    where org_id=p.org_id and mission_id=p.mission_id and reserved_cents>=p.amount_cents;
  if not found then raise exception 'reservation mismatch'; end if;
  insert into public.action_creator_payout_events(payout_intent_id,org_id,event_key,event_type,amount_cents)
    values(p.id,p.org_id,'transfer:'||p_transfer_id,'transferred',p.amount_cents) on conflict(event_key) do nothing;
  return true;
end $$;
revoke all on function public.action_creator_finalize_transfer(uuid,text) from public,anon,authenticated;
grant execute on function public.action_creator_finalize_transfer(uuid,text) to service_role;
