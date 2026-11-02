#!/usr/bin/env python3
"""Replay reviewed SQL on a new network-isolated PostgreSQL container.
No database URL, production credentials, or existing container is accepted.
Usage: python3 replay-prepared.py /path/to/checkout-at-5e020833
"""
import hashlib
import json
import pathlib
import subprocess
import sys
import uuid

ROOT = pathlib.Path(__file__).resolve().parent
IMAGE = 'postgres@sha256:5db6dac2ef5dcff512f4f00a009c3c332b9f2f28f24277175bf3e4a3d02ef83a'
candidate = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads((ROOT / 'migration-manifest.json').read_text())
for item in manifest['prepared']:
    blob = (ROOT / item['path']).read_bytes()
    assert hashlib.sha256(blob).hexdigest() == item['sha256'], item['path']
    assert blob == (candidate / item['source_path']).read_bytes(), item['source_path']
name = 'productization-proof-' + uuid.uuid4().hex[:12]
def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)
def sql(text):
    return run('docker', 'exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', input=text)
try:
    run('docker', 'run', '-d', '--name', name, '--network', 'none', '-e', 'POSTGRES_PASSWORD=disposable-test-only', IMAGE)
    run('docker', 'exec', name, 'bash', '-c', 'for n in {1..30}; do pg_isready -h 127.0.0.1 -U postgres >/dev/null && exit 0; sleep 1; done; exit 1')
    for f in ['supabase_api_roles.stub.sql', 'supabase_storage.stub.sql']:
        sql((candidate / 'supabase/tests' / f).read_text())
    sql('''alter table m_people add column status text default 'active';
create table m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);
create table network_profiles(m_uid uuid,visibility text);
create table orgs(id uuid primary key,slug text);
create table org_members(org_id uuid,profile_id uuid,role text);
grant select on m_people,m_auth_user_links,network_profiles,orgs,org_members to service_role;''')
    for iteration in [1, 2]:
        for item in manifest['prepared']:
            if iteration == 2 and item['optional']:
                attempt = subprocess.run(['docker', 'exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=(ROOT / item['path']).read_text(), capture_output=True, text=True)
                assert attempt.returncode == 3 and 'relation "canonical_artist_bindings" already exists' in attempt.stderr, attempt.stderr
                print('PASS optional artist migration is ONE SHOT: repeated application fails closed, transaction disconnect rolls back', flush=True)
                continue
            sql((ROOT / item['path']).read_text())
        print('PASS ordered replay', iteration, flush=True)
    sql('''do $$ declare t text; r text; f record; begin
foreach t in array array['member_fronts','managed_projects','customer_site_modules','customer_site_addresses','customer_site_storage_reservations','canonical_artist_bindings','canonical_artist_binding_events'] loop
 if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity and relforcerowsecurity) then raise exception 'RLS missing: %',t; end if;
 foreach r in array array['anon','authenticated'] loop
  if has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'browser privilege: % %',r,t; end if;
 end loop;
end loop;
if not exists(select 1 from pg_trigger where tgrelid='public.managed_projects'::regclass and tgname='managed_project_identity_v1' and not tgisinternal) then raise exception 'identity trigger missing'; end if;
if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='site media writes require quota service' and permissive='RESTRICTIVE') then raise exception 'storage boundary missing';end if;
for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('canonical_artist_binding_v1','customer_site_address_assign_v1','customer_site_module_set_v1','customer_site_storage_reserve_v1','customer_site_storage_usage_v1') loop
 if has_function_privilege('anon',f.oid,'execute') or has_function_privilege('authenticated',f.oid,'execute') or not has_function_privilege('service_role',f.oid,'execute') then raise exception 'RPC execute authority drift';end if;
end loop;
end $$;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,p.prosecdef as security_definer,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname ~ '^(customer_site_|canonical_artist_|guard_managed_)' order by p.proname;''')
    print('PASS catalog: forced RLS, browser revokes, identity trigger, restrictive Storage policy; RPC permission inventory above')
finally:
    subprocess.run(['docker', 'rm', '-f', name], check=False)
