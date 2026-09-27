import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

async function withWorkspace(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mccluster-home-'));
  process.env.MCCLUSTER_HOME_ROOT = root;
  const mod = await import('../src/tools/workspace.mjs?test=' + Date.now() + '-' + Math.random());
  try {
    await fn(mod, root);
  } finally {
    delete process.env.MCCLUSTER_HOME_ROOT;
    await rm(root, { recursive: true, force: true });
  }
}

test('McCluster home creates persistent standard directories and reports its contract', async () => {
  await withWorkspace(async ({ workspaceStatus }, root) => {
    const status = await workspaceStatus();
    assert.equal(status.schema, 'mccluster-workspace/v1');
    assert.equal(status.root, root);
    assert.equal(status.persistent, true);
    for (const name of ['notes', 'artifacts', 'scratch', 'state', 'inbox', 'outbox']) {
      assert.ok(status.entries.some((entry) => entry.name === name && entry.type === 'directory'));
    }
  });
});

test('McCluster home atomically writes, reads, and lists a bounded text file', async () => {
  await withWorkspace(async ({ workspaceWrite, workspaceRead, workspaceList }) => {
    const written = await workspaceWrite({ path: 'notes/session.md', content: '# durable\nMcCluster remembers this.' });
    assert.equal(written.written, true);
    assert.equal(written.path, 'notes/session.md');

    const read = await workspaceRead({ path: 'notes/session.md' });
    assert.equal(read.content, '# durable\nMcCluster remembers this.');

    const listed = await workspaceList({ path: 'notes' });
    assert.ok(listed.entries.some((entry) => entry.path === 'notes/session.md' && entry.type === 'file'));
  });
});

test('McCluster home refuses path traversal and absolute paths', async () => {
  await withWorkspace(async ({ workspaceRead, workspaceWrite }) => {
    await assert.rejects(() => workspaceWrite({ path: '../outside.txt', content: 'no' }), /escapes McCluster home/);
    await assert.rejects(() => workspaceWrite({ path: '/tmp/outside.txt', content: 'no' }), /must be relative/);
    await assert.rejects(() => workspaceRead({ path: '../../etc/passwd' }), /escapes McCluster home/);
  });
});
