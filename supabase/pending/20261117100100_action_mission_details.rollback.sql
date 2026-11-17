-- Recovery artifact for 20261117100100_action_mission_details.sql: never a forward migration.
-- Owner approval required, like the forward file. Apply as the service role.
--
-- What it does, in one transaction: drops public.action_mission_details (its two policies, its grants and
-- its constraints go with it). Nothing else references the table.
-- It REFUSES, changing nothing, while the table holds any row: a published sourced mission must never be
-- shown without its credit, and 43 of the Drawdown missions cite CC BY 4.0 records. Roll back the publish
-- (20261117100300_action_mission_drawdown_publish.rollback.sql) and the import
-- (20261117100200_action_mission_drawdown_import.rollback.sql) first, or export the rows and delete them
-- deliberately. The table is locked before it is counted, so no row can arrive between the count and the drop.
-- Safe to run twice, and harmless where the table does not exist.
begin;
set local lock_timeout = '5s';

do $details_rollback$
declare
  v_rows bigint;
begin
  if to_regclass('public.action_mission_details') is null then
    return;
  end if;
  execute 'lock table public.action_mission_details in access exclusive mode';
  execute 'select count(*) from public.action_mission_details' into v_rows;
  if v_rows > 0 then
    raise exception 'action_mission_details rollback refused: the table still holds % row(s)', v_rows
      using errcode = '55000',
            hint = 'Roll back 20261117100300 (publish) and 20261117100200 (import) first; nothing was dropped.';
  end if;
end
$details_rollback$;

drop table if exists public.action_mission_details;

commit;
