-- Proposal only. Apply in isolated replay before any separately approved release.
-- Reuses the house page and its existing audit history. No new published-content store,
-- tenant identity, browser grants on tables, or changes to legacy writer gates.
begin;

-- Private work in progress, never read by the public page. Published content
-- and history remain in the existing site_content stores.
create sequence if not exists public.owner_front_draft_revision_seq;
create table if not exists public.owner_front_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default nextval('public.owner_front_draft_revision_seq'),
  base_revision text not null check (base_revision ~ '^[0-9]+$'),
  config jsonb,
  updated_at timestamptz not null default now()
);
alter table public.owner_front_drafts enable row level security;
alter table public.owner_front_drafts force row level security;
revoke all on public.owner_front_drafts from public, anon, authenticated;
revoke all on sequence public.owner_front_draft_revision_seq from public, anon, authenticated;

create or replace function public.owner_front_snapshot_v1()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare result jsonb;
begin
  if auth.uid() is null or not coalesce(public.mnet_is_admin(), false) then
    raise exception 'House administrator access required' using errcode = '42501';
  end if;
  -- Also coordinates with legacy INSERT/UPDATE/DELETE writers, which do not
  -- participate in advisory locks. Lock is held only for this short transaction.
  lock table public.site_content in share mode;
  select jsonb_build_object(
    'schema', 'owner-front-publication/v1',
    'revision', coalesce((select max(id)::text from public.site_content_history
      where page = 'index.html' and slot = '@front'), '0'),
    'value', (select value from public.site_content where page = 'index.html' and slot = '@front'),
    'updated_at', (select updated_at from public.site_content where page = 'index.html' and slot = '@front'),
    'draft', (select jsonb_build_object('revision', revision::text, 'base_revision', base_revision,
      'config', config, 'updated_at', updated_at) from public.owner_front_drafts where user_id = auth.uid()),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id::text, 'value', nullif(h.became, ''), 'at', h.at, 'via', h.via
    ) order by h.id desc) from (select id, became, at, via from public.site_content_history
      where page = 'index.html' and slot = '@front' order by id desc limit 25) h), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- Exact house-editor shape, based on js/main.js frontConfig. Member media,
