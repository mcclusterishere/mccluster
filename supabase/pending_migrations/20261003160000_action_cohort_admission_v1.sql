-- ACTION COHORT ADMISSION v1: the desk admits an accepted fellow to a cohort.
--
-- NOT YET APPLIED TO PRODUCTION (pending_migrations/). Apply it with
-- 20261003150000_equity_uprise_group_docket_516r.sql, then move both into
-- supabase/migrations/ and record them in the production ledger.
--
-- Acceptance (review_fellowship_application) makes a member a fellow of the
-- whole network; it does not, and should not, put them in any one program's
-- cohort. A cohort is a seat the desk gives on purpose. Before this, nothing
-- could put a person in action_cohort_members at all, so "accepted fellows
-- join the next cohort" was a promise with no mechanism behind it.
--
-- The server decides: only a network admin may admit, only an accepted
-- fellow may be admitted, only into a cohort that is still admitting, and
-- never into a cohort by their own hand. Admitting twice is a no-op that
-- says so. The roster stays private (members read only their own rows).
create or replace function public.admit_fellow_to_cohort(
 p_application_id uuid,
 p_cohort_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_app public.action_fellowship_applications%rowtype;
 v_cohort public.action_cohorts%rowtype;
 v_added boolean;
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
 select * into v_app from public.action_fellowship_applications where id = p_application_id;
 if not found then raise exception 'application not found'; end if;
 if v_app.status <> 'accepted' then raise exception 'only an accepted fellow can be admitted to a cohort'; end if;
 if v_app.user_id = (select auth.uid()) then raise exception 'you cannot admit yourself'; end if;
 select * into v_cohort from public.action_cohorts where id = p_cohort_id;
 if not found then raise exception 'cohort not found'; end if;
 if v_cohort.status <> 'active' then raise exception 'that cohort is not admitting (it is %)', v_cohort.status; end if;

 insert into public.action_cohort_members(cohort_id, m_uid)
 values (v_cohort.id, v_app.m_uid)
 on conflict (cohort_id, m_uid) do nothing;
 v_added := found;

 return jsonb_build_object('cohort_id', v_cohort.id, 'cohort', v_cohort.name,
   'application_id', v_app.id, 'admitted', true, 'idempotent', not v_added);
end;
$$;

revoke all on function public.admit_fellow_to_cohort(uuid, uuid) from public, anon;
grant execute on function public.admit_fellow_to_cohort(uuid, uuid) to authenticated, service_role;
