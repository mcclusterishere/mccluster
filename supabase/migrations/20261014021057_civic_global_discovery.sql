-- Global civic discovery: offices persist when officeholders change.
create table if not exists public.civic_source_registry(
 source_key text primary key, display_name text not null, docs_url text not null,
 coverage text not null, auth_mode text not null check(auth_mode in ('none','api_key','registration','license_review')),
 secret_name text, license_note text not null, enabled boolean not null default false,
 last_checked_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.civic_jurisdictions(
 id uuid primary key default gen_random_uuid(), country_code text not null check(country_code ~ '^[A-Z]{2}$'),
 level text not null check(level in ('country','state','province','region','county','municipality','ward','district','other')),
 name text not null, local_name text, parent_id uuid references public.civic_jurisdictions(id),
 iso_code text, ocd_id text, external_ids jsonb not null default '{}'::jsonb,
 globe_region_key text references public.action_globe_regions(region_key),
 source_key text references public.civic_source_registry(source_key),
 source_url text, verified_at timestamptz, updated_at timestamptz not null default now(),
 unique(country_code,level,iso_code), unique(ocd_id)
);
create index if not exists civic_jurisdictions_parent_idx on public.civic_jurisdictions(parent_id);
create index if not exists civic_jurisdictions_country_level_idx on public.civic_jurisdictions(country_code,level);
create table if not exists public.civic_offices(
 id uuid primary key default gen_random_uuid(),
 jurisdiction_id uuid not null references public.civic_jurisdictions(id),
 title text not null, office_type text not null default 'other',
 official_url text, source_key text references public.civic_source_registry(source_key),
 source_url text, external_id text, verified_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(source_key,external_id)
);
create index if not exists civic_offices_jurisdiction_idx on public.civic_offices(jurisdiction_id);
create table if not exists public.civic_office_terms(
 id uuid primary key default gen_random_uuid(), office_id uuid not null references public.civic_offices(id),
 display_name text not null, source_person_id text, start_date date, end_date date,
 verified_at timestamptz, source_url text, profile_id uuid references public.action_policy_official_profiles(id),
 created_at timestamptz not null default now(),
 check(end_date is null or start_date is null or end_date>=start_date)
);
create index if not exists civic_office_terms_office_idx on public.civic_office_terms(office_id,end_date);
create table if not exists public.civic_contact_channels(
 id uuid primary key default gen_random_uuid(), office_id uuid not null references public.civic_offices(id),
 channel_type text not null check(channel_type in ('email','web_form','phone','postal','official_website')),
 channel_value text not null, source_url text not null, verified_at timestamptz,
 is_public boolean not null default false, created_at timestamptz not null default now(),
 unique(office_id,channel_type,channel_value)
);
create table if not exists public.civic_source_sync_runs(
 id uuid primary key default gen_random_uuid(), source_key text not null references public.civic_source_registry(source_key),
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running' check(status in ('running','completed','failed')),
 processed integer not null default 0, error text
);
alter table public.civic_source_registry enable row level security;
alter table public.civic_jurisdictions enable row level security;
alter table public.civic_offices enable row level security;
alter table public.civic_office_terms enable row level security;
alter table public.civic_contact_channels enable row level security;
alter table public.civic_source_sync_runs enable row level security;
revoke all on public.civic_source_registry,public.civic_jurisdictions,public.civic_offices,public.civic_office_terms,public.civic_contact_channels,public.civic_source_sync_runs from anon,authenticated;
grant select on public.civic_source_registry,public.civic_jurisdictions,public.civic_offices,public.civic_office_terms,public.civic_contact_channels to anon,authenticated;
grant all on public.civic_source_registry,public.civic_jurisdictions,public.civic_offices,public.civic_office_terms,public.civic_contact_channels,public.civic_source_sync_runs to service_role;
create policy civic_public_sources on public.civic_source_registry for select to anon,authenticated using(true);
create policy civic_public_jurisdictions on public.civic_jurisdictions for select to anon,authenticated using(verified_at is not null);
create policy civic_public_offices on public.civic_offices for select to anon,authenticated using(verified_at is not null);
create policy civic_public_terms on public.civic_office_terms for select to anon,authenticated using(verified_at is not null and exists(select 1 from public.civic_offices o where o.id=office_id and o.verified_at is not null));
create policy civic_public_channels on public.civic_contact_channels for select to anon,authenticated using(is_public and verified_at is not null and exists(select 1 from public.civic_offices o where o.id=office_id and o.verified_at is not null));
insert into public.civic_source_registry(source_key,display_name,docs_url,coverage,auth_mode,secret_name,license_note,enabled) values
('wikidata','Wikidata','https://www.wikidata.org/wiki/Help:Data_access','global discovery','none',null,'CC0 structured data; verify officeholder facts against official sources',false),
('ipu_parline','IPU Parline','https://data.ipu.org/data-tools/api/','national parliaments worldwide','registration',null,'Confirm API access and reuse terms',false),
('uk_parliament','UK Parliament','https://developer.parliament.uk/','UK national parliament','none',null,'Official public APIs; observe source-specific licenses',false),
('canada_commons','Canada House of Commons','https://www.ourcommons.ca/en/open-data','Canada federal parliament','none',null,'Check dataset-specific reuse and attribution',false),
('brazil_camara','Brazil Câmara dos Deputados','https://dadosabertos.camara.leg.br/swagger/api.html','Brazil federal lower chamber','none',null,'Check official open-data terms',false),
('congress_gov','Congress.gov','https://api.congress.gov/','United States federal','api_key','CONGRESS_API_KEY','Government data; check endpoint terms',false),
('openstates','Open States','https://docs.openstates.org/api-v3/','United States states and select municipalities','api_key','OPENSTATES_API_KEY','Review API usage and attribution',false),
('legiscan','LegiScan','https://legiscan.com/legiscan','United States legislative bills','api_key','LEGISCAN_API_KEY','Free tier has request limits; review commercial terms',false),
('legistar','Granicus Legistar','https://webapi.legistar.com/','participating municipalities and counties','registration',null,'Per-jurisdiction access and licensing must be verified',false),
('official_local','Official local government portals','https://www.usa.gov/local-governments','county, municipal, ward worldwide','license_review',null,'Manual jurisdiction-by-jurisdiction adapters and verification',false)
on conflict(source_key) do nothing;
