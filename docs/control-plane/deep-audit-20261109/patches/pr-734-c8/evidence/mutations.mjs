// Mutation check for the C8 series (a scratch check, not part of the patches).
// Usage: node mutations.mjs <worktree at the series head> <empty scratch dir>
// Copies <worktree>/core into the scratch dir, applies one mutant at a time to
// the coverage reader (src/actors/coverage.mjs) or the queue writer
// (src/supabase.mjs), runs the two coverage test files there, and restores the
// file. Each mutant's original text must occur exactly once.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [worktree, scratch] = process.argv.slice(2);
if (!worktree || !scratch) { console.error('usage: node mutations.mjs <worktree> <scratch dir>'); process.exit(2); }
const core = join(scratch, 'core');
cpSync(join(worktree, 'core'), core, { recursive: true });

const reader = 'src/actors/coverage.mjs', writer = 'src/supabase.mjs';
const mutants = [
  ['M1 reader: outcome keyed on completed again', reader,
    "preview_outcome: j.status === 'done' ?", "preview_outcome: j.status === 'completed' ?"],
  ['M2 reader: outcome folded back into status for done rows', reader,
    'status: j.status, preview_outcome:', "status: j.status === 'done' ? (j.output?.status || 'needs_review') : j.status, preview_outcome:"],
  ['M3 reader: outcome read whatever the queue status', reader,
    "preview_outcome: j.status === 'done' ? (j.output?.status || 'needs_review') : null", 'preview_outcome: j.output?.status || null'],
  ['M4 reader: the needs_review default removed', reader,
    "(j.output?.status || 'needs_review')", '(j.output?.status)'],
  ['M5 writer: completeJob stores completed instead of done', writer,
    "status: 'done',", "status: 'completed',"],
];

const run = () => spawnSync(process.execPath, ['--test', 'test/actor-coverage.test.mjs', 'test/actor-coverage-queue-contract.test.mjs'], { cwd: core, encoding: 'utf8' });
const summary = out => {
  const count = name => Number((out.match(new RegExp(`^# ${name} (\\d+)$`, 'm')) || [])[1]);
  const failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(m => m[1]);
  return { tests: count('tests'), pass: count('pass'), fail: count('fail'), failed };
};

console.log(`# node ${process.version}; worktree ${worktree}; ${new Date().toISOString()}`);
const clean = summary(run().stdout);
console.log(`unmutated: tests ${clean.tests}, pass ${clean.pass}, fail ${clean.fail}`);
if (clean.fail) process.exit(1);
for (const [name, file, from, to] of mutants) {
  const path = join(core, file), original = readFileSync(path, 'utf8');
  const occurrences = original.split(from).length - 1;
  if (occurrences !== 1) { console.log(`${name}: SETUP ERROR (${occurrences} occurrences)`); process.exitCode = 1; continue; }
  writeFileSync(path, original.replace(from, to));
  const result = summary(run().stdout);
  writeFileSync(path, original);
  console.log(`${name}: ${result.fail ? 'KILLED' : 'SURVIVED'} (tests ${result.tests}, pass ${result.pass}, fail ${result.fail})`);
  for (const test of result.failed) console.log(`  not ok - ${test}`);
}
