#!/usr/bin/env python3
"""Compare aggregate preflight normalization with pinned source, on synthetic rows only."""
import json
import pathlib
import subprocess
import uuid

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[2]
REF = '9d7a7eedc495bb577da1df879cbf7a8fe7aa1cfa'
IMAGE = 'postgres@sha256:5db6dac2ef5dcff512f4f00a009c3c332b9f2f28f24277175bf3e4a3d02ef83a'
name = 'productization-lyric-proof-' + uuid.uuid4().hex[:10]
def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)
def sql(value):
    return run('docker', 'exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', input=value)
source = subprocess.check_output(['git','show',REF+':supabase/pending/music_lyric_revisions_v1.sql'],cwd=REPO,text=True)
function = source[source.index('create or replace function public.music_lyric_public_payload'):source.index('revoke all on function public.music_lyric_public_payload')]
samples = [None, {}, [], 'text', 2, {'plain':'ok'}, {'plain':False}, {'title':'synthetic','_history':[{'reviewed':True}]},
 {'timed':{'line':[]}}, {'timed':{'line':'invalid'}}, {'timed':{'line':[None,'text',{'content':'A','begin':0}]}},
 {'plain':'outdated','timed':{'line':[{'content':'A','begin':0,'end':1,'secret':True},{'content':'B','begin':1}]}},
 {'duration_seconds':2,'artist':'synthetic','timed':{'line':[{'content':'A','begin':0,'words':[{'content':'A','begin':0,'end':1,'secret':True},None,{'content':'bad'}]}]}},
 {'duration_seconds':'bad','language':1,'timed':{'line':[{'content':2,'begin':0},{'content':'B','begin':'bad'}]}}]
preflight = (ROOT/'lyric-impact-preflight.sql').read_text()
prefix = preflight[:preflight.index('select count(*) as total_tracks')]
try:
    run('docker','run','-d','--name',name,'--network','none','-e','POSTGRES_PASSWORD=disposable-test-only',IMAGE)
    run('docker','exec',name,'bash','-c','for n in {1..30}; do pg_isready -h 127.0.0.1 -U postgres >/dev/null && exit 0; sleep 1; done; exit 1')
    sql(function + '''create table public.creator_tracks(id int primary key,lyrics jsonb,reviewed_snapshot jsonb,status text,rights_status text,published_at timestamptz);''')
    for i,item in enumerate(samples):
        literal=json.dumps(item).replace("'","''")
        # Test SQL NULL independently from JSON null; preserve snapshot key presence.
        lyric='NULL' if i==0 else "'"+literal+"'::jsonb"
        sql(f"insert into creator_tracks values ({i},{lyric},jsonb_build_object('lyrics','{literal}'::jsonb),'published','cleared',now());")
    sql(prefix + "select 1 / case when count(*)=0 then 1 else 0 end as normalization_matches_source from normalized where clean is distinct from public.music_lyric_public_payload(payload);")
    sql(prefix + "select 1 / case when (select count(*) from affected)=(select count(*) from creator_tracks t where t.lyrics is distinct from public.music_lyric_public_payload(t.lyrics) or (t.reviewed_snapshot ? 'lyrics' and t.reviewed_snapshot->'lyrics' is distinct from coalesce(public.music_lyric_public_payload(t.reviewed_snapshot->'lyrics'),'null'::jsonb))) then 1 else 0 end as impact_matches_source;")
    sql(preflight)
    print('PASS: 28 synthetic lyric/snapshot documents match pinned sanitizer; aggregate affected count matches migration predicate. No production query or payload output.')
finally:
    subprocess.run(['docker','rm','-f',name],check=False)
