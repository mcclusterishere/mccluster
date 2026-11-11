import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('disposable reset stages the applied migration atomically and restores exact files on success and failure', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'music-reset-'));
  try {
    for(const dir of ['scripts','supabase/migrations','supabase/replay_migrations','bin']) await mkdir(path.join(root,dir),{recursive:true});
    await copyFile(new URL('../supabase-local-reset-with-replay.sh',import.meta.url),path.join(root,'scripts/reset.sh'));
    const name='20261031180839_music_direct_sales_v1.sql';
    const original="set local lock_timeout = '5s';\nlock table public.example in access exclusive mode;\n";
    await writeFile(path.join(root,'supabase/migrations',name),original);
    await writeFile(path.join(root,'supabase/replay_migrations/0001_fixture.sql'),'select 1;\n');
    const shim=path.join(root,'bin/supabase');
    await writeFile(shim,'#!/usr/bin/env bash\ncat "$FIXTURE_ROOT/supabase/migrations/'+name+'" > "$FIXTURE_ROOT/staged.sql"\nexit "$FIXTURE_EXIT"\n');
    await chmod(shim,0o755);
    for(const code of [0,7]){
      const r=spawnSync('bash',[path.join(root,'scripts/reset.sh')],{env:{...process.env,PATH:path.join(root,'bin')+path.delimiter+process.env.PATH,FIXTURE_ROOT:root,FIXTURE_EXIT:String(code)},encoding:'utf8'});
      assert.equal(r.status,code,r.stderr);
      assert.equal(await readFile(path.join(root,'staged.sql'),'utf8'),'begin;\n'+original+'\ncommit;\n');
      assert.equal(await readFile(path.join(root,'supabase/migrations',name),'utf8'),original);
      await assert.rejects(readFile(path.join(root,'supabase/migrations/0001_fixture.sql')), {code:'ENOENT'});
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});
