import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const spec = fs.readFileSync(new URL("../../docs/END-RACISM-TWO-PATH-CAMPAIGN.md", import.meta.url), "utf8");

test("End Racism satire is explicitly self-declared, never inferred", () => {
  assert.match(spec, /SELF-DECLARED: VERIFIED RACIST/);
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
