-- ============================================================
-- THE VAULT — the catalog of record for every frame the house shoots.
-- Paste this whole file into Supabase → SQL Editor → Run.
--
-- Design law:
--   · One row per capture. The database is the catalog of record;
--     Drive keeps the pristine camera originals; Storage holds the
--     web derivatives the pipeline makes.
--   · Gemini SUGGESTS, the owner CONFIRMS. Machine identification of a
--     person is never a fact until a human signs it — that is both the
--     accuracy posture and the privacy posture.
--   · Rights are rows, not vibes. A face without a release is a flag
--     the desk can see before anything goes on sale.
--   · RLS: the public can read nothing. Only the owner's JWT reads or
--     writes. The ingest runner uses the service key, which bypasses
--     RLS by design and lives only in GitHub Secrets.
-- ============================================================

-- ---------- the people the camera knows ----------
create table if not exists public.vault_people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  aka         text,                          -- handle / stage name
  role        text,                          -- client, official, member, family, crew…
  org         text,                          -- who they belong to (chapter, county…)
  reference_url text,                        -- a face the pipeline can show Gemini
  is_minor    boolean default false,         -- flips the release bar higher
  notes       text,
  created_at  timestamptz default now()
);

-- ---------- one row per capture ----------
create table if not exists public.vault_assets (
  id          uuid primary key default gen_random_uuid(),
  catalog_id  text unique not null,          -- MCC-20260611-CANDLER-0001
  sha256      text unique not null,          -- the file's fingerprint — dupes bounce here
  kind        text not null check (kind in ('photo','raw','video','audio','file')),
  event_id    text,                          -- joins data/gallery.json events
  batch_id    text,                          -- which intake batch brought it in
  master_ref  text,                          -- Drive file id — where the original lives
  master_name text,                          -- original filename off the camera
  bytes       bigint,
  width       int,
  height      int,
  duration_s  numeric,                       -- video/audio only
  preview_url text,                          -- web derivative in Storage
  thumb_url   text,
  -- what the camera wrote (exiftool, verbatim where it matters)
  shot_at     timestamptz,
  camera      text,
  lens        text,
  iso         int,
  aperture    text,
  shutter     text,
  gps_lat     numeric,
  gps_lon     numeric,
  exif        jsonb,                         -- the full dump, nothing thrown away
  -- what the machine thinks (never fact until confirmed)
  ai          jsonb,                         -- {caption, scene, people:[{description,guess}], text_visible, quality}
  ai_model    text,
  -- what the house says
  title       text,
  caption     text,
  tags        text[] default '{}',
  status      text not null default 'new'
              check (status in ('new','reviewed','published','archived','killed')),
  -- rights, on the row
  rights_owner   text default 'Matthew McCluster / McCluster Corp',
  license        text default 'all-rights-reserved',
  sellable       boolean default false,     -- the desk flips this, never the machine
  release_clear  boolean default false,     -- true only when every confirmed face is released
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists vault_assets_event on public.vault_assets (event_id);
create index if not exists vault_assets_shot  on public.vault_assets (shot_at);
create index if not exists vault_assets_status on public.vault_assets (status);

-- ---------- who is in what (confirmed by a human) ----------
create table if not exists public.vault_faces (
  asset_id    uuid references public.vault_assets(id) on delete cascade,
  person_id   uuid references public.vault_people(id) on delete cascade,
  source      text not null default 'owner' check (source in ('owner','ai-confirmed')),
  confirmed_at timestamptz default now(),
  primary key (asset_id, person_id)
);

-- ---------- releases: the paper behind a face ----------
create table if not exists public.vault_releases (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid references public.vault_people(id) on delete cascade,
  event_id    text,                          -- blank = blanket release
  kind        text not null default 'model' check (kind in ('model','property','minor-guardian')),
  status      text not null default 'none'
              check (status in ('none','verbal','signed','declined','expired')),
  signed_at   date,
  doc_url     text,                          -- scan of the paper, in Storage
  covers_commercial boolean default false,   -- editorial use ≠ selling prints
  notes       text,
  created_at  timestamptz default now()
);
create index if not exists vault_releases_person on public.vault_releases (person_id);

-- ---------- where a frame went (distribution ledger) ----------
create table if not exists public.vault_pushes (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid references public.vault_assets(id) on delete cascade,
  target      text not null,                 -- instagram, youtube, client-delivery, adobe-stock, getty, press…
  target_ref  text,                          -- the URL or submission id out there
  license     text,                          -- what terms it went out under
  fee         numeric,                       -- what it earned, when it earns
  pushed_at   timestamptz default now(),
  notes       text
);
create index if not exists vault_pushes_asset on public.vault_pushes (asset_id);

-- ---------- RLS: owner only, everywhere ----------
alter table public.vault_people   enable row level security;
alter table public.vault_assets   enable row level security;
alter table public.vault_faces    enable row level security;
alter table public.vault_releases enable row level security;
alter table public.vault_pushes   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['vault_people','vault_assets','vault_faces','vault_releases','vault_pushes'] loop
    execute format('drop policy if exists vault_owner_all on public.%I', t);
    execute format(
      'create policy vault_owner_all on public.%I for all
         using ((auth.jwt() ->> ''email'') = ''matthew@mccluster.org'')
         with check ((auth.jwt() ->> ''email'') = ''matthew@mccluster.org'')', t);
  end loop;
end $$;

-- ---------- storage: web derivatives ----------
insert into storage.buckets (id, name, public)
values ('vault', 'vault', true)
on conflict (id) do nothing;
-- public READ is intentional: these are the 1800px web derivatives the
-- gallery already publishes anyway. Writes are service-key only (no
-- authenticated/anon insert policy exists, so RLS denies them all).

-- ---------- self-check ----------
select 'vault ready' as status,
  (select count(*) from public.vault_assets)  as assets,
  (select count(*) from public.vault_people)  as people,
  (select count(*) from public.vault_releases) as releases;
