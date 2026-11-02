#!/usr/bin/env python3
"""Two-connection PostgreSQL proof. --docker or local psql on localhost only.
Creates/drops its own scratch database; never accepts an external database URL.
"""
import concurrent.futures
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import uuid

ROOT=pathlib.Path(__file__).resolve().parents[2]
IMAGE='postgres@sha256:5db6dac2ef5dcff512f4f00a009c3c332b9f2f28f24277175bf3e4a3d02ef83a'
name='trial_proof_'+uuid.uuid4().hex[:10]
docker=sys.argv[1:]==['--docker']
assert sys.argv[1:] in ([],['--docker'])
assert docker or os.environ.get('PGHOST','localhost') in ('localhost','127.0.0.1','::1'), 'Local disposable PostgreSQL only'
assert docker or not any(os.environ.get(k) for k in ('PGSERVICE','PGSERVICEFILE','PGHOSTADDR')), 'No opaque service target'
prefix=['docker','exec','-i',name,'psql','-U','postgres'] if docker else ['psql','-h',os.environ.get('PGHOST','127.0.0.1')]
def sql(s,database=name,check=True):
    return subprocess.run(prefix+['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-d',database],input=s,text=True,capture_output=True,check=check)
def pair(a,b):
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        futures=[pool.submit(sql,s,check=False) for s in (a,b)]
        results=[f.result() for f in futures]
    assert sorted(r.returncode==0 for r in results)==[False,True], [r.stderr for r in results]
    assert 'PT409' in next(r.stderr for r in results if r.returncode), [r.stderr for r in results]
    return results
A='11111111-1111-4111-8111-111111111111'
O='33333333-3333-4333-8333-333333333333'
service="set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false);"
admin="set role authenticated; select set_config('request.jwt.claims','{\"role\":\"authenticated\",\"sub\":\""+O+"\"}',false);"
try:
    if docker:
        subprocess.run(['docker','run','-d','--name',name,'--network','none','-e','POSTGRES_PASSWORD=disposable-test-only',IMAGE],check=True,capture_output=True)
        subprocess.run(['docker','exec',name,'bash','-c','for n in {1..30}; do pg_isready -h 127.0.0.1 -U postgres >/dev/null && exit 0; sleep 1; done; exit 1'],check=True)
    sql('create database '+name,database='postgres')
    pins=json.loads((ROOT/'supabase/tests/editor-versioned/domain-trial-hashes.json').read_text())
    for path,expected in pins.items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==expected,path
    for f in ['api-roles','account-fixture','domain-trial-catalog','managed-projects']:
        sql((ROOT/f'supabase/tests/editor-versioned/{f}.sql').read_text())
    for f in ['supabase/pending/creator_domain_orders_v1.sql','supabase/migrations/20261009204152_creator_billing_subscriptions_v1.sql','supabase/pending/creator_domain_trial_v1.sql']:
        sql((ROOT/f).read_text())
    sql(f"""insert into orgs values('{A}','alice');insert into org_members values('{A}','{A}','owner');
    insert into platform_apps(app_key,name,product_family) values('social','Social','fixture');
    insert into private.creator_domain_trial_policies values(1,true,'registration_verified','fixed_30_days','once_per_org',false,3600);
    insert into private.creator_domain_trial_modules select 1,id,true,true,null from platform_apps;
    insert into creator_domain_contacts(auth_user_id,provider_contact_id,terms_version,consent_at,verified_at) values('{A}','contact1','v1',now(),now());
    insert into creator_domain_quotes(auth_user_id,hostname,action,years,total_cents,registrar_cents,currency,expires_at) values('{A}','example.test','register',1,1200,1000,'USD',now()+interval '1 hour');
    insert into creator_domain_orders(auth_user_id,quote_id,contact_id,terms_version,status,checkout_session_id,funded_event_id,paid_cents,funded_at)
    select '{A}',q.id,c.id,'v1','fulfilled','cs_fixture','evt_fixture',1200,now()-interval '1 hour' from creator_domain_quotes q cross join creator_domain_contacts c;
    create table fixture_evidence as select jsonb_build_object('source','verified_registrar_readback','mode','live','hostname','example.test','registration_id','reg1','registrant_contact_id','contact1','registrant_verified',true,'charge_verified',true,'registrar_cents',1000,'currency','USD','term_years',1,'registered_at',now()-interval '30 minutes','expires_at',now()+interval '1 year','observed_at',now()) e;
    grant select on fixture_evidence to service_role;""")
    order=sql('select id from creator_domain_orders').stdout.strip()
    call=f"select creator_domain_trial_record_v1('{A}','{A}','{order}','race:event',(select e from fixture_evidence));"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:sql('begin;'+service+call+'select pg_sleep(0.2);commit;',check=False),range(2)))
    assert all(r.returncode==0 for r in results),[r.stderr for r in results]
    assert sql('select count(*) from private.creator_domain_trial_receipts').stdout.strip()=='1'
    assert sql('select count(*) from private.creator_domain_trial_events').stdout.strip()=='1'
    print('PASS two concurrent identical events: one receipt/event, both idempotent success')
    conflict=call.replace("'race:event'","'race:new'").replace('(select e from fixture_evidence)',"(select e||'{\"registration_id\":\"different\"}'::jsonb from fixture_evidence)")
    cancel=f"select creator_domain_trial_cancel_v1('{A}','{A}','{order}','cancel:{order}');"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        futures=[pool.submit(sql,'begin;'+service+c+'commit;',check=False) for c in [call,cancel]]
        results=[f.result() for f in futures]
    assert all(r.returncode==0 for r in results),[r.stderr for r in results]
    assert sql("select cancelled_at is not null from private.creator_domain_trial_receipts").stdout.strip()=='t'
    assert 'PT409' in sql(service+conflict,check=False).stderr
    assert sql(service+f"select creator_platform_access_v1('{A}','{A}','social')->'capabilities'->'advanced'->>'allowed';").stdout.splitlines()[-1]=='false'
    print('PASS concurrent retry/cancel: cancellation persists; changed evidence rejects PT409')
finally:
    if docker:subprocess.run(['docker','rm','-f',name],capture_output=True)
    else:sql('drop database if exists '+name,database='postgres',check=False)
