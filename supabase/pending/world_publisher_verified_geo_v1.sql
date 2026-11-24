-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- The migration runner owns one transaction for this entire file.
set local lock_timeout = '5s';
do $migration_isolation$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='PENDING_REQUIRES_READ_COMMITTED: recovery must see writes committed before its table lock';
  end if;
end $migration_isolation$;
select pg_advisory_xact_lock(20261124,2);
do $publisher_shape$
declare actual_columns jsonb; actual_constraints jsonb;
begin
  lock table public.media_news_sources in access exclusive mode;
  select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),''),a.attidentity,a.attgenerated) order by a.attnum)
    into actual_columns from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.media_news_sources'::regclass and a.attname=any(array['publisher_kind','headquarters_label','headquarters_latitude','headquarters_longitude','headquarters_basis','headquarters_source_url','headquarters_verified_at']::text[]) and not a.attisdropped;
  select jsonb_object_agg(c.conname,pg_get_constraintdef(c.oid)) into actual_constraints from pg_constraint c
    where c.conrelid='public.media_news_sources'::regclass and (
      c.conname=any(array['media_publisher_headquarters_complete','media_news_sources_publisher_kind_check','media_news_sources_headquarters_basis_check','media_news_sources_headquarters_latitude_check','media_news_sources_headquarters_longitude_check','media_news_sources_headquarters_source_url_check'])
      or c.conkey && array(select attnum from pg_attribute where attrelid=c.conrelid and attname=any(array['publisher_kind','headquarters_label','headquarters_latitude','headquarters_longitude','headquarters_basis','headquarters_source_url','headquarters_verified_at']::text[]) and not attisdropped));
  if actual_columns is null and actual_constraints is null then return; end if;
  if actual_columns is distinct from '[["publisher_kind","text",false,"","",""],["headquarters_label","text",false,"","",""],["headquarters_latitude","double precision",false,"","",""],["headquarters_longitude","double precision",false,"","",""],["headquarters_basis","text",false,"","",""],["headquarters_source_url","text",false,"","",""],["headquarters_verified_at","timestamp with time zone",false,"","",""]]'::jsonb or actual_constraints is distinct from '{"media_publisher_headquarters_complete":"CHECK ((((headquarters_latitude IS NULL) AND (headquarters_longitude IS NULL) AND (headquarters_basis IS NULL) AND (headquarters_verified_at IS NULL)) OR ((headquarters_latitude IS NOT NULL) AND (headquarters_longitude IS NOT NULL) AND (headquarters_basis IS NOT NULL) AND (headquarters_verified_at IS NOT NULL) AND (headquarters_source_url IS NOT NULL))))","media_news_sources_publisher_kind_check":"CHECK ((publisher_kind = ANY (ARRAY[''newsroom''::text, ''broadcast''::text, ''wire''::text, ''magazine''::text, ''journal''::text, ''blog''::text, ''government''::text, ''nonprofit''::text, ''other''::text])))","media_news_sources_headquarters_basis_check":"CHECK ((headquarters_basis = ANY (ARRAY[''official_address''::text, ''publisher_directory''::text, ''manual_review''::text])))","media_news_sources_headquarters_latitude_check":"CHECK (((headquarters_latitude >= (''-90''::integer)::double precision) AND (headquarters_latitude <= (90)::double precision)))","media_news_sources_headquarters_longitude_check":"CHECK (((headquarters_longitude >= (''-180''::integer)::double precision) AND (headquarters_longitude <= (180)::double precision)))","media_news_sources_headquarters_source_url_check":"CHECK (((headquarters_source_url IS NULL) OR (headquarters_source_url ~ ''^https://''::text)))"}'::jsonb
    or exists(select 1 from pg_constraint where conrelid='public.media_news_sources'::regclass and conname=any(array['media_publisher_headquarters_complete','media_news_sources_publisher_kind_check','media_news_sources_headquarters_basis_check','media_news_sources_headquarters_latitude_check','media_news_sources_headquarters_longitude_check','media_news_sources_headquarters_source_url_check']) and not convalidated) then
    raise exception using errcode='55000',message='PUBLISHER_GEO_SCHEMA_CHANGED: incomplete or altered verified-geography schema';
  end if;
end $publisher_shape$;
-- Publisher identity and verified geography: never infer HQ from story mentions.
-- Kept in review until migration promotion; existing GDELT ingestion is unchanged.
-- The migration runner owns the transaction. Bound the ACCESS EXCLUSIVE lock wait.
alter table public.media_news_sources
  add column if not exists publisher_kind text
    check(publisher_kind in ('newsroom','broadcast','wire','magazine','journal','blog','government','nonprofit','other')),
  add column if not exists headquarters_label text,
  add column if not exists headquarters_latitude double precision
    check(headquarters_latitude between -90 and 90),
  add column if not exists headquarters_longitude double precision
    check(headquarters_longitude between -180 and 180),
  add column if not exists headquarters_basis text
    check(headquarters_basis in ('official_address','publisher_directory','manual_review')),
  add column if not exists headquarters_source_url text
    check(headquarters_source_url is null or headquarters_source_url ~ '^https://'),
  add column if not exists headquarters_verified_at timestamptz;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.media_news_sources'::regclass
       and conname = 'media_publisher_headquarters_complete'
  ) then
    alter table public.media_news_sources add constraint media_publisher_headquarters_complete
      check ((headquarters_latitude is null and headquarters_longitude is null and headquarters_basis is null
              and headquarters_verified_at is null)
          or (headquarters_latitude is not null and headquarters_longitude is not null
              and headquarters_basis is not null and headquarters_verified_at is not null
              and headquarters_source_url is not null));
  end if;
end
$$;
comment on column public.media_news_sources.headquarters_basis is 'Location of the publisher, never the place mentioned in a story. Only verified information may be promoted.';
-- Keep existing table RLS; do not grant direct browser writes/reads.
revoke insert,update,delete on public.media_news_sources from anon,authenticated;
