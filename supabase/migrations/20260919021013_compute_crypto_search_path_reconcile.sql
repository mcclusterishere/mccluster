-- Reconcile compute SECURITY DEFINER functions with Supabase's pgcrypto extension schema.
-- Live Supabase installs digest() and gen_random_bytes() in extensions, while
-- these functions previously restricted search_path to public,pg_temp.

alter function public.compute_claim_task(text,text[],text[],integer)
  set search_path = pg_catalog, extensions, public, pg_temp;

alter function public.compute_start_lease(text,uuid,text,integer)
  set search_path = pg_catalog, extensions, public, pg_temp;

alter function public.compute_heartbeat_lease(text,uuid,text,jsonb,integer)
  set search_path = pg_catalog, extensions, public, pg_temp;

alter function public.compute_complete_lease(text,uuid,text,jsonb)
  set search_path = pg_catalog, extensions, public, pg_temp;

alter function public.compute_fail_lease(text,uuid,text,text,boolean)
  set search_path = pg_catalog, extensions, public, pg_temp;

alter function public.compute_enqueue_task(uuid,text,text,jsonb,jsonb,integer,timestamptz,integer,jsonb,text)
  set search_path = pg_catalog, extensions, public, pg_temp;
