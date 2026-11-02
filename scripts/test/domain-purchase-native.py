#!/usr/bin/env python3
"""Real concurrent-session proof; network-isolated disposable PostgreSQL only.
Default: pinned Docker image. --local: disposable scratch database on a localhost
PostgreSQL via psql (same convention as editor-versioned-native.py); never an
external/operational database URL.
"""
import concurrent.futures
import json
import os
import pathlib
import subprocess
import sys
import uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
assert sys.argv[1:] in ([],['--local']),'usage: domain-purchase-native.py [--local]'
local=sys.argv[1:]==['--local']
assert not local or os.environ.get('PGHOST','localhost') in ('localhost','127.0.0.1','::1'),'Local disposable PostgreSQL only'
assert not local or not any(os.environ.get(k) for k in ('PGSERVICE','PGSERVICEFILE','PGHOSTADDR')),'No opaque service target'
IMAGE='postgres@sha256:5db6dac2ef5dcff512f4f00a009c3c332b9f2f28f24277175bf3e4a3d02ef83a'
name='domain_proof_'+uuid.uuid4().hex[:10]
A='11111111-1111-4111-8111-111111111111'
B='22222222-2222-4222-8222-222222222222'
DB=name if local else 'postgres'
prefix=['psql','-h',os.environ.get('PGHOST','127.0.0.1')] if local else ['docker','exec','-i',name,'psql','-U','postgres']
def sql(text,check=True,database=None):
 return subprocess.run(prefix+['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',database or DB],input=text,text=True,capture_output=True,check=check)
def parallel(a,b):
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  return [f.result() for f in [pool.submit(sql,a,False),pool.submit(sql,b,False)]]
def seed(owner,host,key):
 return sql(f"""with c as (insert into creator_domain_contacts(auth_user_id,provider_contact_id,terms_version,consent_at,verified_at) values('{owner}','{key}','fixture',now(),now()) returning id), q as (insert into creator_domain_quotes(auth_user_id,hostname,action,years,total_cents,registrar_cents,currency,expires_at) values('{owner}','{host}','register',1,1200,1000,'USD',now()+interval '1 hour') returning id) insert into creator_domain_orders(auth_user_id,quote_id,contact_id,terms_version,checkout_session_id) select '{owner}',q.id,c.id,'fixture','cs_{key}' from q,c returning id;""").stdout.strip()
try:
 if local:
  sql('create database '+name,database='postgres')
  for role,extra in (('anon',''),('authenticated',''),('service_role',' bypassrls')):
   sql(f"do $$ begin if not exists (select 1 from pg_roles where rolname='{role}') then create role {role}{extra}; end if; end $$;")
 else:
  subprocess.run(['docker','run','-d','--name',name,'--network','none','-e','POSTGRES_PASSWORD=disposable-test-only',IMAGE],check=True,capture_output=True)
  subprocess.run(['docker','exec',name,'bash','-c','for n in {1..30}; do pg_isready -h 127.0.0.1 -U postgres >/dev/null && exit 0; sleep 1; done; exit 1'],check=True)
 sql(("" if local else "create role anon;create role authenticated;create role service_role bypassrls;")+f"create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('{A}'),('{B}');")
 for file in ['creator_domain_orders_v1.sql','creator_cf_registration_attempts_v1.sql']:sql((ROOT/'supabase/pending'/file).read_text())
 first=seed(A,'race.org','first');second=seed(B,'race.org','second')
 funding=f"set role service_role;select fund_creator_domain_order('{first}','{A}','evt_first','cs_first',1200,'USD',now());"
 results=parallel(funding,funding)
 assert all(r.returncode==0 and r.stdout.strip()=='funded' for r in results),[(r.stdout,r.stderr) for r in results]
 assert sql(f"select count(*) from creator_domain_orders where id='{first}' and funded_event_id='evt_first' and status='funded';").stdout.strip()=='1'
 print('PASS concurrent duplicate funding: one recorded paid order, idempotent status')
 sql(f"select fund_creator_domain_order('{second}','{B}','evt_second','cs_second',1200,'USD',now());")
 claim=lambda order,owner:f"begin;set role service_role;select claim_cf_registration_attempt('{order}','{owner}','fixture-contact','{'a'*64}');select pg_sleep(0.2);commit;"
 results=parallel(claim(first,A),claim(second,B))
 assert sorted(r.returncode==0 for r in results)==[False,True],[(r.stdout,r.stderr) for r in results]
 assert 'unique constraint' in next(r.stderr for r in results if r.returncode)
 assert sql("select count(*) from creator_cf_registration_attempts where hostname='race.org';").stdout.strip()=='1'
 assert sql("select count(*) from creator_domain_orders where status='funded';").stdout.strip()=='1'
 print('PASS concurrent same-host claims: one durable attempt; loser rolls back funded state, no second provider submit authority')
 # Both racing claims on the same funded order: one claims, the other returns null.
 third=seed(A,'third.org','third')
 sql(f"select fund_creator_domain_order('{third}','{A}','evt_third','cs_third',1200,'USD',now());")
 results=parallel(claim(third,A),claim(third,A))
 assert all(r.returncode==0 for r in results),[r.stderr for r in results]
 assert sum('auth_user_id' in r.stdout for r in results)==1
 print('PASS concurrent same-order claims: exactly one submission authority')
finally:
 if local:
  sql('drop database if exists '+name,database='postgres')
 else:
  subprocess.run(['docker','rm','-f',name],capture_output=True)
