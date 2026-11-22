import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deterministicZip, packageMacosWorker, MAC_ARCHIVE_NAME } from '../package-macos-worker.mjs';

test('package is reproducible, validates with an independent ZIP reader and runs without a repository', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mccluster-macos-package-'));
  try {
    const first = await packageMacosWorker({ outputDir: path.join(temp, 'one') });
    const second = await packageMacosWorker({ outputDir: path.join(temp, 'two') });
    assert.equal(first.sha256, second.sha256); assert.equal(first.runtime_sha256, second.runtime_sha256);
    const archive = path.join(temp, 'one', MAC_ARCHIVE_NAME);
    const bytes = await fs.readFile(archive);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), first.sha256);
    assert.match(await fs.readFile(path.join(temp, 'one', 'mccluster-macos-worker.sha256'), 'utf8'), new RegExp(`^${first.sha256}  ${MAC_ARCHIVE_NAME}`));
    assert.equal(first.physical_mac_verified, false); assert.equal(first.credential_input, 'hidden-terminal-stdin');
    for (const file of first.files) assert.equal(/identity\.json|node\.config|\.env|\.pem|\.log|\/server\.mjs|pair-adapter/.test(file.path), false);
    const checked = spawnSync('python3', ['-m', 'zipfile', '-t', archive], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr); assert.match(checked.stdout, /Done testing/);
    const unpacked = path.join(temp, 'unpacked');
    const extracted = spawnSync('python3', ['-m', 'zipfile', '-e', archive, unpacked], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const file of first.files) {
      const content = await fs.readFile(path.join(unpacked, file.path));
      assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256);
    }
    const cli = path.join(unpacked, first.archive_root, 'core/macos/mccluster-node.mjs');
    const result = spawnSync(process.execPath, [cli, 'install', '--org-id', '11111111-1111-4111-8111-111111111111', '--state-root', path.join(temp, 'never-created'), '--dry-run'], { encoding: 'utf8', cwd: temp });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).writes, false);
    await assert.rejects(fs.stat(path.join(temp, 'never-created')), { code: 'ENOENT' });
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('ZIP packaging rejects traversal and duplicate entry paths', () => {
  for (const name of ['../key', '/absolute', 'a/../b', 'a//b', 'a\\b', 'a\0b']) assert.throws(() => deterministicZip([{ name, bytes: Buffer.from('x') }]));
  assert.throws(() => deterministicZip([{ name: 'a', bytes: Buffer.from('x') }, { name: 'a', bytes: Buffer.from('y') }]));
});
