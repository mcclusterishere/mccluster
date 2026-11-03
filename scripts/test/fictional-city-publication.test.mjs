import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const workflow = await readFile(join(ROOT, '.github/workflows/deploy-pages.yml'), 'utf8');
const exports = ['data/fictional-city/district.v1.json', 'data/fictional-city/whip-story.v1.json',
  'data/fictional-city/places.v1.json', 'data/fictional-city/chunks/index.v1.json'];
const sources = [
  '.gitignore', 'tools/publish-fictional-city.mjs', 'core/data/fictional-city/district.v1.json',
  'core/data/fictional-city/places.v1.json', 'js/fictional-city/places.mjs', 'js/fictional-city/chunks.mjs', 'js/fictional-city/spatial.mjs',
  'docs/music/whip-equipped/CANON.json', 'docs/music/whip-equipped/SCREENPLAY.md',
  'docs/music/whip-equipped/ROAD-YEARS.md'
];

// Extract and execute the checked-in workflow blocks, so a missing force-add
// or a broken output connection fails the test rather than its own mirror.
function block(text, header, indent) {
  const lines = text.split('\n'), prefix = ' '.repeat(indent);
  const start = lines.indexOf(prefix + header);
  assert.notEqual(start, -1, `Missing workflow block: ${header}`);
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].search(/\S/) > indent)) end++;
  return lines.slice(start + 1, end).join('\n');
}
const publishJob = block(workflow, 'publish:', 2);
const verifyJob = block(workflow, 'verify-live:', 2);
const publishStep = block(publishJob, '- name: Publish the fictional city and canonical story reader', 6);
const stripStep = block(publishJob, '- name: Strip the internals out of the published tree', 6);
const verifyStep = block(verifyJob, '- name: Verify the published city manifest and story bytes', 6);
function shell(step) {
  return block(step, 'run: |', 8).split('\n').map(line => line.slice(10)).join('\n');
}
function runStep(step, cwd, env = {}) {
  return exec('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', shell(step)], {
    cwd, env: { ...process.env, ...env }, timeout: 30_000
  });
}
function verificationEnvironment(stepOutputs) {
  const id = publishStep.match(/^\s+id: ([\w-]+)$/m)?.[1];
  assert.ok(id, 'the publisher needs a step ID for job outputs');
  const jobOutputs = {};
  for (const line of block(publishJob, 'outputs:', 4).split('\n').filter(line => line.trim())) {
    const match = line.match(/^\s+(\w+): \$\{\{ steps\.([\w-]+)\.outputs\.(\w+) \}\}$/);
    assert.ok(match, `Unrecognized publish output: ${line}`);
    assert.equal(match[2], id);
    jobOutputs[match[1]] = stepOutputs[match[3]];
  }
  const env = {};
  for (const line of block(verifyStep, 'env:', 8).split('\n').filter(line => line.trim())) {
    const match = line.match(/^\s+(\w+): \$\{\{ needs\.publish\.outputs\.(\w+) \}\}$/);
    assert.ok(match, `Unrecognized live verification input: ${line}`);
    assert.ok(jobOutputs[match[2]], `Missing job output ${match[2]}`);
    env[match[1]] = jobOutputs[match[2]];
  }
  return env;
}

