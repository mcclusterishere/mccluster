-- Vault-backed scheduler for Policy OS workers. No credential is embedded in a
-- cron command or public table. Configure once after Edge Function deployment,
-- then install/reinstall the schedules with eu_cron_install_service().

create table if not exists private.eu_runtime (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  project_url_secret_id uuid not null,
  worker_secret_id uuid not null,
  google_secret_id uuid,
  configured_at timestamptz not null default now()
);
revoke all on table private.eu_runtime from public,anon,authenticated;
grant select,insert,update,delete on private.eu_runtime to service_role;

create or replace function public.eu_runtime_configure_service(
 p_org uuid,p_project_url text,p_worker_secret text,p_google_secret text default null
) returns void language plpgsql security definer set search_path=pg_catalog,public,private,vault as $$
declare u uuid;w uuid;g uuid;
begin
 if p_project_url is null or p_project_url !~ '^https://[A-Za-z0-9.-]+$' then raise exception 'valid https project url required'; end if;
 if p_worker_secret is null or length(p_worker_secret)<24 then raise exception 'worker secret must be at least 24 characters'; end if;
 select vault.create_secret(rtrim(p_project_url,'/'),'eu-project-url-'||p_org,'Equity Uprise Edge Functions base URL') into u;
 select vault.create_secret(p_worker_secret,'eu-worker-secret-'||p_org,'Equity Uprise internal worker bearer') into w;
 if coalesce(p_google_secret,'')<>'' then select vault.create_secret(p_google_secret,'eu-google-secret-'||p_org,'Equity Uprise Google workspace internal bearer') into g; end if;
 insert into private.eu_runtime(org_id,project_url_secret_id,worker_secret_id,google_secret_id)
 values(p_org,u,w,g) on conflict(org_id) do update set project_url_secret_id=excluded.project_url_secret_id,worker_secret_id=excluded.worker_secret_id,google_secret_id=excluded.google_secret_id,configured_at=now();
end;$$;
revoke all on function public.eu_runtime_configure_service(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.eu_runtime_configure_service(uuid,text,text,text) to service_role;

create or replace function private.eu_runtime_secret(p_id uuid)
returns text language sql stable security definer set search_path=pg_catalog,vault as $$
 select decrypted_secret from vault.decrypted_secrets where id=p_id;
$$;
revoke all on function private.eu_runtime_secret(uuid) from public,anon,authenticated;

create or replace function private.eu_cron_worker(p_path text,p_limit integer default 20)
returns bigint language plpgsql security definer set search_path=pg_catalog,public,private,net as $$
declare r private.eu_runtime%rowtype; base text; secret text; req bigint;
begin
 select * into r from private.eu_runtime order by configured_at desc limit 1;
 if r.org_id is null then return null; end if;
 base:=private.eu_runtime_secret(r.project_url_secret_id); secret:=private.eu_runtime_secret(r.worker_secret_id);
 if coalesce(base,'')='' or coalesce(secret,'')='' then return null; end if;
 select net.http_post(url=>rtrim(base,'/')||'/functions/v1/'||p_path,
   headers=>jsonb_build_object('content-type','application/json','x-eu-worker-secret',secret),
   body=>jsonb_build_object('limit',greatest(1,least(coalesce(p_limit,20),50))),timeout_milliseconds=>15000) into req;
 return req;
end;$$;
revoke all on function private.eu_cron_worker(text,integer) from public,anon,authenticated;

create or replace function private.eu_cron_google(p_action text)
returns bigint language plpgsql security definer set search_path=pg_catalog,public,private,net as $$
declare r private.eu_runtime%rowtype; base text; secret text; req bigint;
begin
 select * into r from private.eu_runtime where google_secret_id is not null order by configured_at desc limit 1;
 if r.org_id is null then return null; end if;
 base:=private.eu_runtime_secret(r.project_url_secret_id); secret:=private.eu_runtime_secret(r.google_secret_id);
 if coalesce(base,'')='' or coalesce(secret,'')='' then return null; end if;
 select net.http_post(url=>rtrim(base,'/')||'/functions/v1/eu-google-workspace',
   headers=>jsonb_build_object('content-type','application/json','x-eu-google-secret',secret),
   body=>jsonb_build_object('action',p_action),timeout_milliseconds=>30000) into req;
 return req;
end;$$;
revoke all on function private.eu_cron_google(text) from public,anon,authenticated;

create or replace function public.eu_cron_install_service()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,cron as $$
declare j bigint;
begin
 if not exists(select 1 from private.eu_runtime) then raise exception 'configure eu_runtime first'; end if;
 begin perform cron.unschedule('eu-core-worker'); exception when others then null; end;
 begin perform cron.unschedule('eu-external-worker'); exception when others then null; end;
 begin perform cron.unschedule('eu-monitor'); exception when others then null; end;
 begin perform cron.unschedule('eu-google-watch-renew'); exception when others then null; end;
 begin perform cron.unschedule('eu-google-history-safety-sync'); exception when others then null; end;
 select cron.schedule('eu-core-worker','* * * * *',$$select private.eu_cron_worker('eu-worker',20);$$) into j;
 select cron.schedule('eu-external-worker','* * * * *',$$select private.eu_cron_worker('eu-external-worker',20);$$) into j;
 select cron.schedule('eu-monitor','*/10 * * * *',$$select private.eu_cron_worker('eu-monitor',20);$$) into j;
 if exists(select 1 from private.eu_runtime where google_secret_id is not null) then
   select cron.schedule('eu-google-watch-renew','17 8 * * *',$$select private.eu_cron_google('gmail.watch.renew');$$) into j;
   select cron.schedule('eu-google-history-safety-sync','47 * * * *',$$select private.eu_cron_google('gmail.sync');$$) into j;
 end if;
 return jsonb_build_object('installed',true,'core','every minute','external','every minute','monitors','every 10 minutes','gmail_watch','daily','gmail_sync','hourly');
end;$$;
revoke all on function public.eu_cron_install_service() from public,anon,authenticated;
grant execute on function public.eu_cron_install_service() to service_role;
