import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../../", import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), "utf8");
const action = read("js/action.js");
const gateway = read("js/gateway.js");
const mnet = read("js/mnet.js");
const actionHtml = read("action/index.html");
const notFound = read("404.html");
const control = read("js/control-room/action-network.js");

function completionSql() {
  const pending = new URL("supabase/pending_migrations/action_mission_completion_automation_v1.sql", root);
  if (fs.existsSync(pending)) return fs.readFileSync(pending, "utf8");
  const dir = new URL("supabase/migrations/", root);
  const hit = fs.readdirSync(dir).filter(n => n.endsWith("_action_mission_completion_automation_v1.sql")).sort().at(-1);
  assert.ok(hit, "completion automation migration is present");
  return fs.readFileSync(new URL(hit, dir), "utf8");
}

test("campaign mission handoffs are root-absolute and cannot resolve under /action/", () => {
  assert.match(action, /return "\/mnet\.html\?view=missions"/);
  assert.match(action, /return "\/mnet\.html\?view=missions&campaign="/);
  assert.doesNotMatch(action, /return "mnet\.html\?view=missions"/);
  assert.match(gateway, /return "\/mnet\.html\?view=missions&campaign="/);
  assert.match(gateway, /return "\/action\/" \+ \(s \?/);
  assert.match(actionHtml, /id="anMnet" href="\/mnet\.html"/);
});

test("stale cached /action/mnet.html links self-heal through the 404 forwarder", () => {
  assert.match(notFound, /\/action\\\/mnet\\\.html/);
  assert.match(notFound, /location\.replace\("\/mnet\.html" \+ location\.search \+ location\.hash\)/);
});

test("mission deep links survive OAuth and first-profile onboarding", () => {
  assert.match(mnet, /var next=location\.pathname\+location\.search\+location\.hash/);
  assert.match(mnet, /\/auth\/\?next=" \+ encodeURIComponent\(next\)/);
  assert.match(mnet, /missionDeepLink=\/\[\?&\]\(mission=\|view=missions/);
  assert.match(mnet, /if\(missionDeepLink\)\{\s*setView\("missions"\);\s*openDeepLinkedMission\(\)/);
  assert.match(mnet, /return u\.pathname\+u\.search\+u\.hash/);
  assert.match(mnet, /return "\/mnet\.html\?"\+q\.toString\(\)/);
});

test("mission cards and Control use server-counted assignment progress", () => {
  assert.match(mnet, /sbRpc\("action_mission_stats",\{p_campaign:missions\.campaign\|\|null\}\)/);
  assert.match(mnet, /joined\+" joined/);
  assert.match(mnet, /awaiting review/);
  assert.match(control, /rpc\/action_mission_stats/);
  assert.match(control, /<span>joined<\/span>/);
  assert.match(control, /<span>waiting review<\/span>/);
  assert.match(control, /<span>verified<\/span>/);
});

test("verified assignments automatically become exactly one campaign action", () => {
  const sql = completionSql();
  assert.match(sql, /action_events_kind_check[\s\S]*'mission'/);
  assert.match(sql, /action_events_one_mission_completion/);
  assert.match(sql, /create or replace function public\.action_record_verified_mission\(\)/);
  assert.match(sql, /new\.status <> 'verified' or old\.status = 'verified'/);
  assert.match(sql, /insert into public\.action_events\(campaign_id,user_id,kind,detail,at\)/);
  assert.match(sql, /'mission'/);
  assert.match(sql, /'assignment_id',new\.id/);
  assert.match(sql, /on conflict do nothing/);
  assert.match(sql, /after update of status on public\.action_mission_assignments/);
  assert.match(sql, /where a\.status='verified'/);
});

test("mission stats expose aggregate counts only", () => {
  const sql = completionSql();
  assert.match(sql, /create or replace function public\.action_mission_stats\(p_campaign text default null\)/);
  for (const field of ["joined","in_progress","submitted","verified","rejected","slots_left"]) {
    assert.match(sql, new RegExp("'" + field + "'"));
  }
  const fn = sql.slice(sql.indexOf("create or replace function public.action_mission_stats"));
  assert.doesNotMatch(fn, /proof_url|statement|review_note|email/);
  assert.match(sql, /grant execute on function public\.action_mission_stats\(text\) to anon,authenticated,service_role/);
});
