-- McCluster Music creator platform v1
-- One M Account, one Mnet identity, one creator profile, one governed catalogue.

insert into public.platform_apps (app_key, name, product_family, kind, public_url, enabled, settings)
values ('music-web', 'McCluster Music', 'music', 'web', 'https://matthew.mccluster.org/listen.html', true, '{"surface":"listen.html","identity":"m-account","network":"mnet"}'::jsonb)
on conflict (app_key) do update set name=excluded.name, enabled=true, settings=excluded.settings;

create table if not exists public.music_creator_profiles (
  m_uid uuid primary key references public.m_people(id) on delete cascade default public.current_m_uid(),
  handle text not null unique,
  artist_name text not null,
  bio text not null default '',
  avatar_url text not null default '',
  banner_url text not null default '',
  website_url text not null default '',
  status text not null default 'active' check (status in ('active','paused','suspended')),
  verification_state text not null default 'unverified' check (verification_state in ('unverified','identity_checked','rights_ready','verified')),
  terms_version text not null default 'music-creator-v1',
  terms_accepted_at timestamptz not null default now(),
  rights_warranty_accepted_at timestamptz,
  payout_state text not null default 'not_started' check (payout_state in ('not_started','pending','ready','restricted')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (handle ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  check (char_length(artist_name) between 1 and 160),
  check (char_length(bio) <= 2000)
);

alter table public.creator_tracks
  add column if not exists m_uid uuid references public.m_people(id) on delete cascade,
  add column if not exists slug text,
  add column if not exists description text not null default '',
  add column if not exists status text not null default 'draft',
  add column if not exists access_mode text not null default 'public',
  add column if not exists preview_bucket text not null default 'creator-previews',
  add column if not exists preview_path text not null default '',
  add column if not exists master_bucket text not null default 'creator-masters',
  add column if not exists master_path text not null default '',
  add column if not exists duration_ms integer,
  add column if not exists explicit boolean not null default false,
  add column if not exists genre text not null default '',
  add column if not exists rights_status text not null default 'incomplete',
  add column if not exists rights_declaration jsonb not null default '{}'::jsonb,
  add column if not exists moderation_note text not null default '',
  add column if not exists published_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table public.creator_tracks add constraint creator_tracks_status_check
    check (status in ('draft','pending_review','approved','published','rejected','archived'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.creator_tracks add constraint creator_tracks_access_mode_check
    check (access_mode in ('public','account','purchase'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.creator_tracks add constraint creator_tracks_rights_status_check
    check (rights_status in ('incomplete','attested','review','cleared','disputed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.creator_tracks add constraint creator_tracks_slug_check
    check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,119}$');
exception when duplicate_object then null; end $$;

update public.creator_tracks t
   set m_uid = l.m_uid
  from public.m_auth_user_links l
 where t.m_uid is null and l.auth_user_id=t.uid and l.is_primary=true;

create unique index if not exists creator_tracks_creator_slug_uq
  on public.creator_tracks(m_uid,slug) where slug is not null;
create index if not exists creator_tracks_publish_idx
  on public.creator_tracks(status,published_at desc);
create index if not exists creator_tracks_creator_idx
  on public.creator_tracks(m_uid,created_at desc);

create table if not exists public.music_license_offers (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.creator_tracks(id) on delete cascade,
  creator_m_uid uuid not null references public.m_people(id) on delete cascade default public.current_m_uid(),
  slug text not null,
  title text not null,
  license_type text not null check (license_type in ('personal_download','creator_noncommercial','commercial_basic','commercial_pro','sync_inquiry')),
  price_cents integer,
  currency text not null default 'usd',
  terms_text text not null,
  usage_terms jsonb not null default '{}'::jsonb,
  l3_product_id uuid references public.l3_products(id) on delete set null,
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(track_id,slug),
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  check (price_cents is null or price_cents >= 0),
  check (currency ~ '^[a-z]{3}$'),
  check (char_length(terms_text) between 1 and 20000)
);

create table if not exists public.music_rights_attestations (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.creator_tracks(id) on delete cascade,
  creator_m_uid uuid not null references public.m_people(id) on delete cascade default public.current_m_uid(),
  version text not null default 'music-rights-v1',
  owns_master boolean not null,
  controls_composition boolean not null,
  samples_cleared boolean not null,
  collaborators_cleared boolean not null,
  parody_or_derivative boolean not null default false,
  derivative_permissions text not null default '',
  notes text not null default '',
  attested_at timestamptz not null default now(),
  ip_hash text not null default '',
  user_agent_hash text not null default ''
);
create index if not exists music_rights_track_idx on public.music_rights_attestations(track_id,attested_at desc);

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

drop trigger if exists music_creator_guard_trg on public.music_creator_profiles;
create trigger music_creator_guard_trg before insert or update on public.music_creator_profiles
for each row execute function public.music_creator_guard();

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

drop trigger if exists music_track_guard_trg on public.creator_tracks;
create trigger music_track_guard_trg before insert or update on public.creator_tracks
for each row execute function public.music_track_guard();

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

drop trigger if exists music_license_guard_trg on public.music_license_offers;
create trigger music_license_guard_trg before insert or update on public.music_license_offers
for each row execute function public.music_license_guard();

alter table public.music_creator_profiles enable row level security;
alter table public.music_license_offers enable row level security;
alter table public.music_rights_attestations enable row level security;

drop policy if exists music_creator_profiles_read on public.music_creator_profiles;
create policy music_creator_profiles_read on public.music_creator_profiles for select to anon,authenticated
using (status='active' or m_uid=public.current_m_uid());
drop policy if exists music_creator_profiles_insert on public.music_creator_profiles;
create policy music_creator_profiles_insert on public.music_creator_profiles for insert to authenticated
with check (m_uid=public.current_m_uid());
drop policy if exists music_creator_profiles_update on public.music_creator_profiles;
create policy music_creator_profiles_update on public.music_creator_profiles for update to authenticated
using (m_uid=public.current_m_uid()) with check (m_uid=public.current_m_uid());

drop policy if exists ct_read on public.creator_tracks;
drop policy if exists ct_write on public.creator_tracks;
drop policy if exists ct_edit on public.creator_tracks;
drop policy if exists ct_pull on public.creator_tracks;
drop policy if exists music_creator_tracks_read on public.creator_tracks;
create policy music_creator_tracks_read on public.creator_tracks for select to anon,authenticated
using (status='published' or m_uid=public.current_m_uid());
drop policy if exists music_creator_tracks_insert on public.creator_tracks;
create policy music_creator_tracks_insert on public.creator_tracks for insert to authenticated
with check (m_uid=public.current_m_uid() and uid=auth.uid());
drop policy if exists music_creator_tracks_update on public.creator_tracks;
create policy music_creator_tracks_update on public.creator_tracks for update to authenticated
using (m_uid=public.current_m_uid()) with check (m_uid=public.current_m_uid());
drop policy if exists music_creator_tracks_delete on public.creator_tracks;
create policy music_creator_tracks_delete on public.creator_tracks for delete to authenticated
using (m_uid=public.current_m_uid() and status in ('draft','rejected','archived'));

create policy music_license_offers_read on public.music_license_offers for select to anon,authenticated
using (active=true or creator_m_uid=public.current_m_uid());
create policy music_license_offers_insert on public.music_license_offers for insert to authenticated
with check (creator_m_uid=public.current_m_uid());
create policy music_license_offers_update on public.music_license_offers for update to authenticated
using (creator_m_uid=public.current_m_uid()) with check (creator_m_uid=public.current_m_uid());
create policy music_license_offers_delete on public.music_license_offers for delete to authenticated
using (creator_m_uid=public.current_m_uid() and active=false);

create policy music_rights_attestations_read on public.music_rights_attestations for select to authenticated
using (creator_m_uid=public.current_m_uid());
create policy music_rights_attestations_insert on public.music_rights_attestations for insert to authenticated
with check (creator_m_uid=public.current_m_uid() and exists (
  select 1 from public.creator_tracks t where t.id=track_id and t.m_uid=public.current_m_uid()
));

revoke all on public.music_creator_profiles,public.music_license_offers,public.music_rights_attestations from public;
grant select on public.music_creator_profiles to anon,authenticated;
grant insert,update on public.music_creator_profiles to authenticated;
grant select on public.creator_tracks to anon,authenticated;
grant insert,update,delete on public.creator_tracks to authenticated;
grant select on public.music_license_offers to anon,authenticated;
grant insert,update,delete on public.music_license_offers to authenticated;
grant select,insert on public.music_rights_attestations to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
 ('creator-previews','creator-previews',true,52428800,array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav']),
 ('creator-masters','creator-masters',false,524288000,array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/flac']),
 ('creator-artwork','creator-artwork',true,20971520,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "creator previews are public" on storage.objects;
create policy "creator previews are public" on storage.objects for select to anon,authenticated
using (bucket_id='creator-previews');
drop policy if exists "creator artwork is public" on storage.objects;
create policy "creator artwork is public" on storage.objects for select to anon,authenticated
using (bucket_id='creator-artwork');
drop policy if exists "creator owns uploaded music objects" on storage.objects;
create policy "creator owns uploaded music objects" on storage.objects for insert to authenticated
with check (bucket_id in ('creator-previews','creator-masters','creator-artwork') and (storage.foldername(name))[1]=auth.uid()::text);
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

update storage.buckets set file_size_limit=52428800,
  allowed_mime_types=array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','image/jpeg','image/png','image/webp']
where id='cuts';