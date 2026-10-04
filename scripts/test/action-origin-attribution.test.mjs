import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (p) => fs.readFile(new URL("../../" + p, import.meta.url), "utf8");

test("mission assignments retain first-touch channel, reel and actionable origin", async () => {
  const sql = await read("supabase/migrations/20261004021226_action_origin_attribution_v2.sql");
  assert.match(sql, /add column source_reel text/);
  assert.match(sql, /add column source_actionable text/);
  assert.match(sql, /create or replace function public\.join_action_mission_origin/);
  assert.match(sql, /v_prior_status is null/);
  assert.match(sql, /v_prior_status = 'withdrawn'/);
  assert.match(sql, /v_prior_content is null/);
  assert.match(sql, /v_prior_channel is null/);
  assert.match(sql, /v_prior_reel is null/);
  assert.match(sql, /v_prior_actionable is null/);
  assert.match(sql, /source_reel = v_reel/);
  assert.match(sql, /source_actionable = v_actionable/);
  assert.match(sql, /revoke all on function public\.join_action_mission_origin\(uuid,uuid,text,text,text\)[\s\S]*from public, anon/);
  assert.match(sql, /grant execute on function public\.join_action_mission_origin\(uuid,uuid,text,text,text\)[\s\S]*to authenticated, service_role/);
});

test("verified completion carries durable origin into the server-minted campaign event", async () => {
  const sql = await read("supabase/migrations/20261004021226_action_origin_attribution_v2.sql");
  const fn = sql.slice(sql.indexOf("create or replace function public.action_record_verified_mission"));
  assert.match(fn, /'source_content_id',new\.source_content_id/);
  assert.match(fn, /'source_channel',new\.source_channel/);
  assert.match(fn, /'source_reel',new\.source_reel/);
  assert.match(fn, /'source_actionable',new\.source_actionable/);
  assert.match(fn, /'source_live_session_id',new\.source_live_session_id/);
  assert.match(fn, /on conflict do nothing/);
});

test("owner conversion aggregate exposes counts without participant identity", async () => {
  const sql = await read("supabase/migrations/20261004021226_action_origin_attribution_v2.sql");
  const start = sql.indexOf("create or replace function public.action_origin_stats");
  const fn = sql.slice(start);
  assert.match(fn, /not \(select public\.eu_is_admin\(\)\)/);
  for (const field of ["source_channel","source_reel","source_actionable","source_content_id","joined","in_progress","submitted","verified","rejected"]) {
    assert.match(fn, new RegExp("'" + field + "'"));
  }
  assert.doesNotMatch(fn, /proof_url|statement|review_note|email|user_id',/);
  assert.match(fn, /grant execute on function public\.action_origin_stats\(text\) to authenticated, service_role/);
});

test("Action page passes selected action and Reel into the durable origin command", async () => {
  const js = await read("js/action.js");
  assert.match(js, /rpc\("join_action_mission_origin"/);
  assert.match(js, /p_reel: reel \\|\\| null/);
  assert.match(js, /p_actionable: actionable \\|\\| null/);
  assert.match(js, /SELECTED_ACTION && \(SELECTED_ACTION\.key \|\| SELECTED_ACTION\.kind\)/);
});

test("Control shows durable origin funnel and source context during proof review", async () => {
  const control = await read("js/control-room/action-network.js");
  assert.match(control, /rpc\/action_origin_stats/);
  assert.match(control, /Mission conversion by origin/);
  assert.match(control, /source_reel/);
  assert.match(control, /source_actionable/);
  assert.match(control, /source_content_id/);
  assert.match(control, /<b>Origin:<\/b>/);
  assert.match(control, /Reel /);
});

test("proof retry never resurrects a rejected paid bounty reservation", async () => {
  const bounty = await read("supabase/migrations/20261004000628_action_bounty_lifecycle_guard_v2.sql");
  assert.match(bounty, /new\.status='submitted'[\s\S]*where assignment_id=new\.id and status='reserved'/);
  assert.match(bounty, /new\.status='verified'[\s\S]*where assignment_id=new\.id and status='submitted'/);
  assert.match(bounty, /new\.status='rejected'[\s\S]*set status='rejected'/);
  assert.match(bounty, /this bounty proof was rejected; choose another open action/);
});
