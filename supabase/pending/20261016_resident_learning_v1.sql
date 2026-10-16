-- Pending owner-reviewed migration. DO NOT apply or promote automatically.
-- Reuses ai_context.memory_items, ops_ai_messages/threads/jobs and control_audit.
-- No browser grants, no new transcript/vector database, no model-weight training.
-- Approved pilot memories use learning_approved, NOT active: the legacy org-wide
-- context-query endpoint selects active records without an owner filter. Do not
-- publish these owner-scoped records into that generic retrieval path.
begin;

create or replace function ai_context.learning_owner_v1(p_org uuid,p_thread uuid,p_message uuid)
returns table(actor uuid,source_text text,source_at timestamptz,source_hash text)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if p_org is null or p_thread is null or p_message is null then
    raise exception 'Canonical learning identifiers required' using errcode='22023';
  end if;
  return query
    select t.created_by,m.content,m.created_at,encode(sha256(convert_to(m.content,'UTF8')),'hex')
    from public.ops_ai_threads t
    join public.ops_ai_messages m on m.thread_id=t.id and m.org_id=t.org_id
    join public.orgs o on o.id=t.org_id
    join public.org_members om on om.org_id=o.id and om.profile_id=t.created_by
    join public.ops_agent_jobs j on j.id=m.id and j.org_id=o.id
    where t.id=p_thread and t.org_id=p_org and t.status='active'
      and m.id=p_message and m.role='user'
      and o.enabled is true and o.slug='mccluster' and o.kind='studio'
      and om.role='owner' and j.job_type='resident_ai_turn'
      and j.target_type='ai_thread' and j.target_id=t.id::text
      and j.input->>'user_message_id'=m.id::text
      and j.input->>'thread_id'=t.id::text
    for share of t,m,o,om;
  if not found then raise exception 'Owner learning source unavailable' using errcode='42501'; end if;
end $$;

create or replace function ai_context.learning_text_ok_v1(p_text text)
returns boolean language sql immutable set search_path=pg_catalog,pg_temp as $$
  select p_text is not null and length(btrim(p_text)) between 1 and 1500
    and p_text !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
    and p_text !~* '(-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-(proj-)?[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,}|sb_secret_[a-zA-Z0-9_-]{12,}|Bearer\s+[a-zA-Z0-9._-]{12,}|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)';
$$;

-- Invalidated sources are not reusable. Hashes are provenance checks, NOT proof
-- that a preference, correction or a model-generated generalization is true.
create or replace function ai_context.learning_source_ok_v1(p_org uuid,p_metadata jsonb)
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select exists (
    select 1 from public.ops_ai_messages m
    join public.ops_ai_threads t on t.id=m.thread_id and t.org_id=m.org_id
    where m.org_id=p_org and m.role='user'
      and m.id::text=p_metadata#>>'{learning,source_message_id}'
      and t.created_by::text=p_metadata#>>'{learning,owner_id}'
      and encode(sha256(convert_to(m.content,'UTF8')),'hex')=p_metadata#>>'{learning,source_hash}'
  ) and (
    p_metadata#>>'{learning,source_job_id}' is null or exists (
      select 1 from public.ops_agent_jobs j where j.org_id=p_org and j.status='done'
        and j.job_type='repo_health' and j.id::text=p_metadata#>>'{learning,source_job_id}'
        and j.output#>>'{completion_evidence,result_sha256}'=p_metadata#>>'{learning,evidence_digest}'
        and j.output#>'{tests,ran}'='true'::jsonb
    )
  );
$$;

