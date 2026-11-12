-- PENDING: requires exact production approval; does not delete or rewrite rows.
-- Replaces events.site_id ON DELETE SET NULL, which could move tenant history
-- into the first-party null scope, with RESTRICT. An analytics site with retained
-- events must be archived, or its retention/deletion process explicitly resolved,
-- before its identity row is removed. Existing event retention is unchanged.
-- Execute transactionally. Rollback requires separately approved restoration of
-- SET NULL (and reintroduces the scope defect); never automatically delete data.
set local lock_timeout = '5s';
do $block$
declare
  fk record;
begin
  select c.conname, c.confdeltype into strict fk
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.conrelid='public.events'::regclass and c.confrelid='public.analytics_sites'::regclass
    and c.contype='f' and cardinality(c.conkey)=1 and a.attname='site_id';
  if fk.confdeltype='r' then return; end if;
  if fk.confdeltype <> 'n' then raise exception 'Unexpected events.site_id delete policy; inspect before changing'; end if;
  execute format('alter table public.events drop constraint %I',fk.conname);
  execute format('alter table public.events add constraint %I foreign key (site_id) references public.analytics_sites(id) on delete restrict',fk.conname);
end;
$block$;
