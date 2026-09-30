-- UPRISE ACTION NETWORK v1 — attention in, organized people out.
--
-- APPLIED TO PRODUCTION 2026-09-30 as migration 20260930235851_uprise_action_network.
-- Previously tested in a rolled-back transaction covering anon/participant/owner
-- paths, referral, idempotent join, hourly action de-dup, and money-hidden behavior.
--
-- A campaign is DATA, not a page: /action/?c=<slug> renders whichever
-- campaign row it is given, and the owner launches the next one from
-- McCluster Control without a deploy. Campaign 001 (critical minerals /
-- DR Congo, slug "cobalt") is seeded below.
--
-- People first. Every participant is a signed-in McCluster identity
-- (auth.users -> m_auth_user_links -> m_people), numbered per campaign,
-- with the Reel/source that brought them, what they can contribute and a
-- referral code. Money is off by default (money_enabled = false): the
-- Connecticut solicitation cycle closed 2026-09-30 and no gift is
-- tax-deductible yet, so no page may ask for money until the owner turns
-- a campaign's money on. The public ledger shows only published rows.

create table public.action_campaigns (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  status text not null default 'draft' check (status in ('draft','live','paused','closed')),
  program text not null default 'uprise-action-network',
  title text not null check (char_length(title) between 1 and 160),
  kicker text,
  headline text,
  body text,
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array'),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  phases jsonb not null default '[]'::jsonb check (jsonb_typeof(phases) = 'array'),
  current_phase text,
  people_goal integer check (people_goal is null or people_goal > 0),
  money_goal_cents bigint check (money_goal_cents is null or money_goal_cents > 0),
  money_enabled boolean not null default false,
  allocation_note text,
  chapter jsonb not null default '{}'::jsonb check (jsonb_typeof(chapter) = 'object'),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.action_campaigns is
  'Uprise Action Network campaigns. Rendered by /action/?c=<slug>. money_enabled stays false until the owner may lawfully solicit for this campaign.';

create table public.action_participants (
  campaign_id text not null references public.action_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  m_uid uuid,
  participant_no integer not null,
  joined_at timestamptz not null default now(),
  origin jsonb not null default '{}'::jsonb,
  contributions text[] not null default '{}',
  skills text[] not null default '{}',
  referral_code text not null unique,
  referred_by text,
  primary key (campaign_id, user_id),
  unique (campaign_id, participant_no)
);
create index action_participants_referred_idx on public.action_participants (campaign_id, referred_by) where referred_by is not null;
create index action_participants_reel_idx on public.action_participants (campaign_id, (origin->>'reel'));

create table public.action_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.action_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('share','volunteer','research','organize','learn','resources','give_intent')),
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index action_events_campaign_idx on public.action_events (campaign_id, user_id);

create table public.action_ledger (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.action_campaigns(id) on delete cascade,
  kind text not null check (kind in ('received','committed','disbursed','expense')),
  amount_cents bigint not null check (amount_cents >= 0),
  counterparty text,
  purpose text not null,
  evidence_url text check (evidence_url is null or evidence_url ~ '^https://'),
  occurred_on date not null default current_date,
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create index action_ledger_campaign_idx on public.action_ledger (campaign_id, occurred_on desc);

alter table public.action_campaigns enable row level security;
alter table public.action_participants enable row level security;
alter table public.action_events enable row level security;
alter table public.action_ledger enable row level security;

create policy "anyone reads public campaigns" on public.action_campaigns
  for select to anon, authenticated
  using (status in ('live','paused','closed') or (select public.eu_is_admin()));
create policy "owner writes campaigns" on public.action_campaigns
  for all to authenticated
  using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));

create policy "participants read themselves" on public.action_participants
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.eu_is_admin()));
create policy "participants read their actions" on public.action_events
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.eu_is_admin()));

create policy "anyone reads the published ledger" on public.action_ledger
  for select to anon, authenticated
  using (published or (select public.eu_is_admin()));
create policy "owner writes the ledger" on public.action_ledger
  for all to authenticated
  using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));

