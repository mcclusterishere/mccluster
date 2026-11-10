-- Recovery artifact for pending/eup_module_policy_v1.sql: never a forward migration.
-- Drops the module policy and its command log. Every guarded RPC that still calls public.eup_module_guard or
-- public.eup_module_guard_reduce then fails closed (42883), so roll back eup_league_v1.sql / eup_intake_v1.sql
-- first or expect their writes to refuse. The CASCADE on the trigger function removes the *_module_policy
-- statement triggers from every domain table that still carries one.
-- The command log is LOST; export it before running this after real use. Safe to run twice.
begin;
drop function if exists public.eup_module_guard_trigger() cascade;
drop function if exists public.eup_module_guard_reduce(text);
drop function if exists public.eup_module_guard(text, bigint);
drop function if exists public.eup_module_policy_command(uuid, text, text, bigint, text, text);
drop function if exists public.eup_module_policy_install(uuid, text, text, text);
drop function if exists public.eup_module_control_read(uuid, integer);
drop function if exists public.eup_module_policy_read(text);
drop function if exists public.eup_module_policy_json(text, text, bigint);
drop table if exists public.eup_module_policy_commands;
drop table if exists public.eup_module_policies;
drop function if exists public.eup_module_policy_immutable();
commit;
