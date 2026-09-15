-- Reconstruct the legacy backend-only migration ledger for clean source replay.
-- Production already contains this table; later hardening migrations lock it down.

create table if not exists public._migrations (
  name text primary key,
  at timestamptz not null default now()
);
