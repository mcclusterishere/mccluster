-- Empty-schema rollback only. Preserve consent, receipt and release history once
-- a project exists. The feature's Worker gate can be switched off independently.
begin;
lock table equiquant.research_projects in access exclusive mode;
do $$
begin
  if exists(select 1 from equiquant.research_projects) then
    raise exception using errcode='55000',message='Refusing destructive rollback of private research history';
  end if;
end $$;
do $$
begin
  if exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.ops_agent_jobs'::regclass
            and tgname='equiquant_mirror_other_deleted_jobs') then
    drop trigger equiquant_mirror_other_deleted_jobs on public.ops_agent_jobs;
    drop trigger ops_ontology_sync_job_t on public.ops_agent_jobs;
    create trigger ops_ontology_sync_job_t after insert or update or delete on public.ops_agent_jobs
      for each row execute function private.ops_ontology_sync_job();
  end if;
end $$;

drop trigger equiquant_bind_replay_claim on public.ops_agent_jobs;
drop trigger equiquant_capture_completed_replay on public.ops_agent_jobs;
drop function public.equiquant_action(uuid,uuid,text,uuid,jsonb);
drop function equiquant.apply_project_action(uuid,uuid,text,uuid,jsonb);
drop function equiquant.read_research_project(equiquant.research_projects,text);
drop function equiquant.freeze_project_credits(equiquant.research_projects,uuid,jsonb);
drop function equiquant.request_mosaic_replay(uuid,uuid,text,text,text);
drop function equiquant.mosaic_target_choices(uuid);
drop function public.equiquant_attest_target(jsonb);
drop function equiquant.register_mosaic_capability(jsonb);
drop function equiquant.bind_mosaic_runner();
drop function equiquant.capture_mosaic_receipt();
drop table equiquant.research_release_credits, equiquant.research_result_receipts, equiquant.research_replay_jobs,
  equiquant.mosaic_runner_capabilities, equiquant.mosaic_model_pins, equiquant.research_credit_evidence, equiquant.research_project_members, equiquant.research_projects;
drop function equiquant.reject_research_record_edit();
drop schema equiquant;
commit;
