-- Equity Uprise shared-platform support-only: Core compute completion evidence.
-- This internal receipt store does not define building capabilities or policy.
-- PENDING ONLY. Owner review, isolated SQL proof and explicit migration approval
-- are required before applying this to canonical Supabase. No ledger entry here.
--
-- Device job contract (docs/control-plane/DEVICE-JOBS-CONTRACT.md): the node's
-- own Ed25519 signature over its completion request, recorded by the Core
-- compute gateway after compute_complete_lease accepted the result. One row per
-- lease; the first accepted completion wins and a replayed completion does not
-- overwrite it. The signed body is never stored (it carries the lease token):
-- only its digest, the public signature fields and the canonical SHA-256 of the
-- committed result. Reuses ops_compute_leases/tasks/nodes; adds no RPC.
-- Rollback: compute_job_attestations_v1.rollback.sql. Order and proof:
-- supabase/pending/PROMOTION-ORDER.md section 11. Native role, signed-receipt,
-- concurrent rollback and re-apply proof: scripts/compute-device-native-check.mjs.
-- --from-reset exercises the actual rebuilt schema without base-table stubs.
-- The end-to-end gateway/agent proof is scripts/staging/device-jobs/run.mjs.
create table if not exists public.ops_compute_attestations (
  lease_id uuid primary key references public.ops_compute_leases(id) on delete cascade,
  task_id uuid not null references public.ops_compute_tasks(id) on delete cascade,
  node_id text not null references public.ops_compute_nodes(id) on delete cascade,
  attempt integer not null check (attempt > 0),
  protocol text not null check (protocol = 'mccluster-compute/1'),
  method text not null check (method = 'POST'),
  path text not null check (path ~ '^/v1/compute/leases/[0-9a-f-]{36}/complete$'),
  -- The node's timestamp header, byte for byte: the signature covers this
  -- exact string and a timestamptz would be re-rendered by PostgREST.
  -- (A generated timestamptz twin is deliberately absent: the text-to-timestamptz
  -- cast is not immutable. Query recorded_at for time ranges.)
  signed_at text not null check (length(signed_at) between 20 and 40 and signed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'),
  nonce text not null check (nonce ~ '^[0-9a-fA-F-]{16,80}$'),
  body_digest text not null check (body_digest ~ '^[A-Za-z0-9_-]{43}$'),
  signature text not null check (signature ~ '^[A-Za-z0-9_-]{86}$'),
  result_sha256 text not null check (result_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default now()
);

create index if not exists ops_compute_attestations_task_idx
  on public.ops_compute_attestations(task_id, recorded_at desc);
create index if not exists ops_compute_attestations_node_idx
  on public.ops_compute_attestations(node_id, recorded_at desc);

alter table public.ops_compute_attestations enable row level security;
-- Supabase's public-table default ACL also grants ALL to service_role. RLS
-- does not constrain that BYPASSRLS role: revoke its inherited UPDATE, DELETE,
-- TRUNCATE, REFERENCES and TRIGGER rights before granting the two operations
-- the completion recorder needs. Existing rows remain first accepted wins.
revoke all on public.ops_compute_attestations from public, anon, authenticated, service_role;
grant select, insert on public.ops_compute_attestations to service_role;
