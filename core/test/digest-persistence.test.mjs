import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Audit finding C7: a failed daily report write still exited 0, so the systemd
// timer looked successful with no canonical report. Loopback-free synthetic fetch.
const ORG = '123e4567-e89b-42d3-a456-426614174000';
const DIGEST = new URL('../src/digest.mjs', import.meta.url).pathname;

async function run(mockSource, env = {}) {
  const dir = await mkdtemp('/tmp/mccluster-digest-test-');
  const preload = `${dir}/mock.mjs`;
  await writeFile(preload, mockSource);
  try {
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, DIGEST], {
      env: { ...process.env, SUPABASE_URL: 'https://digest.test', SUPABASE_SECRET_KEY: 'sb_secret_test', MCCLUSTER_ORG_ID: ORG, MCCLUSTER_SMS_NOTIFY: '0', ...env },
      encoding: 'utf8', timeout: 15000,
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('a report that cannot be persisted is a failed run, not a successful timer exit', async () => {
  const result = await run(`globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'POST') throw new Error('synthetic digest persistence failure');
    return Response.json([]);
  };\n`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /core_digest_record_failed/);
  assert.match(result.stderr, /core_digest_failed/);
});

test('a persisted report exits successfully and carries a stable window identity even when SMS is off', async () => {
  const result = await run(`const posts = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'POST') { posts.push(JSON.parse(init.body)); return Response.json([{ id: 'sig-1', ...posts[0] }]); }
    return Response.json([]);
  };
  process.on('exit', () => { process.stderr.write('POSTS=' + JSON.stringify(posts) + '\\n'); });\n`);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.equal(out.recorded, true);
  assert.match(out.window_id, /^core_morning_digest:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\/\d+h$/);
  const posts = JSON.parse(result.stderr.match(/POSTS=(.*)/)[1]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.window_id, out.window_id);
  assert.equal(out.sms.sent, false);
});

test('a repeated run for the same window reuses the existing report instead of inserting a duplicate', async () => {
  const result = await run(`let posts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'GET') return Response.json([{ id: 'sig-existing', payload: { window_id: new URL(href).searchParams.get('payload->>window_id').slice(3), sms_sent: true } }]);
    if (href.includes('/rest/v1/ops_signals') && (init.method || 'GET') === 'POST') { posts += 1; }
    return Response.json([]);
  };
  process.on('exit', () => { process.stderr.write('POSTS=' + posts + '\\n'); });\n`);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.equal(out.recorded, true);
  assert.equal(out.duplicate_window, true);
  assert.equal(out.sms.reason, 'already_delivered');
  assert.match(result.stderr, /POSTS=0/);
});
