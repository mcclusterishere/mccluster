-- Rollback for 20261020170000_news_region_leads.sql: the briefs fall back to the house owner alone.
drop table if exists public.news_region_leads;
