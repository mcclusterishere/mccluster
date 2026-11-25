-- MUSIC LABEL ARTISTS V1 (pending; NOT applied in production)
--
-- Owner, 2026-11-02: "PRIM3 needs their own artist page as that is its own
-- artist. Separate entity from Matthew McCluster. But controlled by Matthew
-- McCluster's account until it gets its own login." And: "as an admin, I
-- want to test multiple, or like being a label account type shit where I can
-- have multiple artists on my account."
--
-- THE MODEL: a label, not a second account system.
--   * An artist is an M identity (public.m_people) with its own creator
--     profile (public.music_creator_profiles, keyed by m_uid). That was
--     already the rule; one profile per identity stays the rule.
--   * An artist does not need a login. public.m_people rows without an
--     m_auth_user_links row are already allowed and already in production:
--     20261021011443_royce_platform_actor.sql provisions Royce exactly so
--     ("No auth.users row, fabricated email, password, or login session is
--     created"), and replay_migrations/0049_m_account_people.sql puts M
--     identities one layer above auth records on purpose.
--   * NEW: public.music_creator_managers says which M identity may act for
--     which artist (role 'label_admin' or 'manager'; revoked_at ends it).
--     public.music_can_act_for(artist) is the one question every guard and
--     policy now asks: "is this artist me, or an artist I manage?"
--   * Every row an artist owns (profile, releases, licence offers, rights
--     attestations) carries the ARTIST's m_uid, never the manager's. So:
--   * HANDING AN ARTIST ITS OWN LOGIN is linking an auth record to the
--     artist's existing identity (public.music_label_hand_over_login, service
--     role only: it changes authentication) and, if the owner wants, revoking
--     the manager row (public.music_label_revoke). No content moves.
--
-- No second auth system, no new login, no fabricated email. Seeds PRIM3 and
-- Equity Uprise's music act as artists managed by the house owner (the
-- mccluster org's owner, i.e. Matthew McCluster) as label_admin; does nothing
-- on a database with no house (an empty replay).
--
-- WHAT CHANGES FOR EVERY EXISTING CREATOR: nothing they can see. For a
-- creator acting as themselves music_can_act_for(own m_uid) is true exactly
-- when "m_uid = current_m_uid()" was. Two tightenings: an insert naming
-- another identity's m_uid now fails (creator_track_forbidden) instead of
-- being silently rewritten to the caller, and creator_tracks.uid (the account
-- that created the row) is kept on update instead of being rewritten to
-- whoever saved last (so files a manager uploaded stay owned by the release
-- after the artist gets a login).
--
-- Replaces public.music_creator_guard() (body of
-- 20260920041011_music_creator_platform_v1.sql), public.music_track_guard()
-- and public.music_license_guard() (bodies of
-- 20261030001000_music_release_payment_integrity_v1.sql; production's are
-- those bodies with CRLF line endings, docs/control-plane/
-- PRODUCTION-SCHEMA-RECONCILIATION-2026-10-28.md). Each replacement is that
-- body with only the LABEL lines changed. Alters (never drops) the creator
-- tables' authenticated policies, so their roles stay as production has them.
--
-- KNOWN LIMIT, follow-up: the music-access Edge Function records an upload's
-- owner_m_uid as the caller's own identity. A file a manager uploads for a
-- release the ARTIST created after getting its own login is owned by the
-- manager, not the release's uid, so review approval would refuse it
-- (release_asset_not_owned) until music-access records the acted-for artist.
-- Not reachable before any artist has a login.
--
-- Test: scripts/test-music-label-db.sh (also .github/workflows/music-label-db.yml):
-- Matthew can write PRIM3's rows, a stranger cannot, a revoked manager cannot,
-- the hand-over keeps every row, the rollback restores production's exact
-- guards and policies. Contract: scripts/test/music-label.test.mjs.
-- Rollback: music_label_artists_v1.rollback.sql.

