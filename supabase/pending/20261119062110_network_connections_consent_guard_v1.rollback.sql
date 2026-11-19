-- Rollback of supabase/pending/20261119062110_network_connections_consent_guard_v1.sql: a recovery artifact, never a
-- forward migration.
--
-- Not applied. Apply only with Matthew's approval. Running it reopens the hole the forward file closes.
--
-- Puts back exactly what production held when it was read on 2026-11-19 (THE HOLE in the forward file): the policies
-- network_connections_self_update (UPDATE to authenticated, USING and WITH CHECK requester or addressee is the caller)
-- and network_connections_self_write (INSERT to authenticated, WITH CHECK requester is the caller), with production's
-- expressions (the same text supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql
-- records), and INSERT, UPDATE and DELETE on public.network_connections for authenticated. It does not touch
-- network_connections_member_read, SELECT, MAINTAIN, anon, the service role, the RPCs or any row. One transaction,
-- safe to run twice; run as postgres, the table's owner, as the forward file.
--
-- Check afterwards: the forward file's catalog query answers
--   policies 'network_connections_member_read SELECT authenticated; network_connections_self_update UPDATE
--   authenticated; network_connections_self_write INSERT authenticated'; member_select, member_insert,
--   member_update and member_delete true; acl
--   '{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=arwdm/postgres,service_role=arwdDxtm/postgres}'.
begin;
set local lock_timeout = '5s';

grant insert, update, delete on table public.network_connections to authenticated;

drop policy if exists network_connections_self_update on public.network_connections;
create policy network_connections_self_update on public.network_connections for update to authenticated
  using (((requester_m_uid = public.current_m_uid()) or (addressee_m_uid = public.current_m_uid())))
  with check (((requester_m_uid = public.current_m_uid()) or (addressee_m_uid = public.current_m_uid())));

drop policy if exists network_connections_self_write on public.network_connections;
create policy network_connections_self_write on public.network_connections for insert to authenticated
  with check ((requester_m_uid = public.current_m_uid()));

commit;
