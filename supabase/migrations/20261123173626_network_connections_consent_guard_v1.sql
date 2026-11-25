-- NETWORK CONNECTIONS CONSENT GUARD V1 (pending; NOT applied in production)
--
-- Not applied. Apply only with Matthew's approval.
-- Order and procedure: supabase/pending/PROMOTION-ORDER.md, section 13. Rollback (owner approval too):
-- 20261119062110_network_connections_consent_guard_v1.rollback.sql.
--
-- THE HOLE
-- public.network_connections holds one row per pair of members: who asked (requester_m_uid), who was asked
-- (addressee_m_uid) and the answer (status pending, accepted, declined or cancelled). An accepted row is the other
-- member's consent, and two things trust it:
--   - public.mnet_open_direct (supabase/migrations/20260920071811_mnet_real_network_v1.sql:342-353): a direct
--     message to a member who takes messages from 'network' (the default; 119 of 120 profiles on 2026-11-19)
--     arrives as a conversation, not as a message request, when the pair is accepted;
--   - public.publish_antisocial_collaboration (supabase/migrations/20261015000455_antisocial_get_social_completion_v1.sql:298-302):
--     an accepted pair is its only partner check before it publishes a public post crediting both members.
-- Only the server is meant to write the table: request_connection, answer_connection and withdraw_connection
-- (20261015000455_antisocial_get_social_completion_v1.sql:25-33 and 64-171; js/mnet.js:3212 "written only by the
-- server"). Production also carries two policies that no migration in this repository created (recorded in
-- supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql:938-946) and grants INSERT, UPDATE
-- and DELETE to authenticated. So any member, with their own session, through the public REST API (a POST or PATCH
-- to /rest/v1/network_connections), can:
--   (a) insert a row naming anyone as addressee with status 'accepted' (network_connections_self_write checks only
--       requester_m_uid = current_m_uid());
--   (b) accept their own pending request (network_connections_self_update lets either member of a row change any
--       column of it);
--   (c) move a row to someone else: a new addressee (as its requester) or a new requester (as its addressee);
-- and then message that member as a connection and publish a "made together" post crediting someone who never
-- agreed. The credit path is latent today (the Anti-Social mission row is absent in production: 0 rows, and 0
-- collaboration posts, 2026-11-19); the message path is live.
--
-- EVIDENCE (production catalogs of the canonical project, read-only SELECT statements, 2026-11-19 between about 06:10
-- and 06:20 UTC; the session lead's read at about 06:05 UTC found the same policies and grants)
--   policies  network_connections_member_read  PERMISSIVE SELECT TO authenticated
--               USING ((requester_m_uid = current_m_uid()) OR (addressee_m_uid = current_m_uid()))
--             network_connections_self_update  PERMISSIVE UPDATE TO authenticated
--               USING ((requester_m_uid = current_m_uid()) OR (addressee_m_uid = current_m_uid()))
--               WITH CHECK ((requester_m_uid = current_m_uid()) OR (addressee_m_uid = current_m_uid()))
--             network_connections_self_write  PERMISSIVE INSERT TO authenticated
--               WITH CHECK (requester_m_uid = current_m_uid())
--   grants    {postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=arwdm/postgres,service_role=arwdDxtm/postgres}:
--             authenticated INSERT, SELECT, UPDATE, DELETE (and PostgreSQL 17's MAINTAIN); anon SELECT (and MAINTAIN).
--             No column grants. Owner postgres (not a superuser; it bypasses row level security); row level security
--             on, not forced. PostgreSQL 17.6.
--   nothing else writes it: no trigger, rule or view on the table; no other table's trigger function, rule, view or
--             policy and no cron job names it; pg_graphql is not installed; anon and authenticated are members of
--             no role.
--   writers   the only functions whose body writes the table are request_connection(uuid),
--             answer_connection(uuid, boolean) and withdraw_connection(uuid): SECURITY DEFINER, owned by postgres,
--             search_path '', EXECUTE for authenticated and service_role. Their production text (pg_get_functiondef)
--             equals the repository's. None lets a member accept a request they sent or create an accepted row in
--             one step: a row is inserted only as 'pending'; it turns 'accepted' only when its addressee answers
--             (answer_connection) or when the member who was asked asks back (request_connection); a declined row
--             asked again goes back to 'pending'; withdraw_connection only deletes. They are not changed here.
--   rows      2: one accepted, one pending. 0 accepted rows have created_at = updated_at (the one accepted row was
--             updated after it was created, and it has both the request notice and the accepted notice that only
--             those RPCs write: members have no insert policy on network_notifications). An accepted row with
--             created_at = updated_at would have been inserted as accepted, or patched without touching
--             updated_at, since every RPC that accepts sets updated_at = now() in a later transaction. The count
--             does not prove nothing was forged: an INSERT or a PATCH can set the timestamps too, and a forged row that
--             was later deleted leaves no trace here.
--   callers   js/mnet.js writes only through the RPCs (2705, 3231-3235) and reads through my_connections (4486); the
--             Worker reads the table with the service role (workers/mccluster/src/platform-api.js:652-655). Nothing in
--             js/, the root pages, workers/, supabase/functions/, core/ or native/ writes it with a member's token, so
--             nothing legitimate needs a member-role INSERT, UPDATE or DELETE.
--   ledger    376 rows (latest version 20261118035654) when this file was written.
--
-- WHAT IT CHANGES (one transaction, safe to run twice; run as postgres, the table's owner, as apply_migration does)
--   1. drops the policies network_connections_self_write and network_connections_self_update;
--   2. revokes INSERT, UPDATE and DELETE on public.network_connections from authenticated;
--   3. checks before it commits that neither anon nor authenticated can insert, update (any column), delete or
--      truncate the table, that no write policy for public, anon or authenticated is left on it, and that the three
--      writer RPCs exist, are SECURITY DEFINER and are owned by the table's owner (so they keep working without the
--      grants). If any of that does not hold it stops with SQLSTATE 55000 naming what is left, and nothing changes.
-- Kept as they are: network_connections_member_read and SELECT for authenticated (a member still reads their own
-- rows), anon's SELECT (no policy admits anon, so it reads no row; Matthew decides it, PROMOTION-ORDER section 13),
-- MAINTAIN (PostgreSQL 17; the Data API cannot use it), the service role, the RPCs and their grants, and every row.
--
-- CHECK AFTER APPLYING (read-only):
--   select (select string_agg(policyname || ' ' || cmd || ' ' || array_to_string(roles, ','), '; ' order by policyname)
--             from pg_policies where schemaname = 'public' and tablename = 'network_connections') as policies,
--          has_table_privilege('authenticated', 'public.network_connections', 'SELECT') as member_select,
--          has_any_column_privilege('authenticated', 'public.network_connections', 'INSERT') as member_insert,
--          has_any_column_privilege('authenticated', 'public.network_connections', 'UPDATE') as member_update,
--          has_table_privilege('authenticated', 'public.network_connections', 'DELETE') as member_delete,
--          (select relacl::text from pg_class where oid = 'public.network_connections'::regclass) as acl;
--   Expected: policies 'network_connections_member_read SELECT authenticated'; member_select true; member_insert,
--   member_update and member_delete false; acl
--   '{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=rm/postgres,service_role=arwdDxtm/postgres}'.
--   Before it (2026-11-19) the same query answers the three policies, true, true, true, true and authenticated=arwdm.
--   A member's POST or PATCH to /rest/v1/network_connections then answers 403 (42501, permission denied for table
--   network_connections), and so does a DELETE; Connect, Accept, Decline, Withdraw and End in the World keep working
--   (they call the RPCs).
--
-- PROOF (never production): scripts/test/network-connections-consent.integration.mjs (PGlite 0.3.14),
-- scripts/test/network-connections-consent.native.integration.mjs (PostgreSQL 16.15 and 17.7),
-- scripts/test/network-connections-consent-sql.test.mjs (root suite) and
-- scripts/test/network-connections-consent.mutants.mjs (each statement removed in turn fails a check).
begin;
set local lock_timeout = '5s';

drop policy if exists network_connections_self_write on public.network_connections;
drop policy if exists network_connections_self_update on public.network_connections;
revoke insert, update, delete on table public.network_connections from authenticated;

do $consent$
declare
  v_left text;
  v_owner oid := (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.network_connections'::regclass);
begin
  select string_agg(r.role || ' ' || p.priv, ', ' order by r.role, p.priv) into v_left
    from (values ('anon'), ('authenticated')) r(role)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
   where case when p.priv in ('INSERT', 'UPDATE')
              then pg_catalog.has_any_column_privilege(r.role, 'public.network_connections', p.priv)
              else pg_catalog.has_table_privilege(r.role, 'public.network_connections', p.priv) end;
  if v_left is not null then
    raise exception using errcode = '55000',
      message = 'network_connections_consent_guard_v1: an API role can still write public.network_connections ('
        || v_left || '); nothing was changed';
  end if;

  select string_agg(p.policyname || ' (' || p.cmd || ')', ', ' order by p.policyname) into v_left
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename = 'network_connections' and p.cmd <> 'SELECT'
     and p.roles && array['public', 'anon', 'authenticated']::name[];
  if v_left is not null then
    raise exception using errcode = '55000',
      message = 'network_connections_consent_guard_v1: a write policy is still on public.network_connections ('
        || v_left || '); nothing was changed';
  end if;

  select string_agg(w.sig, ', ' order by w.sig) into v_left
    from (values ('public.request_connection(uuid)'), ('public.answer_connection(uuid,boolean)'),
                 ('public.withdraw_connection(uuid)')) w(sig)
   where not exists (
     select 1 from pg_catalog.pg_proc f
      where f.oid = pg_catalog.to_regprocedure(w.sig) and f.prosecdef and f.proowner = v_owner);
  if v_left is not null then
    raise exception using errcode = '55000',
      message = 'network_connections_consent_guard_v1: a connection RPC is missing, not SECURITY DEFINER or not owned by '
        || 'the table''s owner (' || v_left || '); it would stop working without the grants, so nothing was changed';
  end if;
end
$consent$;

commit;
