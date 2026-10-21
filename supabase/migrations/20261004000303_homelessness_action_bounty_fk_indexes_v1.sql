-- Cover bounty foreign keys used by member/admin reads and lifecycle cleanup.
create index if not exists action_bounty_claims_user_idx
  on public.action_bounty_claims(user_id, claimed_at desc);

create index if not exists action_bounty_claims_reviewer_idx
  on public.action_bounty_claims(reviewer_m_uid)
  where reviewer_m_uid is not null;

create index if not exists action_bounty_funding_created_by_idx
  on public.action_bounty_funding_ledger(created_by)
  where created_by is not null;
