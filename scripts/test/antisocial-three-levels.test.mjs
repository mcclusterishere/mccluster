import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/migrations/20261014185154_antisocial_get_social_three_levels_draft.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../../js/mnet.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../../mnet.html',import.meta.url),'utf8');
const control=readFileSync(new URL('../../js/control-room/action-network.js',import.meta.url),'utf8');

test('exactly one Anti-Social mission with three levels',()=>{
 assert.match(sql,/Anti-Social — Get Social/);
 assert.match(sql,/level BETWEEN 1 AND 3/);
 assert.match(sql,/mission_id='a17050c1-a551-4c5c-80c1-5a1750c1a001'/);
 assert.match(ui,/High Five","Five High Fives","Make Something Together/);
 assert.match(html,/One mission. Three levels/);
 assert.doesNotMatch(sql,/\bdelete\s+from\s+public\.action_missions/i);
});

test('progression and moderation are server-authoritative',()=>{
 assert.match(sql,/v_prior IS DISTINCT FROM 'verified'/);
 assert.match(sql,/status IN \('pending','verified','rejected'\)/);
 assert.match(sql,/SELECT public\.eu_is_admin\(\)/);
 assert.match(sql,/cannot review own work/);
 assert.match(sql,/ON CONFLICT\(assignment_id,kind\)/);
 assert.match(sql,/antisocial_block_legacy_proof/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.submit_antisocial_level\(uuid,smallint,text,text,uuid,uuid,uuid\) TO authenticated,service_role/);
 assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION public\.submit_antisocial_level\(uuid,smallint,text,text,uuid,uuid\) TO authenticated/);

 assert.match(control,/rpc\/review_antisocial_level/);
});

test('collaboration is connected, reciprocal and counted for both members',()=>{
 assert.match(sql,/network_connections c/);
 assert.match(sql,/c\.status='accepted'/);
 assert.match(sql,/other\.post_id=v_l\.post_id/);
 assert.match(sql,/other\.collaborator_m_uid=v_a\.m_uid/);
 assert.match(sql,/antisocial_public_collaborations/);
 assert.match(sql,/own\.status='verified' AND other\.status='verified'/);
 assert.match(ui,/antisocial_public_collaborations/);
 /* level 3 publishes together through the platform (supabase/migrations/20261015000455_antisocial_get_social_completion_v1.sql):
    the partner rides as p_partner_m_uid, and confirming a project published with me carries reciprocal credit */
 assert.match(ui,/p_partner_m_uid:partner/);
 assert.match(ui,/p_collaborator_m_uid:b\.getAttribute\("data-with"\)/);
});

test('consent-safe evidence and private review queue',()=>{
 assert.match(html,/Do not publish someone who did not consent/);
 assert.match(sql,/ma\.owner_m_uid=v_self/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/owner reads own antisocial levels/);
 assert.match(ui,/submit_antisocial_level/);
 assert.match(control,/action_antisocial_levels\?status=eq\.pending/);
});

test('member and desk javascript parses',()=>{
 assert.doesNotThrow(()=>new Function(ui));
 assert.doesNotThrow(()=>new Function(control));
});
