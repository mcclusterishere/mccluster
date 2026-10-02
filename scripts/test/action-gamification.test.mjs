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