------------------------------------------------------------------------------
-- Who may act for which artist
------------------------------------------------------------------------------
create table if not exists public.music_creator_managers (
  creator_m_uid uuid not null references public.m_people(id) on delete cascade,
  manager_m_uid uuid not null references public.m_people(id) on delete cascade,
  role text not null default 'manager' check (role in ('label_admin','manager')),
  granted_at timestamptz not null default now(),
  granted_by uuid references public.m_people(id) on delete set null,
  revoked_at timestamptz,
  note text not null default '' check (char_length(note) <= 500),
  primary key (creator_m_uid, manager_m_uid),
  check (creator_m_uid <> manager_m_uid),
  check (revoked_at is null or revoked_at >= granted_at)
);
create index if not exists music_creator_managers_manager_idx
  on public.music_creator_managers(manager_m_uid) where revoked_at is null;
comment on table public.music_creator_managers is
  'Label model: which M identity may act for which music artist (an M identity with a music_creator_profiles row, with or without a login). The artist owns its rows; a manager acts for it. revoked_at ends a grant. Written only through music_label_* functions and the service role.';

alter table public.music_creator_managers enable row level security;
revoke all on public.music_creator_managers from public, anon, authenticated;
grant select on public.music_creator_managers to authenticated;
grant all on public.music_creator_managers to service_role;
drop policy if exists music_creator_managers_read on public.music_creator_managers;
create policy music_creator_managers_read on public.music_creator_managers for select to authenticated
  using (manager_m_uid = (select public.current_m_uid()) or creator_m_uid = (select public.current_m_uid()));

-- The one question: is this artist me, or an artist I manage (not revoked)?
create or replace function public.music_can_act_for(p_creator uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select p_creator is not null
     and public.current_m_uid() is not null
     and (p_creator = public.current_m_uid()
          or exists (select 1 from public.music_creator_managers m
                      where m.creator_m_uid = p_creator
                        and m.manager_m_uid = public.current_m_uid()
                        and m.revoked_at is null))
$$;
revoke all on function public.music_can_act_for(uuid) from public, anon;
grant execute on function public.music_can_act_for(uuid) to authenticated, service_role;

------------------------------------------------------------------------------
-- The guards: the same bodies, the LABEL lines changed
------------------------------------------------------------------------------
create or replace function public.music_creator_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_m uuid;
begin
  new.handle := lower(trim(new.handle));
  new.artist_name := trim(new.artist_name);
  new.updated_at := now();
  if auth.role() <> 'service_role' then
    v_m := public.current_m_uid();
    -- LABEL: the profile is the caller's own, or an artist the caller manages
    if v_m is null or not public.music_can_act_for(new.m_uid) then raise exception 'creator_identity_mismatch'; end if;
    -- an artist profile never changes identity
    if tg_op='UPDATE' and new.m_uid <> old.m_uid then raise exception 'creator_identity_mismatch'; end if;
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
  v_artist uuid;
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
    -- LABEL: a release belongs to an artist: the caller's own identity, or an
    -- artist the caller manages (music_creator_managers). It never moves to
    -- another artist. uid is the account that created the row and stays so,
    -- so the files it uploaded stay owned by the release when the artist
    -- later signs in with its own login.
    v_artist := case when tg_op='UPDATE' then old.m_uid else coalesce(new.m_uid, v_m) end;
    if not public.music_can_act_for(v_artist) then raise exception 'creator_track_forbidden'; end if;
    new.m_uid := v_artist;
    new.uid := case when tg_op='UPDATE' and old.uid is not null then old.uid else auth.uid() end;
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
    -- LABEL: the release's own artist, or a manager of that artist
    if v_m is null or not public.music_can_act_for(v_track_m) then raise exception 'license_offer_forbidden'; end if;
    if tg_op = 'UPDATE' and new.track_id <> old.track_id then raise exception 'license_offer_forbidden'; end if;
    new.creator_m_uid := v_track_m;
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

-- A rights attestation is the ARTIST's (a manager attests for the artist it
-- manages, as a label does) and records who made it.
alter table public.music_rights_attestations
  add column if not exists attested_by_m_uid uuid references public.m_people(id) on delete set null;
create or replace function public.music_rights_attestation_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.attested_by_m_uid := public.current_m_uid();
    new.creator_m_uid := (select t.m_uid from public.creator_tracks t where t.id = new.track_id);
  end if;
  return new;
