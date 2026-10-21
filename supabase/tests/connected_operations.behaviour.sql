-- Read-only acceptance against any populated house; no fabricated public posts.
begin;
do $$
declare org uuid; g jsonb;
begin
 if has_function_privilege('anon','public.ops_connected_graph_service(uuid,text,text,integer,integer)','execute')
 or has_function_privilege('authenticated','public.ops_connected_graph_service(uuid,text,text,integer,integer)','execute') then raise exception 'graph exposed to browser roles'; end if;
 if has_column_privilege('service_role','ai_context.decisions','decision','select') then raise exception 'raw decision text newly exposed'; end if;
 g:=public.ops_connected_graph_service('00000000-0000-4000-8000-000000000000','actor:royce.r01');
 if jsonb_array_length(g->'nodes')<>0 or jsonb_array_length(g->'edges')<>0 then raise exception 'cross-org leakage'; end if;
 select org_id into org from public.ops_platform_actors where actor_key='royce.r01';
 if org is not null then
  g:=public.ops_connected_graph_service(org,'actor:royce.r01','actor',3,80);
  if not exists(select 1 from jsonb_array_elements(g->'nodes') n where n->>'id'='actor:royce.r01' and n->>'label'='Royce') then raise exception 'actor not connected'; end if;
  if exists(select 1 from jsonb_array_elements(g->'edges') e where not exists(select 1 from jsonb_array_elements(g->'nodes') n where n->>'id'=e->>'source') or not exists(select 1 from jsonb_array_elements(g->'nodes') n where n->>'id'=e->>'target')) then raise exception 'dangling edge'; end if;
  g:=public.ops_connected_graph_service(org,'actor:royce.r01','actor',3,1);
  if jsonb_array_length(g->'nodes')>1 then raise exception 'node cap exceeded'; end if;
  g:=public.ops_connected_graph_service(org,null,'evidence',0,3);
  if jsonb_array_length(g->'nodes')>3 then raise exception 'browse cap exceeded'; end if;
 end if;
 begin
  perform public.ops_connected_graph_service('00000000-0000-4000-8000-000000000000',null,'actor',10,100);
  raise exception 'depth cap not enforced';
 exception when raise_exception then
  if sqlerrm<>'Invalid graph bounds' then raise; end if;
 end;
end $$;
rollback;
