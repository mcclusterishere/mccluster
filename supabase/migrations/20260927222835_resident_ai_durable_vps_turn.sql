create or replace function public.ops_ai_submit_turn(
  p_org_id uuid,
  p_thread_id uuid,
  p_user_message_id uuid,
  p_assistant_message_id uuid,
  p_content text,
  p_input_mode text default 'text'
)
returns table (
  user_message_id uuid,
  assistant_message_id uuid,
  job_id uuid,
  job_status text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_content text := btrim(coalesce(p_content, ''));
  v_mode text := lower(btrim(coalesce(p_input_mode, 'text')));
  v_message public.ops_ai_messages%rowtype;
  v_job public.ops_agent_jobs%rowtype;
  v_assistant uuid;
begin
  if p_org_id is null or p_thread_id is null or p_user_message_id is null or p_assistant_message_id is null then
    raise exception 'org, thread, user message, and assistant message ids are required'
      using errcode = '22023';
  end if;

  if v_content = '' or char_length(v_content) > 12000 then
    raise exception 'content must be between 1 and 12000 characters'
      using errcode = '22023';
  end if;

  if v_mode not in ('text', 'voice') then
    raise exception 'input mode must be text or voice'
      using errcode = '22023';
  end if;

  perform 1
    from public.ops_ai_threads
   where id = p_thread_id
     and org_id = p_org_id
     and status = 'active';
  if not found then
    raise exception 'active AI thread not found'
      using errcode = 'P0002';
  end if;

  insert into public.ops_ai_messages (
    id, thread_id, org_id, role, content, metadata
  )
  values (
    p_user_message_id,
    p_thread_id,
    p_org_id,
    'user',
    v_content,
    jsonb_build_object(
      'input_mode', v_mode,
      'execution_kind', 'resident_ai_turn',
      'agent_job_id', p_user_message_id::text,
      'task_status', 'queued'
    )
  )
  on conflict (id) do nothing;

  select *
    into v_message
    from public.ops_ai_messages
   where id = p_user_message_id
     and org_id = p_org_id;

  if not found
     or v_message.thread_id <> p_thread_id
     or v_message.role <> 'user'
     or v_message.content <> v_content then
    raise exception 'message id already belongs to a different AI turn'
      using errcode = '23505';
  end if;

  insert into public.ops_agent_jobs (
    id,
    org_id,
    job_type,
    target_type,
    target_id,
    status,
    priority,
    input,
    max_attempts,
    run_after
  )
  values (
    p_user_message_id,
    p_org_id,
    'resident_ai_turn',
    'ai_thread',
    p_thread_id::text,
    'queued',
    100,
    jsonb_build_object(
      'thread_id', p_thread_id::text,
      'user_message_id', p_user_message_id::text,
      'assistant_message_id', p_assistant_message_id::text,
      'input_mode', v_mode
    ),
    3,
    now()
  )
  on conflict (id) do nothing;

  select *
    into v_job
    from public.ops_agent_jobs
   where id = p_user_message_id
     and org_id = p_org_id;

  if not found
     or v_job.job_type <> 'resident_ai_turn'
     or v_job.target_type <> 'ai_thread'
     or v_job.target_id <> p_thread_id::text
     or coalesce(v_job.input->>'user_message_id', '') <> p_user_message_id::text then
    raise exception 'job id already belongs to a different operation'
      using errcode = '23505';
  end if;

  begin
    v_assistant := (v_job.input->>'assistant_message_id')::uuid;
  exception when others then
    raise exception 'resident AI job has invalid assistant message id'
      using errcode = '22023';
  end;

  return query
    select v_message.id, v_assistant, v_job.id, v_job.status;
end;
$$;

revoke all on function public.ops_ai_submit_turn(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ops_ai_submit_turn(uuid, uuid, uuid, uuid, text, text)
  to service_role;

comment on function public.ops_ai_submit_turn(uuid, uuid, uuid, uuid, text, text) is
  'Atomically persists a resident McCluster user turn and its durable VPS job. Service-role only; browser clients must use the authenticated Core tool surface.';
