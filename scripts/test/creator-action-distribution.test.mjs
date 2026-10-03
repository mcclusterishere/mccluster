import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(p)=>readFile(p,"utf8");

test("Control Instagram is a creator to Action Network funnel, not a detached publisher",async()=>{
  const [ui,router,meta,network,migration]=await Promise.all([
    read("js/control-room/instagram.js"),
    read("workers/mccluster/src/social/router.js"),
    read("workers/mccluster/src/social/meta.js"),
    read("workers/mccluster/src/platform-api.js"),
    read("supabase/migrations/20261003230844_creator_action_distribution_v1.sql")
  ]);
  assert.match(ui,/Make this actionable/);
  assert.match(ui,/id="igActionCampaign"/);
  assert.match(ui,/id="igActionMission"/);
  assert.match(ui,/Also publish this content to the Action Network/);
  assert.match(ui,/action_mission_id/);
  assert.match(ui,/publish_to_action_network/);
  assert.match(ui,/\/v1\/social\/action-targets/);
  assert.match(ui,/proof submitted/);
  assert.match(ui,/verified/);

  assert.match(router,/function actionMissionUrl/);
  assert.match(router,/content: contentId/);
  assert.match(router,/Take action: \$\{actionUrl\}/);
  assert.match(router,/social_content_items/);
  assert.match(router,/content_id: contentId/);
  assert.match(router,/ensureActionNetworkPost/);
  assert.match(router,/post_type: 'announcement'/);
  assert.match(router,/action_mission_assignments\?source_content_id=in/);
  assert.match(router,/action_stats: actionStats/);

  assert.match(meta,/content_id: job\.content_id \|\| null/);
  assert.match(meta,/social_content_items', job\.content_id, \{ status: 'published' \}/);
  assert.match(network,/media,metadata,content_id,reply_to_id/);

  assert.match(migration,/source_content_id uuid references public\.social_content_items/);
  assert.match(migration,/source_channel text/);
  assert.match(migration,/social_content_action_stats/);
  assert.match(migration,/join_action_mission_attributed/);
});

test("creator/action attribution remains server authoritative",async()=>{
  const [migration,guard,mnet]=await Promise.all([
    read("supabase/migrations/20261003230844_creator_action_distribution_v1.sql"),
    read("supabase/migrations/20261003231454_creator_action_distribution_network_post_guard_v1.sql"),
    read("js/mnet.js")
  ]);
  assert.match(migration,/function public\.join_action_mission_attributed[\s\S]*?security definer/);
  assert.match(migration,/that content does not point to this mission/);
  assert.match(migration,/action_offer_cards/);
  assert.match(migration,/c\.publisher_m_uid = p\.author_m_uid/);
  assert.match(migration,/revoke all on function public\.action_offer_cards\(uuid\[\]\) from public, anon/);
  assert.match(guard,/unique index if not exists network_posts_one_creator_content/);
  assert.match(mnet,/server-vouched relation/);
  assert.match(mnet,/sbRpc\("action_offer_cards"/);
  assert.match(mnet,/join_action_mission_attributed/);
});

test("creator attribution is first-touch conversion attribution, not a later-click rewrite",async()=>{
  const sql=await read("supabase/migrations/20261003232607_creator_action_conversion_semantics_v1.sql");
  assert.match(sql,/select a\.status, a\.source_content_id\s+into v_prior_status, v_prior_source/);
  assert.match(sql,/v_prior_status is null or \(v_prior_status = 'withdrawn' and v_prior_source is null\)/);
  assert.match(sql,/source_content_id = p_content_id/);
  assert.match(sql,/count\(\*\) filter \(where a\.submitted_at is not null\)/);
  assert.doesNotMatch(sql,/source_content_id = coalesce/);
  assert.match(sql,/existing source is never overwritten/);
});

test("the external CTA keeps content and source attribution through the mission deep link",async()=>{
  const [router,mnet]=await Promise.all([
    read("workers/mccluster/src/social/router.js"),
    read("js/mnet.js")
  ]);
  assert.match(router,/mnet\.html\?\$\{q\.toString\(\)\}/);
  assert.match(router,/q = new URLSearchParams\(\{ view: 'missions', mission: missionId, content: contentId, src: source \}\)/);
  assert.match(mnet,/q\.get\("content"\)/);
  assert.match(mnet,/q\.get\("src"\)/);
  assert.match(mnet,/p_content_id:missions\.content/);
  assert.match(mnet,/p_source:missions\.source\|\|"network"/);
  assert.match(mnet,/missions\.attributedMission===m\.id/);
  assert.match(mnet,/missions\.content="";missions\.source="";missions\.attributedMission=""/);
});
