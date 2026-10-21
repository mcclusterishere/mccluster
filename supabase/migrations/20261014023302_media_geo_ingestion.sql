-- Geo pins are coarse locations explicitly named in a headline, NOT verified event sites.
alter table public.media_articles add column if not exists ingestion_provider text;
alter table public.media_articles add column if not exists headline_location_label text;
alter table public.media_articles add column if not exists headline_latitude double precision;
alter table public.media_articles add column if not exists headline_longitude double precision;
alter table public.media_articles add column if not exists location_basis text not null default 'none' check(location_basis in ('none','headline_country_mention'));
alter table public.media_articles add column if not exists location_rule_id uuid;
create table if not exists public.media_geo_rules(
 id uuid primary key default gen_random_uuid(),country_name text not null unique,
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 enabled boolean not null default true,
 check(length(country_name)>3)
);
insert into public.media_geo_rules(country_name,latitude,longitude) values
('Ukraine',48.38,31.17),('Russia',61.52,105.32),('France',46.60,2.21),
('Germany',51.17,10.45),('Brazil',-14.24,-51.93),('Canada',56.13,-106.35),
('Australia',-25.27,133.78),('Japan',36.20,138.25),('India',20.59,78.96),
('China',35.86,104.20),('Mexico',23.63,-102.55),('Nigeria',9.08,8.68),
('Kenya',-0.02,37.91),('Argentina',-38.42,-63.62),('Pakistan',30.38,69.35),
('Indonesia',-0.79,113.92),('Poland',51.92,19.15),('Spain',40.46,-3.75),
('Italy',41.87,12.57),('Turkey',38.96,35.24)
on conflict(country_name) do nothing;
alter table public.media_geo_rules enable row level security;
revoke all on public.media_geo_rules from anon,authenticated;
grant all on public.media_geo_rules to service_role;
create or replace function public.media_apply_geo_rule() returns trigger language plpgsql security definer set search_path=public as $$
declare matches integer; rule record;
begin
 new.headline_location_label:=null;new.headline_latitude:=null;new.headline_longitude:=null;new.location_rule_id:=null;new.location_basis:='none';
 select count(*) into matches from public.media_geo_rules g where g.enabled and new.title ~* ('\m'||g.country_name||'\M');
 if matches=1 then
  select g.* into rule from public.media_geo_rules g where g.enabled and new.title ~* ('\m'||g.country_name||'\M') limit 1;
  new.headline_location_label:=rule.country_name;new.headline_latitude:=rule.latitude;new.headline_longitude:=rule.longitude;new.location_rule_id:=rule.id;new.location_basis:='headline_country_mention';
 end if;
 return new;
end $$;
drop trigger if exists media_auto_geo_pin on public.media_articles;
create trigger media_auto_geo_pin before insert or update of title on public.media_articles for each row execute function public.media_apply_geo_rule();
create index if not exists media_articles_geo_idx on public.media_articles(location_basis,published_at desc);
create table if not exists public.media_ingestion_runs(
 id uuid primary key default gen_random_uuid(),provider text not null,topic text not null,
 started_at timestamptz not null default now(),finished_at timestamptz,
 articles_received integer not null default 0,articles_saved integer not null default 0,
 error_text text
);
create index if not exists media_ingestion_recent_idx on public.media_ingestion_runs(provider,topic,started_at desc);
alter table public.media_ingestion_runs enable row level security;
revoke all on public.media_ingestion_runs from anon,authenticated;
grant all on public.media_ingestion_runs to service_role;
-- Expose public news through a deliberately limited view, independent of outlet verification.
create or replace view public.media_public_world_feed as
 select a.id,a.title,a.canonical_url,a.published_at,a.language_code,a.topic_keys,
 a.headline_location_label,a.headline_latitude,a.headline_longitude,a.location_basis,
 o.domain as publisher_domain
 from public.media_articles a join public.media_outlets o on o.id=a.outlet_id
 where a.ingestion_provider='gdelt_doc_v2';
grant select on public.media_public_world_feed to anon,authenticated;
