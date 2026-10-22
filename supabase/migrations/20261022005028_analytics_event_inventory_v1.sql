-- Owner-only Analytics event-name coverage, never a public REST dataset.
-- Both raw and lean counts use the first-party property; explicitly include
-- bot events in the inventory, with a separate bot_rows indicator.
-- Performance: read only on explicit owner request, not the home dashboard.

-- 126k+ event rows are much wider than these narrow name/time columns.
-- First-party partial covering indexes avoid two unbounded heap scans when
-- owners request an all-name inventory. Keep the two stores independently
-- indexed so projection mismatch remains visible, without changing rows.
-- A short lock timeout refuses to block the live collector for long.
-- On a populated live collector, indexes MUST already be valid. Build them
-- CONCURRENTLY in separate statements first, then apply this migration.
-- The same file remains replayable in an empty isolated database.
do $$
begin
  if exists (select 1 from public.events limit 1) and (
    not exists (select 1 from pg_catalog.pg_index
      where indexrelid=to_regclass('public.events_first_party_inventory_v1_idx')
        and indisvalid and indisready)
    or not exists (select 1 from pg_catalog.pg_index
      where indexrelid=to_regclass('public.events_lean_first_party_inventory_v1_idx')
        and indisvalid and indisready)
  ) then
    raise exception 'Build both analytics inventory indexes concurrently before live migration';
  end if;
end $$;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create index if not exists events_first_party_inventory_v1_idx
  on public.events (name, at desc) include (is_bot)
  where site_id is null;
create index if not exists events_lean_first_party_inventory_v1_idx
  on public.events_lean (name, at desc)
  where site_id is null;

-- Index-only reads depend on visibility maps. Default insert-only
-- autovacuum thresholds can leave weeks of new pages requiring heap access.
-- Keep this local to the two analytics stores, not the whole database.
alter table public.events set (
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_vacuum_insert_threshold = 500
);
alter table public.events_lean set (
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_vacuum_insert_threshold = 500
);


insert into public.event_taxonomy(event_name,stage,note)
values
  ('mnet_view','view','Client-reported community profile/content view; not unique people.'),
  ('world_focus','view','Client-reported map focus; not verified location or visit.'),
  ('action_view','view','Client-reported campaign/mission view; not a join.'),
  ('gateway_view','view','Client-reported gateway view.'),
  ('music_play','content','Client-reported music playback; not verified listen or payment.'),
  ('music_preview_play','content','Client-reported preview playback; may end before completion.'),
  ('music_full_play','content','Client-reported full-track playback; not a verified purchase.'),
  ('music_preview_complete','content','Client-reported preview completion; not a paid full listen.'),
  ('music_complete','content','Client-reported playback completion.'),
  ('gated_preview_end','content','Gated player preview ended; not a purchase.'),
  ('music_now_open','content','Player interface opened; not proof playback started.'),
  ('song_leave','content','Playback page exited; not a completion.'),
  ('song_pause','content','Player paused; not playback completion.'),
  ('song_resume','content','Player resumed; not a unique listener.'),
  ('song_end','content','Player ended; client observation.'),
  ('track_share','engage','Share action reported by client; not proof recipient engagement.'),
  ('form_start','engage','Form interaction started; not a submitted lead.'),
  ('form_submit','lead','Client reported form submission; server-side lead verification is separate.'),
  ('signup_started','engage','Signup screen started; verified registrations come from auth.users.'),
  ('signup_failed','ops','Client-reported signup error, not registration.'),
  ('guest_sign_in_prompt','engage','Sign-in prompt shown to guest, not a registration.'),
  ('mission_join','lead','Client-reported join intent; canonical mission assignments prove participation.'),
  ('mnet_message_sent','engage','Client-reported send action; message delivery is not verified.'),
  ('feed_scope','ops','Feed filter/scope selection; not funnel engagement conversion.'),
  ('desk_signal','ops','Client interface signal, not evidence of a completed action.'),
  ('vr_gate_deny','ops','Gate refused action; not successful VR use.'),
  ('play_failed','ops','Playback error, not successful listen.'),
  ('precise_location','ops','Permission/location handling signal; not a verified location.'),
  ('world_news_place','ops','World news placement/scope state, not a visitor conversion.'),
  ('onboarding_done','engage','Client-reported onboarding completion; backend registration is separate.')
on conflict (event_name) do nothing;

create or replace function public.analytics_event_inventory_v1()
returns table(
  event_name text, raw_total bigint, lean_total bigint,
  bot_rows bigint, recent_24h bigint, recent_7d bigint,
  first_seen_at timestamptz, last_seen_at timestamptz,
  taxonomy_stage text, taxonomy_note text
)
language sql stable security invoker
set search_path = ''
as $$
  with raw as materialized (
    select e.name,
      count(*)::bigint as n,
      count(*) filter(where e.is_bot is true)::bigint as bots,
      count(*) filter(where e.at>=now()-interval '24 hours')::bigint as d1,
      count(*) filter(where e.at>=now()-interval '7 days')::bigint as d7,
      min(e.at) as first_seen,
      max(e.at) as last_seen
    from public.events e
    where e.site_id is null and e.at<now()
    group by e.name
  ), lean as materialized (
    select l.name,count(*)::bigint as n
    from public.events_lean l
    where l.site_id is null and l.at<now()
    group by l.name
  )
  select coalesce(r.name,l.name),
    coalesce(r.n,0)::bigint,coalesce(l.n,0)::bigint,
    coalesce(r.bots,0)::bigint,coalesce(r.d1,0)::bigint,
    coalesce(r.d7,0)::bigint,
    r.first_seen,r.last_seen,t.stage,t.note
  from raw r
  full join lean l on l.name=r.name
  left join public.event_taxonomy t on t.event_name=coalesce(r.name,l.name)
  order by coalesce(r.n,l.n) desc,coalesce(r.name,l.name);
$$;

revoke all on function public.analytics_event_inventory_v1()
  from public,anon,authenticated;
grant execute on function public.analytics_event_inventory_v1()
  to service_role;


-- Count only verified Instagram API observations belonging to the house.
-- Manually reported snapshots and non-Instagram accounts are not evidence
-- that Instagram authorization/discovery is operational.
create or replace function public.analytics_instagram_source_status_v1(p_org uuid)
returns table(
  instagram_posts bigint, verified_insight_snapshots bigint,
  instagram_accounts bigint, connected_accounts bigint, authorization_expired boolean
)
language sql stable security invoker
set search_path = ''
as $$
  select
    (select count(*)::bigint
      from public.social_posts p
      join public.social_accounts a on a.id=p.account_id
      where p.org_id=p_org and a.org_id=p_org and a.platform='instagram'),
    (select count(*)::bigint
      from public.social_metric_snapshots m
      join public.social_posts p on p.id=m.post_id
      join public.social_accounts a on a.id=p.account_id
      where m.org_id=p_org and p.org_id=p_org and a.org_id=p_org
        and a.platform='instagram' and m.source='platform_api'),
    (select count(*)::bigint
      from public.social_accounts a
      where a.org_id=p_org and a.platform='instagram'),
    (select count(*)::bigint
      from public.social_accounts a
      where a.org_id=p_org and a.platform='instagram' and a.status='connected'),
    exists(select 1 from public.social_accounts a
      where a.org_id=p_org and a.platform='instagram'
        and a.media_discovery_error='meta_error_190');
$$;
revoke all on function public.analytics_instagram_source_status_v1(uuid)
  from public,anon,authenticated;
grant execute on function public.analytics_instagram_source_status_v1(uuid)
  to service_role;
