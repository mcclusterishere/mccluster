import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../../workers/mccluster/src/platform-api.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../../js/mnet.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../../mnet.html',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../supabase/migrations/20261013190000_action_network_comments.sql',import.meta.url),'utf8');

test('only four top-level Action Network tabs',()=>{
 const nav=page.match(/<nav class="mn__tabs"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
 assert.ok(nav);
 assert.deepEqual([...nav.matchAll(/data-mn-view="([^"]+)"/g)].map(x=>x[1]),['feed','missions','messages','profile']);
 assert.doesNotMatch(page,/class="mn__manifesto"/);
});
test('text-only post does not shadow analytics track function',()=>{
 assert.match(client,/var selectedTrack = pickedTrack\(\)/);
 assert.match(client,/track\("mnet_post_created"/);
 assert.doesNotMatch(client,/var track = pickedTrack\(\)/);
});
test('comment and like APIs enforce visibility and authenticated sessions',()=>{
 assert.match(worker,/if\(replies&&\['GET','POST'\]\.includes\(req.method\)\)/);
 assert.match(worker,/if\(!post\|\|!\(await canReadNetworkPost\(env,muid,post\)\)\)/);
 assert.match(worker,/network_post_comments/);
 assert.match(worker,/network_reactions/);
 assert.match(client,/data-action="comments"/);
 assert.match(client,/data-action="like"/);
});
test('comments are private by default with length constraints',()=>{
 assert.match(migration,/enable row level security/);
 assert.match(migration,/revoke all on public.network_post_comments from anon,authenticated/);
 assert.match(migration,/char_length\(btrim\(body\)\) between 1 and 1000/);
});
