import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('creator publish stores tenant-owned plain text via paid-only RPC',async()=>{
 const src=await read('workers/mccluster/src/creator-site-publish.js');
 const sql=await read('supabase/migrations/pending/20261009173000_creator_published_sites.sql');
 assert.match(src,/creator_publish_site/);
 assert.match(sql,/org_id uuid primary key/);
 assert.match(sql,/status='active' and current_period_end>now\(\)/);
 assert.match(sql,/current_user <> 'service_role'/);
});
test('public creator sites escape HTML and deny expired subscriptions',async()=>{
 const src=await read('workers/mccluster/src/creator-site-view.js');
 assert.match(src,/escapeHtml\(site\.bio\)/);
 assert.match(src,/escapeHtml\(site\.title\)/);
 assert.match(src,/current_period_end','gt\.'/);
 assert.match(src,/cache-control':'no-store'/);
 assert.match(src,/content-security-policy/);
});
