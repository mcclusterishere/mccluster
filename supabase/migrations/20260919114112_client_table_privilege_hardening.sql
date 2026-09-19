revoke truncate, references, trigger
on all tables in schema public
from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'ai_context') then
    execute 'revoke truncate, references, trigger on all tables in schema ai_context from anon, authenticated';
    execute 'alter default privileges for role postgres in schema ai_context revoke truncate, references, trigger on tables from anon, authenticated';
  end if;
end
$$;
