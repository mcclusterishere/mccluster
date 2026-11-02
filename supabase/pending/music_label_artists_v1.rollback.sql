-- Rollback for music_label_artists_v1.sql: back to one artist per account.
--
-- Restores, exactly as production has them (scripts/test-music-label-db.sh
-- checks the md5 of each restored guard body and policy expression against
-- docs/control-plane/evidence/production-schema-snapshot-2026-10-31.json):
-- the three guards (music_creator_guard from
-- 20260920041011_music_creator_platform_v1.sql, music_track_guard and
-- music_license_guard from 20261030001000_music_release_payment_integrity_v1.sql)
-- and the creator tables' authenticated policies ("m_uid = current_m_uid()";
-- the track insert policy in its 20261029011314_rls_initplan_select_wrap_v1
-- form). Drops the label table, its functions and the attestation guard.
--
-- Artist identities the label created are removed only when they hold
-- nothing: no login and no release. One that has releases stays, with its
-- profile, and from then on only the service role can change it; give it a
-- login (link an auth record to its m_uid) to hand it back to a person.

alter policy music_creator_profiles_read on public.music_creator_profiles
  using ((status = 'active') or (m_uid = public.current_m_uid()));
alter policy music_creator_profiles_insert on public.music_creator_profiles
  with check (m_uid = public.current_m_uid());
alter policy music_creator_profiles_update on public.music_creator_profiles
  using (m_uid = public.current_m_uid()) with check (m_uid = public.current_m_uid());

alter policy music_creator_tracks_read on public.creator_tracks
  using ((status = 'published') or (m_uid = public.current_m_uid()));
alter policy music_creator_tracks_insert on public.creator_tracks
  with check (((m_uid = (select current_m_uid())) AND (uid = (select auth.uid()))));
alter policy music_creator_tracks_update on public.creator_tracks
  using (m_uid = public.current_m_uid()) with check (m_uid = public.current_m_uid());
alter policy music_creator_tracks_delete on public.creator_tracks
  using (m_uid = public.current_m_uid() and status in ('draft','rejected','archived'));

alter policy music_license_offers_read on public.music_license_offers
  using (active = true or creator_m_uid = public.current_m_uid());
alter policy music_license_offers_insert on public.music_license_offers
  with check (creator_m_uid = public.current_m_uid());
alter policy music_license_offers_update on public.music_license_offers
  using (creator_m_uid = public.current_m_uid()) with check (creator_m_uid = public.current_m_uid());
alter policy music_license_offers_delete on public.music_license_offers
  using (creator_m_uid = public.current_m_uid() and active = false);

alter policy music_rights_attestations_read on public.music_rights_attestations
  using (creator_m_uid = public.current_m_uid());
alter policy music_rights_attestations_insert on public.music_rights_attestations
  with check (creator_m_uid = public.current_m_uid() and exists (
    select 1 from public.creator_tracks t where t.id = track_id and t.m_uid = public.current_m_uid()));

create or replace function public.music_creator_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_m uuid;
begin
  new.handle := lower(trim(new.handle));
  new.artist_name := trim(new.artist_name);
  new.updated_at := now();
  if auth.role() <> 'service_role' then
    v_m := public.current_m_uid();
    if v_m is null or new.m_uid <> v_m then raise exception 'creator_identity_mismatch'; end if;
    if tg_op='UPDATE' then
      new.status := old.status;
      new.verification_state := old.verification_state;
      new.payout_state := old.payout_state;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.music_creator_guard() from public, anon, authenticated;

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

drop trigger if exists music_rights_attestation_guard_trg on public.music_rights_attestations;
drop function if exists public.music_rights_attestation_guard();
alter table public.music_rights_attestations drop column if exists attested_by_m_uid;

drop function if exists public.music_label_hand_over_login(uuid, uuid);
drop function if exists public.music_label_revoke(uuid, uuid);
drop function if exists public.music_label_grant(uuid, uuid, text);
drop function if exists public.music_label_create_artist(text, text, text);
drop function if exists public.music_my_artists();

delete from public.m_people p
 using public.music_creator_profiles c
 where c.m_uid = p.id
   and c.settings->>'provisioned_by' in ('music_label_artists_v1', 'music_label_create_artist')
   and not exists (select 1 from public.m_auth_user_links l where l.m_uid = p.id)
   and not exists (select 1 from public.creator_tracks t where t.m_uid = p.id);

drop function if exists public.music_can_act_for(uuid);
drop table if exists public.music_creator_managers;
