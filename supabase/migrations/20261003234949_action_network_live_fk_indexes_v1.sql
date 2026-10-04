-- Cover new live-governance foreign keys used by deletes and desk lookups.
create index if not exists network_live_host_grants_created_by_idx
  on public.network_live_host_grants(created_by)
  where created_by is not null;

create index if not exists network_live_stage_members_muid_idx
  on public.network_live_stage_members(m_uid, state);
