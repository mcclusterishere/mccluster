-- Core already authenticates to PostgREST with its backend service credential.
-- Keep the context schema private; expose only a bounded house-scoped reader.
begin;
grant usage on schema ai_context to service_role;
grant select on ai_context.memory_items, ai_context.messages, ai_context.conversations, ai_context.sources to service_role;

create or replace function public.ops_ai_context_search(p_org_id uuid, p_query text, p_limit integer default 8, p_before timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  n integer := least(12, greatest(1, coalesce(p_limit, 8)));
  q tsquery;
  memories jsonb;
  messages jsonb;
  resident_messages jsonb;
begin
  if current_user not in ('service_role', 'postgres') then raise exception 'server role required' using errcode = '42501'; end if;
  if not exists(select 1 from public.orgs where id=p_org_id and slug='mccluster' and enabled=true) then raise exception 'organization outside Core authority' using errcode = '42501'; end if;
  if p_query is null or length(btrim(p_query))=0 or length(p_query)>500 then raise exception 'query must contain 1 to 500 characters'; end if;
  q := websearch_to_tsquery('english', p_query);
  select coalesce(jsonb_agg(t), '[]'::jsonb) into memories from (
    select id,memory_type,subject,left(content,1800) as content,confidence,status,sensitivity,source_message_ids,last_confirmed_at,updated_at
    from ai_context.memory_items where org_id=p_org_id and status='active' and fts @@ q
    and (valid_from is null or valid_from <= coalesce(p_before,now()))
    and (valid_until is null or valid_until > coalesce(p_before,now()))
    order by ts_rank_cd(fts,q) desc,updated_at desc limit n
  ) t;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into messages from (
    select m.id,m.conversation_id,m.role,left(m.content,1800) as content,coalesce(m.occurred_at,m.created_at) as occurred_at,c.title,s.provider
    from ai_context.messages m join ai_context.conversations c on c.id=m.conversation_id and c.org_id=m.org_id
    join ai_context.sources s on s.id=c.source_id
    where m.org_id=p_org_id and coalesce(m.occurred_at,m.created_at) <= coalesce(p_before,now()) and m.fts @@ q
    order by ts_rank_cd(m.fts,q) desc,m.created_at desc limit n
  ) t;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into resident_messages from (
    select id,thread_id,role,left(content,1800) as content,created_at from public.ops_ai_messages
    where org_id=p_org_id and created_at <= coalesce(p_before,now()) and to_tsvector('english',content) @@ q
    order by ts_rank_cd(to_tsvector('english',content),q) desc,created_at desc limit n
  ) t;
  return jsonb_build_object('query',p_query,'memories',memories,'messages',messages,'resident_messages',resident_messages,'observed_at',now());
end;
$$;
revoke all on function public.ops_ai_context_search(uuid,text,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.ops_ai_context_search(uuid,text,integer,timestamptz) to service_role;
commit;
