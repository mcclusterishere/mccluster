-- MUSIC RELEASE AND PAYMENT INTEGRITY V1 (pending; NOT applied in production)
--
-- Closes four owner security findings on the creator music catalogue
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
-- Deploy order: deploy music-access, music-checkout and stripe-webhook first
-- (each tolerates this file being absent), then apply this file. Applying
-- it first would refuse new uploads until music-access writes the registry.
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

-- A release's content: every column except identity, workflow and review
-- bookkeeping. A column added later counts as content until it is listed
-- here, so a new field can never be edited under a review by omission.
create or replace function public.music_track_content(p_row public.creator_tracks)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select to_jsonb(p_row) - array['id','uid','m_uid','created_at','updated_at','status','rights_status',
                                 'moderation_note','published_at','reviewed_snapshot','reviewed_digest','reviewed_at']
$$;
revoke all on function public.music_track_content(public.creator_tracks) from public, anon, authenticated;

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
    new.reviewed_snapshot := public.music_track_content(new);
    new.reviewed_digest := md5(new.reviewed_snapshot::text);
    new.reviewed_at := now();
  elsif new.status in ('approved','published')
        and new.reviewed_digest is distinct from md5(public.music_track_content(new)::text) then
    -- unreachable through the branch above; kept so the invariant is stated
    raise exception 'release_differs_from_review';
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
    if public.music_track_assets_owned(r) then
      update public.creator_tracks
         set reviewed_snapshot = public.music_track_content(r),
             reviewed_digest = md5(public.music_track_content(r)::text),
             reviewed_at = coalesce(r.published_at, now())
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
-- (c)+(d) the order and entitlement guards (service role writes these; the
-- guards hold for it too)
------------------------------------------------------------------------------
create or replace function public.music_order_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'music_order_must_start_pending'; end if;
    if new.platform_fee_cents <> round(new.amount_cents * public.music_platform_fee_bps() / 10000.0)::integer then
      raise exception 'music_order_fee_mismatch';
    end if;
    return new;
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
  if not found or o.status <> 'paid' then raise exception 'music_entitlement_order_not_paid'; end if;
  if new.offer_id <> o.offer_id or new.track_id <> o.track_id then
    raise exception 'music_entitlement_order_mismatch';
  end if;
  return new;
end $$;
revoke execute on function public.music_entitlement_guard() from public, anon, authenticated;
drop trigger if exists music_entitlement_guard_trg on public.music_entitlements;
create trigger music_entitlement_guard_trg before insert on public.music_entitlements
for each row execute function public.music_entitlement_guard();

------------------------------------------------------------------------------
-- (a) storage: changing, removing and reading your own private objects
-- follows the server's record of who uploaded them, not the folder name.
-- Writing a NEW object stays confined to your own folder (a namespace, so
-- two accounts never collide); who owns it is what Storage stamps.
------------------------------------------------------------------------------
drop policy if exists "creator updates uploaded music objects" on storage.objects;
create policy "creator updates uploaded music objects" on storage.objects for update to authenticated
using (bucket_id in ('creator-previews','creator-masters','creator-artwork') and public.music_asset_is_mine(bucket_id, name))
with check (bucket_id in ('creator-previews','creator-masters','creator-artwork')
            and (storage.foldername(name))[1] = auth.uid()::text
            and public.music_asset_is_mine(bucket_id, name));
drop policy if exists "creator deletes uploaded music objects" on storage.objects;
create policy "creator deletes uploaded music objects" on storage.objects for delete to authenticated
using (bucket_id in ('creator-previews','creator-masters','creator-artwork') and public.music_asset_is_mine(bucket_id, name));
drop policy if exists "creator reads own private masters" on storage.objects;
create policy "creator reads own private masters" on storage.objects for select to authenticated
using (bucket_id = 'creator-masters' and public.music_asset_is_mine(bucket_id, name));
