// The owner's #510 runbook and the mechanism page, held to the scripts and
// workflows they describe. A runbook claim the code does not support is a
// defect in the runbook: each test reads the claim and the code it rests on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const RUNBOOK = 'docs/control-plane/OVH-510-CONTRACT-AND-AUTH-RUNBOOK.md';

// From a heading that starts with `prefix` to the next heading of the same or a higher level.
function section(markdown, prefix) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(prefix));
  assert.ok(start >= 0, `section ${prefix}`);
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex((line, index) => index > start && /^#+ /.test(line) && line.match(/^#+/)[0].length <= level);
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

test('the runbook names the job that watches a promotion, and says a green run is not acceptance', async () => {
  const [runbook, workflow, verification, collect, reconciler] = await Promise.all([
    read(RUNBOOK),
    read('.github/workflows/promote-ovh-production.yml'),
    read('core/src/health-verification.mjs'),
    read('core/src/executors/host-health-collect.mjs'),
    read('scripts/mccluster-vps-reconcile.sh'),
  ]);
  const step4 = section(runbook, '## Step 4.');
  const job = step4.match(/has the `([a-z_-]+)` job/)?.[1];
  assert.ok(job && workflow.includes(`\n  ${job}:\n`), `the runbook names a job the workflow has: ${job}`);
  assert.match(workflow.slice(workflow.indexOf(`\n  ${job}:\n`)), /^    needs: promote$/m);
  // The broker serves the target from its restart, before the deployer's gate; a deferred rollback keeps it.
  assert.match(step4, /\*\*A green run is not acceptance\.\*\*/);
  assert.match(step4, /a rollback whose producer drain times out is deferred and leaves the failed release live, serving the target/);
  assert.match(step4, /Step 5 is acceptance: `deployed_sha` equal to the serving SHA, and `runtime_verification` = `verified`\./);
  assert.match(runbook, /\| Promotion names the previous head and watches the public serving SHA\. A green run is not acceptance: step 5 is \|/);
  assert.doesNotMatch(runbook, /verifies the runtime|has the `verify` job/);
  // Why step 5 tells them apart: runtime_verification compares the serving SHA with the host's
  // deployment record, which the reconciler writes only after the deployer returned success.
  assert.match(verification, /const verified = \[probes\.local_core,probes\.public_core\]\.every\(probe => access\(probe\) === 'ok' && validSha\(probe\.deployment_sha\) && probe\.deployment_sha === snapshot\.deployment\?\.deployed_sha\);/);
  assert.match(collect, /textFile\('\/var\/lib\/mccluster\/reconcile\/deployed_sha'\)/);
  const deploy = reconciler.indexOf('bash "${CHECKOUT}/scripts/deploy-ovh-core.sh" "${CHECKOUT}" "${TARGET_SHA}"');
  const stamp = reconciler.indexOf('mv "${STATE_FILE}.tmp" "${STATE_FILE}"');
  assert.ok(deploy > 0 && stamp > deploy, 'the deployment record is written only after the deployer succeeded');
});
