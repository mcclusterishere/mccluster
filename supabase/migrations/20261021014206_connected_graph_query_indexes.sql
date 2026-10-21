-- Measured graph reads scanned all durable job outputs for two actor reviews.
create index ops_actor_jobs_graph_idx on public.ops_agent_jobs(org_id,target_id,id)
 where job_type='actor_news_comment';
create index ops_actor_reviews_graph_idx on public.ops_agent_jobs(org_id,('actor_review:'||id::text))
 where job_type='actor_news_comment' and output ? 'review';
create index ops_ontology_graph_ref_idx on public.ops_ontology_objects(org_id,(type_key||':'||object_key));
-- Keep compilation overhead out of this small, bounded interactive query.
alter function public.ops_connected_graph_service(uuid,text,text,integer,integer) set jit=off;
analyze public.ops_agent_jobs;
analyze public.ops_ontology_objects;
