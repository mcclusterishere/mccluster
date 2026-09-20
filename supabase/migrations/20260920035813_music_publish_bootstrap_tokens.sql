-- Exact production migration 20260920035813.
-- One-time publication grant ledger used to bootstrap private owner masters.
-- The corresponding publisher Edge Function is disabled after publication.

create table if not exists public.music_publish_tokens (
  token_hash text primary key,
  asset_slug text not null,
  variant text not null default 'full' check (variant in ('preview','full')),
  bucket_id text not null,
  object_path text not null,
  content_type text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.music_publish_tokens enable row level security;
revoke all on table public.music_publish_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.music_publish_tokens to service_role;

create or replace function public.consume_music_publish_token(p_token_hash text)
returns table(asset_slug text, variant text, bucket_id text, object_path text, content_type text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.music_publish_tokens
     set used_at = now()
   where token_hash = p_token_hash
     and used_at is null
     and expires_at > now()
  returning music_publish_tokens.asset_slug,
            music_publish_tokens.variant,
            music_publish_tokens.bucket_id,
            music_publish_tokens.object_path,
            music_publish_tokens.content_type;
$$;

revoke all on function public.consume_music_publish_token(text) from public, anon, authenticated;
grant execute on function public.consume_music_publish_token(text) to service_role;
