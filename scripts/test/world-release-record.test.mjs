/* THE WORLD RELEASE RUNBOOK STAYS TRUE (docs/control-plane/WORLD-RELEASE-20261118.md). The release mechanics review of
   2026-11-19 found steps that, followed as written, turn a deploy-gate check red (RM-1), rollbacks that undo themselves or name
   no tool (RM-2), probes that cannot tell the new Worker from the old (RM-3), a stale list of pull requests (RM-4), an
   understated CI line (RM-5), checks that skip by design read as failures (RM-6), timings that do not match the workflows and
   caches (RM-8), a known effect of the publish left out (RM-9) and a merge that pins no commit (RM-10). These hold the record
   to the corrected facts, so a later edit cannot quietly put the old ones back.
     node --test scripts/test/world-release-record.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../../docs/control-plane/WORLD-RELEASE-20261118.md', import.meta.url), 'utf8');
/* compared with its line breaks folded, so wrapping a sentence differently never fails a check */
const flat = (text) => text.replace(/\s+/g, ' ');
const doc = flat(raw);
const step = (n) => { const a = raw.indexOf(`\n### ${n}. `); assert.ok(a >= 0, `step ${n} is in the record`); const b = raw.indexOf('\n### ', a + 5); return flat(raw.slice(a, b < 0 ? undefined : b)); };

test('step 11 moves the publish into the generator and its test, and asks for the whole gate (RM-1)', () => {
  const s = step(11);
  assert.match(s, /tools\/build-mission-import\.mjs/);
  assert.match(s, /scripts\/test\/mission-import\.test\.mjs/);
  assert.match(s, /node tools\/build-mission-import\.mjs --check/);
  assert.match(s, /node --test scripts\/test\/\*\.test\.mjs/);
  assert.match(s, /ten (deploy-)?gate checks/);
  assert.doesNotMatch(s, /\*\*Check right after:\*\* the drift check is ok at 377\./, 'the drift check alone is not the check');
});

test('the rollbacks say what they undo, how long they last, which tool and ledger row, and that none was exercised (RM-2)', () => {
  assert.match(step(8), /next push to `main`/, 'a forced gh-pages lasts only until the next push to main');
  assert.match(step(8), /nothing merges|no merge/i);
  assert.match(step(7), /Pages (still|will still) publish/i);
  assert.match(step(7), /cancel/i);
  const s9 = step(9);
  assert.match(s9, /apply_migration/);
  assert.match(s9, /action_mission_drawdown_publish_rollback/);
  assert.match(s9, /378/);
  const s6 = step(6);
  assert.match(s6, /revert/i);
  assert.match(s6, /revert of the revert|re-land/i);
  assert.match(doc, /[Nn]one of the three production rollbacks[^.]*has been exercised/);
});

test('step 7 tells the new Worker from the old by what changes, and says what must not change (RM-3)', () => {
  const s = step(7);
  assert.match(s, /deployment_sha/);
  assert.match(s, /must not change/);
  assert.match(doc, /301[^|]*existing behaviour/);
});

test('step 5 names the pull requests open on 2026-11-19, not the closed #809 (RM-4)', () => {
  const s = step(5);
  assert.doesNotMatch(s, /#809 bumps Wrangler/);
  for (const n of ['#816', '#817', '#758', '#679', '#785', '#803', '#760']) assert.ok(s.includes(n), n);
});

test('the CI line names the new job, the removed commands and the dispatch-only trigger (RM-5)', () => {
  assert.match(doc, /`browser-executor`/);
  assert.match(doc, /mission-swipe/);
  assert.match(doc, /core\/compute-node-v1/);
  assert.doesNotMatch(doc, /No\s+deploy workflow and no trigger changed, only path filters and suite lists\./);
});

test('step 3 names the two checks that skip by design, and the merge is read against the Supabase integration (RM-6)', () => {
  const s = step(3);
  assert.match(s, /Publish generated building artifacts/);
  assert.match(s, /Supabase Preview/);
  assert.match(doc, /"Supabase Preview" on the merge commit/);
});

test('the timings match the workflows and the caches (RM-8), the Live picker is named (RM-9), the merge pins its commit (RM-10)', () => {
  assert.match(step(7), /six minutes/);
  assert.match(step(9), /ten minutes/);
  assert.match(doc, /limit=100/);
  assert.match(step(6), /--match-head-commit/);
});

test('the record says the E=UP event timeline joined this release and the final verification follows it; the GPC wording is the owner\'s to decide', () => {
  assert.match(doc, /E=UP[^.]*event timeline[^.]*part of this release/);
  assert.match(doc, /final verification[^.]*follows/i);
  assert.match(doc, /Global Privacy Control/);
});

/* every finding of the three reviews of 2026-11-19 is accounted for in the record: fixed (with its commit and its test),
   carried into the E=UP timeline rework, refuted, or the owner's to decide */
test('"Fixed after the release review" accounts for every finding of the three reviews', () => {
  const a = raw.indexOf('\n## Fixed after the release review');
  assert.ok(a >= 0, 'the section is in the record');
  const b = raw.indexOf('\n## ', a + 5);
  const s = flat(raw.slice(a, b < 0 ? undefined : b));
  for (const id of ['RS-1', 'RS-2', 'RS-3', 'RS-4', 'RS-5', 'RS-6', 'RS-7', 'RS-8', 'RS-9', 'SEC-1', 'SEC-2', 'SEC-3', 'SEC-4', 'SEC-5', 'RM-7']) {
    assert.ok(s.includes(id), id + ' is accounted for');
  }
  assert.ok(s.includes('RM-1 to RM-6, RM-8 to RM-10'), 'the runbook findings');
  assert.match(s, /SEC-2[^.]*carried into the E=UP timeline rework/);
  assert.match(s, /SEC-5[^.]*owner's/);
  assert.match(s, /refuted/);
  /* each fixed row names its commit and the test that fails without it */
  const rows = s.split(' | ').filter((cell) => /^`[0-9a-f]{8}`$|; `[0-9a-f]{8}`$/.test(cell.trim()));
  assert.ok(rows.length >= 11, 'eleven fixed rows carry a commit: ' + rows.length);
  assert.doesNotMatch(s, /RS9SHA|CHECKSBLOCK|ROW_[A-Z]/, 'no placeholder is left');
});
