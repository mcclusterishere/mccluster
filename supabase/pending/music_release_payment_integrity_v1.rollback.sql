-- Rollback for music_release_payment_integrity_v1.sql. Restores the v1 guards
-- (supabase/migrations/20260920041011_music_creator_platform_v1.sql) and the
-- v1 storage policies, and removes what the file added (including the pinned
-- asset versions and the purchased version recorded on orders and
-- entitlements: that record is LOST). This REOPENS the five findings it closed; apply only to back out a broken promotion.
set local lock_timeout = '5s';

drop trigger if exists music_storage_object_guard_upd on storage.objects;
drop trigger if exists music_storage_object_guard_del on storage.objects;
drop function if exists public.music_storage_object_guard();
drop function if exists public.music_purchase_delivery(uuid, uuid, uuid, text);
drop function if exists public.music_track_delivery(uuid);
drop trigger if exists music_entitlement_guard_trg on public.music_entitlements;
drop function if exists public.music_entitlement_guard();
drop trigger if exists music_order_guard_trg on public.music_orders;
drop function if exists public.music_order_guard();
drop trigger if exists music_track_offers_follow_status_trg on public.creator_tracks;
drop function if exists public.music_track_offers_follow_status();

create or replace function public.music_track_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_m uuid;
begin
  new.updated_at := now();
  new.title := trim(new.title);
  new.artist := trim(new.artist);
  new.slug := nullif(lower(trim(coalesce(new.slug,''))), '');
  if auth.role() <> 'service_role' then
    v_m := public.current_m_uid();
    if v_m is null then raise exception 'creator_identity_missing'; end if;
    new.uid := auth.uid();
    new.m_uid := v_m;
    if tg_op='UPDATE' and old.m_uid <> v_m then raise exception 'creator_track_forbidden'; end if;
    if new.status not in ('draft','pending_review') then new.status := old.status; end if;
    if new.rights_status not in ('incomplete','attested') then new.rights_status := old.rights_status; end if;
    new.moderation_note := case when tg_op='UPDATE' then old.moderation_note else '' end;
    new.published_at := case when tg_op='UPDATE' then old.published_at else null end;
  end if;
  return new;
end $$;
revoke execute on function public.music_track_guard() from public, anon, authenticated;

create or replace function public.music_license_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_m uuid; v_track_m uuid;
begin
  new.updated_at := now();
  select m_uid into v_track_m from public.creator_tracks where id=new.track_id;
  if v_track_m is null then raise exception 'track_not_found'; end if;
  if auth.role() <> 'service_role' then
    v_m := public.current_m_uid();
    if v_m is null or v_m <> v_track_m then raise exception 'license_offer_forbidden'; end if;
    new.creator_m_uid := v_m;
    new.active := case when tg_op='UPDATE' then old.active else false end;
    new.l3_product_id := case when tg_op='UPDATE' then old.l3_product_id else null end;
  end if;
  return new;
end $$;
revoke execute on function public.music_license_guard() from public, anon, authenticated;

drop policy if exists "creator updates uploaded music objects" on storage.objects;
create policy "creator updates uploaded music objects" on storage.objects for update to authenticated
using (bucket_id in ('creator-previews','creator-masters','creator-artwork') and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id in ('creator-previews','creator-masters','creator-artwork') and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "creator deletes uploaded music objects" on storage.objects;
create policy "creator deletes uploaded music objects" on storage.objects for delete to authenticated
using (bucket_id in ('creator-previews','creator-masters','creator-artwork') and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "creator reads own private masters" on storage.objects;
create policy "creator reads own private masters" on storage.objects for select to authenticated
using (bucket_id='creator-masters' and (storage.foldername(name))[1]=auth.uid()::text);

alter table public.music_entitlements drop column if exists asset_version_id;
alter table public.music_orders drop column if exists asset_version_id;
alter table public.creator_tracks drop column if exists approved_master_version_id;
drop function if exists public.music_asset_locked(text, text);
drop function if exists public.music_pin_master(uuid, text, text);
drop function if exists public.music_track_reviewed_snapshot(public.creator_tracks);
drop function if exists public.music_review_digest(jsonb);
drop table if exists public.music_asset_versions;
drop function if exists public.music_asset_version_guard();
drop function if exists public.music_object_identity(text, text);
drop function if exists public.music_track_assets_verified(uuid);
drop function if exists public.music_track_assets_owned(public.creator_tracks);
drop function if exists public.music_track_content(public.creator_tracks);
drop function if exists public.music_artwork_object(text);
drop function if exists public.music_public_object_url(text, text);
drop function if exists public.music_asset_is_mine(text, text);
drop function if exists public.music_asset_owned_by(text, text, uuid, uuid);
drop table if exists public.music_creator_assets;
drop function if exists public.music_platform_fee_bps();
alter table public.creator_tracks
  drop column if exists reviewed_snapshot,
  drop column if exists reviewed_digest,
  drop column if exists reviewed_at;
