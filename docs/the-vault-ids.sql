-- ============================================================
-- THE VAULT, PART II — every identifier system, on the row.
-- Run AFTER docs/the-vault.sql. Safe to re-run.
--
-- Nothing is skipped. Photos, films and every capture in between get
-- a slot for each identifier that actually exists in the world:
--
--   catalog_id   ours, issued at ingest        (already present)
--   copyright_*  US Copyright Office group registration — the one with teeth
--   plus_id      PLUS Registry licensor id — who to ask for a licence
--   c2pa_*       Content Credentials — cryptographic proof of capture
--   iscc         ISO 24138 content-derived code, free, no registry
--   isan         the audiovisual ISBN — FILMS ONLY, per-work fee
--   eidr         the distribution registry — FILMS ONLY, membership
--
-- The two film registries are here because you said don't skip anything,
-- and they are genuinely the right answer for a long-form cut that goes
-- into distribution. They are the WRONG answer for a still frame — no
-- registry will issue an ISAN or EIDR for a photograph, which is why the
-- columns are gated by kind in the check below rather than left to rot.
-- ============================================================

alter table public.vault_assets
  add column if not exists copyright_reg   text,      -- e.g. VA 2-345-678
  add column if not exists copyright_batch text,      -- which group filing carried it
  add column if not exists copyright_filed date,
  add column if not exists plus_id         text,      -- PLUS licensor id (the corp's)
  add column if not exists c2pa_signed     boolean default false,
  add column if not exists c2pa_manifest   jsonb,     -- the claim read off the file
  add column if not exists iscc            text,      -- ISO 24138 content code
  add column if not exists isan            text,      -- films only
  add column if not exists eidr            text;      -- films only

-- A still cannot hold an ISAN or an EIDR. Rather than leave the columns
-- free to be filled with nonsense, the database refuses it.
alter table public.vault_assets drop constraint if exists vault_av_ids_are_av_only;
alter table public.vault_assets add constraint vault_av_ids_are_av_only
  check (
    (isan is null and eidr is null)
    or kind in ('video','audio')
  );

create index if not exists vault_assets_copyright on public.vault_assets (copyright_batch);
create index if not exists vault_assets_c2pa on public.vault_assets (c2pa_signed);

-- ---------- the filings ledger: one row per registration event ----------
-- A group copyright registration covers up to 750 photos in one filing.
-- This is that filing, so you can answer "is this frame registered, and
-- under what number" in one join instead of hunting through email.
create table if not exists public.vault_filings (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'copyright-group'
               check (kind in ('copyright-group','copyright-single','isan','eidr','plus','other')),
  reference    text,                      -- registration / service request number
  title        text,                      -- "McCluster Corp — 2026 Q3 photographs"
  filed_at     date,
  effective_at date,                      -- the date damages run from
  fee          numeric,
  asset_count  int,
  status       text not null default 'draft'
               check (status in ('draft','submitted','registered','refused')),
  receipt_url  text,                      -- the certificate, in Storage
  notes        text,
  created_at   timestamptz default now()
);
alter table public.vault_filings enable row level security;
drop policy if exists vault_owner_all on public.vault_filings;
create policy vault_owner_all on public.vault_filings for all
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

-- ---------- the house's own identifier block ----------
-- One row. Everything the pipeline stamps into a file comes from here, so
-- a new ISNI or a PLUS id is typed once and every future capture carries it.
create table if not exists public.vault_house (
  id           int primary key default 1 check (id = 1),
  legal_name   text default 'McCluster Corp',
  creator_name text default 'Matthew McCluster',
  isni_person  text default '0000000529563111',
  isni_corp    text default '0000000528727276',
  plus_id      text,                      -- fill after PLUS supporting membership
  eidr_party   text,                      -- fill if EIDR membership is taken
  isan_registrant text,                   -- fill if an ISAN agency account is opened
  isrc_prefix  text default 'QT6KV',
  dpid         text default 'PA-DPIDA-2025101205-D',
  ein          text default '394466255',
  web          text default 'https://matthew.mccluster.org/',
  rights_stmt  text default 'All rights reserved. Licensing: matthew@mccluster.org',
  updated_at   timestamptz default now()
);
alter table public.vault_house enable row level security;
drop policy if exists vault_owner_all on public.vault_house;
create policy vault_owner_all on public.vault_house for all
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');
insert into public.vault_house (id) values (1) on conflict (id) do nothing;

-- ---------- distribution targets: what each lane can actually do ----------
-- Honest capability map, in the database, so the desk never offers a
-- one-tap push to a platform that has no upload API.
create table if not exists public.vault_targets (
  id           text primary key,
  label        text not null,
  takes        text not null,             -- 'photo', 'video', 'both'
  rail         text not null              -- how it can be automated, truthfully
               check (rail in ('api','sftp','ftp','portal-only','manual')),
  auto_ready   boolean default false,     -- flips true when we've wired it
  needs        text,                      -- what the owner must set up first
  notes        text
);
alter table public.vault_targets enable row level security;
drop policy if exists vault_owner_all on public.vault_targets;
create policy vault_owner_all on public.vault_targets for all
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

insert into public.vault_targets (id, label, takes, rail, needs, notes) values
  ('youtube',      'YouTube',            'video', 'api',
    'Google Cloud project + OAuth, YouTube Data API v3',
    'Real upload API. VIDEO ONLY — a still can only go up as a Short/slideshow render, which is a different product.'),
  ('instagram',    'Instagram',          'both',  'api',
    'Instagram Professional account + linked Facebook Page + Meta app with instagram_content_publish, App Review 2-4 weeks',
    'Two-step publish: create media container, then publish. Photos, carousels, Reels, Stories. No per-call fee. Rate-limited per rolling window.'),
  ('facebook',     'Facebook Page',      'both',  'api',
    'Same Meta app as Instagram',
    'Same review, same app — comes almost free once Instagram is approved.'),
  ('tiktok',       'TikTok',             'both',  'api',
    'TikTok for Developers app + Content Posting API audit',
    'Photo posts supported alongside video. Audit required before direct-post leaves sandbox.'),
  ('flickr',       'Flickr Pro',         'photo', 'api',
    'Flickr API key',
    'Oldest, friendliest photo upload API. Good archive mirror and it indexes well.'),
  ('smugmug',      'SmugMug',            'photo', 'api',
    'SmugMug account + API key',
    'Full upload API with galleries and client-proofing built in — the natural client-delivery lane.'),
  ('adobe-stock',  'Adobe Stock',        'both',  'sftp',
    'Adobe Stock Contributor account',
    'Contributor portal accepts bulk SFTP upload; metadata rides in the file IPTC — which the Vault already stamps.'),
  ('alamy',        'Alamy',              'both',  'ftp',
    'Alamy contributor account',
    'FTP bulk upload, then metadata in their portal. Higher royalty share than most.'),
  ('getty',        'Getty / iStock',     'both',  'portal-only',
    'Getty contributor approval (application, portfolio review)',
    'No public upload API for individual contributors — ESP portal only. Prep here, upload by hand.'),
  ('shutterstock', 'Shutterstock',       'both',  'ftp',
    'Shutterstock contributor account',
    'FTP upload supported for contributors.'),
  ('client',       'Client delivery',    'both',  'api',
    'nothing — this is our own Storage',
    'Stamped previews already live in the vault bucket; a per-event share link is the deliverable.'),
  ('press',        'Press / editorial',  'both',  'manual',
    'nothing',
    'Emailed with the caption, credit and catalog id. Logged here so the ledger stays complete.')
on conflict (id) do nothing;

select 'vault ids ready' as status,
  (select count(*) from public.vault_targets) as targets,
  (select count(*) from public.vault_filings) as filings;