end $$;
revoke execute on function public.music_rights_attestation_guard() from public, anon, authenticated;
drop trigger if exists music_rights_attestation_guard_trg on public.music_rights_attestations;
create trigger music_rights_attestation_guard_trg before insert on public.music_rights_attestations
for each row execute function public.music_rights_attestation_guard();

------------------------------------------------------------------------------
-- The policies: "m_uid = current_m_uid()" becomes music_can_act_for(m_uid)
------------------------------------------------------------------------------
alter policy music_creator_profiles_read on public.music_creator_profiles
  using ((status = 'active') or public.music_can_act_for(m_uid));
alter policy music_creator_profiles_insert on public.music_creator_profiles
  with check (public.music_can_act_for(m_uid));
alter policy music_creator_profiles_update on public.music_creator_profiles
  using (public.music_can_act_for(m_uid)) with check (public.music_can_act_for(m_uid));

alter policy music_creator_tracks_read on public.creator_tracks
  using ((status = 'published') or public.music_can_act_for(m_uid));
alter policy music_creator_tracks_insert on public.creator_tracks
  with check (public.music_can_act_for(m_uid) and uid = (select auth.uid()));
alter policy music_creator_tracks_update on public.creator_tracks
  using (public.music_can_act_for(m_uid)) with check (public.music_can_act_for(m_uid));
alter policy music_creator_tracks_delete on public.creator_tracks
  using (public.music_can_act_for(m_uid) and status in ('draft','rejected','archived'));

alter policy music_license_offers_read on public.music_license_offers
  using ((active = true) or public.music_can_act_for(creator_m_uid));
alter policy music_license_offers_insert on public.music_license_offers
  with check (public.music_can_act_for(creator_m_uid));
alter policy music_license_offers_update on public.music_license_offers
  using (public.music_can_act_for(creator_m_uid)) with check (public.music_can_act_for(creator_m_uid));
alter policy music_license_offers_delete on public.music_license_offers
  using (public.music_can_act_for(creator_m_uid) and active = false);

alter policy music_rights_attestations_read on public.music_rights_attestations
  using (public.music_can_act_for(creator_m_uid));
alter policy music_rights_attestations_insert on public.music_rights_attestations
  with check (public.music_can_act_for(creator_m_uid) and exists (
    select 1 from public.creator_tracks t where t.id = track_id and t.m_uid = creator_m_uid));

------------------------------------------------------------------------------
-- The label desk's calls
------------------------------------------------------------------------------
-- "Acting as": my own identity first, then every artist I manage.
create or replace function public.music_my_artists()
returns table (m_uid uuid, handle text, artist_name text, avatar_url text,
               relation text, role text, has_login boolean, profile_status text)
language sql stable security definer set search_path = pg_catalog, public as $$
  with me as (select public.current_m_uid() as id),
  rows as (
    select me.id as m_uid, p.handle, p.artist_name, coalesce(p.avatar_url, '') as avatar_url,
           'self'::text as relation, 'owner'::text as role, true as has_login, p.status as profile_status, 0 as rank
      from me left join public.music_creator_profiles p on p.m_uid = me.id
     where me.id is not null
    union all
    select g.creator_m_uid, p.handle, p.artist_name, coalesce(p.avatar_url, ''),
           'managed', g.role,
           exists (select 1 from public.m_auth_user_links l where l.m_uid = g.creator_m_uid),
           p.status, 1
      from me join public.music_creator_managers g on g.manager_m_uid = me.id and g.revoked_at is null
      left join public.music_creator_profiles p on p.m_uid = g.creator_m_uid
  )
  select m_uid, handle, artist_name, avatar_url, relation, role, has_login, profile_status
    from rows order by rank, lower(coalesce(artist_name, handle, ''))
$$;
revoke all on function public.music_my_artists() from public, anon;
grant execute on function public.music_my_artists() to authenticated, service_role;

