alter table public._migrations enable row level security;

revoke all on table public._migrations from public, anon, authenticated;
grant select, insert, update, delete on table public._migrations to service_role;

comment on table public._migrations is
  'Backend-only migration ledger. RLS enabled and direct client-role access revoked; service_role is the intended Data API writer.';
