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
name='editor_proof_'+uuid.uuid4().hex[:10]
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
    pins=json.loads((ROOT/'supabase/tests/editor-versioned/fixture-hashes.json').read_text())
    for path,expected in pins.items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==expected,path
    for f in ['api-roles','storage','account-fixture','site-content','site-content-service','member-fronts','managed-projects','project-identity']:
        sql((ROOT/f'supabase/tests/editor-versioned/{f}.sql').read_text())
    sql(f"insert into managed_projects(slug,owner_user_id,m_uid,name) values ('race-project','{A}','{A}','Race');")
    sql((ROOT/'supabase/tests/editor-versioned/editor-contract-c150.sql').read_text())
    migration=(ROOT/'supabase/pending/editor_versioned_contracts_v1.sql').read_text()
    sql(migration);sql(migration)
    for kind,opening,call in [
      ('project',service,f"select editor_owned_v2('{A}','project','race-project','save',0,'{{}}');"),
      ('site',admin,"select site_content_v2('index.html','@front','save',0,'{\"value\":\"race\"}');"),
      ('front',service,f"select editor_owned_v2('{A}','front','me','save',0,'{{}}');")]:
        pair('begin;'+opening+call+'select pg_sleep(0.3);commit;','begin;'+opening+call+'commit;')
        print('PASS two concurrent '+kind+' writers: exactly one commit, one PT409 conflict')
    pair('begin;'+service+f"select editor_owned_v2('{A}','project','race-project','withdraw',1);select pg_sleep(0.3);commit;",'begin;'+service+f"select editor_owned_v2('{A}','project','race-project','save',1,'{{}}');commit;")
    state=json.loads(sql(service+f"select editor_owned_v2('{A}','project','race-project');").stdout.splitlines()[-1])
    if not state['owner_withdrawn']:
        sql(service+f"select editor_owned_v2('{A}','project','race-project','withdraw',2);")
        revision=3
    else:revision=2
    pair('begin;'+service+f"select editor_owned_v2('{A}','project','race-project','recover',{revision});select pg_sleep(0.3);commit;",'begin;'+service+f"select editor_owned_v2('{A}','project','race-project','recover',{revision});commit;")
    state=json.loads(sql(service+f"select editor_owned_v2('{A}','project','race-project');").stdout.splitlines()[-1])
    assert state['snapshot']['removed_at'] is None and state['snapshot']['published'] is None and not state['owner_withdrawn']
    print('PASS concurrent withdrawal/save and duplicate recovery: one winner; retained draft; no publication')
    # Hold a publish transaction; an already waiting legacy safety takedown must
    # complete afterwards, rather than be overwritten by the stale publication.
    publish='begin;'+service+f"select editor_owned_v2('{A}','front','me','publish',1,'{{}}');select pg_sleep(0.5);commit;"
    takedown='begin;'+service+"update member_fronts set removed_at=now(),published=null,published_at=null where handle='alice';commit;"
    # Explicitly establish lock acquisition without relying on thread scheduling.
    proc=subprocess.Popen(prefix+['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',name],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    proc.stdin.write('begin;'+service+f"select editor_owned_v2('{A}','front','me','publish',1,'{{}}');\n\\echo READY\n");proc.stdin.flush()
    while True:
        line=proc.stdout.readline()
        if line.strip()=='READY':break
        if not line:raise RuntimeError(proc.stderr.read())
    with concurrent.futures.ThreadPoolExecutor(1) as pool:
        future=pool.submit(sql,takedown)
        proc.stdin.write('commit;\n');proc.stdin.close()
        assert proc.wait(timeout=10)==0
        future.result()
    state=json.loads(sql(service+f"select editor_owned_v2('{A}','front','me');").stdout.splitlines()[-1])
    assert state['revision']==3 and state['snapshot']['removed_at'] and state['snapshot']['published'] is None
    rejected=sql(service+f"select editor_owned_v2('{A}','front','me','publish',2,'{{}}');",check=False)
    assert rejected.returncode and 'PT409' in rejected.stderr
    print('PASS native publish/takedown serialization; final removed state retained; stale publish rejected')
finally:
    if docker:subprocess.run(['docker','rm','-f',name],capture_output=True)
    else:sql('drop database if exists '+name,database='postgres',check=False)
