import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/migrations/pending/20261009223000_action_economy_risk_ledger.sql',import.meta.url),'utf8');
test('only one ledger posting function and a closed events definition',()=>{
 assert.equal((sql.match(/create or replace function public\.action_economy_post\(/g)||[]).length,1);
 assert.match(sql,/request_hash text not null check\(request_hash ~ '\^\[0-9a-f\]\{64\}\$'\),\s*metadata jsonb not null default '\{\}'::jsonb\s*\);/);
 assert.ok(sql.indexOf('create table if not exists public.action_economy_entries')<sql.indexOf('create or replace function public.action_economy_post('));
 assert.match(sql.trim(),/to service_role;$/);
});
