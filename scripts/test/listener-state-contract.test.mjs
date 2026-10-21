import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/20261021125121_listener_state_v1.sql','utf8');
const client=readFileSync('js/pip.js','utf8');
test('listener state has an owned, bounded, authenticated-only schema',()=>{
 assert.match(sql,/profile_id\s+uuid primary key references auth\.users\(id\) on delete cascade/i);
 assert.match(sql,/pg_column_size\(state\) <= 4096/);
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/force row level security/i);
 assert.match(sql,/for all to authenticated[\s\S]*?profile_id = \(select auth\.uid\(\)\)/);
 assert.match(sql,/revoke all on public\.listener_state from public, anon, authenticated/i);
 assert.match(sql,/grant select, insert, update on public\.listener_state to authenticated/i);
 assert.doesNotMatch(sql,/grant (?:select|all) on public\.listener_state to anon/i);
});
test('Pocket uses same user identity and upsert contract',()=>{
 assert.match(client,/\/rest\/v1\/listener_state/);
 assert.match(client,/profile_id=eq\./);
 assert.match(client,/resolution=merge-duplicates/);
 assert.match(client,/JSON\.stringify\(\{ profile_id: uid, state: body \}\)/);
});
