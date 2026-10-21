-- Expose only decision metadata required by the owner graph, not raw context or rationale.
grant select(id,org_id,title,status,created_at,risk_class,approved_at) on ai_context.decisions to service_role;

-- Expand bounded edge IDs before loading nodes, avoiding a cross-source join per hop.
create or replace function public.ops_connected_graph_service(p_org uuid,p_root text default null,p_kind text default 'actor',p_depth integer default 2,p_limit integer default 80)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ids text[]:='{}'; more text[]; nodes jsonb; edges jsonb; counts jsonb; i integer; clipped boolean:=false;
begin
 if current_user not in ('postgres','service_role') then raise insufficient_privilege; end if;
 if p_org is null or p_depth is null or p_depth not between 0 and 3 or p_limit is null or p_limit not between 1 and 100
 or (p_root is not null and (length(p_root)>550 or p_root !~ '^[a-z_]+:.+$')) then raise exception 'Invalid graph bounds'; end if;
 if p_root is null then
   select coalesce(array_agg(id),'{}') into ids from (
    select n.id from private.ops_connected_nodes n where n.org_id=p_org and (p_kind is null or n.kind=p_kind)
    order by n.occurred_at desc nulls last,n.id limit p_limit+1
   ) x;
   clipped:=cardinality(ids)>p_limit; ids:=ids[1:p_limit];
 else
   if exists(select 1 from private.ops_connected_nodes n where n.org_id=p_org and n.id=p_root) then ids:=array[p_root]; end if;
   for i in 1..p_depth loop
    select coalesce(array_agg(id),'{}') into more from (
     select distinct case when e.source=any(ids) then e.target else e.source end as id
     from private.ops_connected_edges e
     where e.org_id=p_org and (e.source=any(ids) or e.target=any(ids))
      and not((case when e.source=any(ids) then e.target else e.source end)=any(ids))
     order by id limit greatest(0,p_limit-cardinality(ids))+1
    ) x;
    if cardinality(more)>p_limit-cardinality(ids) then clipped:=true; end if;
    ids:=ids||more[1:greatest(0,p_limit-cardinality(ids))];
    exit when cardinality(more)=0 or cardinality(ids)>=p_limit;
   end loop;
 end if;
 select coalesce(array_agg(n.id),'{}') into ids from private.ops_connected_nodes n where n.org_id=p_org and n.id=any(ids);
 select coalesce(jsonb_agg(to_jsonb(n)-'org_id' order by n.category,n.occurred_at,n.id),'[]') into nodes
 from private.ops_connected_nodes n where n.org_id=p_org and n.id=any(ids);
 select coalesce(jsonb_agg(to_jsonb(e)-'org_id' order by e.source,e.relation,e.target),'[]') into edges
 from (select * from private.ops_connected_edges e where e.org_id=p_org and e.source=any(ids) and e.target=any(ids) order by e.source,e.relation,e.target limit 501) e;
 if jsonb_array_length(edges)>500 then clipped:=true; select jsonb_agg(value) into edges from (select value from jsonb_array_elements(edges) limit 500) e; end if;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.kind),'[]') into counts from (
   select n.kind,n.category,count(*) as count from private.ops_connected_nodes n where n.org_id=p_org group by n.kind,n.category
 ) c;
 return jsonb_build_object('schema','connected-operations/v1','root',p_root,'depth',p_depth,'limit',p_limit,'truncated',clipped,
  'nodes',nodes,'edges',edges,'counts',counts,'generated_at',now(),'basis','Existing source records and explicit relationships; connections do not establish causation.');
end $$;
revoke all on function public.ops_connected_graph_service(uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.ops_connected_graph_service(uuid,text,text,integer,integer) to service_role;
