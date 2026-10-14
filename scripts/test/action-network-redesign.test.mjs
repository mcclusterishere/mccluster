import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../../workers/mccluster/src/platform-api.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../../js/mnet.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../../mnet.html',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../supabase/migrations/20261013201327_action_network_comments.sql',import.meta.url),'utf8');

/* Owner, 2026-10-14 (WORLD-SCREEN-UX-HANDOFF-20261014.md): World is the one
   surface. No competing tab row inside the network; profile, inbox, alerts and
   the other rooms are contextual, behind the avatar, and none of them is lost. */
test('World is the only surface: no second tab row, every room behind the avatar',()=>{
 assert.doesNotMatch(page,/<nav class="mn__tabs"/);
 assert.doesNotMatch(page,/<nav class="mn__quicklinks"/);
 const menu=page.match(/<nav class="mn__menu" id="mnMenu"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
 assert.ok(menu,'the avatar menu exists');
 assert.deepEqual([...menu.matchAll(/data-mn-view="([^"]+)"/g)].map(x=>x[1]),['profile','messages','notifications','missions','discover','groups','clips','live']);
 assert.match(menu,/href="creator-capture\.html"/,'Record/Create stays reachable');
 assert.match(menu,/href="creator-landing-analytics\.html"/,'creator analytics stays reachable, not as a tab');
 assert.match(page,/id="mnMe"[^>]*aria-controls="mnMenu"/);
 assert.match(page,/id="mnToWorld"[^>]*data-mn-view="feed"/);
 assert.match(client,/function closeMenu\(restore\)/);
 assert.match(client,/e\.key === "Escape"/);
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
