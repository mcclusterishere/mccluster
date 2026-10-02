import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs/promises";
const read=p=>fs.readFile(new URL("../../"+p,import.meta.url),"utf8");
test("gamification rewards verified action, not engagement",async()=>{const sql=await read("supabase/pending_migrations/action_network_gamification_v1.sql"),doc=await read("docs/ACTION-NETWORK-REWARD-SYSTEM.md");for(const t of ["action_missions","action_mission_assignments","action_proofs","action_points_ledger","action_skill_progress","action_cohorts"])assert.match(sql,new RegExp("create table public\\."+t));assert.match(doc,/No points for signups/);assert.match(doc,/No points for political viewpoint/);assert.match(doc,/No points for likes, impressions, comments, watch time, or outrage/);assert.match(doc,/one \`mission\` ledger entry per assignment/);});
test("Action Network carries canonical Equity Uprise mark and progression UI",async()=>{const html=await read("mnet.html");assert.match(html,/assets\/img\/equity-uprise-logo\.webp/);assert.match(html,/Founded by Equity Uprise/);assert.match(html,/id="mnActionScore"/);assert.match(html,/UNDERSTAND → ACT/);assert.match(html,/No points for ideology/);});
test("anti-racism demographics stay private and never gate missions",async()=>{const sql=await read("supabase/pending_migrations/action_network_demographics_antiracism_v1.sql"),html=await read("mnet.html"),js=await read("js/mnet.js");assert.match(sql,/action_member_demographics/);assert.match(sql,/members read own demographics/);assert.doesNotMatch(sql,/race_ethnicity.*action_missions|action_missions.*race_ethnicity/);assert.match(html,/Prefer not to say/);assert.match(html,/does not decide which missions you can join/);assert.match(js,/saveDemographics/);assert.match(sql,/Do not photograph people without permission/);assert.match(sql,/Never record strangers without consent/);});


test("mission proof review is server-authoritative and idempotent",async()=>{
 const sql=await read("supabase/pending_migrations/action_network_gamification_v1.sql");
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
 const sql=await read("supabase/pending_migrations/action_network_gamification_v1.sql");
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
 assert.match(html,/Submit proof/);
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
 const [html,js,receipt,sql]=await Promise.all([read("mnet.html"),read("js/mnet.js"),read("receipt.html"),read("supabase/pending_migrations/action_network_gamification_v1.sql")]);
 /* record */
 assert.match(html,/id="mnRecord"/);
 assert.match(js,/sbRpc\("action_record"\)/);
 assert.match(js,/var FELLOWSHIP_MIN_VERIFIED = 3;/);
 assert.match(js,/\$\("mnVerifiedActions"\)\)\$\("mnVerifiedActions"\)\.textContent/);
 /* proof from the camera through the existing media pipeline */
 assert.match(html,/id="mnMissionProofFile" type="file" accept="image\/\*,video\/\*"/);
 assert.match(js,/\/v1\/mnet\/media\/upload-url/);
 assert.match(js,/p_metadata:asset\?\{asset_id:asset\.id\}:\{\}/);
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
