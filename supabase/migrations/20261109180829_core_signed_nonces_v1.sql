-- Shared replay store for Core-signed mutating requests to Worker `mccluster`
-- (workers/mccluster/src/media/core-signature.js, createSupabaseReplayStore).
-- Audit 2026-11-09 finding C5: the per-isolate nonce cache let two isolates
-- accept one captured signed mutation. A unique insert here is the atomic
-- claim. Service-role only; no authenticated or anon grant.
-- Activation: apply this, then set CORE_REPLAY_STORE = "supabase" in
-- workers/mccluster/wrangler.toml [vars]. Until then mutating Core-signed
-- calls answer 503 (fail closed); Core-signed World reads are unaffected.
create table if not exists public.core_signed_nonces (
  nonce text primary key,
  expires_at timestamptz not null,
  claimed_at timestamptz not null default now()
);
create index if not exists core_signed_nonces_expires_at_idx on public.core_signed_nonces (expires_at);
alter table public.core_signed_nonces enable row level security;
revoke all on public.core_signed_nonces from anon, authenticated;
comment on table public.core_signed_nonces is
  'Atomic replay claims for Core-signed mutating Worker requests; rows past expires_at may be swept.';
