-- Pending only. Service-only data. The shared queue never receives course or student details.
begin;
create table public.learning_studio_courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  job_id uuid not null unique references public.ops_agent_jobs(id) deferrable initially deferred,
  school text not null check (length(school) between 1 and 120),
  course_code text not null check(length(course_code) between 1 and 32),
  title text not null check(length(title) between 1 and 160),
  term text not null default '' check(length(term)<=64),
  source_urls jsonb not null check(jsonb_typeof(source_urls)='array' and jsonb_array_length(source_urls) between 1 and 3),
  bundle jsonb check (jsonb_typeof(bundle)='object' and octet_length(bundle::text)<=64000),
  answers jsonb not null default '[]' check(jsonb_typeof(answers)='array'),
  created_at timestamptz not null default now(),
  unique(owner_id,request_id)
);
alter table public.learning_studio_courses enable row level security;
revoke all on public.learning_studio_courses from public, anon, authenticated;
grant select,insert,update on public.learning_studio_courses to service_role;
create view public.learning_studio_summary with (security_invoker=true) as
  select c.id,c.owner_id,c.school,c.course_code,c.title,c.term,c.created_at,
    case when j.status='done' and c.bundle is not null then 'ready' when j.status='failed' then 'failed'
      when j.status='running' then 'running' else 'queued' end as state,
    case when j.status='done' then coalesce(jsonb_array_length(c.bundle->'rounds'),0) else 0 end as total,
    jsonb_array_length(c.answers) as completed,
    (select count(*)::integer from jsonb_array_elements(c.answers) a where a->>'correct'='true') as score
  from public.learning_studio_courses c join public.ops_agent_jobs j on j.id=c.job_id;
revoke all on public.learning_studio_summary from public,anon,authenticated;
grant select on public.learning_studio_summary to service_role;

-- The RPCs are invoker functions, inaccessible to browser tokens even through PostgREST.
create function public.learning_studio_submit(p_owner uuid,p_request uuid,p_school text,p_code text,p_title text,p_term text,p_urls jsonb)
returns uuid language plpgsql set search_path='' as $$
declare c public.learning_studio_courses; org uuid; destination uuid:=gen_random_uuid();
begin
  select o.id into strict org from public.orgs o join public.org_members m on m.org_id=o.id
    where o.slug='mccluster' and o.enabled is true and m.profile_id=p_owner and m.role='owner';
  insert into public.learning_studio_courses(owner_id,request_id,job_id,school,course_code,title,term,source_urls)
  values(p_owner,p_request,destination,p_school,p_code,p_title,p_term,p_urls)
  on conflict (owner_id,request_id) do nothing returning * into c;
  if c.id is null then
    select * into strict c from public.learning_studio_courses where owner_id=p_owner and request_id=p_request;
    if row(c.school,c.course_code,c.title,c.term,c.source_urls) is distinct from row(p_school,p_code,p_title,p_term,p_urls) then
      raise exception 'Request identifier already used for a different course' using errcode='23505';
    end if;
    return c.id;
  end if;
  insert into public.ops_agent_jobs(id,org_id,job_type,target_type,target_id,input,status,priority,max_attempts)
    values(destination,org,'course_study_build','private_study_course',c.id::text,'{}','queued',20,3);
  return c.id;
end $$;

create function public.learning_studio_finish(p_course uuid,p_job uuid,p_worker text,p_attempt integer,p_bundle jsonb)
returns boolean language plpgsql set search_path='' as $$
declare c public.learning_studio_courses;
begin
  perform 1 from public.ops_agent_jobs j join public.orgs o on o.id=j.org_id
    where j.id=p_job and j.job_type='course_study_build' and j.target_type='private_study_course'
      and j.target_id=p_course::text and o.slug='mccluster' and o.enabled is true
      and j.status='running' and j.locked_by=p_worker and j.attempts=p_attempt for update of j;
  if not found then return false; end if;
  select * into c from public.learning_studio_courses where id=p_course and job_id=p_job for update;
  if not found then return false; end if;
  if coalesce((p_bundle->>'version')='1' and jsonb_typeof(p_bundle->'sources')='array'
    and jsonb_array_length(p_bundle->'sources') between 1 and 3 and jsonb_typeof(p_bundle->'brief')='array'
    and jsonb_array_length(p_bundle->'brief') between 1 and 32 and jsonb_typeof(p_bundle->'rounds')='array'
    and jsonb_array_length(p_bundle->'rounds') between 1 and 32,false) is false then
    raise exception 'Invalid study bundle'; end if;
  if c.bundle is not null then return c.bundle=p_bundle; end if;
  update public.learning_studio_courses set bundle=p_bundle where id=c.id;
  return true;
end $$;

create function public.learning_studio_answer(p_owner uuid,p_course uuid,p_round integer,p_choice integer)
returns text language plpgsql set search_path='' as $$
declare c public.learning_studio_courses; r jsonb; n integer;
begin
  select a.* into c from public.learning_studio_courses a join public.ops_agent_jobs j on j.id=a.job_id
    where a.owner_id=p_owner and a.id=p_course and j.status='done' and a.bundle is not null for update of a;
  if not found then return 'unavailable'; end if;
  n:=jsonb_array_length(c.answers);
  if p_round < 0 or p_round >= jsonb_array_length(c.bundle->'rounds') or p_choice < 0 then return 'invalid'; end if;
  if p_round < n then
    if (c.answers->p_round->>'choice')::integer=p_choice then return 'ok'; end if;
    return 'conflict';
  end if;
  if p_round<>n then return 'conflict'; end if;
  r:=c.bundle->'rounds'->p_round;
  if p_choice>=jsonb_array_length(r->'choices') then return 'invalid'; end if;
  update public.learning_studio_courses set answers=answers||jsonb_build_array(jsonb_build_object(
    'round',p_round,'choice',p_choice,'correct',p_choice=(r->>'answer')::integer,'explanation',r->>'explanation'))
    where id=c.id;
  return 'ok';
end $$;

create function public.learning_studio_retry(p_owner uuid,p_course uuid)
returns boolean language plpgsql set search_path='' as $$
declare c public.learning_studio_courses; prev public.ops_agent_jobs;
begin
  select * into c from public.learning_studio_courses where owner_id=p_owner and id=p_course;
  if not found then return false; end if;
  select * into prev from public.ops_agent_jobs where id=c.job_id and status='failed'
    and job_type='course_study_build' and target_id=c.id::text for update;
  if not found then return false; end if;
  -- Serializes retries. Reuse the job id and preserve any previously fenced material.
  if prev.max_attempts>=12 then return false; end if;
  update public.ops_agent_jobs set status='queued',max_attempts=prev.max_attempts+3,run_after=now(),locked_at=null,locked_by=null,last_error=null,updated_at=now() where id=prev.id;
  return true;
end $$;

revoke all on function public.learning_studio_submit(uuid,uuid,text,text,text,text,jsonb),public.learning_studio_finish(uuid,uuid,text,integer,jsonb),public.learning_studio_answer(uuid,uuid,integer,integer),public.learning_studio_retry(uuid,uuid) from public,anon,authenticated;
grant execute on function public.learning_studio_submit(uuid,uuid,text,text,text,text,jsonb),public.learning_studio_finish(uuid,uuid,text,integer,jsonb),public.learning_studio_answer(uuid,uuid,integer,integer),public.learning_studio_retry(uuid,uuid) to service_role;
commit;