-- words and managed projects continue using their existing contracts.
create or replace function public.owner_front_validate_v1(v jsonb)
returns void language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare k text; spec jsonb; item jsonb; n numeric; href text;
begin
  if v is null then return; end if; -- remove override; renderer uses shipped values
  if jsonb_typeof(v) is distinct from 'object' or octet_length(v::text) > 20000 then
    raise exception 'Invalid front page settings' using errcode = '22023';
  end if;
  if not (v ?& array['scenes','scroll','vr','night','start','song','visible'])
    or exists(select 1 from jsonb_object_keys(v) x where x not in ('scenes','scroll','vr','night','start','song','visible','media')) then
    raise exception 'Unsupported front page fields' using errcode = '22023';
  end if;
  for spec in select value from jsonb_array_elements('[
    ["scenes",["doors","vaunt","night","world"]],
    ["scroll",["duration","touchLerp"]],
    ["vr",["enabled","hold","band","yaw","pitch","spots"]],
    ["night",["arrive"]]
  ]'::jsonb) loop
    k := spec->>0;
    if jsonb_typeof(v->k) is distinct from 'object' then
      raise exception 'Invalid front page section: %', k using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_object_keys(v->k) x where not (spec->1 ? x))
      or exists(select 1 from jsonb_array_elements_text(spec->1) x where not (v->k ? x)) then
      raise exception 'Invalid front page section fields: %', k using errcode = '22023';
    end if;
  end loop;
  foreach k in array array['visible','scenes.doors','scenes.vaunt','scenes.night','scenes.world','vr.enabled','vr.hold'] loop
    if jsonb_typeof(v #> string_to_array(k,'.')) is distinct from 'boolean' then
      raise exception 'Invalid boolean: %', k using errcode = '22023';
    end if;
  end loop;
  if v->>'start' not in ('cabin','plane') or v->>'song' not in
    ('antisocial','whodidtheshoot','vaunt','runway','here','environmental-injustice')
    or jsonb_typeof(v->'start') is distinct from 'string' or jsonb_typeof(v->'song') is distinct from 'string' then
    raise exception 'Invalid opening or song' using errcode = '22023';
  end if;
  for spec in select value from jsonb_array_elements('[
    ["scroll.duration",0.3,1.8],["scroll.touchLerp",0.05,0.4],
    ["vr.yaw",-180,180],["vr.pitch",-85,85],["night.arrive",0.5,0.86]
  ]'::jsonb) loop
    k := spec->>0;
    if jsonb_typeof(v #> string_to_array(k,'.')) is distinct from 'number' then
      raise exception 'Invalid number: %', k using errcode = '22023';
    end if;
    n := (v #>> string_to_array(k,'.'))::numeric;
    if n < (spec->>1)::numeric or n > (spec->>2)::numeric then
      raise exception 'Number out of bounds: %', k using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(v#>'{vr,band}') is distinct from 'array' then
    raise exception 'Invalid cabin band' using errcode = '22023';
  end if;
  if jsonb_array_length(v#>'{vr,band}') <> 2 then
    raise exception 'Invalid cabin band length' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(v#>'{vr,band}') loop
    if jsonb_typeof(item) is distinct from 'number' then
      raise exception 'Invalid cabin band number' using errcode = '22023';
    end if;
    if item::numeric < 0.15 or item::numeric > 0.85 then
      raise exception 'Cabin band out of bounds' using errcode = '22023';
    end if;
  end loop;
  if (v#>>'{vr,band,1}')::numeric - (v#>>'{vr,band,0}')::numeric < 0.04 then
    raise exception 'Cabin band is too narrow' using errcode = '22023';
  end if;
  if jsonb_typeof(v#>'{vr,spots}') is distinct from 'array' then
    raise exception 'Invalid tags' using errcode = '22023';
  end if;
  if jsonb_array_length(v#>'{vr,spots}') not between 1 and 5 then
    raise exception 'Expected one to five tags' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(v#>'{vr,spots}') loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'Invalid tag' using errcode = '22023';
    end if;
    if not (item ?& array['yaw','pitch','label','href'])
      or exists(select 1 from jsonb_object_keys(item) x where x not in ('yaw','pitch','label','href','blank','urgent')) then
      raise exception 'Invalid tag fields' using errcode = '22023';
    end if;
    if jsonb_typeof(item->'label') is distinct from 'string' or length(trim(item->>'label')) not between 1 and 60
      or jsonb_typeof(item->'href') is distinct from 'string'
      or (item ? 'blank' and jsonb_typeof(item->'blank') is distinct from 'boolean')
      or (item ? 'urgent' and jsonb_typeof(item->'urgent') is distinct from 'boolean')
      or jsonb_typeof(item->'yaw') is distinct from 'number' or jsonb_typeof(item->'pitch') is distinct from 'number' then
      raise exception 'Invalid tag values' using errcode = '22023';
    end if;
    if (item->>'yaw')::numeric not between -180 and 180 or (item->>'pitch')::numeric not between -85 and 85 then
      raise exception 'Tag view out of bounds' using errcode = '22023';
    end if;
    href := item->>'href';
    if length(href) not between 1 and 300 or not (
      href ~* '^https://[^[:space:]"''<>]+$' or
      (href ~* '^[a-z0-9_./?#=&%-]+$' and href not like '//%')) then
      raise exception 'Invalid tag link' using errcode = '22023';
    end if;
  end loop;
  -- The real renderer emits null media slots for the house. Do not silently
  -- strip an existing media customization: refuse it for separate review.
  if v ? 'media' then
    if jsonb_typeof(v->'media') is distinct from 'object' then
      raise exception 'Unsupported house media' using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_each(v->'media') x where x.value <> 'null'::jsonb
      or x.key not in ('hero','scene1','scene2','night','cabin','sound','still')) then
      raise exception 'House media requires its existing media workflow' using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function public.owner_front_draft_save_v1(p_expected_revision text, p_base_revision text, p_value jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare current_revision text; result jsonb;
begin
  if auth.uid() is null or not coalesce(public.mnet_is_admin(), false) then
    raise exception 'House administrator access required' using errcode = '42501';
  end if;
  perform public.owner_front_validate_v1(p_value);
  if p_base_revision is null or p_base_revision !~ '^[0-9]+$' then
    raise exception 'Invalid publication base revision' using errcode = '22023';
  end if;
  lock table public.owner_front_drafts in share row exclusive mode;
  select revision::text into current_revision from public.owner_front_drafts where user_id = auth.uid();
  if p_expected_revision is distinct from current_revision then
    raise exception 'Your saved draft changed. Reload before saving.' using errcode = '40001';
  end if;
  insert into public.owner_front_drafts(user_id,base_revision,config)
    values(auth.uid(),p_base_revision,p_value)
    on conflict (user_id) do update set revision=nextval('public.owner_front_draft_revision_seq'),
      base_revision=excluded.base_revision, config=excluded.config, updated_at=now();
  select jsonb_build_object('revision',revision::text,'base_revision',base_revision,'config',config,'updated_at',updated_at)
    into result from public.owner_front_drafts where user_id=auth.uid();
  return result;
end;
$$;

create or replace function public.owner_front_draft_discard_v1(p_expected_revision text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare current_revision text;
begin
  if auth.uid() is null or not coalesce(public.mnet_is_admin(), false) then
    raise exception 'House administrator access required' using errcode = '42501';
  end if;
  lock table public.owner_front_drafts in share row exclusive mode;
  select revision::text into current_revision from public.owner_front_drafts where user_id=auth.uid();
  if p_expected_revision is distinct from current_revision then
    raise exception 'Your saved draft changed. Reload before discarding.' using errcode = '40001';
  end if;
  delete from public.owner_front_drafts where user_id=auth.uid();
end;
$$;

create or replace function public.owner_front_publish_v1(p_expected_revision text, p_value jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare revision text;
begin
  if auth.uid() is null or not coalesce(public.mnet_is_admin(), false) then
    raise exception 'House administrator access required' using errcode = '42501';
  end if;
  perform public.owner_front_validate_v1(p_value);
  lock table public.site_content in share row exclusive mode;
  select coalesce(max(id)::text, '0') into revision from public.site_content_history
    where page = 'index.html' and slot = '@front';
  if p_expected_revision is distinct from revision then
    raise exception 'The live page changed. Reload it before publishing.' using errcode = '40001';
  end if;
  if p_value is null then
    delete from public.site_content where page = 'index.html' and slot = '@front';
  else
    perform public.site_content_set('index.html', '@front', p_value::text, 'text', '', false, 'control-front-publication/v1');
  end if;
  -- Do not discard a newer draft saved by another tab during publication.
  delete from public.owner_front_drafts where user_id=auth.uid()
    and base_revision=p_expected_revision and config is not distinct from p_value;
  -- The existing table trigger is the immutable history source, including reset.
  return public.owner_front_snapshot_v1();
end;
$$;

revoke all on function public.owner_front_validate_v1(jsonb) from public, anon, authenticated;
revoke all on function public.owner_front_snapshot_v1() from public, anon, authenticated;
revoke all on function public.owner_front_publish_v1(text,jsonb) from public, anon, authenticated;
grant execute on function public.owner_front_snapshot_v1() to authenticated;
grant execute on function public.owner_front_publish_v1(text,jsonb) to authenticated;
revoke all on function public.owner_front_draft_save_v1(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.owner_front_draft_discard_v1(text) from public, anon, authenticated;
grant execute on function public.owner_front_draft_save_v1(text,text,jsonb) to authenticated;
grant execute on function public.owner_front_draft_discard_v1(text) to authenticated;
commit;
