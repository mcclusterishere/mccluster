import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (p) => fs.readFile(new URL("../../" + p, import.meta.url), "utf8");

test("campaign pages put action choices before campaign context", async () => {
  const html = await read("action/index.html");
  const action = html.indexOf('id="anIntake"');
  const people = html.indexOf('id="anPeople"');
  const phases = html.indexOf('id="anPhases"');
  const evidence = html.indexOf('id="evidence"');

  assert.ok(action > -1);
  assert.ok(action < people);
  assert.ok(action < phases);
  assert.ok(action < evidence);
  assert.ok(html.indexOf('id="join"') > action);
  assert.ok(html.indexOf('id="join"') < people);
  assert.match(html, /Pick an action\./);
});

test("named campaign pages hide the old prelude and keep the page mobile action-first", async () => {
  const css = await read("css/action.css");
  assert.match(css, /\.an-action-first \.an-hero \{ display: none; \}/);
  assert.match(css, /\.an-intake-choice\.is-selected/);
  assert.match(css, /\.an-join\.is-quick #anHave/);
  assert.match(css, /\.an-intake-choice:disabled/);
});

test("all campaigns derive immediate actionables from real mission rows", async () => {
  const js = await read("js/action.js");
  assert.doesNotThrow(() => new Function(js));
  assert.match(js, /action_missions\?campaign_id=eq\./);
  assert.match(js, /function intakeChoices\(\)/);
  assert.match(js, /return MISSIONS\.map/);
  assert.match(js, /No action is open right now\./);
  assert.match(js, /join\.hidden = inNet \|\| !quick/);
});

test("action selection is tracked and becomes a one-tap mission enrollment", async () => {
  const js = await read("js/action.js");
  assert.match(js, /track\("actionable_selected"/);
  assert.match(js, /track\("actionable_started"/);
  assert.match(js, /u\.searchParams\.set\("action"/);
  assert.match(js, /u\.searchParams\.set\("mission"/);
  assert.match(js, /rpc\("join_action_mission", \{ p_mission_id: SELECTED_ACTION\.mission_id \}, true\)/);
  assert.match(js, /root\.location\.assign\(missionHref\(SELECTED_ACTION\.mission_id\)\)/);
});

test("selected mission survives account creation and auth round trips", async () => {
  const js = await read("js/action.js");
  assert.match(js, /action: SELECTED_ACTION \?/);
  assert.match(js, /p\.action && p\.action\.mission_id/);
  assert.match(js, /root\.location\.pathname \+ root\.location\.search/);
  assert.match(js, /return takeSelectedMission\(\)/);
});

test("paused missions cannot become accidental quick actions", async () => {
  const js = await read("js/action.js");
  assert.match(js, /var disabled = x\.kind === "mission" && x\.status && x\.status !== "open"/);
  assert.match(js, /if \(m && m\.status !== "open"\)/);
  assert.match(js, /That action is not open right now\./);
});

test("Cobalt has real open actions instead of a copy-only campaign page", async () => {
  const sql = await read("supabase/migrations/20261004004111_cobalt_action_missions_open_v1.sql");
  assert.match(sql, /campaign_id='critical-minerals-drc-001'/);
  assert.match(sql, /Recycle one dead device the right way/);
  assert.match(sql, /Trace the minerals in your phone/);
  assert.match(sql, /set status='open'/);
});
