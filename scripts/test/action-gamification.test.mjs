import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs/promises";
const read=p=>fs.readFile(new URL("../../"+p,import.meta.url),"utf8");
test("gamification rewards verified action, not engagement",async()=>{const sql=await read("supabase/migrations/20261002061056_action_network_gamification_v1.sql"),doc=await read("docs/ACTION-NETWORK-REWARD-SYSTEM.md");for(const t of ["action_missions","action_mission_assignments","action_proofs","action_points_ledger","action_skill_progress","action_cohorts"])assert.match(sql,new RegExp("create table public\\."+t));assert.match(doc,/No points for signups/);assert.match(doc,/No points for political viewpoint/);assert.match(doc,/No points for likes, impressions, comments, watch time, or outrage/);assert.match(doc,/one \`mission\` ledger entry per assignment/);});
test("Action Network carries canonical Equity Uprise mark and progression UI",async()=>{const html=await read("mnet.html");assert.match(html,/assets\/img\/equity-uprise-logo\.webp/);assert.match(html,/Founded by Equity Uprise/);assert.match(html,/id="mnActionScore"/);assert.match(html,/UNDERSTAND → ACT/);assert.match(html,/No points for ideology/);});
test("anti-racism demographics stay private and never gate missions",async()=>{const sql=await read("supabase/pending_migrations/action_network_demographics_antiracism_v1.sql"),html=await read("mnet.html"),js=await read("js/mnet.js");assert.match(sql,/action_member_demographics/);assert.match(sql,/members read own demographics/);assert.doesNotMatch(sql,/race_ethnicity.*action_missions|action_missions.*race_ethnicity/);assert.match(html,/Prefer not to say/);assert.match(html,/does not decide which missions you can join/);assert.match(js,/saveDemographics/);assert.match(sql,/Do not photograph people without permission/);assert.match(sql,/Never record strangers without consent/);});


test("mission proof review is server-authoritative and idempotent",async()=>{
 const sql=await read("supabase/migrations/20261002061056_action_network_gamification_v1.sql");
 assert.match(sql,/create or replace function public\.review_action_proof/);
 assert.match(sql,/security definer/);
 assert.match(sql,/set search_path = ''/);
 assert.match(sql,/not \(select public\.eu_is_admin\(\)\)/);
 assert.match(sql,/for update/);
 assert.match(sql,/on conflict \(assignment_id,kind\).*do nothing/s);
 assert.match(sql,/if v_awarded then/);
 assert.match(sql,/revoke all on function public\.review_action_proof\(uuid,text,text\) from public, anon/);
 assert.match(sql,/grant execute on function public\.review_action_proof\(uuid,text,text\) to authenticated/);
});

test("members act only through server functions; they cannot write assignments, proofs, awards or verification",async()=>{
 const sql=await read("supabase/migrations/20261002061056_action_network_gamification_v1.sql");
 /* no participant insert/update policy or grant on the work tables */
 assert.doesNotMatch(sql,/policy[^;]*on public\.action_mission_assignments for (insert|update|all)/i);
 assert.doesNotMatch(sql,/policy[^;]*on public\.action_proofs for (insert|update|all)/i);
 assert.doesNotMatch(sql,/grant[^;]*(insert|update)[^;]*action_(mission_assignments|proofs|points_ledger|skill_progress)/i);
 assert.match(sql,/revoke all on public\.action_missions, public\.action_mission_assignments, public\.action_proofs, public\.action_points_ledger, public\.action_skill_progress, public\.action_cohorts, public\.action_cohort_members from public, anon, authenticated;/);
 for(const fn of ["join_action_mission","submit_action_proof","withdraw_action_mission","review_action_proof","action_record"]){
  assert.match(sql,new RegExp("create or replace function public\\."+fn+"[\\s\\S]*?security definer\\s+set search_path = ''"),fn+" is a definer function with a fixed search_path");
  assert.match(sql,new RegExp("revoke all on function public\\."+fn+"\\([^)]*\\) from public, anon;"),fn+" is closed to anon");
 }
 /* the row count lands in an integer, never a boolean */
 assert.match(sql,/get diagnostics v_rows = row_count;\s*v_awarded := v_rows > 0;/);
 assert.doesNotMatch(sql,/get diagnostics v_awarded/);
 assert.match(sql,/if p_decision='rejected' then[\s\S]*'awarded',false/);
 assert.match(sql,/you cannot review your own proof/);
 assert.match(sql,/action_proofs_one_use_per_url/);
 assert.match(sql,/action_proofs_one_use_per_upload/);
 /* a roster is private */
 assert.doesNotMatch(sql,/on public\.action_cohort_members for select to authenticated using\(true\)/);
});


test("Action Network exposes a native mission participant flow",async()=>{
 const [html,js]=await Promise.all([read("mnet.html"),read("js/mnet.js")]);
 assert.match(html,/data-mn-view="missions"/);
 assert.match(html,/id="mnMissionsView"/);
 assert.match(html,/id="mnMissionDialog"/);
 assert.match(html,/Take this mission/);
 assert.match(html,/Submit(?: mission)? proof/);
 assert.match(js,/function loadMissions\(/);
 assert.match(js,/function joinMission\(/);
 assert.match(js,/function submitMissionProof\(/);
 assert.match(js,/sbRpc\("join_action_mission"/);
 assert.match(js,/sbRpc\("submit_action_proof"/);
 /* the page never writes the work tables itself */
 assert.doesNotMatch(js,/sbRest\("action_(mission_assignments|proofs)",\{method:"POST"/);
 assert.doesNotMatch(js,/sbRest\("action_mission_assignments\?id=eq\.[^)]*method:"PATCH"/);
 assert.match(js,/if\(name==="missions"\)loadMissions\(\)/);
});


test("creator content turns a network post into a server-vouched attributed mission offer",async()=>{
 const [js,sql,guard]=await Promise.all([
  read("js/mnet.js"),
  read("supabase/migrations/20261003230844_creator_action_distribution_v1.sql"),
  read("supabase/migrations/20261003231454_creator_action_distribution_network_post_guard_v1.sql")
 ]);
 assert.match(sql,/create table public\.social_content_items/);
 assert.match(sql,/add column content_id uuid references public\.social_content_items/);
 assert.match(sql,/add column source_content_id uuid references public\.social_content_items/);
 assert.match(sql,/function public\.join_action_mission_attributed/);
 assert.match(sql,/v_result := public\.join_action_mission\(p_mission_id\)/);
 const firstTouch=await read("supabase/migrations/20261003232607_creator_action_conversion_semantics_v1.sql");
 assert.match(firstTouch,/select a\.status into v_prior_status/);
 assert.match(firstTouch,/v_prior_status is null or \(v_prior_status = 'withdrawn' and v_prior_source is null\)/);
 assert.match(firstTouch,/source_content_id = p_content_id/);
 assert.match(firstTouch,/count\(\*\) filter \(where a\.submitted_at is not null\)/);
 assert.doesNotMatch(firstTouch,/source_content_id = coalesce/);
 assert.match(sql,/function public\.action_offer_cards/);
 assert.match(sql,/c\.publisher_m_uid = p\.author_m_uid/,"mission offer must be tied to the server-known publisher");
 assert.match(sql,/source_content_id',new\.source_content_id/);
 assert.match(guard,/unique index if not exists network_posts_one_creator_content/);
 assert.match(js,/q\.get\("content"\)/);
 assert.match(js,/q\.get\("src"\)/);
 assert.match(js,/sbRpc\("join_action_mission_attributed"/);
 assert.match(js,/sbRpc\("action_offer_cards"/);
 assert.match(js,/data-content=/);
 assert.match(js,/Take action/);
 assert.match(js,/server-vouched relation/);
});

test("Control has a media-first Mission proof review desk",async()=>{
 const js=await read("js/control-room/action-network.js");
 assert.match(js,/Proof review/);
 assert.match(js,/<video controls playsinline/);
 assert.match(js,/Submitted mission proof/);
 assert.match(js,/Verify action/);
 assert.match(js,/Reject proof/);
 assert.match(js,/rpc\/review_action_proof/);
 assert.match(js,/does not certify a member’s character, beliefs, race/);
 assert.match(js,/Self-declared satire badges remain self-declared/);
});


test("the first mission slice: Action Record, receipt and deep links",async()=>{
 const [html,js,receipt,sql]=await Promise.all([read("mnet.html"),read("js/mnet.js"),read("receipt.html"),read("supabase/migrations/20261002061056_action_network_gamification_v1.sql")]);
 /* record */
 assert.match(html,/id="mnRecord"/);
 assert.match(js,/sbRpc\("action_record"\)/);
 assert.match(js,/var FELLOWSHIP_MIN_VERIFIED = 3;/);
 assert.match(js,/\$\("mnVerifiedActions"\)\)\$\("mnVerifiedActions"\)\.textContent/);
 /* proof from the camera through the existing media pipeline */
 assert.match(html,/id="mnMissionProofFile" type="file" accept="image\/\*,video\/\*"/);
 assert.match(js,/\/v1\/mnet\/media\/upload-url/);
 assert.match(js,/p_metadata:meta/);assert.match(js,/poster_asset_id/);
 /* deep link: a shared mission opens that mission */
 assert.match(js,/new URLSearchParams\(location\.search\)\.get\("mission"\)/);
 assert.match(js,/missions\.deepLinked=true; setView\("missions"\); openMission\(id\);/);
 /* receipt: the exact words, back to the exact mission, nothing private */
 for(const line of ["I did something about it","Verified action","ACTION NETWORK","DON'T JUST WATCH. ACT."])assert.ok(receipt.includes(line),line);
 assert.match(receipt,/rpc\/action_receipt/);
 assert.match(receipt,/"mnet\.html\?mission=" \+ encodeURIComponent\(r\.mission_id\)/);
 assert.match(sql,/where a\.id = p_assignment_id and a\.status = 'verified';/);
 const fn=sql.slice(sql.indexOf("function public.action_receipt"),sql.indexOf("revoke all on function public.join_action_mission"));
 assert.doesNotMatch(fn,/user_id|m_uid|proof_url|review_note|statement/,"the receipt never carries identity or proof");
 assert.match(receipt,/js\/tabbar\.js/);
});


test("the fellowship opens at three verified actions, server-counted, desk-reviewed",async()=>{
 const [sql,js,ctl]=await Promise.all([read("supabase/migrations/20261002063754_action_network_fellowship_v1.sql"),read("js/mnet.js"),read("js/control-room/action-network.js")]);
 assert.match(sql,/returns integer language sql immutable set search_path = '' as \$\$ select 3 \$\$;/);
 assert.match(sql,/select count\(\*\) into v_verified from public\.action_mission_assignments where user_id = v_user and status = 'verified';/);
 assert.match(sql,/create unique index action_fellowship_one_open on public\.action_fellowship_applications\(user_id\) where status = 'submitted';/);
 assert.doesNotMatch(sql,/policy[^;]*action_fellowship_applications for (insert|update|all)/i);
 assert.match(sql,/you cannot review your own application/);
 assert.match(js,/sbRpc\("action_fellowship_status"\)/);
 assert.match(js,/sbRpc\("apply_for_fellowship"/);
 assert.match(js,/var FELLOWSHIP_MIN_VERIFIED = 3;/);
 assert.match(ctl,/\["missions","Missions"\]/);
 assert.match(ctl,/\["fellows","Fellowship"\]/);
 assert.match(ctl,/rpc\/review_fellowship_application/);
 /* a new mission is always born a draft */
 assert.match(ctl,/capacity:isFinite\(cap\)&&cap>0\?cap:null,status:"draft"/);
});

test("a cohort seat is given on purpose, only to an accepted fellow, by the desk",async()=>{
 const [sql,seed,ctl,page]=await Promise.all([
  read("supabase/pending_migrations/20261003160000_action_cohort_admission_v1.sql"),
  read("supabase/pending_migrations/20261003150000_equity_uprise_group_docket_516r.sql"),
  read("js/control-room/action-network.js"),
  read("docket-516.html")]);
 assert.match(sql,/create or replace function public\.admit_fellow_to_cohort\(\s*p_application_id uuid,\s*p_cohort_id uuid\s*\)/);
 assert.match(sql,/security definer\s+set search_path = ''/);
 assert.match(sql,/not \(select public\.eu_is_admin\(\)\) then raise exception 'not authorized'/);
 assert.match(sql,/v_app\.status <> 'accepted'/,"only accepted fellows get a seat");
 assert.match(sql,/v_app\.user_id = \(select auth\.uid\(\)\) then raise exception 'you cannot admit yourself'/);
 assert.match(sql,/v_cohort\.status <> 'active'/,"only a cohort that is still admitting");
 assert.match(sql,/on conflict \(cohort_id, m_uid\) do nothing/,"admitting twice is a no-op");
 assert.match(sql,/revoke all on function public\.admit_fellow_to_cohort\(uuid, uuid\) from public, anon;/);
 assert.doesNotMatch(sql,/grant execute on function public\.admit_fellow_to_cohort\(uuid, uuid\) to [^;]*anon/);
 /* the generic fellowship acceptance stays network-wide; it does not seat anyone */
 assert.doesNotMatch(await read("supabase/migrations/20261002063754_action_network_fellowship_v1.sql"),/action_cohort_members/);
 assert.match(ctl,/rpc\/admit_fellow_to_cohort/);
 assert.match(ctl,/a\.status==="accepted"\?seatControls\(a\)/,"seat controls only on accepted applications");
 assert.match(ctl,/action_fellowship_applications\?select="\+APP_COLS\+"&status=eq\.accepted/,"accepted fellows stay on the desk past the newest 100");
 /* the Equity Uprise group is the cohort group for aspiring policy writers (owner, 2026-10-03) */
 assert.match(seed,/cohort group for people who want to become Equity Uprise cohort policy writers/);
 assert.match(seed,/'Equity Uprise · policy writers, next cohort'/);
 assert.match(page,/cohort group for people who want to become Equity Uprise cohort policy writers/);
 assert.doesNotMatch(page,/Accepted fellows join the\s+next Equity Uprise cohort\./,"no promise without the admission path");
});