-- A new artist on the label: its own identity (no login), its profile, and
-- the caller as its label_admin. v1: the house owner only.
create or replace function public.music_label_create_artist(p_handle text, p_artist_name text, p_bio text default '')
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_me uuid := public.current_m_uid(); v_artist uuid;
begin
  if v_me is null then raise exception 'creator_identity_missing' using errcode = '42501'; end if;
  if not public.mccluster_is_house_owner() then raise exception 'label_admin_required' using errcode = '42501'; end if;
  insert into public.m_people default values returning id into v_artist;
  insert into public.music_creator_managers(creator_m_uid, manager_m_uid, role, granted_by, note)
  values (v_artist, v_me, 'label_admin', v_me, 'created on the label by music_label_create_artist');
  insert into public.music_creator_profiles(m_uid, handle, artist_name, bio, settings)
  values (v_artist, p_handle, p_artist_name, coalesce(p_bio, ''),
          jsonb_build_object('managed', true, 'provisioned_by', 'music_label_create_artist'));
  return v_artist;
end $$;
revoke all on function public.music_label_create_artist(text, text, text) from public, anon;
grant execute on function public.music_label_create_artist(text, text, text) to authenticated, service_role;

-- Add (or re-activate) a manager: the house owner or the artist's label_admin.
create or replace function public.music_label_grant(p_creator uuid, p_manager uuid, p_role text default 'manager')
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_me uuid := public.current_m_uid(); v_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not v_service then
    if v_me is null then raise exception 'creator_identity_missing' using errcode = '42501'; end if;
    if not (public.mccluster_is_house_owner() or exists (
              select 1 from public.music_creator_managers m
               where m.creator_m_uid = p_creator and m.manager_m_uid = v_me
                 and m.role = 'label_admin' and m.revoked_at is null)) then
      raise exception 'label_admin_required' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from public.music_creator_profiles where m_uid = p_creator) then
    raise exception 'artist_not_found';
  end if;
  insert into public.music_creator_managers(creator_m_uid, manager_m_uid, role, granted_by)
  values (p_creator, p_manager, coalesce(p_role, 'manager'), v_me)
  on conflict (creator_m_uid, manager_m_uid) do update
    set role = excluded.role, granted_by = excluded.granted_by, granted_at = now(), revoked_at = null;
end $$;
revoke all on function public.music_label_grant(uuid, uuid, text) from public, anon;
grant execute on function public.music_label_grant(uuid, uuid, text) to authenticated, service_role;

-- End a grant: the house owner, the artist's label_admin, the manager
-- stepping down, or the artist itself once it signs in with its own login.
create or replace function public.music_label_revoke(p_creator uuid, p_manager uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_me uuid := public.current_m_uid(); v_service boolean := coalesce(auth.role(), '') = 'service_role'; v_n integer;
begin
  if not v_service then
    if v_me is null then raise exception 'creator_identity_missing' using errcode = '42501'; end if;
    if not (v_me = p_creator or v_me = p_manager or public.mccluster_is_house_owner() or exists (
              select 1 from public.music_creator_managers m
               where m.creator_m_uid = p_creator and m.manager_m_uid = v_me
                 and m.role = 'label_admin' and m.revoked_at is null)) then
      raise exception 'label_admin_required' using errcode = '42501';
    end if;
  end if;
  update public.music_creator_managers set revoked_at = now()
   where creator_m_uid = p_creator and manager_m_uid = p_manager and revoked_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.music_label_revoke(uuid, uuid) from public, anon;
grant execute on function public.music_label_revoke(uuid, uuid) to authenticated, service_role;

-- The artist's own login, later: point an auth record (a fresh sign-up, whose
-- M identity is still empty) at the artist's identity. Service role only: it
-- changes authentication, so an operator runs it on the owner's word. Every
-- profile, release, offer and attestation is already the artist's: nothing
-- moves. Manager rows are left as they are; revoke them separately if wanted.
create or replace function public.music_label_hand_over_login(p_creator uuid, p_auth_user uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'service_role') then
    raise exception 'server role required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.music_creator_profiles where m_uid = p_creator) then
    raise exception 'artist_not_found';
  end if;
  if exists (select 1 from public.m_auth_user_links where m_uid = p_creator) then
    raise exception 'artist_already_has_login';
  end if;
  select m_uid into v_old from public.m_auth_user_links where auth_user_id = p_auth_user for update;
  if v_old is null then raise exception 'auth_user_not_linked'; end if;
  if exists (select 1 from public.music_creator_profiles where m_uid = v_old)
     or exists (select 1 from public.creator_tracks where m_uid = v_old)
     or exists (select 1 from public.music_creator_managers where manager_m_uid = v_old and revoked_at is null) then
    raise exception 'auth_user_identity_not_empty'
      using hint = 'Hand over only a fresh sign-up: its own M identity must hold no music.';
  end if;
  update public.m_auth_user_links set m_uid = p_creator, link_method = 'manual', is_primary = true
   where auth_user_id = p_auth_user;
  return jsonb_build_object('artist', p_creator, 'auth_user', p_auth_user, 'released_identity', v_old);
