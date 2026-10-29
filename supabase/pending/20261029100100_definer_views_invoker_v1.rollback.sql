-- Rollback of supabase/pending/20261029100100_definer_views_invoker_v1.sql: the three views
-- back to production's definer views of 2026-10-29 (pg_get_viewdef, schema-qualified), their
-- grants as they were, then the three private functions dropped.

set local lock_timeout = '5s';

alter view public.v_track_signals reset (security_invoker);
create or replace view public.v_track_signals as
 WITH plays AS (
         SELECT lower(TRIM(BOTH FROM e.props ->> 'track'::text)) AS k,
            e.device_id,
            e.session_id,
            e.at
           FROM public.events e
          WHERE e.name = 'album_play'::text AND e.is_bot IS NOT TRUE AND COALESCE(TRIM(BOTH FROM e.props ->> 'track'::text), ''::text) <> ''::text
        ), keeps AS (
         SELECT lower(TRIM(BOTH FROM e.props ->> 'track'::text)) AS k,
            count(DISTINCT e.device_id) FILTER (WHERE e.name = 'rotation_add'::text) AS kept,
            count(DISTINCT e.device_id) FILTER (WHERE e.name = 'rotation_drop'::text) AS dropped
           FROM public.events e
          WHERE (e.name = ANY (ARRAY['rotation_add'::text, 'rotation_drop'::text])) AND e.is_bot IS NOT TRUE AND COALESCE(TRIM(BOTH FROM e.props ->> 'track'::text), ''::text) <> ''::text
          GROUP BY (lower(TRIM(BOTH FROM e.props ->> 'track'::text)))
        ), base AS (
         SELECT p.k,
            count(*) AS plays,
            count(DISTINCT p.device_id) AS listeners,
            sum(exp((- ln(2.0)) * (EXTRACT(epoch FROM now() - p.at) / 86400.0) / 7.0)) AS momentum
           FROM plays p
          GROUP BY p.k
        ), joined AS (
         SELECT b.k,
            b.plays,
            b.listeners,
            b.momentum,
            GREATEST(COALESCE(kp.kept, 0::bigint) - COALESCE(kp.dropped, 0::bigint), 0::bigint) AS kept
           FROM base b
             LEFT JOIN keeps kp ON kp.k = b.k
        ), prior AS (
         SELECT
                CASE
                    WHEN sum(GREATEST(j.listeners, j.kept)) = 0::numeric THEN 0::numeric
                    ELSE sum(j.kept) / sum(GREATEST(j.listeners, j.kept))
                END AS c,
            10::numeric AS m
           FROM joined j
        ), wilson AS (
         SELECT j.k,
            j.plays,
            j.listeners,
            j.momentum,
            j.kept,
            GREATEST(j.listeners, j.kept)::numeric + pr.m AS n,
                CASE
                    WHEN (GREATEST(j.listeners, j.kept)::numeric + pr.m) = 0::numeric THEN 0::numeric
                    ELSE (j.kept::numeric + pr.c * pr.m) / (GREATEST(j.listeners, j.kept)::numeric + pr.m)
                END AS p
           FROM joined j
             CROSS JOIN prior pr
        ), scored AS (
         SELECT w.k,
            w.plays,
            w.listeners,
            w.momentum,
            w.kept,
            w.n,
            w.p,
            (w.p + 3.8416 / (2::numeric * w.n) - 1.96 * sqrt((w.p * (1::numeric - w.p) + 3.8416 / (4::numeric * w.n)) / w.n)) / (1::numeric + 3.8416 / w.n) AS keep_lb
           FROM wilson w
        ), ranked AS (
         SELECT s.k,
            s.plays,
            s.listeners,
            s.momentum,
            s.kept,
            s.n,
            s.p,
            s.keep_lb,
            rank() OVER (ORDER BY s.keep_lb DESC, s.plays DESC, s.k) AS keep_rank,
            rank() OVER (ORDER BY s.plays DESC, s.k) AS play_rank,
            count(*) OVER () AS total
           FROM scored s
        )
 SELECT k AS track_key,
    keep_rank AS "position",
        CASE
            WHEN max(keep_lb) OVER () > 0::numeric THEN round(100::numeric * keep_lb / max(keep_lb) OVER ())::integer
            ELSE 0
        END AS keep_score,
        CASE
            WHEN max(momentum) OVER () > 0::numeric THEN round(100::numeric * momentum / max(momentum) OVER ())::integer
            ELSE 0
        END AS momentum_score,
    rank() OVER (ORDER BY momentum DESC, k)::integer AS momentum_rank,
    keep_rank::numeric <= (total::numeric / 2.0) AND play_rank::numeric > (total::numeric / 2.0) AS deep_cut
   FROM ranked r
  WHERE plays > 0;

alter view public.v_track_affinity reset (security_invoker);
create or replace view public.v_track_affinity as
 WITH plays AS (
         SELECT DISTINCT lower(TRIM(BOTH FROM e.props ->> 'track'::text)) AS k,
            e.session_id,
            e.device_id
           FROM public.events e
          WHERE e.name = 'album_play'::text AND e.is_bot IS NOT TRUE AND e.session_id IS NOT NULL AND COALESCE(TRIM(BOTH FROM e.props ->> 'track'::text), ''::text) <> ''::text
        ), totals AS (
         SELECT plays.k,
            count(DISTINCT plays.session_id)::numeric AS sessions
           FROM plays
          GROUP BY plays.k
        ), pairs AS (
         SELECT a.k,
            b.k AS other,
            count(DISTINCT a.session_id)::numeric AS co_sessions,
            count(DISTINCT a.device_id) AS co_devices
           FROM plays a
             JOIN plays b ON b.session_id = a.session_id AND b.k <> a.k
          GROUP BY a.k, b.k
        )
 SELECT p.k AS track_key,
    p.other AS other_key,
    round(p.co_sessions / sqrt(ta.sessions * tb.sessions), 4) AS score,
    rank() OVER (PARTITION BY p.k ORDER BY (p.co_sessions / sqrt(ta.sessions * tb.sessions)) DESC, p.other) AS rn
   FROM pairs p
     JOIN totals ta ON ta.k = p.k
     JOIN totals tb ON tb.k = p.other
  WHERE p.co_devices >= 3;

alter view public.media_public_world_feed reset (security_invoker);
create or replace view public.media_public_world_feed as
 SELECT a.id,
    a.title,
    a.canonical_url,
    a.published_at,
    a.language_code,
    a.topic_keys,
    a.headline_location_label,
    a.headline_latitude,
    a.headline_longitude,
    a.location_basis,
    o.domain AS publisher_domain
   FROM public.media_news_articles a
     JOIN public.media_news_sources o ON o.id = a.source_id
  WHERE a.ingestion_provider = 'gdelt_doc_v2'::text;

grant select on table public.v_track_signals, public.v_track_affinity to anon, authenticated;
grant select, insert, update, delete on table public.media_public_world_feed to anon, authenticated;

drop function if exists private.track_signals_rows();
drop function if exists private.track_affinity_rows();
drop function if exists private.media_public_world_feed_rows();
