-- Production Experience Policy v1 + ecosystem/brand bridge.
--
-- PR C intentionally promotes a deterministic, inspectable production policy.
-- No contextual bandit, opaque latent state, protected-trait inference or
-- model-authored UI is introduced here.
--
-- It also creates the canonical Heat Chart community door and a disclosed
-- music-credit destination contract. Paid brand relationships are metadata
-- and navigation; they never buy recommendation score in this policy.

create table if not exists public.experience_preferences (
  m_uid uuid not null references public.m_people(id) on delete cascade,
  namespace text not null check (namespace ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  key text not null check (char_length(key) between 1 and 160),
  value text not null check (value in ('more','less')),
  source text not null default 'explicit' check (source in ('explicit','imported')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (m_uid, namespace, key)
);
create index if not exists experience_preferences_active_idx
  on public.experience_preferences (m_uid, namespace, updated_at desc)
  where revoked_at is null;
alter table public.experience_preferences enable row level security;
revoke all on public.experience_preferences from public,anon,authenticated;
grant all on public.experience_preferences to service_role;

insert into public.experience_policies
  (key,version,plane,mode,algorithm,config,enabled)
values (
  'production-mature','v1','production','promoted','deterministic_score_mmr',
  '{
    "feature_schema":"production-v1",
    "behavior_window_days":14,
    "stable_ttl_seconds":1800,
    "weights":{
      "editorial_prior":0.20,
      "recent_affinity":0.35,
      "explicit_preference":0.30,
      "novelty":0.10,
      "business_priority":0.05
    },
    "fatigue":{"per_unanswered_visible":0.12,"max_penalty":0.48},
    "diversity":{"same_domain_penalty":0.12,"same_kind_penalty":0.06,"same_topic_penalty":0.08},
    "business_priority":{
      "global.for_you":{"music":1,"action":1,"client":1},
      "music.next_step":{"here-album":1,"here-videos":0.6,"creator-studio":0.4},
      "action.next_step":{}
    },
    "notes":[
      "Deterministic and inspectable; no random exploration.",
      "Explicit preference and observed behavior remain separate evidence.",
      "Material sponsorship/brand connection does not affect ranking score.",
      "Protected or sensitive traits are excluded from policy features."
    ]
  }'::jsonb,
  true
)
on conflict (key,version) do update set
  plane=excluded.plane,
  mode=excluded.mode,
  algorithm=excluded.algorithm,
  config=excluded.config,
  enabled=true;

create table if not exists public.music_credit_destinations (
  id uuid primary key default gen_random_uuid(),
  music_object_id uuid not null references public.music_catalog_objects(id) on delete cascade,
  organization_id uuid references public.network_organizations(id) on delete set null,
  relationship_type text not null
    check (relationship_type in ('credit','brand_partner','sponsor','campaign_partner','affiliate','client')),
  label text not null check (char_length(label) between 1 and 120),
  destination_url text not null check (destination_url ~ '^https://'),
  material_connection boolean not null default false,
  disclosure_text text not null default '' check (char_length(disclosure_text)<=240),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not material_connection or char_length(trim(disclosure_text)) > 0),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists music_credit_destinations_object_active_idx
  on public.music_credit_destinations (music_object_id,active,created_at);
create unique index if not exists music_credit_destinations_unique_link_idx
  on public.music_credit_destinations (music_object_id,relationship_type,destination_url);
alter table public.music_credit_destinations enable row level security;
revoke all on public.music_credit_destinations from public,anon,authenticated;
grant select on public.music_credit_destinations to anon,authenticated;
grant all on public.music_credit_destinations to service_role;
drop policy if exists "public reads active music destinations" on public.music_credit_destinations;
create policy "public reads active music destinations"
on public.music_credit_destinations for select to anon,authenticated
using (
  active
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

with org as (
  insert into public.network_organizations
    (slug,name,organization_type,description,website_url,verification_state)
  values (
    'heat-chart','The Heat Chart','brand',
    'The custom-sneaker culture product grown from Designer Kicks: artists, collectors, battles, the Heat List, drops and authenticity tools.',
    'https://theheatchart.com','verified'
  )
  on conflict (lower(slug)) do update set
    name=excluded.name,
    organization_type=excluded.organization_type,
    description=excluded.description,
    website_url=excluded.website_url,
    verification_state=excluded.verification_state,
    updated_at=now()
  returning id
),
oid as (
  select id from org
  union all
  select id from public.network_organizations where lower(slug)='heat-chart'
  limit 1
)
insert into public.network_groups
  (slug,name,purpose,visibility,organization_id,group_type,front_page_url)
select
  'heat-chart','The Heat Chart',
  'The McCluster network room for sneaker artists, collectors, voters, legit-checkers and people using The Heat Chart.',
  'open',id,'community','https://theheatchart.com'
from oid
on conflict (lower(slug)) do update set
  name=excluded.name,
  purpose=excluded.purpose,
  visibility=excluded.visibility,
  organization_id=excluded.organization_id,
  group_type=excluded.group_type,
  front_page_url=excluded.front_page_url;

insert into public.event_taxonomy(event_name,stage,note) values
  ('experience_preference_set','engage','A signed-in member explicitly asked to see more or less of an allowed experience candidate.'),
  ('music_partner_open','engage','A listener followed a disclosed music credit/partner destination.'),
  ('ecosystem_bridge_open','engage','A visitor crossed between McCluster and a registered satellite product surface.')
on conflict(event_name) do update set stage=excluded.stage,note=excluded.note;

insert into public.research_sources
  (citation_key,title,authors,published_year,canonical_url,source_type,category,relevance,verified_at)
values
  (
    'parapar_radlinski_2021_accuracy_diversity',
    'Towards Unified Metrics for Accuracy and Diversity for Recommender Systems',
    '["Javier Parapar","Filip Radlinski"]'::jsonb,2021,
    'https://research.google/pubs/towards-unified-metrics-for-accuracy-and-diversity-for-recommender-systems/',
    'paper','production_policy',
    'Supports treating diversity as a first-class recommendation quality alongside relevance rather than optimizing accuracy alone.',
    now()
  ),
  (
    'xu_et_al_2022_long_term_ux',
    'Surrogate for Long-Term User Experience in Recommender Systems',
    '["Can Xu","Ed H. Chi","Lee Richardson","Lisa Mijung Chung","Minmin Chen","Mohit Sharma","Qian Sun","Sriraj Badam","Yuyan Wang"]'::jsonb,2022,
    'https://research.google/pubs/surrogate-for-long-term-user-experience-in-recommender-systems/',
    'paper','production_policy',
    'Supports monitoring return/revisit and longer-horizon outcomes instead of treating immediate clicks as the sole objective.',
    now()
  ),
  (
    'chen_et_al_2021_values_exploration',
    'Values of Exploration in Recommender Systems',
    '["Minmin Chen et al."]'::jsonb,2021,
    'https://research.google/pubs/values-of-exploration-in-recommender-systems/',
    'paper','production_policy',
    'Motivates diversity/novelty guardrails while keeping randomized exploration in the later research-policy phase.',
    now()
  ),
  (
    'zhan_et_al_provider_aware',
    'Towards Content Provider-Aware Recommendation Systems: A Simulation Study on Interplays among User and Provider Utilities',
    '["Ruohan Zhan","Konstantina Christakopoulou","Elaine Le","Jayden Ooi","Martin Mladenov","Alex Beutel","Craig Boutilier","Ed H. Chi","Minmin Chen"]'::jsonb,2021,
    'https://research.google/pubs/towards-content-provider-aware-recommendation-systems-a-simulation-study-on-interplays-among-user-and-provider-utilities/',
    'paper','multi_stakeholder',
    'Supports modeling provider/business utility separately from user utility and bounding it rather than letting commercial value dominate relevance.',
    now()
  ),
  (
    'ftc_endorsements_material_connections',
    'Endorsements, Influencers, and Reviews',
    '["U.S. Federal Trade Commission"]'::jsonb,2026,
    'https://www.ftc.gov/business-guidance/advertising-marketing/endorsements-influencers-reviews',
    'guidance','commercial_disclosure',
    'Material brand relationships connected to music/creator promotion should be clearly disclosed rather than disguised as ordinary editorial credit.',
    now()
  ),
  (
    'schema_musicrecording_sponsor',
    'Schema.org MusicRecording',
    '["Schema.org Community Group"]'::jsonb,2026,
    'https://schema.org/MusicRecording',
    'standard','music_metadata',
    'MusicRecording inherits sponsor and funder properties, providing a standards-compatible representation for disclosed brand support.',
    now()
  )
on conflict (citation_key) do update set
  title=excluded.title,
  authors=excluded.authors,
  published_year=excluded.published_year,
  canonical_url=excluded.canonical_url,
  source_type=excluded.source_type,
  category=excluded.category,
  relevance=excluded.relevance,
  verified_at=excluded.verified_at;

comment on table public.experience_preferences is
  'Explicit member-controlled preference memory. Observed behavior belongs to analytics/Audience Science and is never written here.';
comment on table public.music_credit_destinations is
  'Disclosed music credit/partner destinations. A commercial relationship may add a link/credit but never recommendation rank by itself.';
