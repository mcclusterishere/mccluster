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

test("members can submit proof but cannot write awards or verification state directly",async()=>{
 const sql=await read("supabase/pending_migrations/action_network_gamification_v1.sql");
 assert.match(sql,/members submit own proof/);
 assert.match(sql,/grant select,insert on public\.action_proofs to authenticated/);
 assert.doesNotMatch(sql,/grant[^;]*insert[^;]*action_points_ledger/i);
 assert.doesNotMatch(sql,/grant[^;]*update[^;]*action_proofs/i);
 assert.match(sql,/if p_decision='rejected' then[\s\S]*'awarded',false/);
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
 assert.match(js,/action_mission_assignments/);
 assert.match(js,/action_proofs/);
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