test('Pages stages ignored city exports and verifies both exact published artifacts through its real workflow', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'mccluster-city-publication-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const checkout = join(temporary, 'checkout');
  for (const path of sources) {
    await mkdir(dirname(join(checkout, path)), { recursive: true });
    await copyFile(join(ROOT, path), join(checkout, path));
  }
  const git = (...args) => exec('git', args, { cwd: checkout });
  await git('init', '--quiet');
  await git('config', 'core.autocrlf', 'false');
  await git('config', 'core.hooksPath', '/dev/null');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'user.name', 'City publication test');
  await git('config', 'user.email', 'city-publication@example.invalid');
  await git('add', '-f', '--', ...sources);
  await git('commit', '--quiet', '-m', 'Minimal source checkout');
  assert.deepEqual((await git('check-ignore', '--no-index', '--', ...exports)).stdout.trim().split('\n'), exports,
    'the fixture must reproduce the real ignore rule that caused the missing files');

  const outputPath = join(temporary, 'publisher-outputs');
  await runStep(publishStep, checkout, { GITHUB_OUTPUT: outputPath });
  const index = JSON.parse(await readFile(join(checkout, 'data/fictional-city/chunks/index.v1.json'), 'utf8'));
  const chunkPaths = index.chunks.map(c => 'data/fictional-city/' + c.file);
  assert.ok(chunkPaths.length >= 20, 'the expanded city publishes its streamed chunks');
  const staged = (await git('ls-files', '--', ...exports, ...chunkPaths)).stdout.trim().split('\n');
  assert.deepEqual(staged.sort(), [...exports, ...chunkPaths].sort(),
    'every generated file, including every chunk, must be staged despite the real .gitignore');
  const served = [...exports, ...chunkPaths];
  const bodies = new Map(await Promise.all(served.map(async path => [path, await readFile(join(checkout, path))])));
  const hashes = exports.map(path => createHash('sha256').update(bodies.get(path)).digest('hex'));
  const stepOutputs = Object.fromEntries((await readFile(outputPath, 'utf8')).trim().split('\n').map(line => line.split('=')));
  assert.equal(stepOutputs.manifest_sha256, hashes[0]);
  assert.equal(stepOutputs.story_sha256, hashes[1]);
  assert.equal(stepOutputs.places_sha256, hashes[2]);
  assert.equal(stepOutputs.chunk_index_sha256, hashes[3]);
  assert.ok(bodies.get(exports[0]).equals(await readFile(join(ROOT, sources[2]))));
  assert.ok(bodies.get(exports[2]).equals(await readFile(join(ROOT, sources[3]))), 'places are exported byte-for-byte');
  for (const c of index.chunks) assert.equal(createHash('sha256').update(bodies.get('data/fictional-city/' + c.file)).digest('hex'), c.sha256, c.id);
  assert.equal(JSON.parse(bodies.get(exports[1])).chapters.length, 13);

  // The actual strip/add/commit step must retain those entries in the tree
  // that would be pushed to gh-pages, after deleting the canonical sources.
  await runStep(stripStep, checkout);
  for (const path of served) {
    const committed = await exec('git', ['show', `HEAD:${path}`], { cwd: checkout, encoding: 'buffer' });
    assert.ok(committed.stdout.equals(bodies.get(path)), `${path} differs in the published commit`);
  }
  assert.equal((await git('ls-files', '--', 'core', 'docs', 'tools')).stdout, '');

  const env = verificationEnvironment(stepOutputs);
  assert.equal(env.CITY_MANIFEST_SHA256, hashes[0]);
  assert.equal(env.CITY_STORY_SHA256, hashes[1]);
  assert.equal(env.CITY_PLACES_SHA256, hashes[2]);
  assert.equal(env.CITY_CHUNK_INDEX_SHA256, hashes[3]);
  const requests = [];
  let override;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname.slice(1);
    requests.push({ path, authorization: request.headers.authorization, cookie: request.headers.cookie });
    const replacement = override?.path === path ? override : null;
    response.writeHead(replacement?.status ?? (bodies.has(path) ? 200 : 404), { 'content-type': 'application/json' });
    response.end(replacement?.body ?? bodies.get(path) ?? 'Not found');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const liveEnv = { ...env, SITE: `http://127.0.0.1:${server.address().port}`, GITHUB_SHA: 'a'.repeat(40) };

  await t.test('HTTP 200 and both generated byte hashes pass without owner credentials', async () => {
    const result = await runStep(verifyStep, checkout, liveEnv);
    assert.deepEqual(requests.map(request => request.path), served);
    assert.ok(requests.every(request => !request.authorization && !request.cookie));
    for (const hash of hashes) assert.ok(result.stdout.includes(hash));
  });
  for (const path of [...exports, chunkPaths[0], chunkPaths.at(-1)]) {
    await t.test(`${path}: HTTP 404 fails even with the correct response bytes`, async () => {
      override = { path, status: 404, body: bodies.get(path) };
      await assert.rejects(runStep(verifyStep, checkout, liveEnv), error => error.code === 22 && /404/.test(error.stderr));
    });
    await t.test(`${path}: HTTP 200 with changed bytes fails`, async () => {
      override = { path, status: 200, body: Buffer.concat([bodies.get(path), Buffer.from('\n')]) };
      await assert.rejects(runStep(verifyStep, checkout, liveEnv), error => error.code === 1 && /SHA256 .* differs/.test(error.stdout));
    });
  }
  await t.test('missing generated hash fails closed', async () => {
    override = null;
    await assert.rejects(runStep(verifyStep, checkout, { ...liveEnv, CITY_STORY_SHA256: '' }),
      error => error.code === 1 && /Missing or invalid expected SHA256/.test(error.stdout));
    await assert.rejects(runStep(verifyStep, checkout, { ...liveEnv, CITY_CHUNK_INDEX_SHA256: '' }),
      error => error.code === 1 && /Missing or invalid expected SHA256/.test(error.stdout));
  });
});
