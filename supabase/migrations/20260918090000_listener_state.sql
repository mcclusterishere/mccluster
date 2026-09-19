-- Where the record is, for a signed-in listener.
--
-- The pocket player banks its position in localStorage, which follows a
-- listener across pages, tabs and browser restarts but stops at the edge of
-- the device. This is the one row that lets the phone pick up where the laptop
-- was. It is not a second media store: no track, no audio, no catalogue lives
-- here — only a pointer at a position in a record the site already serves.
--
-- Anonymous visitors never touch this table. Most traffic is anonymous, so
-- localStorage remains the primary mechanism and this is an addition for
-- people with an account, not a replacement.

create table if not exists public.listener_state (
  profile_id uuid primary key references auth.users(id) on delete cascade,
  -- {src, album, title, t, playing, at, video, poster, lyrics} — the same
  -- shape the player already banks locally, stored opaquely so the player can
  -- evolve its own state without a migration each time.
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint listener_state_size check (pg_column_size(state) <= 4096)
);

alter table public.listener_state enable row level security;

-- A listener reads and writes their own row and no other. There is no
-- service-role ingest path because nothing server-side needs to author a
-- listening position on someone's behalf.
drop policy if exists listener_state_select_own on public.listener_state;
create policy listener_state_select_own on public.listener_state
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists listener_state_insert_own on public.listener_state;
create policy listener_state_insert_own on public.listener_state
  for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists listener_state_update_own on public.listener_state;
create policy listener_state_update_own on public.listener_state
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists listener_state_delete_own on public.listener_state;
create policy listener_state_delete_own on public.listener_state
  for delete to authenticated
  using (profile_id = auth.uid());

revoke all on table public.listener_state from anon;
grant select, insert, update, delete on table public.listener_state to authenticated;
grant all on table public.listener_state to service_role;

create or replace function public.touch_listener_state()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists listener_state_touch on public.listener_state;
create trigger listener_state_touch
  before update on public.listener_state
  for each row execute function public.touch_listener_state();

comment on table public.listener_state is
  'One row per signed-in listener: where the record was. Position only, never audio. Anonymous listeners use localStorage and never appear here.';
