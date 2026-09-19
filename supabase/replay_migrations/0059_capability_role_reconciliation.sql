-- ============================================================
-- THE CAPABILITY TABLE AND THE MEMBERSHIP TABLE DISAGREED
--
-- `control_capabilities` (16 rows) and `control_role_capabilities`
-- (47 rows) are the best-designed thing in this schema: a named,
-- risk-graded vocabulary of privileged acts, and an explicit grant
-- matrix mapping roles onto it. Nothing has ever read either table.
-- `control_commands`, `control_approvals`, `control_leases` and
-- `control_audit` are all empty.
--
-- Before anything could start reading them, one thing had to be fixed:
-- the two tables do not speak the same role vocabulary.
--
--   org_members.role   CHECK (role IN ('owner','staff','viewer'))
--   control_role_capabilities.role  contains owner, admin, staff, member
--
-- So `viewer` — a role the system can actually issue, and the default
-- for anyone invited without elevation — had **zero** grants, while
-- `admin` and `member` had 21 grants between them and can never appear
-- in org_members at all.
--
-- Joining membership to capabilities without noticing this would have
-- silently locked every viewer out of everything, including the reads
-- they are supposed to have. It would have looked like a permissions
-- bug in a hundred places, and the cause would have been one word.
--
-- This migration reconciles toward the vocabulary that is REAL: the one
-- the CHECK constraint permits and the one org_members actually holds.
-- It is additive. No grant is removed, so nothing that would have been
-- allowed before becomes forbidden.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `viewer` is the org_members name for what the grant matrix
--    calls `member`. Give it the same five read capabilities.
--
--    Copied from the `member` rows rather than retyped, so the two
--    cannot drift: if someone later grants `member` something new and
--    re-runs this, viewer follows. Deliberately only mirrors ALLOWED
--    rows — an explicit deny should be written deliberately, not
--    inherited by a copy statement.
-- ------------------------------------------------------------
insert into public.control_role_capabilities (role, capability, allowed)
select 'viewer', capability, true
  from public.control_role_capabilities
 where role = 'member' and allowed
on conflict (role, capability) do nothing;

-- ------------------------------------------------------------
-- 2. `admin` and `member` stay exactly as they are.
--
--    They are unreachable today: org_members' CHECK constraint cannot
--    produce either. They are NOT deleted, because deleting a grant is
--    the kind of change that looks harmless and turns out not to be,
--    and because `admin` may reflect an intent recorded elsewhere.
--
--    They are also not made reachable. Widening the CHECK to admit
--    `admin` would create a second role holding all sixteen
--    capabilities — identical to `owner` — which is two names for one
--    thing and the beginning of a permissions system nobody can reason
--    about. If an admin tier is genuinely wanted, it should be defined
--    by what it may NOT do, and that is a decision, not a migration.
--
--    Recorded here so the next person reading this table knows the
--    dead rows are deliberate.
-- ------------------------------------------------------------
comment on table public.control_role_capabilities is
  'Grant matrix: which org role holds which capability. Roles that '
  'org_members can actually issue are owner, staff, viewer. The admin '
  'and member rows are historical and currently unreachable — see '
  '0059_capability_role_reconciliation.sql. Read by '
  'supabase/functions/_shared/authz.ts.';

comment on table public.control_capabilities is
  'The vocabulary of privileged acts, graded by risk. A capability is '
  'named here before anything may require it. Read by '
  'supabase/functions/_shared/authz.ts.';

comment on table public.control_audit is
  'Every authorization decision — allow and deny both. Written by '
  'supabase/functions/_shared/authz.ts on every privileged call. A '
  'deny is as much a fact worth keeping as an allow.';

-- ------------------------------------------------------------
-- 3. Two capabilities the vocabulary was missing.
--
--    `ops-chat` is a privileged surface — it can drive the other
--    functions — and `ops.use` covers it. But the outreach `stats`
--    read and the social `channels` read had no capability naming
--    them, and campaign.read/social.read cover those exactly. So
--    nothing new is needed there.
--
--    What IS missing is a name for reading the CRM: the inquiry and
--    lead surface that /v1/inquiries writes into. Named now so that
--    when something starts guarding it, the word already exists.
-- ------------------------------------------------------------
insert into public.control_capabilities (capability, description, risk)
values
  ('crm.read',  'Read leads, inquiries and inbox conversations for an org', 'low'),
  ('crm.write', 'Change lead state, reply to an inquiry, edit contacts',    'medium')
on conflict (capability) do nothing;

insert into public.control_role_capabilities (role, capability, allowed)
values
  ('owner',  'crm.read',  true),
  ('owner',  'crm.write', true),
  ('staff',  'crm.read',  true),
  ('staff',  'crm.write', true),
  ('viewer', 'crm.read',  true)
on conflict (role, capability) do nothing;

-- ------------------------------------------------------------
-- 4. Verify the thing this migration exists to guarantee: every role
--    org_members can issue resolves to at least one capability.
--
--    Raises rather than warns. A migration that silently leaves the
--    original bug in place is worse than one that refuses to finish.
-- ------------------------------------------------------------
do $$
declare
  starved text;
begin
  select string_agg(r, ', ')
    into starved
    from unnest(array['owner', 'staff', 'viewer']) as r
   where not exists (
     select 1 from public.control_role_capabilities c
      where c.role = r and c.allowed
   );

  if starved is not null then
    raise exception
      'Role(s) % can be issued by org_members but hold no capability. '
      'Authorization would refuse them everything.', starved;
  end if;
end $$;
