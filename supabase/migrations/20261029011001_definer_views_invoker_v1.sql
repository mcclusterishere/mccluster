-- The three security_definer_view advisor ERRORs, fixed without changing a row any caller
-- sees (finding 3 of docs/control-plane/PRODUCTION-SCHEMA-RECONCILIATION-2026-10-28.md).
--
-- public.v_track_signals, public.v_track_affinity (the listening room's order and "more
-- like this", js/listen.js) and public.media_public_world_feed (the World news pins,
-- js/world-news.js) are views anon reads that run with their owner's rights. That is
-- deliberate for the track views (they are the one public door out of the owner-only
-- public.events, see supabase/migrations/20260919150000_track_recommendation_signals.sql), but a definer view is invisible
-- as such: it bypasses RLS silently and the advisor flags it as an ERROR.
--
-- Could security_invoker alone keep the same public rows? No, for all three:
--   - public.events has RLS with only "only the desk reads it" (eu_is_admin) and
--     "analytics owners read site events" (authenticated site owners): anon would read
--     nothing and the room would lose its order.
--   - public.media_news_articles and media_news_sources grant nothing to anon or
--     authenticated: an invoker view would raise "permission denied".
-- So each projection moves into a SECURITY DEFINER function with `set search_path = ''`
-- (fully qualified body, the pattern of public.play_counts()), placed in schema private
-- so PostgREST does not publish it as an RPC (anon and authenticated hold USAGE on
-- private, so the view can call it), and each view becomes a security_invoker view over
-- its function. The function bodies are production's view definitions
-- (pg_get_viewdef, 2026-10-29) with every relation schema-qualified, column for column,
-- so the views keep their names, columns, types, comments and SELECT grants, and return
-- the same rows (supabase/tests/definer_views_invoker_v1.behaviour.sql proves it on a
-- scratch database; on production the before/after row sets can be compared with
-- `select md5(string_agg(t::text, '|' order by t::text)) from public.v_track_signals t`).
--
-- Also: anon and authenticated lose INSERT/UPDATE/DELETE on media_public_world_feed
-- (a join view, never writable); SELECT stays.
--
-- Dependency order: none (production today). Promotion: PROMOTION-ORDER.md group 0,
-- before supabase/pending/public_music_reads_lean_v1.sql, which is edited to replace the
-- two track functions' bodies (reading events_lean) instead of recreating the views as
-- definer views.
--
-- Rollback: supabase/pending/20261029100100_definer_views_invoker_v1.rollback.sql
-- (production's definer views, verbatim, then the three functions dropped).
-- Test: bash scripts/test-schema-hygiene-db.sh.

set local lock_timeout = '5s';

create or replace function private.track_signals_rows()
returns table(track_key text, "position" bigint, keep_score integer, momentum_score integer, momentum_rank integer, deep_cut boolean)
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.track_affinity_rows()
returns table(track_key text, other_key text, score numeric, rn bigint)
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.media_public_world_feed_rows()
returns table(id uuid, title text, canonical_url text, published_at timestamp with time zone, language_code text,
  topic_keys text[], headline_location_label text, headline_latitude double precision, headline_longitude double precision,
  location_basis text, publisher_domain text)
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

revoke all on function private.track_signals_rows(), private.track_affinity_rows(), private.media_public_world_feed_rows()
  from public, anon, authenticated;
grant execute on function private.track_signals_rows(), private.track_affinity_rows(), private.media_public_world_feed_rows()
  to anon, authenticated, service_role;

create or replace view public.v_track_signals with (security_invoker = true) as
  select s.track_key, s."position", s.keep_score, s.momentum_score, s.momentum_rank, s.deep_cut
    from private.track_signals_rows() s;

create or replace view public.v_track_affinity with (security_invoker = true) as
  select a.track_key, a.other_key, a.score, a.rn
    from private.track_affinity_rows() a;

create or replace view public.media_public_world_feed with (security_invoker = true) as
  select f.id, f.title, f.canonical_url, f.published_at, f.language_code, f.topic_keys, f.headline_location_label,
         f.headline_latitude, f.headline_longitude, f.location_basis, f.publisher_domain
    from private.media_public_world_feed_rows() f;

revoke all on table public.v_track_signals, public.v_track_affinity, public.media_public_world_feed from anon, authenticated;
grant select on table public.v_track_signals, public.v_track_affinity, public.media_public_world_feed to anon, authenticated;
