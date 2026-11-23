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
create table if not exists public.ops_compute_attestations (
  lease_id uuid primary key references public.ops_compute_leases(id) on delete cascade,
  task_id uuid not null references public.ops_compute_tasks(id) on delete cascade,
  node_id text not null references public.ops_compute_nodes(id) on delete cascade,
  attempt integer not null check (attempt > 0),
  protocol text not null check (protocol = 'mccluster-compute/1'),
  method text not null check (method = 'POST'),
  path text not null check (path ~ '^/v1/compute/leases/[0-9a-f-]{36}/complete$'),
  signed_at timestamptz not null,
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
revoke all on public.ops_compute_attestations from public, anon, authenticated;
grant select, insert on public.ops_compute_attestations to service_role;
