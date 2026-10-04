import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (p) => fs.readFile(new URL("../../" + p, import.meta.url), "utf8");

test("Homelessness Action is a governed campaign, not an unbounded donation page", async () => {
  const sql = await read("supabase/migrations/20261003235507_homelessness_action_bounties_v1.sql");

  assert.match(sql, /'homelessness-action-001','homelessness','live'/);
  assert.match(sql, /'Homelessness Action'/);
  assert.match(sql, /'mobilize',1000,null,false/);
  assert.match(sql, /Funding is not being collected for this campaign while the McCluster Corp support rail is closed/);

  for (const table of [
    "action_mission_policies",
    "action_bounties",
    "action_bounty_funding_ledger",
    "action_bounty_claims"
  ]) {
    assert.match(sql, new RegExp("create table public\\." + table));
    assert.match(sql, new RegExp("alter table public\\." + table + " enable row level security"));
  }

  assert.match(sql, /create or replace function public\.action_bounty_public/);
  assert.match(sql, /create or replace function public\.claim_action_bounty/);
  assert.match(sql, /create or replace function public\.mark_action_bounty_paid/);
  assert.match(sql, /revoke all on function public\.claim_action_bounty\(uuid\) from public,anon/);
  assert.match(sql, /grant execute on function public\.claim_action_bounty\(uuid\) to authenticated/);
  assert.match(sql, /not \(select public\.eu_is_admin\(\)\)/);
  assert.match(sql, /only an approved bounty can be marked paid/);

  assert.doesNotMatch(sql, /insert into public\.action_bounty_funding_ledger/i);
  assert.match(sql, /where f\.bounty_id=x\.id and f\.state='verified'/);
  assert.match(sql, /if v_funded-v_committed<v_bounty\.reward_cents then raise exception 'this bounty is waiting for funding'/);
});

test("Homelessness Action has concrete missions with a higher-trust housing lane", async () => {
  const sql = await read("supabase/migrations/20261003235507_homelessness_action_bounties_v1.sql");

  for (const title of [
    "Feed two people",
    "Build and hand out two care kits",
    "Help someone reach a real service",
    "Housing navigation follow-through",
    "Document one completed homelessness action"
  ]) assert.ok(sql.includes(title), title);

  assert.match(sql, /'51000000-0000-4000-8000-000000000004'[\s\S]*?'paused'/);
  assert.match(sql, /'housing_navigation',3,true,true/);
  assert.match(sql, /approved program or partner workflow/i);
  assert.match(sql, /does not promise a housing placement/i);
});

test("Homelessness proof protects recipients instead of making vulnerability the content", async () => {
  const sql = await read("supabase/migrations/20261003235507_homelessness_action_bounties_v1.sql");

  assert.match(sql, /a recipient never has to be photographed/i);
  assert.match(sql, /Recipient identity is not proof/i);
  assert.match(sql, /Do not publish names, health information, documents or exact sleeping locations/i);
  assert.match(sql, /Identifiable recipient footage requires explicit consent/i);
  assert.match(sql, /do not identify minors/i);
  assert.match(sql, /Film the action, not someone.s vulnerability/i);
});

test("Paid bounties are fixed compensation slots for approved field participants", async () => {
  const sql = await read("supabase/migrations/20261003235507_homelessness_action_bounties_v1.sql");

  assert.match(sql, /'Feed-two field stipend'[\s\S]*?1000,100,'campaign_cohort'/);
  assert.match(sql, /'Document-the-work stipend'[\s\S]*?1000,100,'campaign_cohort'/);
  assert.match(sql, /'Resource-navigation follow-through'[\s\S]*?2000,50,'campaign_cohort'/);
  assert.match(sql, /Homelessness Action · field team/);
  assert.match(sql, /program seat, not a public status badge/i);
  assert.match(sql, /where cm\.m_uid=v_muid and co\.campaign_id=v_bounty\.campaign_id and co\.status='active'/);
  assert.match(sql, /status in \('submitted','approved','paid'\)/);
  assert.match(sql, /status='reserved' and expires_at>now\(\)/);
});

test("Bounty state follows canonical mission proof review and payout stays explicit", async () => {
  const sql = await read("supabase/migrations/20261003235507_homelessness_action_bounties_v1.sql");
  const guard = await read("supabase/migrations/20261004000122_action_bounty_rejected_reclaim_guard_v1.sql");

  assert.match(sql, /after update of status on public\.action_mission_assignments/);
  assert.match(sql, /new\.status='submitted'[\s\S]*?status='submitted'/);
  assert.match(sql, /new\.status='verified'[\s\S]*?status='approved'/);
  assert.match(sql, /new\.status='rejected'[\s\S]*?status='rejected'/);
  assert.match(sql, /new\.status='withdrawn'[\s\S]*?status='cancelled'/);
  assert.match(sql, /payout_provider text/);
  assert.match(sql, /payout_ref text/);
  assert.doesNotMatch(sql, /stripe\.transfers|transfers\.create|payouts\.create/i);
  assert.match(guard, /this bounty proof was rejected; choose another open action/);
});

test("Homelessness gets one persistent Field room without arming support", async () => {
  const sql = await read("supabase/migrations/20261003235507_homelessness_action_bounties_v1.sql");

  assert.match(sql, /'homelessness-action',null,'Homelessness Action Room'/);
  assert.match(sql, /'home','field',null,'52000000-0000-4000-8000-000000000001'/);
  assert.match(sql, /4,false,'Fund verified homelessness actions and approved participant bounties.'/);
});

test("The campaign page exposes Do, Fund, Bounty and Live lanes from campaign data", async () => {
  const [html, js, css] = await Promise.all([
    read("action/index.html"),
    read("js/action.js"),
    read("css/action.css")
  ]);

  for (const id of ["anIntake", "anIntakeChoices", "anBounties", "anBountyList", "anBountyFunding", "anBountyStatus"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /A bounty pays an approved participant for completing a defined action/);
  assert.match(html, /never buys somebody else&rsquo;s face, story, medical information, documents, or sleeping location/);

  assert.match(js, /C\.chapter/);
  assert.match(js, /intake_choices/);
  assert.match(js, /rpc\("action_bounty_public"/);
  assert.match(js, /rpc\("claim_action_bounty"/);
  assert.match(js, /BOUNTIES\.support_open/);
  assert.match(js, /root\.location\.assign\("\/mnet\.html\?view=live&category=field"\)/);
  assert.match(js, /Waiting for funding/);

  assert.match(css, /\.an-intake-grid/);
  assert.match(css, /\.an-bounty-list/);
  assert.match(css, /button:disabled/);
});
