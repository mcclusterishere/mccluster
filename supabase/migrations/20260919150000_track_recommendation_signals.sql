-- THE ROOM RECOMMENDS, AND EVERY SECTION IS AN ACTUAL ALGORITHM.
--
-- This replaces v_track_reach, which ranked tracks by a hand-weighted sum of
-- plays, listeners and saves. That was defensible as an ordering and it was
-- not a recommender: it had one axis, no notion of confidence, no notion of
-- time, and nothing to say about which records go together. The room built on
-- it could only ever have a "most played" rail and some labels.
--
-- Four signals, each a named method rather than a taste:
--
--   1. KEEP RATE, as a Wilson score lower bound over smoothed counts. The
--      naive ranking of "what fraction of listeners saved this" puts a track
--      played twice and saved twice (100%) above one played two hundred times
--      and saved eighteen, which is nonsense — the first number is two coin
--      flips. The Wilson interval (Wilson, 1927; the ranking application is
--      Evan Miller's, 2009) asks instead: given this many trials, what is the
--      lowest rate we can still be confident in?
--
--      WILSON ALONE WAS NOT ENOUGH, AND THIS WAS MEASURED RATHER THAN
--      ASSUMED. Run against a fixture, a track with two plays and two saves
--      still scored a lower bound of 0.34 and landed SECOND, above a track
--      with forty listeners and a 45% keep rate (0.31). At n = 2 the interval
--      is so wide that even its floor beats a real track's honest rate.
--      So the proportion is smoothed first: every track is credited with a
--      prior of PRIOR_TRIALS pseudo-listeners behaving at the catalogue's own
--      mean keep rate, and the interval is taken over the smoothed counts.
--      That is the Bayesian-average idea (the same shrinkage IMDb uses on
--      ratings with few votes) wearing Wilson's confidence bound. With it the
--      two-play track falls to 0.25, below the forty-listener track at 0.31,
--      which is the whole point of the exercise.
--
--   2. MOMENTUM, as an exponentially time-decayed play count with a seven-day
--      half-life. A play today is worth one, a play a week ago half that, a
--      play a month ago a sixteenth. This is what makes "Rising" mean rising
--      rather than "old and famous", and it is the same decay family the
--      ranking boards have used since Hacker News.
--
--   3. AFFINITY, as item-to-item collaborative filtering — cosine similarity
--      over which tracks turn up in the same listening session. This is the
--      Amazon method (Linden, Smith & York, IEEE Internet Computing, 2003),
--      chosen over user-to-user CF or a factorisation for the honest reason
--      that it is the one that works at this catalogue's size: eighteen
--      tracks cannot support latent factors, but co-occurrence is meaningful
--      from the first few hundred sessions.
--
--   4. DEEP CUTS, as a deliberate popularity-bias correction. A recommender
--      trained on plays feeds the head of the catalogue back to itself and
--      the tail never surfaces (Celma & Cano, 2008, on the long tail in
--      recommendation networks). A track whose keep rate is far better than
--      its play rank is one the room is failing to show people, so it gets
--      its own rail.
--
-- WHAT IS PUBLISHED, AND WHAT IS STILL NOT. Same discipline as the view this
-- replaces: these are readable by anonymous visitors, so they carry positions
-- and scores normalised against the top track, never a count, never a
-- timestamp, never an identifier. A raw save rate would leak catalogue
-- performance ("four percent of listeners kept this"), so even the keep rate
-- is published relative to the best track rather than absolutely.

drop view if exists public.v_track_reach;

-- ============================================================
-- 1. THE SIGNALS, one row per track
-- ============================================================
create or replace view public.v_track_signals as
with plays as (
  select
    lower(trim(e.props->>'track')) as k,
    e.device_id,
    e.session_id,
    e.at
  from public.events e
  where e.name = 'album_play'
    -- A crawler pressing play is not an audience. is_bot is null on every
    -- row written before the telemetry columns existed, so this keeps those.
    and e.is_bot is not true
    and coalesce(trim(e.props->>'track'), '') <> ''
), keeps as (
  select
    lower(trim(e.props->>'track')) as k,
    count(distinct e.device_id) filter (where e.name = 'rotation_add')  as kept,
    count(distinct e.device_id) filter (where e.name = 'rotation_drop') as dropped
  from public.events e
  where e.name in ('rotation_add', 'rotation_drop')
    and e.is_bot is not true
    and coalesce(trim(e.props->>'track'), '') <> ''
  group by 1
), base as (
  select
    p.k,
    count(*)                        as plays,
    count(distinct p.device_id)     as listeners,
    -- the seven-day half-life: 0.5 ^ (age in days / 7)
    sum(exp(-ln(2.0) * (extract(epoch from (now() - p.at)) / 86400.0) / 7.0)) as momentum
  from plays p
  group by 1
), joined as (
  select
    b.k, b.plays, b.listeners, b.momentum,
    greatest(coalesce(kp.kept, 0) - coalesce(kp.dropped, 0), 0) as kept
  from base b
  left join keeps kp on kp.k = b.k
), prior as (
  /* THE PRIOR, TAKEN FROM THE CATALOGUE ITSELF rather than picked. C is how
     often a listener keeps a track here, across everything; PRIOR_TRIALS is
     how much evidence that prior is worth, in listeners. Ten is the weight
     at which a two-play track stops being able to outrank a two-hundred-play
     one — below about six it still slips through, and far above it the
     prior drowns real differences between real tracks. */
  select
    case when sum(greatest(j.listeners, j.kept)) = 0 then 0::numeric
         else sum(j.kept)::numeric / sum(greatest(j.listeners, j.kept)) end as c,
    10::numeric as m
  from joined j
), wilson as (
  select
    j.*,
    -- trials cannot be fewer than successes, or the proportion leaves [0,1]
    greatest(j.listeners, j.kept)::numeric + pr.m as n,
    case when greatest(j.listeners, j.kept)::numeric + pr.m = 0 then 0::numeric
         else (j.kept::numeric + pr.c * pr.m)
              / (greatest(j.listeners, j.kept)::numeric + pr.m) end as p
  from joined j cross join prior pr
), scored as (
  select
    w.*,
    /* Wilson score interval, lower bound, z = 1.96 (95%), over the smoothed
       counts above.
         (p + z²/2n - z*sqrt((p(1-p) + z²/4n)/n)) / (1 + z²/n)
       n can no longer be zero, because the prior is always in it — which is
       the other thing the smoothing buys: no special case for a track
       nobody has kept. */
    ((w.p + (3.8416 / (2 * w.n))
      - 1.96 * sqrt((w.p * (1 - w.p) + (3.8416 / (4 * w.n))) / w.n))
     / (1 + (3.8416 / w.n))) as keep_lb
  from wilson w
), ranked as (
  select
    s.*,
    rank() over (order by s.keep_lb desc, s.plays desc, s.k) as keep_rank,
    rank() over (order by s.plays desc, s.k)                 as play_rank,
    count(*) over ()                                          as total
  from scored s
)
select
  r.k as track_key,
  -- the primary ordering: kept, with confidence
  r.keep_rank as position,
  -- everything below is relative to the best track, so an ordering can be
  -- read off it and a volume cannot
  case when max(r.keep_lb) over () > 0
    then round(100 * r.keep_lb / max(r.keep_lb) over ())::int else 0 end as keep_score,
  case when max(r.momentum) over () > 0
    then round(100 * r.momentum / max(r.momentum) over ())::int else 0 end as momentum_score,
  rank() over (order by r.momentum desc, r.k)::int as momentum_rank,
  /* THE LONG TAIL, NAMED. A track the room under-shows: its keep rank sits
     in the better half while its play rank sits in the worse half. Both
     halves are of the same population, so this cannot fire on a catalogue
     where everything is played evenly. */
  (r.keep_rank <= r.total / 2.0 and r.play_rank > r.total / 2.0) as deep_cut
from ranked r
where r.plays > 0;

comment on view public.v_track_signals is
  'Per-track recommendation signals for the public listening room: Wilson '
  'lower-bound keep rate (primary order), seven-day half-life momentum, and a '
  'long-tail flag. Aggregate and anonymous by construction — positions and '
  'scores relative to the top track only, never counts, timestamps or '
  'identifiers. Adding a column here publishes it to the anonymous internet.';

-- ============================================================
-- 2. ITEM-TO-ITEM AFFINITY, cosine over session co-occurrence
-- ============================================================
create or replace view public.v_track_affinity as
with plays as (
  select distinct
    lower(trim(e.props->>'track')) as k,
    e.session_id,
    e.device_id
  from public.events e
  where e.name = 'album_play'
    and e.is_bot is not true
    and e.session_id is not null
    and coalesce(trim(e.props->>'track'), '') <> ''
), totals as (
  select k, count(distinct session_id)::numeric as sessions
  from plays group by 1
), pairs as (
  select
    a.k as k,
    b.k as other,
    count(distinct a.session_id)::numeric as co_sessions,
    count(distinct a.device_id)           as co_devices
  from plays a
  join plays b on b.session_id = a.session_id and b.k <> a.k
  group by 1, 2
)
select
  p.k as track_key,
  p.other as other_key,
  -- cosine similarity: co-occurrences over the geometric mean of the two
  -- tracks' own session counts, so a track everybody plays does not become
  -- everybody's neighbour
  round(p.co_sessions / sqrt(ta.sessions * tb.sessions), 4) as score,
  rank() over (partition by p.k order by p.co_sessions / sqrt(ta.sessions * tb.sessions) desc, p.other) as rn
from pairs p
join totals ta on ta.k = p.k
join totals tb on tb.k = p.other
/* MINIMUM SUPPORT, AND IT IS A PRIVACY FLOOR RATHER THAN A QUALITY ONE.
   A pair that only one device ever played together IS that person's
   listening session, and this view is readable by anybody. Three distinct
   devices is the floor for a pair to be published at all. It also happens
   to throw out the noisiest recommendations, but that is the bonus, not
   the reason. */
where p.co_devices >= 3;

comment on view public.v_track_affinity is
  'Item-to-item collaborative filtering (Linden/Smith/York 2003): cosine '
  'similarity over per-session co-occurrence. Pairs supported by fewer than '
  'three distinct devices are withheld, because a pair with support of one '
  'is a single visitor''s session and this view is public.';

grant select on public.v_track_signals  to anon, authenticated;
grant select on public.v_track_affinity to anon, authenticated;
