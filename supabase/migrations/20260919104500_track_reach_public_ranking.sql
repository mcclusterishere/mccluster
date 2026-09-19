-- THE ROOM ORDERS ITSELF, FROM WHAT LISTENERS ACTUALLY DID.
--
-- The explore room needs to put the most-reached record first. Everything it
-- needs is already being written: js/analytics.js sends `album_play` when a
-- track starts and `rotation_add` / `rotation_drop` when somebody saves or
-- unsaves one. Both land in public.events.
--
-- THE PROBLEM THIS SOLVES. public.events is owner-only by policy, and it must
-- stay that way: those rows carry an address, a network and a device. But a
-- public page cannot rank a shelf from a table it may not read, and shipping
-- the order as a hand-maintained list in the page would mean it is wrong the
-- day after it is written.
--
-- SO THIS VIEW IS DELIBERATELY NOT security_invoker. Every other view added
-- with the telemetry is, precisely so the owner-only policy governs it. This
-- one is the single exception in the schema, and it is an exception on
-- purpose: read as its owner, it is the one door through which anything about
-- public.events reaches an anonymous visitor. That makes what it selects the
-- whole of the security argument, so:
--
--   * It aggregates. There is no row here, only counts collapsed per title.
--   * It emits no identifier of any kind — no device, no session, no address,
--     no account, no timestamp anybody could line up against a visit.
--   * It emits no raw totals either, only a position and an index relative to
--     the top record. How many times a catalogue has actually been played is
--     the owner's business decision to publish, not a side effect of wanting
--     the shelf in a sensible order. The page needs the ORDER; it does not
--     need the numbers, so the numbers do not leave.
--
-- Anything added to this select list is a publication. Treat it that way.

create or replace view public.v_track_reach as
with signal as (
  select
    lower(trim(e.props->>'track')) as key,
    -- A distinct browser that pressed play is the honest unit of reach; a
    -- play is the volume on top of it. A save is the strongest thing a
    -- listener does short of buying, so it is weighted hardest.
    count(*) filter (where e.name = 'album_play')                       as plays,
    count(distinct e.device_id) filter (where e.name = 'album_play')    as listeners,
    count(*) filter (where e.name = 'rotation_add')                     as adds,
    count(*) filter (where e.name = 'rotation_drop')                    as drops
  from public.events e
  where e.name in ('album_play', 'rotation_add', 'rotation_drop')
    -- A crawler pressing play is not an audience. is_bot is null on every row
    -- written before the telemetry columns existed, so this keeps those.
    and e.is_bot is not true
    and coalesce(trim(e.props->>'track'), '') <> ''
  group by 1
), weighted as (
  select
    key,
    (listeners * 2) + plays + (greatest(adds - drops, 0) * 5) as weight
  from signal
)
select
  key as track_key,
  rank() over (order by weight desc, key) as position,
  -- 0-100 against the top record, so the page can size or sort without ever
  -- learning a total.
  case
    when max(weight) over () > 0
      then round(100.0 * weight / max(weight) over ())::int
    else 0
  end as reach
from weighted
where weight > 0;

comment on view public.v_track_reach is
  'Aggregate-only ranking of tracks by listener reach, for the public explore room. '
  'The one intentionally non-security_invoker view in this schema: it reads the '
  'owner-only events table as its owner and publishes a position and a relative '
  'index, never a count, a timestamp or any identifier. Adding a column here '
  'publishes that column to the anonymous internet.';

-- The shelf order is public because the shelf is public. Nothing else is.
grant select on public.v_track_reach to anon, authenticated;
