-- Event-driven automation. Every canonical event can start declarative workflows.
-- High-risk actions are queued as waiting-approval unless an explicit approval is
-- already bound. The trigger itself never performs an external side effect.

create or replace function private.eu_event_dispatch()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  w public.eu_workflows%rowtype;
  run_id uuid;
  a jsonb;
  cap_risk text;
  st text;
  approval uuid;
  rid text;
begin
  -- Built-in derivative: every approved publication gets a deterministic PDF.
  if new.event_type='publication.approved' and new.entity_type='eu_publications' then
    select id into approval from public.control_approvals
     where org_id=new.org_id and capability='publication.publish'
       and resource_type='eu_publications' and resource_id=new.entity_id
       and state='approved' and expires_at>now()
     order by decided_at desc nulls last limit 1;
    insert into public.eu_jobs(org_id,initiative_id,event_id,job_type,provider,action,capability,resource_type,resource_id,payload,state,approval_id,idempotency_key,priority)
    values(new.org_id,new.initiative_id,new.id,'publication.render-pdf','pdf-native','render','publication.publish','eu_publications',new.entity_id,
      jsonb_build_object('publication_id',new.entity_id,'version_label',coalesce(new.data->>'version','1.0')),
      case when approval is null then 'waiting-approval' else 'queued' end,approval,
      'publication:'||new.entity_id||':'||coalesce(new.data->>'version','1.0')||':pdf-native',7)
    on conflict (org_id,idempotency_key) where idempotency_key is not null do nothing;
  end if;

  -- Once canonical publication has actually rendered, start recurring citation monitoring.
  if new.event_type='publication.published' and new.entity_type='eu_publications' then
    insert into public.eu_monitors(org_id,initiative_id,name,monitor_type,provider,query,cadence,enabled,next_run_at)
    values(new.org_id,new.initiative_id,'Citations · '||coalesce(new.data->>'stable_id',new.entity_id),'citation','openalex',
      jsonb_build_object('publication_id',new.entity_id),'daily',true,now()+interval '6 hours')
    on conflict do nothing;
  end if;

  -- User-defined workflows. Conditions currently support exact JSON containment;
  -- richer policy belongs in Edge Functions, not a trigger that can block writes.
  for w in
    select * from public.eu_workflows
     where org_id=new.org_id and enabled=true and trigger_event=new.event_type
       and (initiative_id is null or initiative_id=new.initiative_id)
       and (conditions='{}'::jsonb or new.data @> conditions)
  loop
    insert into public.eu_workflow_runs(org_id,workflow_id,trigger_event_id,state,input)
    values(new.org_id,w.id,new.id,'running',jsonb_build_object('event_id',new.id,'event_type',new.event_type,'entity_type',new.entity_type,'entity_id',new.entity_id,'data',new.data))
    returning id into run_id;

    for a in select * from jsonb_array_elements(coalesce(w.actions,'[]'::jsonb))
    loop
      if coalesce(a->>'do','job') <> 'job' then continue; end if;
      select risk into cap_risk from public.control_capabilities where capability=coalesce(a->>'capability','');
      rid:=case when coalesce(a->>'resource_id','') in ('','$entity') then new.entity_id else a->>'resource_id' end;
      st:=case when cap_risk='high' or w.approval_mode='per-run' then 'waiting-approval' else 'queued' end;
      insert into public.eu_jobs(org_id,initiative_id,workflow_run_id,event_id,job_type,provider,action,capability,resource_type,resource_id,payload,state,idempotency_key,priority)
      values(new.org_id,new.initiative_id,run_id,new.id,
        coalesce(a->>'job_type','workflow.action'),coalesce(a->>'provider','internal'),coalesce(a->>'action','run'),coalesce(a->>'capability',''),
        coalesce(a->>'resource_type',new.entity_type),rid,
        coalesce(a->'payload','{}'::jsonb)||jsonb_build_object('event_id',new.id,'event_data',new.data,'entity_type',new.entity_type,'entity_id',new.entity_id),
        st,'workflow:'||w.id||':event:'||new.id||':action:'||coalesce(a->>'key',md5(a::text)),coalesce((a->>'priority')::smallint,5))
      on conflict (org_id,idempotency_key) where idempotency_key is not null do nothing;
    end loop;
    update public.eu_workflow_runs set state=case when exists(select 1 from public.eu_jobs where workflow_run_id=run_id and state='waiting-approval') then 'waiting-approval' else 'queued' end where id=run_id;
  end loop;
  return new;
end;
$$;
revoke all on function private.eu_event_dispatch() from public, anon, authenticated;

drop trigger if exists eu_events_dispatch on public.eu_events;
create trigger eu_events_dispatch after insert on public.eu_events
for each row execute function private.eu_event_dispatch();
