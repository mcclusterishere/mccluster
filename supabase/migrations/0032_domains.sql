-- THE DOMAIN SEARCH.
--
-- The card used to say "Get the address" and then take money for an
-- address nobody had checked. Somebody could buy the first month of
-- hosting for a name that was registered in 1998. This is the table
-- that stops that: what we will look up, what we will sell, and at
-- what price -- in the database, where every other price already is,
-- so adding a TLD is an INSERT and not a deploy.

create table if not exists public.domain_tlds (
  tld        text primary key,

  -- Whether THIS site can take money for it today. A TLD we can look
  -- up but cannot sell self-serve is still worth looking up: knowing
  -- the name is free is the useful half of the answer.
  sellable   boolean not null default false,

  -- Dollars a year, retail. Null where we do not sell it. Named in
  -- dollars rather than a multiplier of some other row because a
  -- registry price is not a fraction of anything -- it is its own
  -- number, set by the registry, and it moves on its own schedule.
  price_usd  numeric(10,2),

  -- What the card says when it is not sellable. Public-facing text:
  -- it is printed to a visitor verbatim.
  note       text,

  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),

  constraint domain_tlds_sellable_has_a_price
    check (not sellable or price_usd is not null)
);

comment on constraint domain_tlds_sellable_has_a_price on public.domain_tlds is
  'A TLD offered for instant purchase has a price. Selling an address at a price nobody set is how a $33 checkout buys a $60 domain.';

insert into public.domain_tlds (tld, sellable, price_usd, note) values
  ('com', true,  33, null),
  ('net', true,  33, null),
  ('org', true,  33, null),
  ('co',    false, null, 'Available. .co is registered for you rather than bought here; the price is set with you before anything is charged.'),
  ('io',    false, null, 'Available. .io costs more than the standard address, so it is quoted before anything is charged.'),
  ('dev',   false, null, 'Available. .dev is registered for you rather than bought here; the price is set with you first.'),
  ('app',   false, null, 'Available. .app is registered for you rather than bought here; the price is set with you first.'),
  ('me',    false, null, 'Available. .me is registered for you rather than bought here; the price is set with you first.'),
  ('info',  false, null, 'Available. .info is registered for you rather than bought here; the price is set with you first.'),
  ('biz',   false, null, 'Available. .biz is registered for you rather than bought here; the price is set with you first.'),
  ('us',    false, null, 'Available. .us has a US-presence requirement, so it is set up with you rather than bought in one tap.'),
  ('church',false, null, 'Available. .church is registered for you rather than bought here; the price is set with you first.'),
  ('tv',    false, null, 'Available. .tv is a premium registry, so it is quoted before anything is charged.'),
  ('xyz',   false, null, 'Available. .xyz is registered for you rather than bought here; the price is set with you first.')
on conflict (tld) do update
  set sellable = excluded.sellable,
      price_usd = excluded.price_usd,
      note = excluded.note,
      updated_at = now();

-- THE CACHE.
--
-- RDAP is a public service run by registries who rate-limit, and a
-- search box on a public page is a machine for hammering it. Every
-- answer is kept for a few hours, which turns a hundred people typing
-- the same obvious name into one lookup. It is also the thing that
-- makes the second keystroke instant.
create table if not exists public.domain_lookups (
  name       text primary key,
  tld        text not null,

  -- true available, false taken, null asked and could not tell
  available  boolean,

  source     text not null default 'rdap',
  status     int,

  checked_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours',
  hits       int not null default 1
);

create index if not exists domain_lookups_expiry on public.domain_lookups (expires_at);

comment on column public.domain_lookups.available is
  'NULL is a real answer and a different one from taken: it means the registry did not say. A null must never render as "yours" -- see readRdap().';

-- THE THROTTLE.
--
-- Keyed on a salted hash of the caller, never the address itself: this
-- table exists to stop abuse, and a table of who searched what from
-- where is a different, worse thing to be holding.
create table if not exists public.domain_rate (
  client       text not null,
  window_start timestamptz not null,
  n            int not null default 0,
  primary key (client, window_start)
);

create index if not exists domain_rate_window on public.domain_rate (window_start);

create or replace function public.domain_rate_take(
  p_client text,
  p_limit  int default 40,
  p_window interval default interval '1 minute'
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  v_n int;
begin
  insert into public.domain_rate (client, window_start, n)
  values (p_client, v_start, 1)
  on conflict (client, window_start) do update set n = public.domain_rate.n + 1
  returning n into v_n;

  -- housekeeping rides along with the write, so nothing has to be
  -- scheduled for a table that is only ever a few minutes deep
  delete from public.domain_rate where window_start < now() - interval '1 hour';

  return v_n <= p_limit;
end $$;

revoke all on function public.domain_rate_take(text, int, interval) from public, anon, authenticated;

comment on function public.domain_rate_take(text, int, interval) is
  'Count one request against a fixed window and say whether it is inside the limit. Atomic: two requests arriving together get two different numbers.';

alter table public.domain_tlds    enable row level security;
alter table public.domain_lookups enable row level security;
alter table public.domain_rate    enable row level security;

revoke all on public.domain_lookups, public.domain_rate from anon, authenticated;

-- The TLD list is a price list, and a price list is public by nature:
-- the card has to be able to say ".io is not one we sell in a tap"
-- whether or not anybody is signed in.
drop policy if exists domain_tlds_public on public.domain_tlds;
create policy domain_tlds_public on public.domain_tlds
  for select using (enabled);

grant select on public.domain_tlds to anon, authenticated;