-- Keep only the attribution keys the funnel reads, each short and plain.
create function public.action_clean_origin(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    from (
      select k, lower(left(p->>k, 40)) as v
        from unnest(array['src','med','reel','cmp']) k
       where jsonb_typeof(p->k) = 'string'
         and lower(left(p->>k, 40)) ~ '^[a-z0-9][a-z0-9._-]*$'
    ) s;
$$;

create function public.action_me(p_campaign text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.user_id is null then null else jsonb_build_object(
    'participant_no', p.participant_no,
    'joined_at', p.joined_at,
    'origin', p.origin,
    'contributions', to_jsonb(p.contributions),
    'skills', to_jsonb(p.skills),
    'referral_code', p.referral_code,
    'actions', (select count(*) from public.action_events e where e.campaign_id = p.campaign_id and e.user_id = p.user_id),
    'recruited', (select count(*) from public.action_participants r where r.campaign_id = p.campaign_id and r.referred_by = p.referral_code),
    'phase', c.current_phase
  ) end
  from public.action_campaigns c
  left join public.action_participants p on p.campaign_id = c.id and p.user_id = auth.uid()
  where c.id = p_campaign;
$$;

create function public.action_join(p_campaign text, p_origin jsonb, p_contributions text[], p_skills text[], p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
  v_no integer;
  v_code text;
  v_ref text;
  v_contrib text[];
  v_skills text[];
begin
  if v_user is null then
    raise exception 'sign in to join' using errcode = '28000';
  end if;
  select status into v_status from public.action_campaigns where id = p_campaign;
  if v_status is null or v_status <> 'live' then
    raise exception 'campaign is not open' using errcode = 'P0002';
  end if;
  -- joins are serialized per campaign: numbers are handed out one at a
  -- time, and one person's two taps cannot both insert
  perform pg_advisory_xact_lock(hashtextextended('action_join:' || p_campaign, 0));
  select coalesce(array_agg(distinct x order by x), '{}') into v_contrib
    from unnest(coalesce(p_contributions, '{}')) x
   where x in ('give','time','skills','reach','resources','learn');
  select coalesce(array_agg(distinct x order by x), '{}') into v_skills
    from unnest(coalesce(p_skills, '{}')) x
   where x in ('research','engineering','media','organizing','education','design','legal_policy','fundraising','field','unsure');

  if exists (select 1 from public.action_participants where campaign_id = p_campaign and user_id = v_user) then
    -- already in: widen what they offer, never renumber or re-attribute
    update public.action_participants
       set contributions = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(contributions || v_contrib) x),
           skills = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(skills || v_skills) x)
     where campaign_id = p_campaign and user_id = v_user;
    return public.action_me(p_campaign);
  end if;

  select coalesce(max(participant_no), 0) + 1 into v_no from public.action_participants where campaign_id = p_campaign;

  select referral_code into v_ref from public.action_participants
   where campaign_id = p_campaign and referral_code = upper(left(coalesce(p_ref, ''), 12)) and user_id <> v_user;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 7));
    exit when not exists (select 1 from public.action_participants where referral_code = v_code);
  end loop;

  insert into public.action_participants
    (campaign_id, user_id, m_uid, participant_no, origin, contributions, skills, referral_code, referred_by)
  values
    (p_campaign, v_user,
     (select m_uid from public.m_auth_user_links where auth_user_id = v_user and is_primary limit 1),
     v_no, public.action_clean_origin(coalesce(p_origin, '{}'::jsonb)), v_contrib, v_skills, v_code, v_ref);
  return public.action_me(p_campaign);
end;
$$;

