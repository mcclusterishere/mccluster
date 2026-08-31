-- Licensing briefs from the HERE app's licence desk.
--
-- The app's "Send it to the desk" button previously set local state and showed
-- a receipt with a reference number built from Date.now(). Nothing was
-- transmitted and nothing was stored, so a customer told their brief was filed
-- had in fact sent nothing. This is where a brief actually lands.

create table if not exists licensing_briefs (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  track_slug text not null,
  use_case text,
  term text,
  requester_name text not null,
  requester_email text not null,
  note text,
  source text not null default 'here-app',
  status text not null default 'received'
    check (status in ('received','quoted','signed','declined','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists licensing_briefs_created_idx
  on licensing_briefs (created_at desc);
create index if not exists licensing_briefs_status_idx
  on licensing_briefs (status, created_at desc);

-- Briefs carry a name, an email address and a commercial intent. Nothing
-- anonymous reads this table; the Worker holds the service credential and is
-- the only path in.
alter table licensing_briefs enable row level security;
