-- NATIVE TELEMETRY, part two: the questions.
--
-- Raw rows are not analytics, they are the raw material. These views are the
-- answers, and they are the part Google Analytics structurally cannot hand
-- over: SQL against unsampled rows that still carry the address, the network
-- and the account, with no fourteen-month expiry and nobody else's login in
-- front of them.
--
-- security_invoker means each view is read as the person querying it, so the
-- admin-only policy on public.events governs them too. Without it a view is a
-- hole in the wall — which has happened here before, on eu_profiles.

create or replace view public.v_sessions
with (security_invoker = true) as
select
  e.session_id,
  min(e.at) as started,
  max(e.at) as ended,
  extract(epoch from (max(e.at) - min(e.at)))::int as span_s,
  max(e.device_id) as device_id,
  max(e.uid::text)::uuid as uid,
  bool_or(e.is_bot) as is_bot,
  max(e.ip::text) as ip,
  max(e.country) as country,
  max(e.region) as region,
  max(e.city) as city,
  max(e.asn) as asn,
  max(e.asn_org) as network,
  max(e.user_agent) as user_agent,
  count(*) as events,
  count(distinct e.path) as pages,
  count(*) filter (where e.name = 'click') as clicks,
  count(*) filter (where e.name = 'rage_click') as rage_clicks,
  count(*) filter (where e.name = 'dead_click') as dead_clicks,
  count(*) filter (where e.name in ('js_error','js_rejection')) as errors,
  count(*) filter (where e.name = 'conversion') as conversions,
  count(*) filter (where e.name = 'offer_buy_click') as buy_taps,
  bool_or(e.name = 'exit_intent') as showed_exit_intent,
  max((e.props->>'depth')::int) as max_scroll_pct,
  sum(coalesce((e.props->>'visible_s')::int,0)) as visible_s,
  (array_agg(e.path order by e.at))[1] as entry_page,
  (array_agg(e.path order by e.at desc))[1] as exit_page,
  (array_agg(e.referrer order by e.at) filter (where e.referrer is not null))[1] as referrer,
  (array_agg(e.props->'acq' order by e.at) filter (where e.props ? 'acq'))[1] as acquisition
from public.events e
where e.session_id is not null
group by e.session_id;

comment on view public.v_sessions is
  'One row per sitting: where they came from, what they were on, how far they got, and how hard the page fought them.';

create or replace view public.v_visitors
with (security_invoker = true) as
select
  e.device_id,
  min(e.at) as first_seen,
  max(e.at) as last_seen,
  count(distinct e.session_id) as sessions,
  count(*) as events,
  count(distinct e.path) as distinct_pages,
  bool_or(e.uid is not null) as has_account,
  max(e.uid::text)::uuid as uid,
  bool_or(e.is_bot) as is_bot,
  max(e.ip::text) as last_ip,
  max(e.country) as country,
  max(e.city) as city,
  max(e.asn_org) as network,
  max((e.device->>'platform')) as platform,
  max((e.props->'machine'->>'gpu')) as gpu,
  count(*) filter (where e.name = 'conversion') as conversions,
  count(*) filter (where e.name = 'offer_buy_click') as buy_taps
from public.events e
where e.device_id is not null
group by e.device_id;

comment on view public.v_visitors is
  'One row per browser: what the house knows about a returning device, including whether it ever became an account.';

create or replace view public.v_friction
with (security_invoker = true) as
select
  e.path,
  e.props->>'el' as element,
  e.props->>'text' as label,
  e.name as kind,
  count(*) as hits,
  count(distinct e.session_id) as sessions,
  max(e.at) as last_seen
from public.events e
where e.name in ('rage_click','dead_click')
  and coalesce(e.is_bot, false) = false
group by e.path, e.props->>'el', e.props->>'text', e.name;

comment on view public.v_friction is
  'The exact elements that fight people: things that look pressable and are not, and things they hammered. The most directly actionable table here, and one GA4 has no equivalent of at any price.';

create or replace view public.v_acquisition
with (security_invoker = true) as
select
  coalesce(s.acquisition->>'src', 'direct') as source,
  coalesce(s.acquisition->>'med', 'none') as medium,
  nullif(s.acquisition->>'cmp', '') as campaign,
  count(*) as sessions,
  count(distinct s.device_id) as devices,
  sum(s.conversions) as conversions,
  sum(s.buy_taps) as buy_taps,
  round(avg(s.span_s), 1) as avg_span_s
from public.v_sessions s
where coalesce(s.is_bot, false) = false
group by 1,2,3;

comment on view public.v_acquisition is
  'First-touch attribution against unsampled rows.';

create or replace view public.v_live
with (security_invoker = true) as
select
  e.session_id,
  max(e.at) as last_seen,
  max(e.path) as on_page,
  max(e.city) as city,
  max(e.region) as region,
  max(e.country) as country,
  max(e.asn_org) as network,
  max(e.ip::text) as ip,
  max(e.device_id) as device_id,
  max(e.uid::text)::uuid as uid,
  count(*) as events
from public.events e
where e.at > now() - interval '30 minutes'
  and coalesce(e.is_bot, false) = false
group by e.session_id
order by 2 desc;

comment on view public.v_live is
  'Everyone on the site in the last half hour, with the city and the network they are on.';

grant select on public.v_sessions, public.v_visitors,
               public.v_friction, public.v_acquisition, public.v_live
  to authenticated;
