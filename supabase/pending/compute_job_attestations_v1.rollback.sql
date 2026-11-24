-- Equity Uprise shared-platform support-only: preserve Core compute evidence
-- when undoing an unused installation; no building capability is owned here.
-- PENDING ONLY. Explicit per-file approval is required before production use.
-- Empty-install rollback only. Signed completion evidence must survive an
-- application rollback; a populated table requires a reviewed forward repair.
-- One atomic block locks before checking so a concurrent completion cannot be
-- committed between the empty check and DROP. READ COMMITTED is required so
-- the post-lock check sees an in-flight writer that committed while we waited.
do $rollback$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'attestation rollback requires READ COMMITTED; an old snapshot cannot prove the table is empty'
      using errcode = '55000';
  end if;
  perform set_config('lock_timeout', '5s', true);
  if to_regclass('public.ops_compute_attestations') is not null then
    lock table public.ops_compute_attestations in access exclusive mode;
    if exists (select 1 from public.ops_compute_attestations) then
      raise exception 'attestation rollback refused: signed completion evidence exists; preserve it and prepare a reviewed forward repair'
        using errcode = '55000';
    end if;
    drop table public.ops_compute_attestations;
  end if;
end
$rollback$;
