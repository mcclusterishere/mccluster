import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const deploy = await readFile(new URL('../../scripts/deploy-ovh-core.sh', import.meta.url), 'utf8');
const resume = await readFile(new URL('../src/tools/resume.mjs', import.meta.url), 'utf8');

test('OVH deploy creates persistent McCluster machine roots', () => {
  for (const dir of [
    '/var/lib/mccluster-core/workspace',
    '/var/lib/mccluster-core/sessions',
    '/var/lib/mccluster-core/artifacts',
  ]) {
    assert.ok(deploy.includes(dir), 'missing persistent McCluster root: ' + dir);
  }
});

test('core.resume distinguishes machine state from canonical conversation memory', () => {
  assert.match(resume, /workspace_root: process\.env\.MCCLUSTER_WORKSPACE_ROOT/);
  assert.match(resume, /session_root: process\.env\.MCCLUSTER_SESSION_ROOT/);
  assert.match(resume, /artifact_root: process\.env\.MCCLUSTER_ARTIFACT_ROOT/);
  assert.match(resume, /repository_root: process\.env\.MCCLUSTER_REPO_ROOT/);
  assert.match(resume, /worktree_root: process\.env\.MCCLUSTER_WORKTREE_ROOT/);
  assert.match(resume, /conversation_truth: 'supabase:ops_ai_threads\+ops_ai_messages'/);
  assert.match(resume, /private_memory_truth: 'supabase:ai_context'/);
});
