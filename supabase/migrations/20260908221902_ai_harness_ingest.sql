create or replace function public.ai_ingest(envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ai_context, public, pg_catalog
as $$
declare
  v_org uuid;
  v_provider text;
  v_account text;
  v_adapter text;
  v_ext text;
  v_key text;
  v_hash text;
  v_id uuid;
  v_receipt ai_context.ingestion_receipts%rowtype;
  v_msg jsonb;
  v_i int := 0;
  v_inserted int := 0;
  v_role text;
begin
  if envelope is null or jsonb_typeof(envelope) <> 'object' then
    raise exception 'envelope required' using errcode = '22023';
  end if;

  v_org := nullif(envelope->>'org_id','')::uuid;
  v_provider := lower(nullif(envelope->>'provider',''));
  v_account := coalesce(nullif(envelope->>'account_label',''), 'default');
  v_adapter := coalesce(nullif(envelope->>'adapter_version',''), '1');
  v_ext := nullif(envelope->>'external_conversation_id','');
  v_key := nullif(envelope->>'idempotency_key','');

  if v_org is null then raise exception 'org_id required' using errcode = '22023'; end if;
  if v_provider is null or v_provider not in ('chatgpt','claude','grok','gemini','copilot','local','other') then
    raise exception 'provider required' using errcode = '22023';
  end if;
  if v_ext is null then raise exception 'external_conversation_id required' using errcode = '22023'; end if;
  if v_key is null then raise exception 'idempotency_key required' using errcode = '22023'; end if;
  if not exists (select 1 from public.orgs where id = v_org) then
    raise exception 'unknown org' using errcode = '22023';
  end if;

  v_hash := encode(digest(envelope::text, 'sha256'), 'hex');

  select * into v_receipt from ai_context.ingestion_receipts where idempotency_key = v_key;
  if found then
    if v_receipt.payload_hash <> v_hash then
      raise exception 'idempotency_key reuse with different payload' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'conversation_id', v_receipt.conversation_id
    );
  end if;

  insert into ai_context.conversations (
    org_id, provider, account_label, adapter_version, external_conversation_id,
    title, source_url, model_family, started_at, last_message_at, metadata, payload_hash, updated_at
  ) values (
    v_org, v_provider, v_account, v_adapter, v_ext,
    nullif(envelope->>'title',''),
    nullif(envelope->>'source_url',''),
    nullif(envelope->>'model_family',''),
    nullif(envelope->>'started_at','')::timestamptz,
    coalesce(nullif(envelope->>'last_message_at','')::timestamptz, now()),
    coalesce(envelope->'metadata', '{}'::jsonb),
    v_hash,
    now()
  )
  on conflict (org_id, provider, account_label, external_conversation_id)
  do update set
    title = excluded.title,
    source_url = excluded.source_url,
    model_family = excluded.model_family,
    last_message_at = excluded.last_message_at,
    metadata = excluded.metadata,
    payload_hash = excluded.payload_hash,
    adapter_version = excluded.adapter_version,
    updated_at = now()
  returning id into v_id;

  if jsonb_typeof(envelope->'messages') = 'array' then
    for v_msg in select * from jsonb_array_elements(envelope->'messages')
    loop
      v_role := coalesce(nullif(v_msg->>'role',''), 'other');
      if v_role not in ('user','assistant','system','tool','other') then v_role := 'other'; end if;
      insert into ai_context.messages (
        conversation_id, org_id, provider_message_id, role, model, content,
        occurred_at, ordinal, metadata, content_hash
      ) values (
        v_id,
        v_org,
        nullif(v_msg->>'id',''),
        v_role,
        nullif(v_msg->>'model',''),
        coalesce(v_msg->>'content',''),
        nullif(v_msg->>'occurred_at','')::timestamptz,
        coalesce(nullif(v_msg->>'ordinal','')::int, v_i),
        coalesce(v_msg->'metadata', '{}'::jsonb),
        encode(digest(coalesce(v_msg->>'content',''), 'sha256'), 'hex')
      )
      on conflict (conversation_id, ordinal) do update set
        content = excluded.content,
        role = excluded.role,
        model = excluded.model,
        metadata = excluded.metadata,
        content_hash = excluded.content_hash;
      v_inserted := v_inserted + 1;
      v_i := v_i + 1;
    end loop;
  end if;

  insert into ai_context.ingestion_receipts (idempotency_key, org_id, conversation_id, payload_hash)
  values (v_key, v_org, v_id, v_hash);

  insert into public.ops_jobs (org_id, kind, payload)
  values (
    v_org,
    'ai_enrich',
    jsonb_build_object('conversation_id', v_id, 'provider', v_provider)
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'conversation_id', v_id,
    'messages_upserted', v_inserted
  );
end;
$$;
