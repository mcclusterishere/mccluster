import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../../supabase/migrations/pending/20261009234500_creator_clip_lifecycle_reporting.sql',import.meta.url),'utf8');
test('creator clip report derives data from authoritative marketplace tables',()=>{
 for(const name of ['action_clip_claims','action_clip_submissions','action_clip_earnings'])
  assert.match(sql,new RegExp('public\\.'+name));
});
test('verification is distinguished from submission',()=>{
 assert.match(sql,/verified_at is not null/);
 assert.match(sql,/verified_count/);
 assert.match(sql,/submitted_count/);
});
test('only payable and paid earnings count as eligible',()=>{
 assert.match(sql,/e\.state in \('payable','paid'\)/);
 assert.match(sql,/e\.state='paid'/);
});
test('view is invoker-security and not directly accessible to users',()=>{
 assert.match(sql,/security_invoker=true/);
 assert.match(sql,/revoke all on public\.creator_clip_lifecycle_summary from public,anon,authenticated/);
 assert.match(sql,/grant select on public\.creator_clip_lifecycle_summary to service_role/);
});
