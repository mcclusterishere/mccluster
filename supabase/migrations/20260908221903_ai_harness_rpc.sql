create or replace function public.ai_retrieve(p_org uuid, p_query text, p_limit int default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = ai_context, public, pg_catalog
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 8), 32));
  v_memories jsonb;
  v_messages jsonb;
begin
  if p_org is null then raise exception 'org required' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) into v_memories
  from (
    select id, kind, subject, body, confidence, status, sensitivity, freshness_at
    from ai_context.memory_items
    where org_id = p_org
      and status = 'active'
      and (
        p_query is null or length(trim(p_query)) = 0
        or fts @@ websearch_to_tsquery('english', p_query)
        or body ilike '%' || p_query || '%'
      )
    order by freshness_at desc
    limit v_limit
  ) m;

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into v_messages
  from (
    select msg.id, msg.role, msg.content, msg.occurred_at, msg.conversation_id, c.provider, c.title
    from ai_context.messages msg
    join ai_context.conversations c on c.id = msg.conversation_id
    where msg.org_id = p_org
      and (
        p_query is null or length(trim(p_query)) = 0
        or msg.fts @@ websearch_to_tsquery('english', p_query)
        or msg.content ilike '%' || p_query || '%'
      )
    order by msg.occurred_at desc nulls last
    limit v_limit
  ) x;

  return jsonb_build_object(
    'memories', v_memories,
    'messages', v_messages
  );
end;
$$;

create or replace function public.ai_record_decision(envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ai_context, public, pg_catalog
as $$
declare
  v_org uuid;
  v_id uuid;
  v_risk text;
  v_needs boolean;
begin
  v_org := nullif(envelope->>'org_id','')::uuid;
  if v_org is null then raise exception 'org_id required' using errcode = '22023'; end if;
  if nullif(envelope->>'title','') is null then raise exception 'title required' using errcode = '22023'; end if;
  v_risk := coalesce(nullif(envelope->>'risk_class',''), 'low');
  if v_risk not in ('low','medium','high','critical') then v_risk := 'low'; end if;
  v_needs := v_risk in ('high','critical');

  insert into ai_context.decisions (
    org_id, title, rationale, risk_class, status, requires_approval, provenance, metadata
  ) values (
    v_org,
    envelope->>'title',
    nullif(envelope->>'rationale',''),
    v_risk,
    'proposed',
    coalesce((envelope->>'requires_approval')::boolean, v_needs),
    coalesce(envelope->'provenance', '{}'::jsonb),
    coalesce(envelope->'metadata', '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'proposed', 'requires_approval', v_needs or coalesce((envelope->>'requires_approval')::boolean, false));
end;
$$;

create or replace function public.ai_harness_status(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ai_context, public, pg_catalog
as $$
declare
  v_conversations int;
  v_messages int;
  v_memories int;
  v_decisions int;
  v_jobs int;
begin
  if p_org is null then raise exception 'org required' using errcode = '22023'; end if;
  select count(*) into v_conversations from ai_context.conversations where org_id = p_org;
  select count(*) into v_messages from ai_context.messages where org_id = p_org;
  select count(*) into v_memories from ai_context.memory_items where org_id = p_org and status = 'active';
  select count(*) into v_decisions from ai_context.decisions where org_id = p_org;
  select count(*) into v_jobs from public.ops_jobs where org_id = p_org and status = 'queued';
  return jsonb_build_object(
    'ok', true,
    'schema', 'ai_context',
    'counts', jsonb_build_object(
      'conversations', v_conversations,
      'messages', v_messages,
      'memories_active', v_memories,
      'decisions', v_decisions,
      'jobs_queued', v_jobs
    )
  );
end;
$$;

revoke all on function public.ai_ingest(jsonb) from public, anon, authenticated;
revoke all on function public.ai_retrieve(uuid, text, int) from public, anon, authenticated;
revoke all on function public.ai_record_decision(jsonb) from public, anon, authenticated;
revoke all on function public.ai_harness_status(uuid) from public, anon, authenticated;
grant execute on function public.ai_ingest(jsonb) to service_role;
grant execute on function public.ai_retrieve(uuid, text, int) to service_role;
grant execute on function public.ai_record_decision(jsonb) to service_role;
grant execute on function public.ai_harness_status(uuid) to service_role;
