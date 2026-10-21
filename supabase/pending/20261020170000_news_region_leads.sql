-- REGION LEADERS FOR THE MORNING BRIEF (pending; not applied in production)
--
-- Owner, 2026-10-20: "Each region leader will be doing this so make a summary of
-- each country's news for the day." A region leader reads, asks for, reads live
-- and publishes the briefs of the countries granted to them here; the house owner
-- grants and removes them (POST/DELETE /v1/news-briefs/leads,
-- workers/mccluster/src/news-briefs.js). Their countries are also queued every
-- night. Until this table exists the briefs are the house owner's alone.
--
-- Service role only: the Worker checks the house owner before every write.
-- Rollback: 20261020170000_news_region_leads.rollback.sql

create table if not exists public.news_region_leads (
  m_uid uuid not null references public.m_people(id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  primary key (m_uid, country_code)
);
create index if not exists news_region_leads_country_idx on public.news_region_leads (country_code);
alter table public.news_region_leads enable row level security;
revoke all on public.news_region_leads from public, anon, authenticated;
