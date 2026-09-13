do $do$
begin
  if to_regclass('public._migrations') is not null then
    execute 'alter table public._migrations enable row level security';
    execute 'revoke all on table public._migrations from public, anon, authenticated';
    execute 'grant select, insert, update, delete on table public._migrations to service_role';
    execute 'comment on table public._migrations is ''Backend-only migration ledger. RLS enabled and direct client-role access revoked; service_role is the intended Data API writer.''';
  end if;
end
$do$;
