-- MUSIC RELEASE AND PAYMENT INTEGRITY V1 (pending; NOT applied in production)
--
-- Closes five owner security findings on the creator music catalogue
-- (supabase/migrations/20260920041011_music_creator_platform_v1.sql and
-- 20260920041250_music_commerce_v1.sql). Each part says what it fixes.
--
-- (a) ASSET OWNERSHIP FROM A SERVER-HELD RECORD, NOT A PATH.
--     creator_tracks.master_path / preview_path / audio_url / poster_url were
--     whatever the creator wrote. A creator could save a draft whose
--     master_path is another creator's private master and then ask
--     music-access `stream` (as the track's owner) for a signed URL to it, or
--     publish a release that plays someone else's audio. Ownership now comes
--     from public.music_creator_assets (written only by the music-access
--     function, with the service role, when it issues an upload grant: the
--     grant's uploader is the authenticated caller) or from storage.objects'
--     own owner column (set by the Storage API from the uploader's token).
--     The object path prefix is never consulted for a new reference. The
--     track guard refuses a reference to an object the caller does not own,
--     pins the buckets, and pins audio_url / poster_url to the public URL of
--     an owned object. Publishing or approving refuses a release whose
--     assets are not owned by its creator (legacy rows included), and
--     music-access asks public.music_track_assets_verified() before signing.
--     The storage update/delete/own-read policies use the same record.
--
-- (b) A REVIEWED RELEASE CANNOT CHANGE UNDER ITS REVIEW.
--     Any change to a release's content (audio, artwork, metadata, rights
--     declaration, access) after it is approved or published returns it to
--     pending_review (rights 'review', published_at cleared) for every
--     role, and switches off its license offers' checkout. When a release
--     enters approved/published its content is frozen in reviewed_snapshot
--     and reviewed_digest; while it stays there the live row equals that
--     snapshot, so what is published is what was reviewed. music-access
--     `operator-review` also refuses a decision on a row that changed since
--     the operator loaded it (expected_updated_at).
--
-- (c) PLATFORM COMMISSION IS SERVER-CONTROLLED.
--     music_license_offers.platform_fee_bps was writable by the creator
--     (a creator could set 1 bp). The license guard now pins it to
--     public.music_platform_fee_bps() on insert and to the stored value on
--     update for everyone but the service role, and a music_orders row must
--     carry exactly round(amount * music_platform_fee_bps() / 10000) as its
--     platform fee. music-checkout computes the fee from the same server
--     constant (supabase/functions/_shared/music-commission.ts) and ignores
--     the offer column. A creator can no longer switch checkout on, and any
--     change to a live offer's price/currency/terms takes it off sale until
--     an operator re-enables it.
--
-- (d) FULFILMENT IS BOUND TO ITS ORDER.
--     The stripe-webhook function now checks the Stripe account, the
--     checkout session stored on the order, amount_total, currency and
--     payment_status before it marks an order paid
--     (supabase/functions/stripe-webhook/music.ts). Underneath it, this file
--     makes the database refuse what the function must never do: an order
--     becomes paid only from pending/failed and only under the session it was
--     created with; amount, currency, fee, offer, track and session are
--     immutable; paid is final except for refunded; and an entitlement can
--     only be issued for a paid order, for that order's offer and track
--     (and, already, once per order).
--
-- (e) APPROVED AUDIO IS AN IMMUTABLE, PINNED VERSION; PURCHASERS GET THAT VERSION.
--     A review used to cover the row, not the bytes: an object's creator could
--     overwrite an approved master at the same path and the row kept its
--     approval, and music-access signed whatever creator_tracks.master_path
--     held for a purchaser. Now, entering approved/published pins the master's
--     exact Storage identity (storage.objects id + version + eTag + size) in
--     public.music_asset_versions, and that identity is part of the reviewed
--     snapshot and its sha256 digest. A pinned object, and any object an
--     approved/published release references, cannot be overwritten, moved or
--     deleted by ANY role: a trigger on storage.objects refuses it (the
--     Storage API writes every upload under a new version key and then swaps
--     the row, so refusing the row change leaves the reviewed bytes in place).
--     Creators lose UPDATE/DELETE on such objects in RLS too, and upload grants
--     are no longer upserts. A different master is a new path, which is a
--     content change and goes back to review. Every order records the pinned
--     version on sale when checkout began (music_orders.asset_version_id) and
--     its entitlement inherits it; a download signs exactly that object, after
--     re-checking its live identity equals the pinned one (else refuse).
--     Owner policy: a purchaser keeps the version bought even if the release
--     is later taken down or replaced, unless the entitlement is revoked
--     (refund or operator), which refuses delivery.
--
-- (f) APPROVAL IS OF THE EXACT AUDIO BYTES THE REVIEWER HEARD.
--     The pin above names a Storage object version; it now also names the
--     bytes. music-access streams the pinned master once through an
--     incremental SHA-256 (capped at the creator-masters bucket limit, fail
--     closed) and records it write-once on the version
--     (public.music_record_asset_sha256; a recompute that disagrees
--     invalidates the version and sends its releases back to review). A
--     release cannot enter approved/published unless its pinned master has a
--     recorded hash AND the approval (public.music_operator_review) carries
--     the same hash the reviewer was shown; the hash is in the reviewed
--     snapshot/digest, and orders and entitlements record it. Preview and
--     artwork are not hashed: they are public, are not what is sold, and are
--     locked against overwrite once the release is approved (storage
--     trigger); see supabase/pending/README.md for that residual window.
--
-- Deploy order (dependency-safe; music-access now FAILS CLOSED without this
-- file): 1. apply this file (it backfills existing reviewed releases' pinned
-- versions and existing orders'/entitlements' purchased version);
-- 2. run the post-apply health queries in supabase/pending/README.md;
-- 3. deploy music-access, music-checkout, stripe-webhook; 4. run the
-- post-deploy checks there. The functions in production before step 3 keep
-- working on top of this file.
--
-- Test: scripts/test-music-release-integrity-db.sh
--       (supabase/tests/music_release_payment_integrity.behaviour.sql)
-- Rollback: supabase/pending/music_release_payment_integrity_v1.rollback.sql

set local lock_timeout = '5s';

------------------------------------------------------------------------------
-- (c) the server's commission. One number; music-checkout carries the same
--     constant and scripts/test/music-payment-integrity.test.mjs holds them
--     equal.
------------------------------------------------------------------------------
create or replace function public.music_platform_fee_bps()
returns integer language sql immutable set search_path = pg_catalog as $$ select 1500 $$;
revoke all on function public.music_platform_fee_bps() from public, anon, authenticated;
grant execute on function public.music_platform_fee_bps() to service_role;

------------------------------------------------------------------------------
-- (a) the server-held asset record
------------------------------------------------------------------------------
create table if not exists public.music_creator_assets (
  bucket_id text not null check (bucket_id in ('creator-previews','creator-masters','creator-artwork')),
  object_name text not null check (char_length(object_name) between 3 and 512),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_m_uid uuid references public.m_people(id) on delete cascade,
  source text not null default 'upload_grant' check (source in ('upload_grant','storage_owner','legacy_backfill')),
  created_at timestamptz not null default now(),
  primary key (bucket_id, object_name)
);
create index if not exists music_creator_assets_owner_idx on public.music_creator_assets(owner_user_id);
alter table public.music_creator_assets enable row level security;
alter table public.music_creator_assets force row level security;
revoke all on public.music_creator_assets from public, anon, authenticated;
grant select, insert, update, delete on public.music_creator_assets to service_role;

comment on table public.music_creator_assets is
  'Who uploaded each creator music object. Written only by music-access (service role) when it issues an upload grant. The authority for asset ownership; never the object path.';

-- Is this object owned by this account? The registry first, then the owner
-- the Storage API stamped from the uploader's token. Never the path.
create or replace function public.music_asset_owned_by(p_bucket text, p_name text, p_user uuid, p_m uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, storage as $$
  select coalesce(
    (select (a.owner_user_id = p_user) or (p_m is not null and a.owner_m_uid = p_m)
       from public.music_creator_assets a
      where a.bucket_id = p_bucket and a.object_name = p_name),
    (select coalesce(o.owner = p_user, false)
            or coalesce(o.owner_id = p_user::text, false)
       from storage.objects o
      where o.bucket_id = p_bucket and o.name = p_name
      limit 1),
    false)
$$;
revoke all on function public.music_asset_owned_by(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.music_asset_owned_by(text, text, uuid, uuid) to service_role;

-- The storage policies' question: is this object mine?
create or replace function public.music_asset_is_mine(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select auth.uid() is not null
     and public.music_asset_owned_by(p_bucket, p_name, auth.uid(), public.current_m_uid())
$$;
revoke all on function public.music_asset_is_mine(text, text) from public, anon;
grant execute on function public.music_asset_is_mine(text, text) to authenticated, service_role;

-- The public URL an object in a public creator bucket is served at. Pinned to
-- the canonical project: a creator cannot point a release at another host.
create or replace function public.music_public_object_url(p_bucket text, p_name text)
returns text language sql immutable set search_path = pg_catalog as $$
  select 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/' || p_bucket || '/' || p_name
$$;
revoke all on function public.music_public_object_url(text, text) from public, anon;
grant execute on function public.music_public_object_url(text, text) to authenticated, service_role;

-- The artwork object a poster_url names, or null when it names none.
create or replace function public.music_artwork_object(p_url text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when p_url is null or p_url = '' then null
    when left(p_url, char_length(public.music_public_object_url('creator-artwork', ''))) = public.music_public_object_url('creator-artwork', '')
      then nullif(substr(p_url, char_length(public.music_public_object_url('creator-artwork', '')) + 1), '')
    else null end
$$;
revoke all on function public.music_artwork_object(text) from public, anon;
grant execute on function public.music_artwork_object(text) to authenticated, service_role;

-- Backfill the registry from what Storage already holds. The Storage owner
-- where it was stamped; otherwise (objects uploaded through a service-role
-- grant before this file, whose owner is null) the folder the object was
-- written to, once: those folders were only writable by their own account
-- (the insert policy) or by music-access, which named them after the
-- caller. This is about objects that exist, never about a row's reference.
insert into public.music_creator_assets(bucket_id, object_name, owner_user_id, owner_m_uid, source)
select o.bucket_id, o.name, u.id,
       (select l.m_uid from public.m_auth_user_links l where l.auth_user_id = u.id and l.is_primary limit 1),
       case when o.owner is not null or o.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then 'storage_owner' else 'legacy_backfill' end
  from storage.objects o
  join auth.users u on u.id = coalesce(
         o.owner,
         case when o.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then o.owner_id::uuid end,
         case when split_part(o.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(o.name, '/', 1)::uuid end)
 where o.bucket_id in ('creator-previews','creator-masters','creator-artwork')
on conflict (bucket_id, object_name) do nothing;

------------------------------------------------------------------------------
-- (b) the reviewed snapshot
------------------------------------------------------------------------------
alter table public.creator_tracks
  add column if not exists reviewed_snapshot jsonb,
  add column if not exists reviewed_digest text,
  add column if not exists reviewed_at timestamptz;


------------------------------------------------------------------------------
-- (e) the pinned asset version
------------------------------------------------------------------------------
-- The live Storage identity of one object: which row, which stored version,
-- which bytes (eTag, size). Changes on every overwrite; never read from a path.
create or replace function public.music_object_identity(p_bucket text, p_name text)
returns jsonb language sql stable security definer set search_path = pg_catalog, public, storage as $$
  select jsonb_build_object('bucket', o.bucket_id, 'name', o.name, 'object_id', o.id,
                            'version', o.version, 'etag', o.metadata->>'eTag', 'size', o.metadata->>'size')
    from storage.objects o
   where o.bucket_id = p_bucket and o.name = p_name
   limit 1
$$;
revoke all on function public.music_object_identity(text, text) from public, anon, authenticated;
grant execute on function public.music_object_identity(text, text) to service_role;

create table if not exists public.music_asset_versions (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.creator_tracks(id) on delete restrict deferrable initially deferred,
  bucket_id text not null check (bucket_id = 'creator-masters'),
  object_name text not null check (char_length(object_name) between 3 and 512),
  storage_object_id uuid not null,
  storage_version text,
  etag text,
  size_bytes bigint,
  identity jsonb not null,
  -- (f) SHA-256 of the object's exact bytes, computed by music-access
  -- (operator-review-prepare) streaming the pinned object, and recorded once
  -- through public.music_record_asset_sha256(); Postgres cannot read Storage
  -- bytes. Approval requires it and the reviewer's expected copy of it.
  content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256_at timestamptz,
  -- (f) a recompute that disagreed with the recorded hash, or Storage
  -- identity that no longer matches the pin: this version is never approved,
  -- sold or delivered again. Final.
  invalidated_at timestamptz,
  invalid_reason text check (invalid_reason in ('sha256_mismatch','identity_changed')),
  pinned_via text not null check (pinned_via in ('review_candidate','review_approval','legacy_backfill')),
  created_at timestamptz not null default now()
);
create index if not exists music_asset_versions_object_idx on public.music_asset_versions(bucket_id, object_name);
create index if not exists music_asset_versions_track_idx on public.music_asset_versions(track_id);
-- one row per exact object version per track, so a hash is never split
create unique index if not exists music_asset_versions_identity_uq
  on public.music_asset_versions(track_id, bucket_id, object_name, identity);
alter table public.music_asset_versions enable row level security;
alter table public.music_asset_versions force row level security;
revoke all on public.music_asset_versions from public, anon, authenticated, service_role;
-- (f) read-only even to the service role: rows are written only by this
-- file's security-definer functions (music_pin_master, music_record_asset_sha256)
grant select on public.music_asset_versions to service_role;
comment on table public.music_asset_versions is
  'Exact Storage identity (object id, version, eTag, size) and SHA-256 of the bytes of each reviewed master. Immutable; approval binds to content_sha256, orders and entitlements point here, and music-access signs only these objects for purchasers.';

-- A pinned version never changes and is never removed. content_sha256 may
-- be filled in once; invalidated_at/invalid_reason may be set once (final).
create or replace function public.music_asset_version_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception 'music_asset_version_immutable'; end if;
  if (new.id, new.track_id, new.bucket_id, new.object_name, new.storage_object_id, new.storage_version,
      new.etag, new.size_bytes, new.identity, new.pinned_via, new.created_at)
     is distinct from
     (old.id, old.track_id, old.bucket_id, old.object_name, old.storage_object_id, old.storage_version,
      old.etag, old.size_bytes, old.identity, old.pinned_via, old.created_at)
     or (old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256)
     or (old.content_sha256_at is not null and new.content_sha256_at is distinct from old.content_sha256_at)
     or (new.content_sha256 is null) <> (new.content_sha256_at is null)
     or (old.invalidated_at is not null
         and (new.invalidated_at, new.invalid_reason) is distinct from (old.invalidated_at, old.invalid_reason))
     or (new.invalidated_at is null) <> (new.invalid_reason is null) then
    raise exception 'music_asset_version_immutable';
  end if;
  return new;
end $$;
revoke execute on function public.music_asset_version_guard() from public, anon, authenticated;
drop trigger if exists music_asset_version_guard_trg on public.music_asset_versions;
create trigger music_asset_version_guard_trg before update or delete on public.music_asset_versions
for each row execute function public.music_asset_version_guard();

-- Pin a track's master as it stands in Storage now; the same identity reuses
-- its row (re-approval after a metadata edit).
create or replace function public.music_pin_master(p_track uuid, p_master_path text, p_via text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ident jsonb; v_id uuid;
begin
  v_ident := public.music_object_identity('creator-masters', p_master_path);
  if v_ident is null then raise exception 'release_master_missing' using detail = p_master_path; end if;
  select v.id into v_id from public.music_asset_versions v
   where v.track_id = p_track and v.bucket_id = 'creator-masters' and v.object_name = p_master_path and v.identity = v_ident
   limit 1;
  if v_id is null then
    insert into public.music_asset_versions(track_id, bucket_id, object_name, storage_object_id, storage_version,
                                            etag, size_bytes, identity, pinned_via)
    values (p_track, 'creator-masters', p_master_path, (v_ident->>'object_id')::uuid, v_ident->>'version',
            v_ident->>'etag', case when v_ident->>'size' ~ '^[0-9]+$' then (v_ident->>'size')::bigint end,
            v_ident, p_via)
    on conflict (track_id, bucket_id, object_name, identity) do nothing
    returning id into v_id;
    if v_id is null then -- a concurrent pin of the same version won
      select v.id into v_id from public.music_asset_versions v
       where v.track_id = p_track and v.bucket_id = 'creator-masters' and v.object_name = p_master_path and v.identity = v_ident;
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.music_pin_master(uuid, text, text) from public, anon, authenticated;

alter table public.creator_tracks
  add column if not exists approved_master_version_id uuid references public.music_asset_versions(id) on delete restrict;

-- Is this object locked: pinned for review/sale, or referenced by a release
-- that is approved or published?
create or replace function public.music_asset_locked(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.music_asset_versions v where v.bucket_id = p_bucket and v.object_name = p_name)
      or exists (select 1 from public.creator_tracks t
                  where t.status in ('approved','published')
                    and ((p_bucket = 'creator-masters' and t.master_path = p_name)
                      or (p_bucket = 'creator-previews' and t.preview_path = p_name)
                      or (p_bucket = 'creator-artwork' and public.music_artwork_object(t.poster_url) = p_name)))
$$;
revoke all on function public.music_asset_locked(text, text) from public, anon;
grant execute on function public.music_asset_locked(text, text) to authenticated, service_role;

-- A release's content: every column except identity, workflow and review
-- bookkeeping. A column added later counts as content until it is listed
-- here, so a new field can never be edited under a review by omission.
create or replace function public.music_track_content(p_row public.creator_tracks)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select to_jsonb(p_row) - array['id','uid','m_uid','created_at','updated_at','status','rights_status',
                                 'moderation_note','published_at','reviewed_snapshot','reviewed_digest','reviewed_at',
                                 'approved_master_version_id']
$$;
revoke all on function public.music_track_content(public.creator_tracks) from public, anon, authenticated;

-- (e)+(f) What a review covers: the content AND the exact master object
-- pinned for it AND the SHA-256 of its bytes, so the digest names bytes, not
-- just a path or a Storage version.
create or replace function public.music_track_reviewed_snapshot(p_row public.creator_tracks)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select public.music_track_content(p_row)
         || jsonb_build_object(
              'approved_master',
              (select v.identity from public.music_asset_versions v where v.id = p_row.approved_master_version_id),
              'approved_master_sha256',
              (select v.content_sha256 from public.music_asset_versions v where v.id = p_row.approved_master_version_id))
$$;
revoke all on function public.music_track_reviewed_snapshot(public.creator_tracks) from public, anon, authenticated;

create or replace function public.music_review_digest(p_snapshot jsonb)
returns text language sql immutable set search_path = pg_catalog as $$
  select encode(sha256(convert_to(p_snapshot::text, 'UTF8')), 'hex')
$$;
revoke all on function public.music_review_digest(jsonb) from public, anon, authenticated;

-- (f) May this pinned version be approved, sold or delivered? Storage still
-- holds exactly the pinned object, its bytes' SHA-256 is on record, and it was
-- never invalidated. Bytes are hashed once (operator-review-prepare), not per
-- request: the object is immutable once pinned (storage trigger below), so
-- the identity check here plus the recorded hash is the guarantee.
create or replace function public.music_asset_version_intact(p_version uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select v.content_sha256 is not null and v.invalidated_at is null
                          and public.music_object_identity(v.bucket_id, v.object_name) = v.identity
                     from public.music_asset_versions v where v.id = p_version), false)
$$;
revoke all on function public.music_asset_version_intact(uuid) from public, anon, authenticated;
grant execute on function public.music_asset_version_intact(uuid) to service_role;

-- Are this release's audio and artwork owned by its creator?
create or replace function public.music_track_assets_owned(p_row public.creator_tracks)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_art text;
begin
  if coalesce(p_row.master_path, '') <> ''
     and not public.music_asset_owned_by('creator-masters', p_row.master_path, p_row.uid, p_row.m_uid) then
    return false;
  end if;
  if coalesce(p_row.preview_path, '') <> ''
     and not public.music_asset_owned_by('creator-previews', p_row.preview_path, p_row.uid, p_row.m_uid) then
    return false;
  end if;
  if coalesce(p_row.audio_url, '') <> ''
     and p_row.audio_url is distinct from public.music_public_object_url('creator-previews', p_row.preview_path) then
    return false;
  end if;
  if coalesce(p_row.poster_url, '') <> '' then
    v_art := public.music_artwork_object(p_row.poster_url);
    if v_art is null or not public.music_asset_owned_by('creator-artwork', v_art, p_row.uid, p_row.m_uid) then
      return false;
    end if;
  end if;
  return true;
end $$;
revoke all on function public.music_track_assets_owned(public.creator_tracks) from public, anon, authenticated;

-- music-access asks this before it signs a master.
create or replace function public.music_track_assets_verified(p_track uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select public.music_track_assets_owned(t) from public.creator_tracks t where t.id = p_track), false)
$$;
revoke all on function public.music_track_assets_verified(uuid) from public, anon, authenticated;
grant execute on function public.music_track_assets_verified(uuid) to service_role;

------------------------------------------------------------------------------
-- The track guard, replaced. Everything the v1 guard did is kept, in order;
-- (a) and (b) are added.
------------------------------------------------------------------------------
create or replace function public.music_track_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_m uuid;
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_reviewed boolean;
  v_art text;
  v_ver public.music_asset_versions%rowtype;
  v_expected text;
begin
  new.updated_at := now();
  new.title := trim(new.title);
  new.artist := trim(new.artist);
  new.slug := nullif(lower(trim(coalesce(new.slug,''))), '');
  if not v_service then
    v_m := public.current_m_uid();
    if v_m is null then raise exception 'creator_identity_missing'; end if;
    new.uid := auth.uid();
    new.m_uid := v_m;
    if tg_op='UPDATE' and old.m_uid <> v_m then raise exception 'creator_track_forbidden'; end if;
    if new.status not in ('draft','pending_review') then new.status := case when tg_op='UPDATE' then old.status else 'draft' end; end if;
    if new.rights_status not in ('incomplete','attested') then new.rights_status := case when tg_op='UPDATE' then old.rights_status else 'incomplete' end; end if;
    new.moderation_note := case when tg_op='UPDATE' then old.moderation_note else '' end;
    new.published_at := case when tg_op='UPDATE' then old.published_at else null end;
    new.reviewed_snapshot := case when tg_op='UPDATE' then old.reviewed_snapshot else null end;
    new.reviewed_digest := case when tg_op='UPDATE' then old.reviewed_digest else null end;
    new.reviewed_at := case when tg_op='UPDATE' then old.reviewed_at else null end;
    new.approved_master_version_id := case when tg_op='UPDATE' then old.approved_master_version_id else null end;

    -- (a) the buckets are fixed and every new reference must be to an
    -- object this account uploaded, by the server's record.
    new.preview_bucket := 'creator-previews';
    new.master_bucket := 'creator-masters';
    if coalesce(new.master_path, '') <> ''
       and (tg_op = 'INSERT' or new.master_path is distinct from old.master_path)
       and not public.music_asset_owned_by('creator-masters', new.master_path, auth.uid(), v_m) then
      raise exception 'creator_asset_not_owned' using detail = 'master_path';
    end if;
    if coalesce(new.preview_path, '') <> ''
       and (tg_op = 'INSERT' or new.preview_path is distinct from old.preview_path)
       and not public.music_asset_owned_by('creator-previews', new.preview_path, auth.uid(), v_m) then
      raise exception 'creator_asset_not_owned' using detail = 'preview_path';
    end if;
    if coalesce(new.audio_url, '') <> ''
       and (tg_op = 'INSERT' or new.audio_url is distinct from old.audio_url or new.preview_path is distinct from old.preview_path)
       and new.audio_url is distinct from public.music_public_object_url('creator-previews', new.preview_path) then
      raise exception 'creator_asset_not_owned' using detail = 'audio_url';
    end if;
    if coalesce(new.poster_url, '') <> ''
       and (tg_op = 'INSERT' or new.poster_url is distinct from old.poster_url) then
      v_art := public.music_artwork_object(new.poster_url);
      if v_art is null or not public.music_asset_owned_by('creator-artwork', v_art, auth.uid(), v_m) then
        raise exception 'creator_asset_not_owned' using detail = 'poster_url';
      end if;
    end if;
  end if;

  -- (b) a reviewed release whose content changes goes back to review, for
  -- every role: published content is only ever reviewed content.
  if tg_op = 'UPDATE' and old.status in ('approved','published')
     and public.music_track_content(new) is distinct from public.music_track_content(old) then
    new.status := 'pending_review';
    new.rights_status := case when old.rights_status = 'cleared' then 'review' else new.rights_status end;
    new.published_at := null;
  end if;

  -- (a)+(b) entering review-approved states: the assets must be the
  -- creator's own, and the content is frozen as the reviewed snapshot.
  v_reviewed := new.status in ('approved','published')
                and (tg_op = 'INSERT' or old.status not in ('approved','published'));
  if v_reviewed then
    if not public.music_track_assets_owned(new) then
      raise exception 'release_asset_not_owned';
    end if;
    -- (f) approval is of audio: no master, nothing was listened to
    if coalesce(new.master_path, '') = '' then
      raise exception 'release_master_missing' using detail = 'no master';
    end if;
    -- (e) pin the exact master object being approved (normally the version
    -- music_prepare_review already pinned and hashed for the reviewer)
    new.approved_master_version_id := public.music_pin_master(new.id, new.master_path, 'review_approval');
    -- (f) ...and approve only the bytes the reviewer was shown: the version's
    -- SHA-256 must be on record and equal the hash the approval carries
    -- (public.music_operator_review sets it for this statement only)
    select * into v_ver from public.music_asset_versions where id = new.approved_master_version_id;
    if v_ver.invalidated_at is not null then
      raise exception 'release_master_invalid' using detail = v_ver.invalid_reason;
    end if;
    if v_ver.content_sha256 is null then
      raise exception 'release_master_unhashed'
        using hint = 'Verify the audio (music-access operator-review-prepare) before approving.';
    end if;
    v_expected := nullif(lower(coalesce(current_setting('music.review_expected_master_sha256', true), '')), '');
    if v_expected is null then
      raise exception 'release_master_hash_required'
        using hint = 'Approve through public.music_operator_review with the SHA-256 the reviewer was shown.';
    end if;
    if v_expected is distinct from v_ver.content_sha256 then
      raise exception 'release_master_hash_mismatch';
    end if;
    new.reviewed_snapshot := public.music_track_reviewed_snapshot(new);
    new.reviewed_digest := public.music_review_digest(new.reviewed_snapshot);
    new.reviewed_at := now();
  elsif new.status in ('approved','published') then
    -- the pinned version of a reviewed release cannot be swapped; only this
    -- file's backfill (service role, row never pinned) records one, and only
    -- a version of this track's current master
    if tg_op = 'UPDATE' and (old.approved_master_version_id is not null or not v_service) then
      new.approved_master_version_id := old.approved_master_version_id;
    elsif new.approved_master_version_id is not null and not exists (
            select 1 from public.music_asset_versions v
             where v.id = new.approved_master_version_id and v.track_id = new.id
               and v.object_name = new.master_path) then
      raise exception 'release_master_version_mismatch';
    end if;
    if new.reviewed_digest is distinct from public.music_review_digest(public.music_track_reviewed_snapshot(new)) then
      -- unreachable through the branches above; kept so the invariant is stated
      raise exception 'release_differs_from_review';
    end if;
  else
    -- not under review approval: nothing is pinned as on sale
    new.approved_master_version_id := null;
  end if;
  return new;
end $$;
revoke execute on function public.music_track_guard() from public, anon, authenticated;

drop trigger if exists music_track_guard_trg on public.creator_tracks;
create trigger music_track_guard_trg before insert or update on public.creator_tracks
for each row execute function public.music_track_guard();

-- Off sale while not published. Runs after the row is written; the offer
-- guard lets anyone switch an offer OFF.
create or replace function public.music_track_offers_follow_status()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.status = 'published' and new.status <> 'published' then
    update public.music_license_offers
       set active = false, checkout_enabled = false
     where track_id = new.id and (active or checkout_enabled);
  end if;
  return null;
end $$;
revoke execute on function public.music_track_offers_follow_status() from public, anon, authenticated;
drop trigger if exists music_track_offers_follow_status_trg on public.creator_tracks;
create trigger music_track_offers_follow_status_trg after update on public.creator_tracks
for each row execute function public.music_track_offers_follow_status();

-- Existing reviewed rows: freeze what is live now as their snapshot, and send
-- back to review any whose assets are not their creator's (a reference that
-- was possible before this file). Runs with the service role's claim: the guard's
-- creator branch does not apply.
do $$
declare r public.creator_tracks;
begin
  -- the platform's own write, not a creator's (local to this statement's transaction)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for r in select t.* from public.creator_tracks t where t.status in ('approved','published') loop
    if r.approved_master_version_id is not null then
      continue; -- already pinned (this file re-run)
    elsif public.music_track_assets_owned(r)
          and (coalesce(r.master_path, '') = '' or public.music_object_identity('creator-masters', r.master_path) is not null) then
      -- (e) pin what is live now: the master object as Storage holds it
      if coalesce(r.master_path, '') <> '' then
        r.approved_master_version_id := public.music_pin_master(r.id, r.master_path, 'legacy_backfill');
      end if;
      update public.creator_tracks
         set approved_master_version_id = r.approved_master_version_id,
             reviewed_snapshot = public.music_track_reviewed_snapshot(r),
             reviewed_digest = public.music_review_digest(public.music_track_reviewed_snapshot(r)),
             reviewed_at = coalesce(r.published_at, now())
       where id = r.id;
    elsif public.music_track_assets_owned(r) then
      update public.creator_tracks
         set status = 'pending_review', rights_status = 'review', published_at = null,
             moderation_note = 'Returned to review: its master file is missing from Storage.'
       where id = r.id;
    else
      update public.creator_tracks
         set status = 'pending_review', rights_status = 'review', published_at = null,
             moderation_note = 'Returned to review: an audio or artwork reference is not owned by this creator.'
       where id = r.id;
    end if;
  end loop;
end $$;

------------------------------------------------------------------------------
-- (c) the offer guard, replaced
------------------------------------------------------------------------------
create or replace function public.music_license_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_m uuid; v_track_m uuid;
begin
  new.updated_at := now();
  select m_uid into v_track_m from public.creator_tracks where id = new.track_id;
  if v_track_m is null then raise exception 'track_not_found'; end if;
  if coalesce(auth.role(), '') <> 'service_role' then
    v_m := public.current_m_uid();
    if v_m is null or v_m <> v_track_m then raise exception 'license_offer_forbidden'; end if;
    if tg_op = 'UPDATE' and new.track_id <> old.track_id then raise exception 'license_offer_forbidden'; end if;
    new.creator_m_uid := v_m;
    new.l3_product_id := case when tg_op = 'UPDATE' then old.l3_product_id else null end;
    -- the commission is the server's
    new.platform_fee_bps := case when tg_op = 'UPDATE' then old.platform_fee_bps else public.music_platform_fee_bps() end;
    -- a creator may take an offer off sale, never put one on
    if tg_op = 'INSERT' then
      new.active := false;
      new.checkout_enabled := false;
    else
      new.active := old.active and new.active;
      new.checkout_enabled := old.checkout_enabled and new.checkout_enabled;
      -- what an operator enabled is what is sold: a changed offer is off sale
      if (new.price_cents, new.currency, new.license_type, new.terms_text, new.usage_terms, new.title, new.slug)
         is distinct from
         (old.price_cents, old.currency, old.license_type, old.terms_text, old.usage_terms, old.title, old.slug) then
        new.active := false;
        new.checkout_enabled := false;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.music_license_guard() from public, anon, authenticated;

drop trigger if exists music_license_guard_trg on public.music_license_offers;
create trigger music_license_guard_trg before insert or update on public.music_license_offers
for each row execute function public.music_license_guard();

-- Offers whose fee a creator lowered before this file: back to the server's.
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.music_license_offers
     set platform_fee_bps = public.music_platform_fee_bps()
   where platform_fee_bps < public.music_platform_fee_bps();
end $$;

------------------------------------------------------------------------------
-- (c)+(d)+(e) the order and entitlement guards (service role writes these;
-- the guards hold for it too)
------------------------------------------------------------------------------
-- (e) the version a buyer pays for: the one pinned on sale when checkout began
alter table public.music_orders
  add column if not exists asset_version_id uuid references public.music_asset_versions(id) on delete restrict;
alter table public.music_entitlements
  add column if not exists asset_version_id uuid references public.music_asset_versions(id) on delete restrict;
-- (f) ...and the SHA-256 of that version's bytes, copied from it (a record on
-- the purchase itself; the version row is immutable too)
alter table public.music_orders
  add column if not exists asset_sha256 text check (asset_sha256 ~ '^[0-9a-f]{64}$');
alter table public.music_entitlements
  add column if not exists asset_sha256 text check (asset_sha256 ~ '^[0-9a-f]{64}$');

create or replace function public.music_order_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_status text; v_version uuid; v_sha text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'music_order_must_start_pending'; end if;
    if new.platform_fee_cents <> round(new.amount_cents * public.music_platform_fee_bps() / 10000.0)::integer then
      raise exception 'music_order_fee_mismatch';
    end if;
    -- (e) only a published release with a pinned master is sold, and the
    -- order names that exact version (whatever the caller sent)
    select t.status, t.approved_master_version_id into v_status, v_version
      from public.creator_tracks t where t.id = new.track_id;
    if v_status is distinct from 'published' or v_version is null then
      raise exception 'music_order_track_not_on_sale';
    end if;
    -- (f) and only while that version is intact: hashed, never invalidated,
    -- and Storage still holds exactly the pinned object. The bytes are not
    -- re-hashed per checkout (a full read of a master per session); the
    -- object is immutable once pinned, so this identity check stands for it.
    if not public.music_asset_version_intact(v_version) then
      raise exception 'music_order_track_not_on_sale' using detail = 'pinned master not intact';
    end if;
    select v.content_sha256 into v_sha from public.music_asset_versions v where v.id = v_version;
    new.asset_version_id := v_version;
    new.asset_sha256 := v_sha;
    return new;
  end if;

  -- (e) the purchased version is fixed once recorded (set-once for orders
  -- that predate this file)
  if old.asset_version_id is not null and new.asset_version_id is distinct from old.asset_version_id then
    raise exception 'music_order_terms_immutable' using detail = 'asset_version_id';
  end if;
  -- (f) its hash likewise; null -> the version's own hash only (a backfilled
  -- order whose version was hashed after this file)
  if new.asset_sha256 is distinct from old.asset_sha256
     and (old.asset_sha256 is not null
          or new.asset_sha256 is distinct from (select v.content_sha256 from public.music_asset_versions v
                                                 where v.id = new.asset_version_id)) then
    raise exception 'music_order_terms_immutable' using detail = 'asset_sha256';
  end if;

  if (new.offer_id, new.track_id, new.creator_m_uid, new.amount_cents, new.platform_fee_cents,
      new.creator_net_cents, new.currency)
     is distinct from
     (old.offer_id, old.track_id, old.creator_m_uid, old.amount_cents, old.platform_fee_cents,
      old.creator_net_cents, old.currency) then
    raise exception 'music_order_terms_immutable';
  end if;
  if old.stripe_checkout_session_id is not null
     and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id then
    raise exception 'music_order_session_immutable';
  end if;
  if new.status = 'paid' and old.status <> 'paid' then
    if old.status not in ('pending','failed') then raise exception 'music_order_not_payable'; end if;
    if new.stripe_checkout_session_id is null then raise exception 'music_order_session_missing'; end if;
  end if;
  if old.status = 'paid' and new.status not in ('paid','refunded') then
    raise exception 'music_order_paid_is_final';
  end if;
  if old.status = 'refunded' and new.status <> 'refunded' then
    raise exception 'music_order_refund_is_final';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.music_order_guard() from public, anon, authenticated;
drop trigger if exists music_order_guard_trg on public.music_orders;
create trigger music_order_guard_trg before insert or update on public.music_orders
for each row execute function public.music_order_guard();

create or replace function public.music_entitlement_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare o public.music_orders%rowtype;
begin
  select * into o from public.music_orders where id = new.order_id;
  if tg_op = 'UPDATE' then
    -- delivery bookkeeping and revocation only; what was bought is fixed
    if (new.order_id, new.offer_id, new.track_id) is distinct from (old.order_id, old.offer_id, old.track_id)
       or (old.asset_version_id is not null and new.asset_version_id is distinct from old.asset_version_id)
       or (old.asset_version_id is null and new.asset_version_id is not null
           and new.asset_version_id is distinct from o.asset_version_id)
       or (new.asset_sha256 is distinct from old.asset_sha256
           and (old.asset_sha256 is not null
                or new.asset_sha256 is distinct from (select v.content_sha256 from public.music_asset_versions v
                                                       where v.id = new.asset_version_id))) then
      raise exception 'music_entitlement_immutable';
    end if;
    return new;
  end if;
  if not found or o.status <> 'paid' then raise exception 'music_entitlement_order_not_paid'; end if;
  if new.offer_id <> o.offer_id or new.track_id <> o.track_id then
    raise exception 'music_entitlement_order_mismatch';
  end if;
  -- (e) the licence delivers the order's pinned version, never the caller's
  new.asset_version_id := o.asset_version_id;
  new.asset_sha256 := o.asset_sha256;
  return new;
end $$;
revoke execute on function public.music_entitlement_guard() from public, anon, authenticated;
drop trigger if exists music_entitlement_guard_trg on public.music_entitlements;
create trigger music_entitlement_guard_trg before insert or update on public.music_entitlements
for each row execute function public.music_entitlement_guard();

-- (e) backfill: an order that predates this file is recorded against the
-- version pinned for its track now (the best evidence there is of what was
-- on sale; production had no orders when this file was written), and its
-- entitlement inherits the order's. One with no pinned version stays null
-- and music-access refuses its download (409) until an operator resolves it.
update public.music_orders o
   set asset_version_id = t.approved_master_version_id
  from public.creator_tracks t
 where o.asset_version_id is null and t.id = o.track_id and t.approved_master_version_id is not null;
update public.music_entitlements e
   set asset_version_id = o.asset_version_id
  from public.music_orders o
 where e.asset_version_id is null and o.id = e.order_id and o.asset_version_id is not null;
-- (f) and the hash where the version already has one (a re-run after the
-- operator's hash backfill; on first apply no version has one yet)
update public.music_orders o
   set asset_sha256 = v.content_sha256
  from public.music_asset_versions v
 where o.asset_sha256 is null and v.id = o.asset_version_id and v.content_sha256 is not null;
update public.music_entitlements e
   set asset_sha256 = v.content_sha256
  from public.music_asset_versions v
 where e.asset_sha256 is null and v.id = e.asset_version_id and v.content_sha256 is not null;

------------------------------------------------------------------------------
-- (f) APPROVAL IS BOUND TO THE REVIEWED AUDIO BYTES.
--     Review flow (music-access, operator only):
--       1. operator-review-prepare -> music_prepare_review(track): pins the
--          release's current master as a version (which locks the object:
--          the storage trigger refuses overwrite/move/delete from here on),
--          and returns it. If it has no hash yet, music-access streams the
--          pinned object's bytes through an incremental SHA-256 (size-capped,
--          fail closed) and records it with music_record_asset_sha256().
--          The reviewer's player streams THAT pinned object, and the desk
--          shows the short hash.
--       2. publish/approve -> music_operator_review(..., expected sha256): the
--          track guard refuses entering approved/published unless the pinned
--          version has a recorded hash equal to the one the reviewer saw.
--     A replacement master is a new path: content change -> back to review,
--     a new version with no hash -> step 1 again before re-approval.
------------------------------------------------------------------------------
create or replace function public.music_prepare_review(p_track uuid)
returns table(track_id uuid, track_status text, track_updated_at timestamptz, version_id uuid,
              bucket_id text, object_name text, size_bytes bigint, etag text, content_sha256 text,
              invalidated boolean, invalid_reason text, identity_intact boolean)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare t public.creator_tracks; v_id uuid;
begin
  select * into t from public.creator_tracks c where c.id = p_track;
  if not found then raise exception 'track_not_found'; end if;
  if t.status in ('approved','published') and t.approved_master_version_id is not null then
    v_id := t.approved_master_version_id; -- already reviewed: show what was approved
  elsif t.status in ('pending_review','rejected') then -- submitted, or an operator reconsidering
    if not public.music_track_assets_owned(t) then raise exception 'release_asset_not_owned'; end if;
    if coalesce(t.master_path, '') = '' then raise exception 'release_master_missing' using detail = 'no master'; end if;
    v_id := public.music_pin_master(t.id, t.master_path, 'review_candidate');
  else
    raise exception 'release_not_in_review' using detail = t.status;
  end if;
  return query
    select t.id, t.status, t.updated_at, v.id, v.bucket_id, v.object_name, v.size_bytes, v.etag, v.content_sha256,
           v.invalidated_at is not null, v.invalid_reason,
           coalesce(public.music_object_identity(v.bucket_id, v.object_name) = v.identity, false)
      from public.music_asset_versions v where v.id = v_id;
end $$;
revoke all on function public.music_prepare_review(uuid) from public, anon, authenticated;
grant execute on function public.music_prepare_review(uuid) to service_role;

-- Record the SHA-256 music-access computed over a pinned version's bytes.
-- Write-once. Answers (never raises for a verification outcome, so an
-- invalidation is committed): 'recorded' | 'already_recorded' |
-- 'size_mismatch' (nothing written: the read was not the whole object) |
-- 'mismatch' (a recompute disagreed: the version is invalidated) |
-- 'identity_changed' (Storage no longer holds the pinned object: invalidated) |
-- 'invalid' (already invalidated). An invalidated version's releases go back
-- to review and off sale; it is never approved, sold or delivered again.
create or replace function public.music_record_asset_sha256(p_version uuid, p_sha256 text, p_size bigint)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare v public.music_asset_versions; v_sha text := lower(coalesce(p_sha256, '')); v_reason text;
begin
  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'invalid_sha256'; end if;
  select * into v from public.music_asset_versions a where a.id = p_version for update;
  if not found then raise exception 'music_asset_version_not_found'; end if;
  if v.invalidated_at is not null then return 'invalid'; end if;
  -- the platform's own write (local to this transaction): the track guard's
  -- creator branch must not apply to the follow-up track updates below
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  if public.music_object_identity(v.bucket_id, v.object_name) is distinct from v.identity then
    v_reason := 'identity_changed';
  elsif v.size_bytes is not null and p_size is distinct from v.size_bytes then
    return 'size_mismatch';
  elsif v.content_sha256 is null then
    update public.music_asset_versions set content_sha256 = v_sha, content_sha256_at = now() where id = v.id;
    -- a release pinned by this file's backfill was frozen before its hash
    -- existed: its reviewed snapshot gains the hash of the same pinned bytes
    -- (nothing else changes), and its purchases record it
    update public.creator_tracks t
       set reviewed_snapshot = public.music_track_reviewed_snapshot(t),
           reviewed_digest = public.music_review_digest(public.music_track_reviewed_snapshot(t))
     where t.approved_master_version_id = v.id and t.status in ('approved','published')
       and t.reviewed_snapshot->>'approved_master_sha256' is null;
    update public.music_orders o set asset_sha256 = v_sha where o.asset_version_id = v.id and o.asset_sha256 is null;
    update public.music_entitlements e set asset_sha256 = v_sha where e.asset_version_id = v.id and e.asset_sha256 is null;
    return 'recorded';
  elsif v.content_sha256 = v_sha then
    return 'already_recorded';
  else
    v_reason := 'sha256_mismatch';
  end if;

  update public.music_asset_versions set invalidated_at = now(), invalid_reason = v_reason where id = v.id;
  update public.creator_tracks t
     set status = 'pending_review', rights_status = 'review', published_at = null,
         moderation_note = 'Returned to review: its approved master failed byte verification (' || v_reason || '). Upload the master again.'
   where t.approved_master_version_id = v.id and t.status in ('approved','published');
  return case when v_reason = 'sha256_mismatch' then 'mismatch' else v_reason end;
end $$;
revoke all on function public.music_record_asset_sha256(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.music_record_asset_sha256(uuid, text, bigint) to service_role;

-- The operator's decision. publish/approve carry the release version the
-- operator loaded (expected_updated_at) and the SHA-256 of the audio they
-- were shown; the track guard checks the hash on entering approved/published,
-- and this function checks it for approved -> published too. Returns null
-- when the release changed since it was loaded.
create or replace function public.music_operator_review(p_track uuid, p_decision text, p_note text,
                                                        p_expected_updated_at timestamptz, p_expected_master_sha256 text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare t public.creator_tracks; v_expected text := nullif(lower(trim(coalesce(p_expected_master_sha256, ''))), '');
        v_sha text;
begin
  if p_decision not in ('publish','approve','reject','review') then raise exception 'invalid_review_decision'; end if;
  if p_decision in ('publish','approve') then
    if p_expected_updated_at is null then raise exception 'review_expected_updated_at_required'; end if;
    if v_expected is null or v_expected !~ '^[0-9a-f]{64}$' then raise exception 'release_master_hash_required'; end if;
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('music.review_expected_master_sha256', coalesce(v_expected, ''), true);
  update public.creator_tracks c
     set moderation_note = coalesce(p_note, ''),
         status = case p_decision when 'publish' then 'published' when 'approve' then 'approved'
                                  when 'reject' then 'rejected' else 'pending_review' end,
         rights_status = case p_decision when 'publish' then 'cleared' when 'approve' then 'cleared'
                                         when 'reject' then 'disputed' else 'review' end,
         published_at = case when p_decision = 'publish' then coalesce(c.published_at, now()) else c.published_at end
   where c.id = p_track and (p_expected_updated_at is null or c.updated_at = p_expected_updated_at)
  returning c.* into t;
  perform set_config('music.review_expected_master_sha256', '', true);
  if t.id is null then return null; end if; -- changed since it was loaded
  if p_decision in ('publish','approve') then
    select v.content_sha256 into v_sha from public.music_asset_versions v where v.id = t.approved_master_version_id;
    if v_sha is null or v_sha is distinct from v_expected or not public.music_asset_version_intact(t.approved_master_version_id) then
      raise exception 'release_master_hash_mismatch';
    end if;
  end if;
  return jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'rights_status', t.rights_status,
                            'published_at', t.published_at, 'moderation_note', t.moderation_note, 'updated_at', t.updated_at,
                            'approved_master_version_id', t.approved_master_version_id, 'master_sha256', v_sha);
end $$;
revoke all on function public.music_operator_review(uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.music_operator_review(uuid, text, text, timestamptz, text) to service_role;

------------------------------------------------------------------------------
-- (e) delivery: what music-access signs. Service role only.
------------------------------------------------------------------------------
-- A purchaser's licence for (track, offer): the newest unrevoked one, else
-- the newest revoked one (so a revocation is refused, not mistaken for no
-- purchase), with the pinned object and whether Storage still holds exactly
-- those bytes. The release's current state is deliberately not consulted:
-- a purchaser keeps the version bought (owner policy) unless revoked.
create or replace function public.music_purchase_delivery(p_track uuid, p_offer uuid, p_user uuid, p_email text)
returns table(entitlement_id uuid, download_count integer, revoked boolean, order_status text,
              asset_version_id uuid, bucket_id text, object_name text, intact boolean, track_status text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select e.id, e.download_count, e.revoked_at is not null, o.status,
         e.asset_version_id, v.bucket_id, v.object_name,
         -- (f) hashed, never invalidated, the object unchanged, and the hash
         -- the purchase recorded is the version's
         coalesce(v.id is not null and public.music_asset_version_intact(v.id)
                  and (e.asset_sha256 is null or e.asset_sha256 = v.content_sha256), false),
         t.status
    from public.music_entitlements e
    join public.music_orders o on o.id = e.order_id
    join public.creator_tracks t on t.id = e.track_id
    left join public.music_asset_versions v on v.id = e.asset_version_id
   where e.track_id = p_track and e.offer_id = p_offer
     and ((p_user is not null and e.user_id = p_user)
       or (coalesce(p_email, '') <> '' and lower(e.customer_email) = lower(p_email)))
   order by (e.revoked_at is null) desc, e.created_at desc
   limit 1
$$;
revoke all on function public.music_purchase_delivery(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.music_purchase_delivery(uuid, uuid, uuid, text) to service_role;

-- A published release's pinned master, for listeners: never the live path.
create or replace function public.music_track_delivery(p_track uuid)
returns table(track_status text, asset_version_id uuid, bucket_id text, object_name text, intact boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select t.status, t.approved_master_version_id, v.bucket_id, v.object_name,
         coalesce(v.id is not null and public.music_asset_version_intact(v.id), false)
    from public.creator_tracks t
    left join public.music_asset_versions v on v.id = t.approved_master_version_id
   where t.id = p_track
$$;
revoke all on function public.music_track_delivery(uuid) from public, anon, authenticated;
grant execute on function public.music_track_delivery(uuid) to service_role;

------------------------------------------------------------------------------
-- (a) storage: changing, removing and reading your own private objects
-- follows the server's record of who uploaded them, not the folder name.
-- Writing a NEW object stays confined to your own folder (a namespace, so
-- two accounts never collide); who owns it is what Storage stamps.
------------------------------------------------------------------------------
-- (e) and never an object that is pinned or that an approved/published
-- release references: those are what was reviewed and sold.
drop policy if exists "creator updates uploaded music objects" on storage.objects;
create policy "creator updates uploaded music objects" on storage.objects for update to authenticated
using (bucket_id in ('creator-previews','creator-masters','creator-artwork')
       and public.music_asset_is_mine(bucket_id, name)
       and not public.music_asset_locked(bucket_id, name))
with check (bucket_id in ('creator-previews','creator-masters','creator-artwork')
            and (storage.foldername(name))[1] = auth.uid()::text
            and public.music_asset_is_mine(bucket_id, name));
drop policy if exists "creator deletes uploaded music objects" on storage.objects;
create policy "creator deletes uploaded music objects" on storage.objects for delete to authenticated
using (bucket_id in ('creator-previews','creator-masters','creator-artwork')
       and public.music_asset_is_mine(bucket_id, name)
       and not public.music_asset_locked(bucket_id, name));
drop policy if exists "creator reads own private masters" on storage.objects;
create policy "creator reads own private masters" on storage.objects for select to authenticated
using (bucket_id = 'creator-masters' and public.music_asset_is_mine(bucket_id, name));

------------------------------------------------------------------------------
-- (e) the same rule for every role, including the service role and the
-- Storage API's own writes (signed upload URLs, upserts, moves, deletes),
-- which RLS does not reach. Overwriting a locked object at the same path
-- changes its version/eTag/size: refused, so the row keeps pointing at the
-- reviewed version's bytes. Taking a pinned master down (legal) is an
-- operator migration, not an API call.
------------------------------------------------------------------------------
create or replace function public.music_storage_object_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.bucket_id in ('creator-previews','creator-masters','creator-artwork')
     and public.music_asset_locked(old.bucket_id, old.name) then
    raise exception 'music_asset_immutable'
      using detail = old.bucket_id || '/' || old.name, errcode = '42501',
            hint = 'Approved or purchased music is immutable: upload a new file (a new path) and resubmit for review.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.music_storage_object_guard() from public, anon, authenticated;
drop trigger if exists music_storage_object_guard_upd on storage.objects;
create trigger music_storage_object_guard_upd before update on storage.objects
for each row
when (old.bucket_id is distinct from new.bucket_id or old.name is distinct from new.name
      or old.version is distinct from new.version
      or old.metadata->>'eTag' is distinct from new.metadata->>'eTag'
      or old.metadata->>'size' is distinct from new.metadata->>'size')
execute function public.music_storage_object_guard();
drop trigger if exists music_storage_object_guard_del on storage.objects;
create trigger music_storage_object_guard_del before delete on storage.objects
for each row execute function public.music_storage_object_guard();