create function public.action_act(p_campaign text, p_kind text, p_detail jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if not exists (select 1 from public.action_participants where campaign_id = p_campaign and user_id = v_user) then
    raise exception 'join the campaign first' using errcode = 'P0002';
  end if;
  if p_kind not in ('share','volunteer','research','organize','learn','resources','give_intent') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  -- one of each kind per hour is plenty; repeats do not inflate the count
  if exists (select 1 from public.action_events where campaign_id = p_campaign and user_id = v_user
              and kind = p_kind and at > now() - interval '1 hour') then
    return public.action_me(p_campaign);
  end if;
  insert into public.action_events (campaign_id, user_id, kind, detail)
  values (p_campaign, v_user, p_kind,
          case when p_detail is null or jsonb_typeof(p_detail) <> 'object' or char_length(p_detail::text) > 2000
               then '{}'::jsonb else p_detail end);
  return public.action_me(p_campaign);
end;
$$;

-- The public face of a campaign: its content, how many people and actions,
-- and money only when the owner has switched money on.
create function public.action_campaign_public(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'status', c.status, 'program', c.program,
    'title', c.title, 'kicker', c.kicker, 'headline', c.headline, 'body', c.body,
    'facts', c.facts, 'sources', c.sources, 'phases', c.phases,
    'current_phase', c.current_phase, 'people_goal', c.people_goal,
    'allocation_note', c.allocation_note, 'chapter', c.chapter,
    'people', (select count(*) from public.action_participants p where p.campaign_id = c.id),
    'actions', (select count(*) from public.action_events e where e.campaign_id = c.id),
    'money', case when c.money_enabled then jsonb_build_object(
        'goal_cents', c.money_goal_cents,
        'raised_cents', (select coalesce(sum(amount_cents), 0) from public.action_ledger l
                          where l.campaign_id = c.id and l.published and l.kind = 'received')
      ) else null end,
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object(
                  'kind', l.kind, 'amount_cents', l.amount_cents, 'counterparty', l.counterparty,
                  'purpose', l.purpose, 'evidence_url', l.evidence_url, 'occurred_on', l.occurred_on)
                  order by l.occurred_on desc), '[]'::jsonb)
                 from public.action_ledger l where l.campaign_id = c.id and l.published)
  )
  from public.action_campaigns c
  where c.slug = lower(p_slug) and c.status in ('live','paused','closed');
$$;

create function public.action_campaigns_live()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', c.slug, 'title', c.title, 'kicker', c.kicker, 'chapter', c.chapter,
    'current_phase', c.current_phase,
    'people', (select count(*) from public.action_participants p where p.campaign_id = c.id)
  ) order by c.sort, c.created_at), '[]'::jsonb)
  from public.action_campaigns c where c.status = 'live';
$$;

-- Owner only: which Reel/source produced visits, joins and actions.
create function public.action_funnel(p_campaign text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  if not public.eu_is_admin() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  select slug into v_slug from public.action_campaigns where id = p_campaign;
  return (
    with views as (
      select coalesce(nullif(lower(e.props->>'reel'), ''), '(none)') as reel,
             coalesce(nullif(lower(e.props->>'src'), ''), '(none)') as src,
             count(*) as views, count(distinct coalesce(e.device_id, e.session_id)) as visitors
        from public.events e
       where e.name = 'action_view' and e.props->>'campaign' = v_slug
       group by 1, 2
    ), joins as (
      select coalesce(nullif(p.origin->>'reel', ''), '(none)') as reel,
             coalesce(nullif(p.origin->>'src', ''), '(none)') as src,
             count(*) as joins,
             count(*) filter (where exists (select 1 from public.action_events a
                                             where a.campaign_id = p.campaign_id and a.user_id = p.user_id)) as acted,
             count(*) filter (where p.referred_by is not null) as referred
        from public.action_participants p
       where p.campaign_id = p_campaign
       group by 1, 2
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'reel', coalesce(v.reel, j.reel), 'src', coalesce(v.src, j.src),
      'views', coalesce(v.views, 0), 'visitors', coalesce(v.visitors, 0),
      'joins', coalesce(j.joins, 0), 'acted', coalesce(j.acted, 0), 'referred', coalesce(j.referred, 0)
    ) order by coalesce(j.joins, 0) desc, coalesce(v.views, 0) desc), '[]'::jsonb)
    from views v full join joins j on j.reel = v.reel and j.src = v.src
  );
end;
$$;

revoke all on function public.action_clean_origin(jsonb) from public, anon, authenticated;
revoke all on function public.action_me(text) from public, anon;
revoke all on function public.action_join(text, jsonb, text[], text[], text) from public, anon;
revoke all on function public.action_act(text, text, jsonb) from public, anon;
revoke all on function public.action_funnel(text) from public, anon;
revoke all on function public.action_campaign_public(text) from public;
revoke all on function public.action_campaigns_live() from public;
grant execute on function public.action_me(text) to authenticated;
grant execute on function public.action_join(text, jsonb, text[], text[], text) to authenticated;
grant execute on function public.action_act(text, text, jsonb) to authenticated;
grant execute on function public.action_funnel(text) to authenticated;
grant execute on function public.action_campaign_public(text) to anon, authenticated;
grant execute on function public.action_campaigns_live() to anon, authenticated;

