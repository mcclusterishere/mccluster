import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../../workers/mccluster/src/platform-api.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../../js/mnet.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../../mnet.html',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../supabase/migrations/20261013201327_action_network_comments.sql',import.meta.url),'utf8');

/* Owner, 2026-10-14: "Three destinations. One small account menu. Contextual
   features everywhere else." World is the one surface; the avatar opens a
   compact account menu; every room that used to sit in a directory menu has
   a home where it belongs, and none of them is lost. */
test('the avatar opens a compact account menu, not a directory',()=>{
 assert.doesNotMatch(page,/<nav class="mn__tabs"/);
 assert.doesNotMatch(page,/<nav class="mn__quicklinks"/);
 const menu=page.match(/<nav class="mn__menu" id="mnMenu"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
 assert.ok(menu,'the account menu exists');
 assert.match(menu,/id="mnMenuName"/);
 assert.match(menu,/id="mnMenuHandle"/);
 assert.deepEqual([...menu.matchAll(/data-mn-view="([^"]+)"/g)].map(x=>x[1]),['profile','messages']);
 assert.deepEqual([...menu.matchAll(/href="([^"]+)"/g)].map(x=>x[1]),['account.html?stay=1']);
 assert.deepEqual([...menu.matchAll(/<(?:button|a)\b[^>]*>([^<]*)/g)].map(x=>x[1].replace(/&amp;/g,'&').trim()),
  ['View profile','Messages','Settings & account','Sign out']);
 assert.match(menu,/id="mnMessageBadge"/);
 assert.match(page,/id="mnMe"[^>]*aria-controls="mnMenu"/);
 assert.match(page,/id="mnToWorld"[^>]*data-mn-view="feed"/);
 assert.match(client,/function closeMenu\(restore\)/);
 assert.match(client,/e\.key === "Escape"/);
 assert.match(client,/\$\("mnSignOut"\)\.onclick/);
 assert.match(client,/MCC\.signOut\(\)[\s\S]{0,200}location\.replace\("mnet\.html"\)/,'signing out lands on the guest World');
 assert.match(client,/function refreshMessageBadge\(\)/,'message requests show on the avatar without opening Messages');
 assert.match(client,/function startPoll\(\)[\s\S]*?startPoll\(\);[\s\S]*?startPoll\(\);/,'returning members keep alerts current too');
 assert.doesNotMatch(page,/class="mn__manifesto"/);
});
test('every room that left the menu has a contextual home',()=>{
 /* Alerts: the bell, with its count */
 assert.match(page,/id="mnBell"[\s\S]{0,400}id="mnNotifBadge"/);
 assert.match(client,/\$\("mnBell"\)\.onclick = function \(\) \{ setView\("notifications"\); \}/);
 /* Missions: pins, the mission card, and search */
 const card=page.match(/<article class="mn__mission-card" id="mnWorldFocus"[\s\S]*?<\/article>/)?.[0]||'';
 assert.match(card,/data-mn-view="missions"/,'All missions from the mission card');
 const suggest=page.match(/<div class="mn__suggest" id="mnSuggest"[\s\S]*?<\/form>/)?.[0]||'';
 for(const view of ['missions','discover','groups'])assert.match(suggest,new RegExp('data-mn-view="'+view+'"'),view+' from the World search');
 /* People and Groups: the World search finds them */
 assert.match(client,/api\("\/v1\/mnet\/discover\?q=" \+ encodeURIComponent\(who\) \+ "&limit=3"\)/);
 assert.match(client,/function exploreGroups\(q\)/);
 assert.match(client,/kind === "group"\) \{ setView\("groups"\); openGroup\(id\)/);
 /* Clips: a door from the Music and Photos & video tabs, real terms only */
 assert.match(page,/id="mnClipDoor"[\s\S]{0,400}data-mn-view="clips"/);
 assert.match(client,/sbRpc\("clip_campaigns_open"/);
 /* Live: a badge over the globe; Go live in the composer */
 assert.match(page,/id="mnWorldLive"[^>]*data-mn-view="live"/);
 assert.match(page,/id="mnComposerLive"/);
 /* Create: the composer, folded or open */
 const composer=page.match(/<article class="mn__composer" id="mnComposer">[\s\S]*?<\/article>/)?.[0]||'';
 assert.equal([...composer.matchAll(/href="create\.html"/g)].length,2);
 /* A creator's analytics: their profile, shown only with a music creator profile */
 assert.match(page,/id="mnProfileAnalytics" hidden[\s\S]{0,400}href="creator\.html#artistAnalyticsHeading"/);
 assert.match(client,/music_creator_profiles\?m_uid=eq\./);
 /* The M Account: Settings & account. The Action Record and the block list: the profile */
 assert.match(page,/id="mnProfileRecord"[\s\S]{0,300}data-mn-view="missions"/);
 assert.match(client,/\$\("mnProfileBlocked"\)\.onclick = function \(\) \{ setView\("discover"\); loadBlocked\(\); \}/);
 /* the old directory links are gone from the network page */
 assert.doesNotMatch(page,/creator-capture\.html|creator-landing-analytics\.html/);
});
test('the World search is a bar in the header at every width, not an icon',()=>{
 const css=readFileSync(new URL('../../css/mnet.css',import.meta.url),'utf8');
 assert.doesNotMatch(page,/mnSearchToggle/);
 assert.doesNotMatch(client,/mn-search-open/);
 /* phone first: the bar is on outside any media query */
 const base=css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,'');
 assert.match(base,/\.mn-world-on \.mn__search \{ display: flex;/);
 assert.match(page,/id="mnSearchInput"[^>]*role="combobox"[^>]*aria-controls="mnSuggest"/);
 assert.match(client,/function refreshSuggest\(\)/,'late answers never reopen a closed panel');
});
test('Time rewind reads the feed from an earlier point, posts only, and says so',()=>{
 assert.match(page,/<section class="mn__rewind" id="mnRewind"[\s\S]*?data-rewind="0"[\s\S]*?data-rewind="24"[\s\S]*?data-rewind="168"[\s\S]*?data-rewind="720"/);
 assert.match(client,/else if \(reset && state\.world\.rewind\) path \+= "&before=" \+ encodeURIComponent\(new Date\(Date\.now\(\) - state\.world\.rewind \* 3600e3\)\.toISOString\(\)\)/,'the first page starts before the chosen moment; later pages follow the server cursor');
 assert.match(client,/"Posts from before " \+ rewindLabel\(hours\) \+ " ago\. The Earth stays live\."/,'the globe is not rewound and the line says so');
 assert.match(client,/No posts from before ' \+ esc\(rewindLabel\(state\.world\.rewind\)\) \+ ' ago in/);
 assert.match(client,/panel\.classList\.toggle\("is-rewound", !!hours\)/);
 assert.match(client,/return state\.world\.rewind \? setRewind\(0\) : loadFeed\(true\);/,'posting brings a rewound feed back to Live so the post is seen');
});
test('the World look is graphite and one red, scoped to the World screen',()=>{
 const css=readFileSync(new URL('../../css/mnet.css',import.meta.url),'utf8');
 const look=css.slice(css.indexOf('THE WORLD LOOK'));
 assert.match(look,/\.mn-world-on \.mn \{[^}]*--mn-hot: #ff2a4d/);
 assert.match(look,/--w-steel: linear-gradient\(180deg, #181b21, #0d0f13\)/);
 assert.doesNotMatch(look,/#0f1626|#131c31|#070b14/,'the navy of the earlier mockup is gone');
 assert.match(look,/\.mn-world-on \.mn__brand-world::after \{[^}]*background: var\(--mn-hot\)/,'the red rule under WORLD');
 assert.doesNotMatch(look,/\.appbar/,'the house bar is styled by the house');
 assert.match(look,/\.mn__world-tag \{ display: none;/,'the corner tag waits for tablet width, where the credit line leaves room');
});
test('a narrowed feed with nothing in it gives the whole feed back',()=>{
 assert.match(client,/data-world-unfilter/);
 assert.match(client,/setWorldFocus\(Object\.assign\(\{\}, state\.world\.focus, \{ filter: false \}\)\)/);
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