create or replace function public.ops_ai_learning_turn(p_org_id uuid,p_thread_id uuid,p_message_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  own record; cmd text; parts text[]; lesson text; typ text; target uuid;
  row ai_context.memory_items%rowtype; evidence public.ops_agent_jobs%rowtype;
  items jsonb; result jsonb; target_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_message_id::text,717));
  select * into strict own from ai_context.learning_owner_v1(p_org_id,p_thread_id,p_message_id);
  cmd=btrim(own.source_text,E' \r\n\t');
  if cmd !~* '^/learn(\s|$)' then
    select coalesce(jsonb_agg(q.doc),'[]'::jsonb) into items from (
      select jsonb_build_object('id',m.id,'memory_type',m.memory_type,'content',m.content,
        'status','active','sensitivity',m.sensitivity,'valid_until',m.valid_until,
        'last_confirmed_at',m.last_confirmed_at,'metadata',m.metadata) as doc
      from ai_context.memory_items m
      where m.org_id=p_org_id and m.status='learning_approved' and m.sensitivity='private'
        and m.metadata#>'{learning,version}'='1'::jsonb
        and m.metadata#>>'{learning,owner_id}'=own.actor::text
        and m.metadata#>>'{learning,state}'='approved'
        and m.memory_type in ('preference','correction','procedure')
        and m.valid_from<=now() and m.valid_until>now()
        and m.last_confirmed_at<=own.source_at
        and ai_context.learning_text_ok_v1(m.content)
        and ai_context.learning_source_ok_v1(p_org_id,m.metadata)
        and exists (
          select 1 from public.ops_ai_messages a
          join public.ops_ai_threads t on t.id=a.thread_id and t.org_id=a.org_id
          where a.org_id=p_org_id and a.role='user' and t.created_by=own.actor
            and a.id::text=m.metadata#>>'{learning,approval_message_id}'
            and encode(sha256(convert_to(a.content,'UTF8')),'hex')=m.metadata#>>'{learning,approval_hash}'
        )
      order by ts_rank_cd(to_tsvector('english',m.content),plainto_tsquery('english',left(cmd,1000))) desc,
        m.last_confirmed_at desc,m.id limit 8
    ) q;
    return jsonb_build_object('handled',false,'owner_id',own.actor,'items',items);
  end if;

  if cmd ~* '^/learn\s+list$' then
    select coalesce(jsonb_agg(q.doc),'[]'::jsonb) into items from (
      select jsonb_build_object('id',m.id,'memory_type',m.memory_type,'content',m.content,'status',case when m.status='learning_approved' then 'approved' else m.status end,
        'valid_until',m.valid_until) as doc
      from ai_context.memory_items m where m.org_id=p_org_id
        and m.metadata#>'{learning,version}'='1'::jsonb
        and m.metadata#>>'{learning,owner_id}'=own.actor::text
      order by m.updated_at desc,m.id limit 20
    ) q;
    return jsonb_build_object('handled',true,'status','list','items',items);
  end if;

  parts=regexp_match(cmd,'^/learn[ \t]+propose[ \t]+(preference|correction)[ \t]*\r?\n([\s\S]+)$','i');
  if parts is not null then
    typ=lower(parts[1]);lesson=btrim(parts[2],E' \r\n\t');
    if not ai_context.learning_text_ok_v1(lesson) then return jsonb_build_object('handled',true,'status','rejected'); end if;
    select * into row from ai_context.memory_items m where m.org_id=p_org_id
      and m.canonical_key='learning:v1:'||p_message_id::text for update;
    if found then
      if (row.metadata#>>'{learning,source_hash}') is distinct from own.source_hash or row.content<>lesson then
        return jsonb_build_object('handled',true,'status','conflict');
      end if;
      return jsonb_build_object('handled',true,'status',case when row.status='learning_approved' then 'approved' else row.status end,'id',row.id,'content',row.content);
    end if;
    -- Bounded pilot, never an unbounded accumulating corpus.
    perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||own.actor::text,718));
    if (select count(*) from ai_context.memory_items m where m.org_id=p_org_id
        and m.metadata#>>'{learning,owner_id}'=own.actor::text and m.status in ('learning_approved','proposed')
        and m.valid_until>now())>=200 then return jsonb_build_object('handled',true,'status','rejected'); end if;
    insert into ai_context.memory_items(org_id,memory_type,subject,content,canonical_key,status,sensitivity,
      confidence,valid_from,valid_until,metadata)
    values(p_org_id,typ,'Owner-reviewed learning',lesson,'learning:v1:'||p_message_id::text,'proposed','private',0.5,
      now(),now()+case when typ='preference' then interval '90 days' else interval '30 days' end,
      jsonb_build_object('learning',jsonb_build_object('version',1,'state','proposed','owner_id',own.actor,
        'source_table','ops_ai_messages','source_message_id',p_message_id,'source_hash',own.source_hash,
        'model_generated',false,'training_allowed',false))) returning * into row;
    insert into public.control_audit(org_id,actor_user_id,actor_kind,event,capability,resource_type,resource_id,detail)
      values(p_org_id,own.actor,'user','ai.learning.proposed','ai.memory','ai_context.memory_items',row.id::text,
        jsonb_build_object('message_id',p_message_id,'source_hash',own.source_hash,'weights_updated',false));
    return jsonb_build_object('handled',true,'status','proposed','id',row.id,'content',row.content);
  end if;

  parts=regexp_match(cmd,'^/learn\s+(approve|revoke|reflect)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$','i');
  if parts is null then return jsonb_build_object('handled',true,'status','help'); end if;
  target=parts[2]::uuid;
  if lower(parts[1])='reflect' then
    select * into row from ai_context.memory_items m where m.org_id=p_org_id
      and m.canonical_key='learning:v1:'||p_message_id::text;
    if found then
      if (row.metadata#>>'{learning,source_hash}') is distinct from own.source_hash then return jsonb_build_object('handled',true,'status','conflict');end if;
      return jsonb_build_object('handled',true,'status',case when row.status='learning_approved' then 'approved' else row.status end,'id',row.id,'content',row.content);
    end if;
    select * into evidence from public.ops_agent_jobs j where j.id=target and j.org_id=p_org_id
      and j.status='done' and j.job_type='repo_health' and j.output#>'{tests,ran}'='true'::jsonb
      and jsonb_typeof(j.output#>'{tests,ok}')='boolean'
      and j.output#>>'{completion_evidence,result_sha256}' ~ '^[0-9a-f]{64}$';
    if not found then return jsonb_build_object('handled',true,'status','rejected'); end if;
    -- Internal response to the trusted Core executor, NEVER to a browser/model.
    return jsonb_build_object('handled',true,'status','reflect','job',to_jsonb(evidence));
  end if;
  select * into row from ai_context.memory_items m where m.id=target and m.org_id=p_org_id
    and m.metadata#>'{learning,version}'='1'::jsonb
    and m.metadata#>>'{learning,owner_id}'=own.actor::text for update;
  if not found then return jsonb_build_object('handled',true,'status','rejected'); end if;
  if lower(parts[1])='approve' then
    if row.status='learning_approved' and row.metadata#>>'{learning,approval_message_id}'=p_message_id::text
        and row.metadata#>>'{learning,approval_hash}'=own.source_hash
        and row.valid_until>now() and ai_context.learning_source_ok_v1(p_org_id,row.metadata) then
      return jsonb_build_object('handled',true,'status','approved','id',target);
    end if;
    if row.status<>'proposed' or row.valid_until<=now() or not ai_context.learning_source_ok_v1(p_org_id,row.metadata) then
      return jsonb_build_object('handled',true,'status','conflict');
    end if;
    update ai_context.memory_items set status='learning_approved',last_confirmed_at=now(),updated_at=now(),
      metadata=jsonb_set(metadata,'{learning}',metadata->'learning'||jsonb_build_object('state','approved',
        'approved_by',own.actor,'approval_message_id',p_message_id,'approval_hash',own.source_hash)) where id=target;
    target_status='approved';
  else
    if row.status='retracted' then return jsonb_build_object('handled',true,'status','retracted','id',target);end if;
    if row.status not in ('learning_approved','proposed') then return jsonb_build_object('handled',true,'status','conflict');end if;
    update ai_context.memory_items set status='retracted',updated_at=now(),
      metadata=jsonb_set(metadata,'{learning}',metadata->'learning'||jsonb_build_object('state','retracted',
        'revoked_by',own.actor,'revocation_message_id',p_message_id)) where id=target;
    target_status='retracted';
  end if;
  insert into public.control_audit(org_id,actor_user_id,actor_kind,event,capability,resource_type,resource_id,detail)
    values(p_org_id,own.actor,'user','ai.learning.'||target_status,'ai.memory','ai_context.memory_items',target::text,
      jsonb_build_object('message_id',p_message_id,'source_hash',own.source_hash,'weights_updated',false));
  return jsonb_build_object('handled',true,'status',target_status,'id',target);
end $$;

create or replace function public.ops_ai_learning_reflection(p_org_id uuid,p_thread_id uuid,p_message_id uuid,p_content text,p_evidence_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare own record; parts text[]; source_job uuid; row ai_context.memory_items%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_message_id::text,717));
  select * into strict own from ai_context.learning_owner_v1(p_org_id,p_thread_id,p_message_id);
  parts=regexp_match(btrim(own.source_text,E' \r\n\t'),'^/learn\s+reflect\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$','i');
  if parts is null or not ai_context.learning_text_ok_v1(p_content) or p_evidence_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('handled',true,'status','rejected');
  end if;
  source_job=parts[1]::uuid;
  perform 1 from public.ops_agent_jobs j where j.id=source_job and j.org_id=p_org_id
    and j.status='done' and j.job_type='repo_health' and j.output#>'{tests,ran}'='true'::jsonb
    and jsonb_typeof(j.output#>'{tests,ok}')='boolean'
    and j.output#>>'{completion_evidence,result_sha256}'=p_evidence_digest for share;
  if not found then return jsonb_build_object('handled',true,'status','rejected');end if;
  select * into row from ai_context.memory_items m where m.org_id=p_org_id
    and m.canonical_key='learning:v1:'||p_message_id::text for update;
  if found then
    if (row.metadata#>>'{learning,source_hash}') is distinct from own.source_hash then return jsonb_build_object('handled',true,'status','conflict');end if;
    return jsonb_build_object('handled',true,'status',case when row.status='learning_approved' then 'approved' else row.status end,'id',row.id,'content',row.content);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||own.actor::text,718));
  if (select count(*) from ai_context.memory_items m where m.org_id=p_org_id
      and m.metadata#>>'{learning,owner_id}'=own.actor::text and m.status in ('learning_approved','proposed')
      and m.valid_until>now())>=200 then return jsonb_build_object('handled',true,'status','rejected');end if;
  insert into ai_context.memory_items(org_id,memory_type,subject,content,canonical_key,status,sensitivity,
    confidence,valid_from,valid_until,metadata)
    values(p_org_id,'procedure','Outcome-grounded procedural hypothesis',btrim(p_content),
      'learning:v1:'||p_message_id::text,'proposed','private',0.5,now(),now()+interval '30 days',
      jsonb_build_object('learning',jsonb_build_object('version',1,'state','proposed','owner_id',own.actor,
        'source_table','ops_ai_messages','source_message_id',p_message_id,'source_hash',own.source_hash,
        'source_job_id',source_job,'evidence_digest',p_evidence_digest,'model_generated',true,'training_allowed',false))) returning * into row;
  insert into public.control_audit(org_id,actor_user_id,actor_kind,event,capability,resource_type,resource_id,detail)
    values(p_org_id,own.actor,'user','ai.learning.proposed','ai.memory','ai_context.memory_items',row.id::text,
      jsonb_build_object('message_id',p_message_id,'source_job_id',source_job,'model_proposal',true,'weights_updated',false));
  return jsonb_build_object('handled',true,'status','proposed','id',row.id,'content',row.content);
end $$;

revoke all on function ai_context.learning_owner_v1(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function ai_context.learning_text_ok_v1(text) from public,anon,authenticated;
revoke all on function ai_context.learning_source_ok_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ops_ai_learning_turn(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.ops_ai_learning_reflection(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ops_ai_learning_turn(uuid,uuid,uuid) to service_role;
grant execute on function public.ops_ai_learning_reflection(uuid,uuid,uuid,text,text) to service_role;
commit;
-- Rollback: first set MCCLUSTER_LEARNING_ENABLED=false on Core. Optional removal:
-- drop function public.ops_ai_learning_reflection(uuid,uuid,uuid,text,text);
-- drop function public.ops_ai_learning_turn(uuid,uuid,uuid);
-- drop function ai_context.learning_source_ok_v1(uuid,jsonb);
-- drop function ai_context.learning_text_ok_v1(text);
-- drop function ai_context.learning_owner_v1(uuid,uuid,uuid);
-- Retain auditable memory records; revocation is not transcript deletion/unlearning.
