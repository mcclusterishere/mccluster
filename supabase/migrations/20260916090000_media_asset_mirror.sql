-- MIRROR GENERATED ASSETS INTO McCLUSTER STORAGE.
--
-- media_assets has carried storage_path and sha256 since 0041 and has never
-- populated either: saveAssets records the provider's own URL and nothing
-- else. That makes "asset lineage" a set of links into somebody else's CDN,
-- which fails in two ways that matter.
--
-- The durability one: when fal expires a URL, the lineage for every shot and
-- every generated environment becomes dead links, and there is no second
-- copy. An archive that points at an expiring host is not an archive.
--
-- The production one: the show renderer runs Blender against GLB files on
-- disk. A URL is not a file. Nothing can render until the bytes are ours.
--
-- MCCLUSTER-CORE.md already requires this — "Generated assets are copied
-- into private McCluster storage, hashed, inspected, and assigned canonical
-- storage paths" — so this is the missing half of a written contract, not a
-- new idea.
--
-- Supabase stays authoritative for the bytes and the row. Core may keep a
-- bounded local cache to render from; it does not own asset truth.

alter table public.media_assets
  add column if not exists mirror_state text not null default 'pending',
  add column if not exists mirror_attempts integer not null default 0,
  add column if not exists mirror_error text,
  add column if not exists mirror_claimed_at timestamptz,
  add column if not exists mirrored_at timestamptz,
  add column if not exists bytes bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_assets_mirror_state_check'
  ) then
    alter table public.media_assets
      add constraint media_assets_mirror_state_check
      check (mirror_state in ('pending', 'mirroring', 'mirrored', 'failed', 'skipped'));
  end if;
end $$;

comment on column public.media_assets.mirror_state is
  'pending -> mirroring -> mirrored. A row is only safe to render from, or to cite as lineage, once it is mirrored: before that the bytes live only on the provider.';

comment on column public.media_assets.sha256 is
  'Hash of the mirrored bytes. Identifies the asset independently of any provider URL, so a re-download can be proven identical.';

-- Anything already carrying a storage path predates this and is not pending.
update public.media_assets
   set mirror_state = 'mirrored',
       mirrored_at = coalesce(mirrored_at, created_at)
 where storage_path is not null
   and mirror_state = 'pending';

-- A row with no URL has nothing to fetch; parking it as skipped keeps it out
-- of the claim loop instead of failing forever.
update public.media_assets
   set mirror_state = 'skipped'
 where url is null
   and mirror_state = 'pending';

create index if not exists media_assets_mirror_pending_idx
  on public.media_assets (created_at)
  where mirror_state in ('pending', 'mirroring');

-- ============================================================
-- CLAIMING WORK
--
-- Several Core workers may poll at once, so a claim has to be a lock, not a
-- read. A row claimed by a worker that then died must come back: the claim
-- reclaims anything left 'mirroring' past the lease, and gives up after
-- p_max_attempts so one permanently dead URL cannot occupy the loop forever.
-- ============================================================

create or replace function private.media_claim_assets_for_mirror(
  p_limit integer default 10,
  p_lease_seconds integer default 900,
  p_max_attempts integer default 5
)
returns setof public.media_assets
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  return query
  with claimable as (
    select id from public.media_assets
     where url is not null
       and mirror_attempts < greatest(1, coalesce(p_max_attempts, 5))
       and (
         mirror_state = 'pending'
         or (mirror_state = 'mirroring'
             and mirror_claimed_at < now() - make_interval(secs => greatest(60, coalesce(p_lease_seconds, 900))))
       )
     order by created_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 10), 100))
  )
  update public.media_assets a
     set mirror_state = 'mirroring',
         mirror_claimed_at = now(),
         mirror_attempts = a.mirror_attempts + 1
    from claimable
   where a.id = claimable.id
  returning a.*;
end;
$$;

revoke all on function private.media_claim_assets_for_mirror(integer, integer, integer) from public, anon, authenticated;
grant execute on function private.media_claim_assets_for_mirror(integer, integer, integer) to service_role;

create or replace function public.media_claim_assets_for_mirror_service(
  p_limit integer default 10,
  p_lease_seconds integer default 900,
  p_max_attempts integer default 5
)
returns setof public.media_assets
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select * from private.media_claim_assets_for_mirror(p_limit, p_lease_seconds, p_max_attempts);
$$;

revoke all on function public.media_claim_assets_for_mirror_service(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.media_claim_assets_for_mirror_service(integer, integer, integer) to service_role;

-- ============================================================
-- RECORDING THE RESULT
--
-- Written as one function so a mirrored row can never end up with a storage
-- path and no hash, or a success state and no bytes.
-- ============================================================

create or replace function public.media_record_asset_mirror(
  p_asset_id uuid,
  p_storage_path text,
  p_sha256 text,
  p_bytes bigint,
  p_mime_type text default null
)
returns public.media_assets
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare row public.media_assets;
begin
  if p_storage_path is null or p_sha256 is null or p_bytes is null then
    raise exception 'a mirrored asset requires a storage path, a hash and a byte count';
  end if;

  update public.media_assets a
     set storage_path = p_storage_path,
         sha256 = p_sha256,
         bytes = p_bytes,
         mime_type = coalesce(p_mime_type, a.mime_type),
         mirror_state = 'mirrored',
         mirrored_at = now(),
         mirror_error = null
   where a.id = p_asset_id
  returning a.* into row;

  return row;
end;
$$;

revoke all on function public.media_record_asset_mirror(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.media_record_asset_mirror(uuid, text, text, bigint, text) to service_role;

create or replace function public.media_fail_asset_mirror(
  p_asset_id uuid,
  p_reason text,
  p_max_attempts integer default 5
)
returns public.media_assets
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare row public.media_assets;
begin
  update public.media_assets a
     set mirror_error = left(coalesce(p_reason, 'mirror failed'), 2000),
         -- Back to pending while retries remain; 'failed' is terminal and
         -- means a person should look, not that the loop should keep trying.
         mirror_state = case
           when a.mirror_attempts >= greatest(1, coalesce(p_max_attempts, 5)) then 'failed'
           else 'pending'
         end
   where a.id = p_asset_id
  returning a.* into row;

  return row;
end;
$$;

revoke all on function public.media_fail_asset_mirror(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.media_fail_asset_mirror(uuid, text, integer) to service_role;
