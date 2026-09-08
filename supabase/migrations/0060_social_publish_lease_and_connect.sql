-- ============================================================
-- STOP THE SOCIAL ENGINE POSTING TWICE, AND NAME WHO MAY CONNECT
--
-- Two P0s from the social audit, in the part that has to live in the
-- database rather than the Worker.
--
-- Context that matters for reading this: every social_* table has
-- n_tup_ins = 0. Not "empty right now" — no row has ever been inserted
-- into any of them. Nothing here is a migration of live data; it is
-- putting the guard rails up before the first client arrives.
-- ============================================================


-- ------------------------------------------------------------
-- 1. A LEASE, SO TWO CRON RUNS CANNOT PUBLISH THE SAME REEL
--
-- The queue processor selects
--   state in ('queued','processing') and scheduled_at <= now()
-- and then, in a plain loop, calls Meta for each row.
--
-- There is no claim between the read and the call, and the selection
-- deliberately includes 'processing' — the state set after a media
-- container is created and before media_publish is called. So two
-- overlapping invocations do not merely race for a queued job: the
-- second one re-selects a job the first is *currently* publishing and
-- calls media_publish on the same container again.
--
-- `dedupe_key` does not help. It is unique on OUR table; it says
-- nothing about how many times we called Instagram.
--
-- The fix is a lease the claimer takes atomically. `UPDATE ... WHERE id
-- = $1 AND (lease_until IS NULL OR lease_until < now())` is a genuine
-- compare-and-swap in Postgres: a concurrent updater blocks on the row
-- lock, then re-evaluates the predicate against the committed new
-- version, fails to match, and updates zero rows. Zero rows back means
-- somebody else owns this job — skip it.
--
-- The lease EXPIRES rather than being released, because the failure
-- this has to survive is a Worker that dies mid-publish. A released
-- lock would strand the job forever; an expiring one is picked up by
-- the next run after the window.
-- ------------------------------------------------------------
alter table public.social_publish_jobs
  add column if not exists lease_owner text,
  add column if not exists lease_until timestamptz;

comment on column public.social_publish_jobs.lease_owner is
  'Opaque id of the Worker invocation currently publishing this job. '
  'Informational — the lease is enforced by lease_until, not by this.';

comment on column public.social_publish_jobs.lease_until is
  'A job may only be touched by a claimer that atomically set this to a '
  'future time. Expires rather than releases, so a Worker that dies '
  'mid-publish does not strand the job. See '
  '0060_social_publish_lease_and_connect.sql.';

-- The claim query orders by scheduled_at over unleased rows, so index
-- exactly that. Partial: leased rows are the ones we never want back.
create index if not exists social_publish_jobs_claimable_idx
  on public.social_publish_jobs (scheduled_at asc)
  where state in ('queued', 'processing');


-- ------------------------------------------------------------
-- 2. CREDENTIAL_REF IS A SECRET SELECTOR, SO CONSTRAIN IT
--
-- social_accounts.credential_ref holds the NAME of a Cloudflare Worker
-- secret; the Worker resolves it with `env[credential_ref]`. Storing
-- the binding name rather than the token is the right call.
--
-- But the create-account endpoint takes credential_ref straight from
-- the request body, and `env[ref]` is an unrestricted dynamic lookup.
-- Combined with the missing role check in the Worker, any member of any
-- org could bind any Worker secret — STRIPE_SECRET_KEY, the service
-- role key, anything — to a social account they control.
--
-- The value is only ever sent to graph.facebook.com as a bearer token,
-- so it is not directly readable by the caller today. That is a
-- property of the current code, not a guarantee: it becomes
-- exfiltration the moment any path logs the token, echoes it in an
-- error, or takes a caller-influenced host.
--
-- A prefix is the whole defence, and it is a good one: secrets that are
-- meant to be selectable this way are named for it, and nothing else in
-- the environment can be reached. Enforced here AND in the Worker,
-- because a constraint the application also checks is one that fails
-- early with a good message and late with a guarantee.
-- ------------------------------------------------------------
alter table public.social_accounts
  drop constraint if exists social_accounts_credential_ref_shape;

alter table public.social_accounts
  add constraint social_accounts_credential_ref_shape
  check (
    credential_ref is null
    or credential_ref ~ '^SOCIAL_[A-Z0-9_]{1,64}$'
  );

comment on column public.social_accounts.credential_ref is
  'NAME of a Worker secret binding, never a token. Must match '
  'SOCIAL_[A-Z0-9_]{1,64} so it can only select secrets deliberately '
  'named for this purpose — the Worker resolves it with env[ref].';


-- ------------------------------------------------------------
-- 3. A NAME FOR "MAY ATTACH THIS ORG'S SOCIAL IDENTITY"
--
-- The Worker had no role check at all, so everything below is new
-- ground. Publishing already has `social.publish`; queueing has
-- `social.queue`. Connecting an account is neither: it is the act of
-- binding a credential and an external identity to the org, and it is
-- strictly more dangerous than posting once — whoever does it decides
-- which account everything afterwards speaks as.
--
-- So it gets its own high-risk name rather than being folded into
-- publish. Owner only.
-- ------------------------------------------------------------
insert into public.control_capabilities (capability, description, risk)
values ('social.connect',
        'Attach or detach a social account and its credential for an org',
        'high')
on conflict (capability) do nothing;

insert into public.control_role_capabilities (role, capability, allowed)
values ('owner', 'social.connect', true)
on conflict (role, capability) do nothing;


-- ------------------------------------------------------------
-- 4. Verify the two invariants this migration exists to create.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'social_publish_jobs'
       and column_name = 'lease_until'
  ) then
    raise exception 'lease_until missing; the publish queue would still be able to double-post';
  end if;

  if not exists (
    select 1 from public.control_role_capabilities
     where capability = 'social.connect' and allowed
  ) then
    raise exception 'social.connect exists but no role holds it; connecting an account would be impossible for everyone';
  end if;
end $$;