end $$;
revoke all on function public.music_label_hand_over_login(uuid, uuid) from public, anon, authenticated;
grant execute on function public.music_label_hand_over_login(uuid, uuid) to service_role;

------------------------------------------------------------------------------
-- Seed: PRIM3 and Equity Uprise's music act on the house owner's label
------------------------------------------------------------------------------
do $$
declare
  v_owner uuid;
  v_artist uuid;
  r record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select l.m_uid into v_owner
    from public.orgs o
    join public.org_members om on om.org_id = o.id and om.role = 'owner'
    join public.m_auth_user_links l on l.auth_user_id = om.profile_id and l.is_primary
   where o.slug = 'mccluster'
   order by l.m_uid
   limit 1;
  if v_owner is null then return; end if; -- an empty replay database has no house
  for r in
    select * from (values
      ('prim3', 'PRIM3',
       'The music act of PRIM3, McCluster Corp''s cybersecurity learning product. Album: Cyber Security Specialist. Managed by Matthew McCluster until PRIM3 has its own login.',
       'https://matthew.mccluster.org/prim3-artist.html',
       'https://matthew.mccluster.org/prim3-artist.html#prim3-artist', 'prim3'),
      ('equity-uprise', 'Equity Uprise',
       'The music act of Equity Uprise, McCluster Corp''s civic program. Album: Docket 516R. Managed by Matthew McCluster.',
       'https://matthew.mccluster.org/album.html?album=equity-uprise',
       'https://matthew.mccluster.org/catalogue.html#artist-equity-uprise', 'equity-uprise')
    ) as t(handle, artist_name, bio, website_url, entity, album_slug)
  loop
    select m_uid into v_artist from public.music_creator_profiles where handle = r.handle;
    if v_artist is null then
      insert into public.m_people default values returning id into v_artist;
      insert into public.music_creator_managers(creator_m_uid, manager_m_uid, role, granted_by, note)
      values (v_artist, v_owner, 'label_admin', v_owner, 'seeded by music_label_artists_v1 (owner, 2026-11-02)');
      insert into public.music_creator_profiles(m_uid, handle, artist_name, bio, website_url, settings)
      values (v_artist, r.handle, r.artist_name, r.bio, r.website_url,
              jsonb_build_object('managed', true, 'provisioned_by', 'music_label_artists_v1',
                                 'entity', r.entity, 'album_slug', r.album_slug));
    elsif v_artist = v_owner
       or (exists (select 1 from public.m_auth_user_links where m_uid = v_artist)
           and not exists (select 1 from public.music_creator_managers where creator_m_uid = v_artist and manager_m_uid = v_owner)) then
      raise exception 'music handle % already belongs to a person; inspect before provisioning', r.handle;
    else
      -- a re-run: keep whatever grant exists (a revoked grant stays revoked)
      insert into public.music_creator_managers(creator_m_uid, manager_m_uid, role, granted_by, note)
      values (v_artist, v_owner, 'label_admin', v_owner, 'seeded by music_label_artists_v1 (owner, 2026-11-02)')
      on conflict (creator_m_uid, manager_m_uid) do nothing;
    end if;
  end loop;
end $$;
