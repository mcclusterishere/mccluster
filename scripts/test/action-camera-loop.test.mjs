import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = p => fs.readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const html = read("mnet.html");
const mnet = read("js/mnet.js");
const action = read("js/action.js");
const gateway = read("js/gateway.js");
const api = read("workers/mccluster/src/platform-api.js");
const wrp = read("wigger-recovery.html");
const sql = read("supabase/pending_migrations/action_mission_camera_loop_v1.sql");

test("signed-in campaign surfaces hand people to campaign missions", () => {
  assert.match(action, /Do a mission now/);
  assert.match(action, /missionHubHref/);
  assert.match(action, /campaign=.*encodeURIComponent\(C\.id\)/);
  assert.match(gateway, /gatewaySignedIn/);
  assert.match(gateway, /Do a mission now/);
  assert.match(gateway, /view=missions&campaign=/);
});

test("mission execution is camera-first and preserves a return route", () => {
  assert.match(html, /id="mnMissionCameraFile"[^>]*accept="image\/\*,video\/\*"[^>]*capture="environment"/);
  assert.match(html, /id="mnMissionCameraGo"/);
  assert.match(html, /What are you about to do\?/);
  assert.match(mnet, /safeMissionReturn/);
  assert.match(mnet, /missions\.returnHref/);
  assert.match(mnet, /location\.assign\(missions\.returnHref\)/);
  assert.match(mnet, /campaign_id=eq\./);
});

test("Freestyle Containment opens its exact mission, not a generic join page", () => {
  assert.match(wrp, /mission=6ec6b7a5-5290-4ba1-9f05-8f3a82e1cc04/);
  assert.match(wrp, /campaign=end-racism-002/);
  assert.match(wrp, /Take this mission &amp; open the camera/);
  assert.match(sql, /6ec6b7a5-5290-4ba1-9f05-8f3a82e1cc04/);
  assert.match(sql, /Freestyle Containment Protocol/);
  assert.match(sql, /'end-racism-002'/);
});

test("video uploads get local poster frames and feed video uses them", () => {
  assert.match(mnet, /function makeVideoPoster/);
  assert.match(mnet, /canvas\.toBlob/);
  assert.match(mnet, /poster_asset_ids/);
  assert.match(mnet, /data-poster-asset/);
  assert.match(mnet, /poster="/);
  assert.match(api, /poster_asset_ids/);
  assert.match(api, /Video posters must be images/);
  assert.match(api, /poster_asset_id/);
});

test("mission proof poster is server-validated and verified shares carry proof media", () => {
  assert.match(sql, /poster_asset_id/);
  assert.match(sql, /poster must be your ready image/);
  assert.match(sql, /action_share_assignment_internal/);
  assert.match(sql, /insert into public\.network_posts\(author_m_uid,body,post_type,visibility,media,metadata,source_app_id\)/);
  assert.match(sql, /status='attached'/);
});

test("camera proof defaults to sharing only after verification", () => {
  assert.match(html, /id="mnMissionShare" type="checkbox" checked/);
  assert.match(html, /once it's verified/);
  assert.match(mnet, /set_action_share_intent/);
  assert.match(mnet, /Once verified, this action can appear on the feed with your proof/);
});
