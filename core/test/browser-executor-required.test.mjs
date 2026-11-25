// The browser-executor CI job must FAIL when it cannot run the real-Chromium tests, never pass with all of them skipped
// (verification finding N2V-m1). MCCLUSTER_BROWSER_TESTS_REQUIRED=1, which .github/workflows/compute-node-ci.yml sets on
// that job, turns the harness's "unverified here" skip into a failing test. This runs the harness itself
// (test/browser-executor.test.mjs) as that job does, with no browser to find, both ways, so it launches no Chromium:
// - Chromium missing: Playwright is found where the executor finds it, but PLAYWRIGHT_BROWSERS_PATH is an empty folder;
// - Playwright missing: MCCLUSTER_BROWSER_PLAYWRIGHT_DIR names an empty folder (the owner's pin, the only place tried).
// Required, each run exits non-zero and names what is missing; not required, it skips and passes, as a developer's
// machine without a browser always has.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = fileURLToPath(new URL('./browser-executor.test.mjs', import.meta.url));
const empty = mkdtempSync(path.join(os.tmpdir(), 'mccluster-no-browser-'));
after(() => rmSync(empty, { recursive: true, force: true }));

function harness(env) {
  const childEnv = { ...process.env, ...env };
  // a nested run must report on its own, not as a child of this runner
  delete childEnv.NODE_TEST_CONTEXT;
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete childEnv[key];
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', HARNESS], { env: childEnv, encoding: 'utf8', timeout: 120000 });
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  const count = (name) => Number((new RegExp(`^# ${name} (\\d+)$`, 'm').exec(out) || [])[1] || 0);
  return { status: run.status, out, pass: count('pass'), fail: count('fail'), skipped: count('skipped') };
}

const MISSING = {
  'Chromium missing': { PLAYWRIGHT_BROWSERS_PATH: empty },
  'Playwright missing': { MCCLUSTER_BROWSER_PLAYWRIGHT_DIR: empty }
};

for (const [name, env] of Object.entries(MISSING)) {
  test(`${name}, required: the harness fails and says what is missing, instead of skipping`, { timeout: 150000 }, () => {
    const run = harness({ ...env, MCCLUSTER_BROWSER_TESTS_REQUIRED: '1' });
    assert.notEqual(run.status, 0, `the job must go red, got exit ${run.status}\n${run.out.slice(-1500)}`);
    assert.ok(run.fail >= 1, 'a failing test, not only skips');
    assert.match(run.out, /MCCLUSTER_BROWSER_TESTS_REQUIRED/, 'the failure names the flag that required the browser');
    assert.match(run.out, /playwright not found|chromium not installed/, 'and what was not there');
  });

  test(`${name}, not required: the harness skips the browser tests and passes, as before`, { timeout: 150000 }, () => {
    const run = harness({ ...env, MCCLUSTER_BROWSER_TESTS_REQUIRED: undefined });
    assert.equal(run.status, 0, `exit ${run.status}\n${run.out.slice(-1500)}`);
    assert.equal(run.fail, 0);
    assert.ok(run.skipped >= 10, `the real-Chromium tests are skipped (${run.skipped})`);
    assert.match(run.out, /executor tests skipped \(unverified here\)/);
  });
}
