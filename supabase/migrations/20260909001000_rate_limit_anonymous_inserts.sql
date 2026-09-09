-- Rate limit the two tables a stranger can write to directly.
--
-- public.leads and public.events both carry an INSERT policy for `anon`
-- with `check (true)`. That is deliberate — a lead form and an analytics
-- beacon have to accept writes from people who have no account — but
-- "deliberate" is not "bounded". Anyone with the publishable key could
-- insert without limit.
--
-- supabase/functions/intake already has a per-IP limiter, and its own
-- comment is right that "real abuse protection belongs at the edge". It
-- is also in-memory, per-instance, and guards the intake FUNCTION. These
-- two tables are reachable straight through PostgREST, which never goes
-- near that code. This covers the path that has nothing, at the only
-- layer that path passes through.
--
-- Verified before choosing thresholds, rather than guessed:
--   * request.headers IS populated for anon PostgREST calls. Confirmed by
--     calling an RPC over HTTPS with the publishable key: cf-connecting-ip
--     and x-forwarded-for are both present. Cloudflare sets both, so a
--     client cannot forge them.
--   * events: 23,541 rows over 51 active days. Busiest hour ever = 758
--     across the whole site; p95 hour = 283. js/analytics.js batches and
--     flushes on pagehide, so one visitor is nowhere near that.
--   * leads: 2 rows, ever.
--
-- Limits are therefore set above anything the site has ever legitimately
-- done, because the failure modes are not symmetric: dropping an
-- analytics beacon costs a data point, dropping a real lead costs a
-- customer. The job here is to convert "unbounded" into "bounded", not to
-- police normal use.

create schema if not exists private;

-- Raw IPs are never stored. The salt makes the hashes useless outside
-- this database, so the counter table cannot be turned back into a list
-- of who visited.
create table if not exists private.rate_limit_salt (
  only_row boolean primary key default true check (only_row),
  salt     text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into private.rate_limit_salt default values on conflict do nothing;

create table if not exists private.rate_limit_counters (
  bucket_key   text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket_key, window_start)
);
create index if not exists rate_limit_counters_window_idx
  on private.rate_limit_counters(window_start);

-- Which client is this. Returns null when no address can be established,
-- and never raises: a limiter that can break an insert is worse than the
-- unbounded insert it replaced.
create or replace function private.rate_limit_client_key()
returns text
language plpgsql stable security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  h  jsonb;
  ip text;
begin
  h := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  -- cf-connecting-ip first: Cloudflare overwrites it on every request, so
  -- unlike x-forwarded-for it cannot be extended by the caller.
  ip := nullif(btrim(h ->> 'cf-connecting-ip'), '');
  if ip is null then
    ip := nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), '');
  end if;
  if ip is null then
    return null;
  end if;
  return encode(
    extensions.digest(ip || (select salt from private.rate_limit_salt limit 1), 'sha256'),
    'hex'
  );
exception when others then
  return null;
end;
$$;
revoke all on function private.rate_limit_client_key() from public, anon, authenticated;

-- tg_argv: [0] scope label, [1] per-address hourly limit, [2] hourly
-- ceiling for the shared bucket, which is enforced on every insert.
create or replace function private.enforce_anon_insert_rate_limit()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_scope   text := tg_argv[0];
  v_role    text;
  v_key     text;
  v_window  timestamptz;
  v_hits    integer;
begin
  -- Only the anonymous role is limited. service_role runs the workers and
  -- backfills, and an authenticated caller is already identified and
  -- constrained by policy; capping either would break legitimate work.
  --
  -- The role has to come from the JWT claim, NOT current_user. This
  -- function is SECURITY DEFINER, so inside it current_user is the owner
  -- ('postgres') and session_user is the pooler role ('authenticator') —
  -- never the caller. Keying on current_user made the trigger a no-op:
  -- 23 consecutive anonymous inserts sailed past a limit of 20 before
  -- this was caught by testing it over real HTTP.
  --
  -- No claims at all means this is not a PostgREST request — a migration,
  -- a direct psql session, an internal job — and those are already gated
  -- by database credentials, so they are left alone.
  v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if v_role is distinct from 'anon' then
    return new;
  end if;

  v_window := date_trunc('hour', now());
  v_key    := private.rate_limit_client_key();

  -- Two buckets, both enforced.
  --
  -- Per-address alone is not enough: testing this from the agent proxy
  -- spread 26 consecutive submissions across 7 source addresses, so no
  -- single bucket ever filled. Anything with a pool of addresses — a
  -- proxy, a carrier NAT, a botnet — evades a per-address limit by
  -- construction, which is precisely how bulk spam arrives.
  --
  -- So the per-address limit stops one determined person, and a shared
  -- ceiling stops a distributed flood. The ceiling sits far above
  -- anything this site has recorded, because it is the last line before
  -- real submissions start being refused.
  if v_key is not null then
    insert into private.rate_limit_counters (bucket_key, window_start, hits)
    values (v_scope || ':ip:' || v_key, v_window, 1)
    on conflict (bucket_key, window_start)
      do update set hits = private.rate_limit_counters.hits + 1
    returning hits into v_hits;

    if v_hits > tg_argv[1]::integer then
      raise exception 'Too many submissions from this address. Please try again later.'
        using errcode = 'PT429';
    end if;
  end if;

  insert into private.rate_limit_counters (bucket_key, window_start, hits)
  values (v_scope || ':all', v_window, 1)
  on conflict (bucket_key, window_start)
    do update set hits = private.rate_limit_counters.hits + 1
  returning hits into v_hits;

  if v_hits > tg_argv[2]::integer then
    raise exception 'Too many submissions. Please try again later.'
      using errcode = 'PT429';
  end if;

  -- Old windows are dead weight. Clearing them on roughly one insert in
  -- five hundred keeps the table small without a scheduled job.
  if random() < 0.002 then
    delete from private.rate_limit_counters where window_start < now() - interval '2 days';
  end if;

  return new;
end;
$$;
revoke all on function private.enforce_anon_insert_rate_limit() from public, anon, authenticated;

-- leads: a human does not submit twenty enquiries an hour, but carrier
-- and office NAT put many people behind one address, so the per-IP number
-- has room. The shared ceiling is far above any campaign spike this site
-- has seen, because a blocked lead is a lost customer.
drop trigger if exists leads_anon_rate_limit on public.leads;
create trigger leads_anon_rate_limit
before insert on public.leads
for each row execute function private.enforce_anon_insert_rate_limit('leads', '20', '300');

-- events: 1000/hour per address sits above the busiest hour the entire
-- site has ever recorded, so it cannot clip a real visitor, while still
-- capping a scripted flood at something finite.
drop trigger if exists events_anon_rate_limit on public.events;
create trigger events_anon_rate_limit
before insert on public.events
for each row execute function private.enforce_anon_insert_rate_limit('events', '1000', '5000');

-- The counters are internal. Nothing outside the trigger reads them.
revoke all on private.rate_limit_counters from public, anon, authenticated;
revoke all on private.rate_limit_salt     from public, anon, authenticated;
