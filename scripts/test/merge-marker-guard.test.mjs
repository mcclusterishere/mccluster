/* THE TREE PASSES RECONCILIATION CI'S MERGE-MARKER GUARD.

   "Worker contracts" (.github/workflows/reconciliation-ci.yml), one of the ten deploy-gate checks listed in
   docs/control-plane/deploy-gate.json, ends with the step "Reject unresolved reconciliation markers": a git grep for any
   tracked line that starts with seven "<", "=" or ">" characters, lock files aside. It reads every tracked file, so a
   rule of equals signs around a heading fails it exactly as a real conflict marker would. THIRD-PARTY-NOTICES carried
   six such rules (found in the release preparation of 2026-11-18): the gate would have gone red on the pull request and
   again on the merge commit, where the Worker has already deployed and the Pages publish refuses.

   This runs the workflow's own command, read from the workflow file, so the root suite
   (node --test scripts/test/*.test.mjs) says so before a pull request does. Dependency-free. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflow = readFileSync(join(ROOT, ".github/workflows/reconciliation-ci.yml"), "utf8");

/* the guard as the workflow writes it: if git grep -nE '<pattern>' -- <pathspecs>; then */
const guard = workflow.match(/^\s*if git grep -nE '([^']+)' -- ([^;\n]+); then\s*$/m);

test("the workflow still carries the guard this test runs", () => {
  assert.ok(guard, "reconciliation-ci.yml has one `if git grep -nE '<pattern>' -- <pathspecs>; then` line");
  assert.match(workflow, /Reject unresolved reconciliation markers/);
  const [, pattern, pathspecs] = guard;
  assert.equal(pattern, "^(<<<<<<<|=======|>>>>>>>)", "the pattern is the three conflict markers at the start of a line");
  assert.deepEqual(pathspecs.trim().split(/\s+/), [".", "':!*.lock'"], "every tracked file but lock files");
});

test("the guard's pattern refuses a conflict marker and a rule of equals signs, and lets other rules be", () => {
  const pattern = new RegExp(guard[1]);
  for (const line of ["<<<<<<< HEAD", "=======", ">>>>>>> other", "=".repeat(80)]) assert.ok(pattern.test(line), `refused: ${line.slice(0, 16)}`);
  for (const line of ["#".repeat(80), "-".repeat(80), " =======", "a = b", "<<<<<< six", "==== four"]) assert.ok(!pattern.test(line), `let be: ${line.slice(0, 16)}`);
});

test("no tracked file has a line the guard refuses", () => {
  const run = spawnSync("git", ["grep", "-nE", guard[1], "--", ".", ":!*.lock"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  /* git grep: 0 = a match (the gate fails), 1 = no match, anything else = the scan itself failed */
  assert.notEqual(run.status, 0, `the deploy gate's "Worker contracts" check would fail on:\n${run.stdout.split("\n").slice(0, 20).join("\n")}`);
  assert.equal(run.status, 1, `git grep could not scan the tree (exit ${run.status}): ${run.stderr}`);
});
