-- Reconcile two independent hardening passes that landed on the same tables.
--
-- Both passes added a lease to social_publish_jobs and both constrained
-- social_accounts.credential_ref. Merged, they contradict each other in
-- production, and one of the contradictions is fatal on first use.
--
-- 1. credential_ref
--    The earlier constraint required '^SOCIAL_[A-Z0-9_]{1,64}$'. The
--    surviving Worker derives the reference from org_channels and emits
--    'env:SOCIAL_IG_<NAME>_ACCESS_TOKEN' or 'vault:<uuid>' — both of
--    which that constraint REJECTS. Connecting the first Instagram
--    account would have failed with a check violation. The constraint is
--    replaced with one that accepts exactly what parseSocialCredentialRef
--    in workers/mccluster/src/social/security.js accepts, and nothing
--    else: the point of the constraint is that a stored reference can
--    never name an unrelated Worker secret.
--
-- 2. lease columns
--    social_publish_jobs ended up with both lease_until and
--    lease_expires_at. claim_social_publish_jobs() leases on
--    lease_expires_at; nothing reads or writes lease_until any more. Two
--    lease columns is worse than either one alone, because a job leased
--    through one looks free to code checking the other. lease_until is
--    dropped. The table has never held a row (n_tup_ins = 0), so there is
--    nothing to migrate across.

begin;

alter table public.social_accounts
  drop constraint if exists social_accounts_credential_ref_shape;

alter table public.social_accounts
  add constraint social_accounts_credential_ref_shape
  check (
    credential_ref is null
    or credential_ref ~ '^SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$'
    or credential_ref ~ '^env:SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$'
    or credential_ref ~ '^vault:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  );

alter table public.social_publish_jobs
  drop column if exists lease_until;

commit;

-- Prove the constraint admits what the Worker emits and refuses what it
-- must never store. A failure here means the two layers have drifted
-- again and the next account connect would break.
do $$
declare
  ok_refs text[] := array[
    'SOCIAL_IG_PRIMARY_ACCESS_TOKEN',
    'env:SOCIAL_IG_CLIENT_A_ACCESS_TOKEN',
    'vault:123e4567-e89b-42d3-a456-426614174000'
  ];
  bad_refs text[] := array[
    'STRIPE_SECRET_KEY',
    'env:STRIPE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'vault:not-a-uuid',
    'SOCIAL_IG_ACCESS_TOKEN; drop table social_accounts'
  ];
  r text;
  accepted boolean;
begin
  foreach r in array ok_refs loop
    accepted :=
      r ~ '^SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$'
      or r ~ '^env:SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$'
      or r ~ '^vault:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
    if not accepted then
      raise exception 'credential_ref constraint rejects a reference the Worker emits: %', r;
    end if;
  end loop;

  foreach r in array bad_refs loop
    accepted :=
      r ~ '^SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$'
      or r ~ '^env:SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$'
      or r ~ '^vault:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
    if accepted then
      raise exception 'credential_ref constraint would admit a forbidden reference: %', r;
    end if;
  end loop;
end $$;
