import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const spec = fs.readFileSync(new URL("../../docs/END-RACISM-TWO-PATH-CAMPAIGN.md", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../end-racism.html", import.meta.url), "utf8");
const recoveryPage = fs.readFileSync(new URL("../../wigger-recovery.html", import.meta.url), "utf8");

test("End Racism satire is explicitly self-declared, never inferred", () => {
  assert.match(spec, /SELF-DECLARED: CERTIFIED RACIST/);
  assert.match(spec, /must never assign this status/i);
  assert.match(spec, /Never infer or algorithmically assign/i);
});

test("Racist Tax cannot buy Action reputation or abusive permission", () => {
  assert.match(spec, /buys no exemption, permission, moderation privilege, mission credit, points/i);
  assert.match(spec, /payments award zero Action points and zero mission completions/i);
  assert.match(spec, /No slur permission, harassment waiver, discrimination waiver, or moderation exemption exists/i);
});

test("earned path depends on verified action and supports redemption", () => {
  assert.match(spec, /Progress is earned only through verified mission completions/i);
  assert.match(spec, /self_declared_path → action_path/);
  assert.match(spec, /did_the_work.*verified-action threshold/i);
});

test("campaign does not fork the Mission Engine", () => {
  assert.match(spec, /reference the canonical mission\/assignment\/points primitives/i);
  assert.match(spec, /rather than inventing a parallel reward system/i);
});


test("Certified Racist is member-selected and reversible in current presentation", () => {
  assert.match(spec, /CERTIFIED RACIST/);
  assert.match(spec, /SELF-DECLARED/);
  assert.match(spec, /I CHANGED MY MIND/);
  assert.match(spec, /preserves the append-only state-transition audit history/i);
});

test("members control optional front-profile badges without self-awarding verified badges", () => {
  assert.match(spec, /show or hide each optional public badge/i);
  assert.match(spec, /reorder displayed badges/i);
  assert.match(spec, /cannot grant themselves an earned or verified badge/i);
  assert.match(spec, /verified_action/);
  assert.match(spec, /self_declared/);
});

test("admins cannot assign the racist satire badge to another member", () => {
  assert.match(spec, /must not assign \*\*Certified Racist\*\*/i);
  assert.match(spec, /make a private self-declaration public on a member's behalf/i);
});


test("public gateway carries Certified Racist, recovery, and human-race reveal", () => {
  assert.match(html, /Certified Racist/i);
  assert.match(html, /GET THE WIGGERS OUT OF THE STREET/);
  assert.match(html, /Wigger Recovery Program/);
  assert.match(html, /HOMO[\s\S]*SAPIENS/);
  assert.match(html, /CERTIFIED RACIST[\s\S]*AGAINST THE HUMAN RACE/);
  assert.match(html, /SELF-DECLARED/);
});

test("campaign rewrite preserves the canonical CIA Mind Control and Action routes", () => {
  assert.match(html, /href="album\.html\?album=cia-mind-control"/);
  assert.match(html, /href="action\/"/);
  assert.match(html, /href="mnet\.html"/);
  assert.match(html, /href="account\.html"/);
  assert.match(html, /href="docket-516\.html"/);
  assert.match(html, /"name": "end-racism"/);
  assert.match(html, /"feature": "end-racism"/);
  assert.match(html, /MCC_SONGTEST\.mount\([\s\S]*"cia-mind-control"/);
});

test("campaign canon defines recovery as behavior satire and keeps canonical proof mechanics", () => {
  assert.match(spec, /wigger.*names that behavior pattern/i);
  assert.match(spec, /not a racial classification/i);
  assert.match(spec, /must use the canonical mission, assignment, proof, review, and points primitives/i);
  assert.match(spec, /one living human species/i);
  assert.match(spec, /Human racial categories are social classifications/i);
});


test("End Racism reveals the freestyle meme mission gradually", () => {
  assert.match(html, /Field mission 004/);
  assert.match(html, /STOP A WHITE FRIEND FROM FREESTYLING AT THE FUNCTION/);
  assert.match(html, /href="wigger-recovery\.html#freestyle"/);
  assert.match(html, /Trace the source/);
  assert.match(html, /Bring proof/);
});

test("Freestyle Containment has exactly three authorized levels", () => {
  const authorized = recoveryPage.match(/<article class="wrp-level(?:\s[^"]*)?"/g) || [];
  assert.equal(authorized.length, 3);
  assert.match(recoveryPage, /Level 1[\s\S]*TALK HIM DOWN/);
  assert.match(recoveryPage, /Level 2[\s\S]*CONTAIN THE VERSE/);
  assert.match(recoveryPage, /Level 3[\s\S]*COUNTER-WIGGER DEPLOYMENT/);
  assert.match(recoveryPage, /Brother\. Not tonight\./);
  assert.match(recoveryPage, /Sometimes you gotta be a wigger to get through to a wigger/);
});

test("Level 4 remains forbidden lore, not a playable escalation", () => {
  assert.match(recoveryPage, /LEVEL 4[\s\S]*TOTAL WIGGER EVENT[\s\S]*NOT AUTHORIZED/);
  assert.match(recoveryPage, /We do not discuss Level 4/);
  assert.match(spec, /Do not expand Level 4 into a normal playable escalation/);
});

test("Freestyle mission proof stays staged and returns to canonical Action", () => {
  assert.match(recoveryPage, /Stage it with friends who are in on the joke/);
  assert.match(recoveryPage, /Do not secretly film or humiliate somebody/);
  assert.match(recoveryPage, /href="mnet\.html\?view=missions&amp;campaign=end-racism-002&amp;mission=6ec6b7a5-5290-4ba1-9f05-8f3a82e1cc04/);
  assert.match(recoveryPage, /href="end-racism\.html#recovery"/);
});


test("End Racism campaign photography is assigned to the intended lore and mission surfaces", () => {
  assert.match(html, /assets\/img\/end-racism\/wiggers-anonymous\.svg/);
  assert.match(html, /assets\/img\/end-racism\/freestyle-containment\.svg/);
  assert.match(recoveryPage, /assets\/img\/end-racism\/wiggers-anonymous\.svg/);
  assert.match(recoveryPage, /assets\/img\/end-racism\/freestyle-containment\.svg/);
  assert.match(recoveryPage, /assets\/img\/end-racism\/counter-freestyle\.svg/);
  assert.match(recoveryPage, /WIGGERS ANONYMOUS/);
});
