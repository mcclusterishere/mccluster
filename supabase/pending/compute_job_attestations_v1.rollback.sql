-- Rollback for compute_job_attestations_v1. Drops only what that file created.
drop table if exists public.ops_compute_attestations;
