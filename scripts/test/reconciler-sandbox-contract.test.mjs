import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const unit = await readFile(new URL('../../core/systemd/mccluster-vps-reconcile.service', import.meta.url), 'utf8');
const deploy = await readFile(new URL('../../scripts/deploy-ovh-core.sh', import.meta.url), 'utf8');

test('reconciler sandbox permits every deploy-owned system configuration path', () => {
  const line = unit.split('\n').find((value) => value.startsWith('ReadWritePaths='));
  assert.ok(line, 'ReadWritePaths is missing');
  for (const path of [
    '/opt/mccluster',
    '/var/lib/mccluster',
    '/etc/systemd/system',
    '/etc/polkit-1/rules.d',
    '/etc/mccluster-node',
    '/run',
    '/tmp'
  ]) {
    assert.ok(line.includes(path), `reconciler cannot write deploy-owned path ${path}`);
  }

  assert.match(deploy, /\/etc\/polkit-1\/rules\.d\/50-mccluster-preview-build\.rules/);
  assert.match(deploy, /\/etc\/mccluster-node\/capabilities\.json/);
});
