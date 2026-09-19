-- ============================================================
-- MCCLUSTER SITES — the client desk's two tables.
--   site_accounts : one row per client site the studio runs.
--                   Written ONLY by the owner (service role) —
--                   clients read their own row, never write.
--   site_requests : the change-requests a signed-in client files
--                   from console.html. Clients insert and read
--                   their own; only the desk (service role)
--                   changes status or writes the reply.
-- The client console degrades gracefully if these tables aren't
-- live yet, so this migration can land after the pages ship.
-- ============================================================

create table if not exists public.site_accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  site_name   text not null,
  site_url    text,
  plan        text not null default 'sites',          -- ledger slug, data/sites.json
  price       numeric,                                 -- what THIS client pays (founding seats differ)
  status      text not null default 'building'
              check (status in ('building','live','paused','closed')),
  started_at  timestamptz not null default now(),
  notes       text                                     -- desk-only context; harmless if read by owner
);

create unique index if not exists site_accounts_one_per_user
  on public.site_accounts (user_id);

alter table public.site_accounts enable row level security;

drop policy if exists "clients read their own site" on public.site_accounts;
create policy "clients read their own site"
  on public.site_accounts for select
  to authenticated
  using (user_id = auth.uid());
-- no insert/update/delete policies for clients: the desk writes with the
-- service role, which bypasses RLS by design.

create table if not exists public.site_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null default 'change',
  body        text not null check (char_length(body) between 3 and 4000),
  status      text not null default 'new'
              check (status in ('new','in_progress','awaiting_approval','live','declined')),
  reply       text,                                    -- the desk's note back to the client
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists site_requests_by_user
  on public.site_requests (user_id, created_at desc);

alter table public.site_requests enable row level security;

drop policy if exists "clients file their own requests" on public.site_requests;
create policy "clients file their own requests"
  on public.site_requests for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "clients read their own requests" on public.site_requests;
create policy "clients read their own requests"
  on public.site_requests for select
  to authenticated
  using (user_id = auth.uid());
-- clients cannot update or delete: the request trail is the record.
-- Status changes and replies come from the desk (service role only).

-- keep updated_at honest on desk-side edits
create or replace function public.site_requests_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists site_requests_touch on public.site_requests;
create trigger site_requests_touch
  before update on public.site_requests
  for each row execute function public.site_requests_touch();
