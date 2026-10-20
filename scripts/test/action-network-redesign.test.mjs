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
test('Time rewind is tucked away (owner, 2026-10-15: "that button is taking up too much space"): no panel, no code',()=>{
 const css=readFileSync(new URL('../../css/mnet.css',import.meta.url),'utf8');
 for(const [name,text] of [['the page',page],['the script',client],['the stylesheet',css]]) assert.doesNotMatch(text,/rewind/i,name+' carries no rewind');
 assert.match(client,/return loadFeed\(true\);/,'posting reloads the live feed');
});
test('the World look is graphite and one red, scoped to the World screen',()=>{
 const css=readFileSync(new URL('../../css/mnet.css',import.meta.url),'utf8');
 const look=css.slice(css.indexOf('THE WORLD LOOK'));
 assert.match(look,/\.mn-world-on \.mn \{[^}]*--mn-hot: #ff2a4d/);
 assert.match(look,/--w-steel: linear-gradient\(180deg, #181b21, #0d0f13\)/);
 assert.doesNotMatch(look,/#0f1626|#131c31|#070b14/,'the navy of the earlier mockup is gone');
 assert.match(look,/\.mn-world-on \.mn__top \.mn__brand strong::after \{[^}]*background: var\(--mn-hot\)/,'the red rule under EQUITY UPRISE');
 assert.doesNotMatch(page,/mn__brand-world/,'the wordmark is Equity Uprise, and only that');
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
test('the emblem or Fund it: no like, comment or reaction; a mission post offers the emblem and the governed rail',()=>{
 const css=readFileSync(new URL('../../css/mnet.css',import.meta.url),'utf8');
 /* the join is the owner's emblem, complete, scaled only, never redrawn, and never written out (owner, 2026-10-14: "just the symbol … never state it") */
 assert.match(client,/var EUP_MARK = '<img class="mn__eup" src="assets\/img\/equity-uprise-mark-white\.png" alt="" width="28" height="28">'/);
 assert.match(client,/class="mn__primary mn__primary--eup" href="' \+ esc\(actionOfferHref\(c\)\)[\s\S]{0,200}aria-label="Join this mission and do it">' \+ EUP_MARK \+ '<\/a>/);
 assert.equal((client.match(/EUP_MARK \+ '<\/a>'/g)||[]).length,3,'every feed join is the mark alone: offer, verified action, made together');
 assert.match(page,/id="mnWorldFocusJoin"[^>]*aria-label="Join this mission and do it"[^>]*><img class="mn__eup" src="assets\/img\/equity-uprise-mark-white\.png" alt="" width="28" height="28"><\/button>/);
 for(const [name,text] of [['the page',page],['the script',client],['the stylesheet',css]]) assert.doesNotMatch(text,/E\s*=\s*Up/i,name+' never writes the mark out');
 assert.match(css,/\.mn__eup \{ width: 28px; height: 28px; object-fit: contain; flex: none; \}/,'the complete artwork, scaled only, no rounding');
 assert.match(css,/\.mn__primary--eup, \.mn__world-go--eup \{ display: inline-flex; align-items: center; justify-content: center; gap: 0; min-width: 44px;/,'the pill is the tap target');
 assert.match(css,/\.mn-world-on #mnFeed \.mn__actcard-row \.mn__primary--eup::after \{ content: none; \}/,'no chevron beside the mark');
 assert.match(page,/id="mnWorldFocusFund"/);
 /* Fund tells the truth per campaign and never pays by itself */
 assert.match(client,/function fundState\(missionId, campaignId\)/);
 assert.match(client,/sbRpc\("action_bounty_public", \{ p_campaign: cid \}\)/);
 assert.match(client,/href="give\.html"/);
 assert.match(client,/Funding isn\\u2019t open for this mission yet\. You can still join it and do it\./);
 assert.doesNotMatch(client,/stripe|checkout/i,'no payment endpoint of its own');
 assert.match(client,/\$\("mnWorldFocusJoin"\)\.addEventListener\("click"[\s\S]{0,160}if \(state\.guest\) \{ askToSignIn\("mission"\); return; \}/,'the emblem as a guest names this mission as the reason to sign in');
 /* nothing else reacts */
 assert.doesNotMatch(client,/data-action="comments"|data-action="like"|data-action="uprise"/);
 assert.doesNotMatch(client,/function explainUprise/);
 assert.doesNotMatch(page,/data-action="like"|Comment<\/button>/);
 /* the Worker keeps its routes: reactions stay gated on a completed mission for any older caller, replies carry live-room chat */
 assert.match(worker,/async function hasVerifiedAction\(env,muid\)/);
 assert.match(worker,/network_post_comments/);
});
test('comments are private by default with length constraints',()=>{
 assert.match(migration,/enable row level security/);
 assert.match(migration,/revoke all on public.network_post_comments from anon,authenticated/);
 assert.match(migration,/char_length\(btrim\(body\)\) between 1 and 1000/);
});
