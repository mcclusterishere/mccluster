-- The pocket player's cross-device resume finally has somewhere to write.
--
-- js/pip.js mirrors a signed-in listener's position (track, second, album)
-- to one row so another device can pick up where this one left off. The
-- table it reads and upserts was never created: every signed-in page answered
-- 404 on GET and POST /rest/v1/listener_state (21 in one day), and the
-- feature never worked. Until this is applied pip.js parks the sync for a day
-- after a 404; once applied, the next call finds the table and the mirror
-- starts on its own.
--
-- One row per auth user, owned by that user alone. The row holds what the
-- player already keeps in localStorage (no listening history, just the last
-- position), capped in size so it cannot be used as general storage.

set local lock_timeout = '5s';

create table if not exists public.listener_state (
  profile_id  uuid primary key references auth.users(id) on delete cascade,
  state       jsonb not null default '{}'::jsonb
              check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 4096),
  updated_at  timestamptz not null default now()
);

create or replace function private.listener_state_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.listener_state_touch() from public, anon, authenticated;

drop trigger if exists listener_state_touch on public.listener_state;
create trigger listener_state_touch before insert or update on public.listener_state
  for each row execute function private.listener_state_touch();

alter table public.listener_state enable row level security;
alter table public.listener_state force row level security;
revoke all on public.listener_state from public, anon, authenticated;
grant select, insert, update on public.listener_state to authenticated;
grant all on public.listener_state to service_role;

drop policy if exists listener_state_own on public.listener_state;
create policy listener_state_own on public.listener_state
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
