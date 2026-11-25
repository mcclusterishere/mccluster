-- Stems v1: every instrument of a track, kept private.
--
-- PENDING: apply after McCluster Core is deployed with the stems_separate
-- executor. Rollback: 20261031190000_music_stem_sets_v1.rollback.sql
--
-- The audio lives in the existing private bucket mcc-gated-audio under
-- stems/<track_key>/<stem>.<ext> (no bucket or storage-policy change: the bucket
-- is already private and only the service role signs URLs for it, see
-- 20260928012324_music_listen_gate.sql). This table is the manifest: which
-- model made them, the stems, sizes, hashes and levels. No browser role reads
-- it; the owner sees it through music-access (operator-stems-list), which checks
-- the house operator and signs short-lived URLs.

create table if not exists public.music_stem_sets (
  track_key text primary key
    check (track_key ~ '^([a-z0-9][a-z0-9-]{0,79}|ct-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'),
  source text not null check (source in ('shelf', 'creator')),
  creator_track_id uuid references public.creator_tracks(id) on delete cascade,
  separator text not null check (separator = 'demucs'),
  model text not null check (model in ('htdemucs_6s', 'htdemucs', 'htdemucs_ft', 'mdx_extra')),
  format text not null check (format in ('mp3', 'flac', 'wav')),
  seconds numeric not null check (seconds > 0),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and jsonb_typeof(manifest->'stems') = 'array'),
  status text not null default 'ready' check (status in ('ready', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source = 'creator') = (creator_track_id is not null))
);
comment on table public.music_stem_sets is
  'Private stem manifests (Demucs) for shelf tracks and creator uploads; audio in mcc-gated-audio/stems/<track_key>/. Service role only.';

alter table public.music_stem_sets enable row level security;
revoke all on public.music_stem_sets from public, anon, authenticated;
grant all on public.music_stem_sets to service_role;
