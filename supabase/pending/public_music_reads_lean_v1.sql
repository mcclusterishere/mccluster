-- Public music reads come off the lean copy of the events.
--
-- play_counts() (every album and listen page) and the v_track_signals /
-- v_track_affinity views (the listen room's order and "more like this") read
-- public.events, whose rows carry the full props, device and edge blobs
-- (~1.4 KB each). Counting 7.3k album plays took 4.5 s with every page in
-- memory (production, 2026-10-06) and crossed the 8 s statement limit under
-- any other load: 23 play_counts and 8 view timeouts in one day, each a
-- visitor's page with no counts and no ordering.
--
-- public.events_lean (20261002061954) is the narrow projection the analytics
-- functions already read, kept in step by a trigger and fully backfilled
-- (100,155 of 100,155 rows). It carries the same track, is_bot, device and
-- session columns these read. The same aggregate over it takes 131 ms; the
-- affinity matrix 114 ms.
--
-- One deliberate difference: events_lean stores the track normalized
-- (lower case, runs of - and _ as one space). The pages already match on a
-- normalized key (listen.js key(); album.html paintPlays() as of this
-- change), so the counts line up with every spelling of a title.

set local lock_timeout = '5s';

create or replace function public.play_counts()
returns table(track text, plays bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.track, count(*)::bigint as plays
    from public.events_lean l
   where l.name = 'album_play'
     and l.track is not null
   group by l.track
$$;

create or replace view public.v_track_signals as
 with plays as (
         select l.track as k, l.device_id, l.session_id, l.at
           from public.events_lean l
          where l.name = 'album_play' and not l.is_bot and coalesce(l.track, '') <> ''
        ), keeps as (
         select l.track as k,
            count(distinct l.device_id) filter (where l.name = 'rotation_add') as kept,
            count(distinct l.device_id) filter (where l.name = 'rotation_drop') as dropped
           from public.events_lean l
          where l.name = any (array['rotation_add', 'rotation_drop']) and not l.is_bot and coalesce(l.track, '') <> ''
          group by l.track
        ), base as (
         select p.k,
            count(*) as plays,
            count(distinct p.device_id) as listeners,
            sum(exp((- ln(2.0)) * (extract(epoch from now() - p.at) / 86400.0) / 7.0)) as momentum
           from plays p
          group by p.k
        ), joined as (
         select b.k, b.plays, b.listeners, b.momentum,
            greatest(coalesce(kp.kept, 0::bigint) - coalesce(kp.dropped, 0::bigint), 0::bigint) as kept
           from base b
             left join keeps kp on kp.k = b.k
        ), prior as (
         select
                case
                    when sum(greatest(j.listeners, j.kept)) = 0::numeric then 0::numeric
                    else sum(j.kept) / sum(greatest(j.listeners, j.kept))
                end as c,
            10::numeric as m
           from joined j
        ), wilson as (
         select j.k, j.plays, j.listeners, j.momentum, j.kept,
            greatest(j.listeners, j.kept)::numeric + pr.m as n,
                case
                    when (greatest(j.listeners, j.kept)::numeric + pr.m) = 0::numeric then 0::numeric
                    else (j.kept::numeric + pr.c * pr.m) / (greatest(j.listeners, j.kept)::numeric + pr.m)
                end as p
           from joined j
             cross join prior pr
        ), scored as (
         select w.k, w.plays, w.listeners, w.momentum, w.kept, w.n, w.p,
            (w.p + 3.8416 / (2::numeric * w.n) - 1.96 * sqrt((w.p * (1::numeric - w.p) + 3.8416 / (4::numeric * w.n)) / w.n)) / (1::numeric + 3.8416 / w.n) as keep_lb
           from wilson w
        ), ranked as (
         select s.k, s.plays, s.listeners, s.momentum, s.kept, s.n, s.p, s.keep_lb,
            rank() over (order by s.keep_lb desc, s.plays desc, s.k) as keep_rank,
            rank() over (order by s.plays desc, s.k) as play_rank,
            count(*) over () as total
           from scored s
        )
 select k as track_key,
    keep_rank as "position",
        case
            when max(keep_lb) over () > 0::numeric then round(100::numeric * keep_lb / max(keep_lb) over ())::integer
            else 0
        end as keep_score,
        case
            when max(momentum) over () > 0::numeric then round(100::numeric * momentum / max(momentum) over ())::integer
            else 0
        end as momentum_score,
    rank() over (order by momentum desc, k)::integer as momentum_rank,
    keep_rank::numeric <= (total::numeric / 2.0) and play_rank::numeric > (total::numeric / 2.0) as deep_cut
   from ranked r
  where plays > 0;

create or replace view public.v_track_affinity as
 with plays as (
         select distinct l.track as k, l.session_id, l.device_id
           from public.events_lean l
          where l.name = 'album_play' and not l.is_bot and l.session_id is not null and coalesce(l.track, '') <> ''
        ), totals as (
         select plays.k, count(distinct plays.session_id)::numeric as sessions
           from plays
          group by plays.k
        ), pairs as (
         select a.k, b.k as other,
            count(distinct a.session_id)::numeric as co_sessions,
            count(distinct a.device_id) as co_devices
           from plays a
             join plays b on b.session_id = a.session_id and b.k <> a.k
          group by a.k, b.k
        )
 select p.k as track_key,
    p.other as other_key,
    round(p.co_sessions / sqrt(ta.sessions * tb.sessions), 4) as score,
    rank() over (partition by p.k order by (p.co_sessions / sqrt(ta.sessions * tb.sessions)) desc, p.other) as rn
   from pairs p
     join totals ta on ta.k = p.k
     join totals tb on tb.k = p.other
  where p.co_devices >= 3;