-- CAMPAIGN 001. Every fact below is quoted or closely paraphrased from the
-- linked primary source (checked 2026-09-30). Money is off.
insert into public.action_campaigns
  (id, slug, status, title, kicker, headline, body, facts, sources, phases, current_phase,
   people_goal, money_goal_cents, money_enabled, allocation_note, chapter, sort)
values (
  'critical-minerals-drc-001', 'cobalt', 'live',
  'The Cobalt Action Mission',
  'Campaign 001 · Critical minerals · DR Congo',
  'You saw it. Now do something.',
  'Children and adults face serious labor abuses and dangerous conditions in parts of the Democratic Republic of the Congo''s mineral economy. 1,000,000 people watching is attention. 1,000,000 people organized is power. Equity Uprise is organizing people, skills, research and resources toward a measurable intervention against child exploitation in critical-mineral supply chains: partner-vetted, and published as it happens.',
  '[
    {"text": "Over 70% of the world''s cobalt comes from mines in the Democratic Republic of the Congo.", "source": "U.S. Department of Labor, ILAB", "url": "https://www.dol.gov/agencies/ilab/reports/child-labor/list-of-goods/supply-chains/lithium-ion-batteries"},
    {"text": "In 2009 the U.S. Department of Labor placed cobalt ore from the DRC on its List of Goods Produced by Child Labor or Forced Labor.", "source": "U.S. Department of Labor, ILAB", "url": "https://www.dol.gov/agencies/ilab/reports/child-labor/list-of-goods/supply-chains/lithium-ion-batteries"},
    {"text": "Child labor is often found in artisanal and small-scale mines, which are less regulated and rarely visited by labor inspectors.", "source": "U.S. Department of Labor, ILAB", "url": "https://www.dol.gov/agencies/ilab/reports/child-labor/list-of-goods/supply-chains/lithium-ion-batteries"},
    {"text": "Children perform dangerous tasks mining cobalt ore (heterogenite) and copper ore.", "source": "U.S. Department of Labor, 2024 Findings on the Worst Forms of Child Labor", "url": "https://www.dol.gov/agencies/ilab/resources/reports/child-labor/congo-democratic-republic-drc"},
    {"text": "The ILO''s GALAB project has registered over 6,200 children engaged in mining in Haut-Katanga and Lualaba through its Child Labour Monitoring and Remediation System, and funds referral, remediation, education and livelihood support.", "source": "International Labour Organization, 20 Nov 2024", "url": "https://www.ilo.org/resource/news/ilo-launches-galab-project-democratic-republic-congo-address-child-labour"}
  ]'::jsonb,
  '[
    {"label": "Interconnected supply chains: due diligence challenges and opportunities sourcing cobalt and copper from the DRC", "publisher": "OECD", "url": "https://mneguidelines.oecd.org/interconnected-supply-chains-a-comprehensive-look-at-due-diligence-challenges-and-opportunities-sourcing-cobalt-and-copper-from-the-drc.htm"},
    {"label": "Child Labor in the DRC: 2024 findings", "publisher": "U.S. Department of Labor", "url": "https://www.dol.gov/agencies/ilab/resources/reports/child-labor/congo-democratic-republic-drc"},
    {"label": "ILO launches GALAB project to address child labour in cobalt mining", "publisher": "ILO", "url": "https://www.ilo.org/resource/news/ilo-launches-galab-project-democratic-republic-congo-address-child-labour"}
  ]'::jsonb,
  '[
    {"key": "mobilize", "title": "Mobilize", "detail": "10,000 people in the Action Network."},
    {"key": "investigate", "title": "Investigate", "detail": "Commission research and identify Congolese partners."},
    {"key": "build", "title": "Build", "detail": "Publish the intervention and safeguarding plan."},
    {"key": "fund", "title": "Fund", "detail": "$1,000,000 committed to the plan."},
    {"key": "deploy", "title": "Deploy", "detail": "Fund approved, partner-vetted interventions."},
    {"key": "prove", "title": "Prove", "detail": "Publish outcomes, expenditures and evidence."}
  ]'::jsonb,
  'mobilize', 10000, 100000000, false,
  'Allocation pending partner and intervention due diligence. No money is being collected for this campaign yet; when it is, every dollar received and spent will be published here.',
  '{"region": "DR Congo", "title": "Critical minerals", "line": "The metal in your phone has a story."}'::jsonb,
  1
);
