-- The model on the VPS has to be able to change copy too, and it
-- authenticates as service_role -- no JWT, so mnet_is_admin() is false
-- for it and every write was refused.
--
-- Opening that path deliberately rather than loosening the admin check:
-- service_role is the box we own, already trusted with the rest of the
-- platform. What matters is that the AUDIT still says who did it, so
-- `via` is recorded on every row and a model's edits can be found and
-- undone as a group without touching the owner's.

create or replace function public.site_content_set(
  p_page text, p_slot text, p_value text,
  p_kind text default 'text', p_original text default null,
  p_fragile boolean default false, p_via text default 'editor')
returns public.site_content
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare r public.site_content;
begin
  if not (public.mnet_is_admin() or auth.role() = 'service_role') then
    raise exception 'only the house admin may edit the site';
  end if;
  insert into public.site_content(page, slot, kind, value, original, fragile, updated_by, updated_via)
  values (lower(trim(p_page)), trim(p_slot), coalesce(p_kind,'text'), coalesce(p_value,''),
          coalesce(p_original,''), coalesce(p_fragile,false), auth.uid(), coalesce(p_via,'editor'))
  on conflict (page, slot) do update
    set value = excluded.value,
        kind = excluded.kind,
        -- written once, at first edit: overwriting it on every save would
        -- make "revert" mean "go back to the last edit".
        original = case when public.site_content.original = ''
                        then excluded.original else public.site_content.original end,
        fragile = excluded.fragile,
        updated_at = now(),
        updated_by = auth.uid(),
        updated_via = excluded.updated_via
  returning * into r;
  return r;
end $fn$;

create or replace function public.site_content_revert(p_page text, p_slot text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  if not (public.mnet_is_admin() or auth.role() = 'service_role') then
    raise exception 'only the house admin may edit the site';
  end if;
  delete from public.site_content
   where page = lower(trim(p_page)) and slot = trim(p_slot);
end $fn$;

-- Undo everything one author did, without touching the other's work.
create or replace function public.site_content_revert_via(p_via text, p_since timestamptz default null)
returns integer language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare n integer;
begin
  if not (public.mnet_is_admin() or auth.role() = 'service_role') then
    raise exception 'only the house admin may edit the site';
  end if;
  delete from public.site_content
   where updated_via = p_via and (p_since is null or updated_at >= p_since);
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke all on function public.site_content_set(text,text,text,text,text,boolean,text) from public, anon;
revoke all on function public.site_content_revert(text,text) from public, anon;
revoke all on function public.site_content_revert_via(text, timestamptz) from public, anon;
grant execute on function public.site_content_set(text,text,text,text,text,boolean,text) to authenticated;
grant execute on function public.site_content_revert(text,text) to authenticated;
grant execute on function public.site_content_revert_via(text, timestamptz) to authenticated;

comment on function public.site_content_revert_via(text, timestamptz) is
  'Undo every edit from one author (e.g. via=''llm'') without touching the owner''s.';
