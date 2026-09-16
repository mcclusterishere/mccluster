/* The Asset Vault's contract, proven against real servers.

   These tests stand both services up on ephemeral loopback ports over a
   temporary vault and drive them with real HTTP, because every property
   that matters here — truncation, traversal, range seeking, duplicate
   provenance, content-addressing — is a property of the wire behaviour,
   not of a function in isolation. A unit test that stubs the socket
   would prove nothing about the thing that will actually run. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createServer as createIngress, config as ingressConfig,
  filename, mimeType, tokenMatches
} from '../src/asset-ingress.mjs';
import {
  createServer as createGateway, config as gatewayConfig, safeFilename
} from '../src/asset-gateway.mjs';

const TOKEN = 'test-token-that-is-long-enough-to-pass-0123456789';

async function vault() {
  const root = await mkdtemp(path.join(tmpdir(), 'mccluster-assets-'));
  const ingress = createIngress(ingressConfig({
    MCCLUSTER_ASSET_ROOT: root,
    MCCLUSTER_ASSET_INGEST_TOKEN: TOKEN,
    MCCLUSTER_ASSET_PUBLIC_BASE: 'https://assets.mccluster.org',
    MCCLUSTER_ASSET_MAX_BYTES: String(1024 * 1024)
  }));
  const gateway = createGateway(gatewayConfig({ MCCLUSTER_ASSET_ROOT: root }));
  await new Promise((r) => ingress.listen(0, '127.0.0.1', r));
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  return {
    root,
    ingestUrl: `http://127.0.0.1:${ingress.address().port}`,
    readUrl: `http://127.0.0.1:${gateway.address().port}`,
    async close() {
      await new Promise((r) => ingress.close(r));
      await new Promise((r) => gateway.close(r));
      await rm(root, { recursive: true, force: true });
    }
  };
}

function sha(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function upload(v, body, headers = {}, token = TOKEN) {
  return fetch(`${v.ingestUrl}/v1/assets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', ...headers },
    body
  });
}

/* ---------- pure helpers ---------- */

test('bearer comparison does not short-circuit on length', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abc', 'abcd'), false);
  assert.equal(tokenMatches('', 'abc'), false);
  assert.equal(tokenMatches(undefined, 'abc'), false);
});

test('filenames cannot traverse, hide, or collide with the sidecar', () => {
  assert.equal(filename('../../etc/passwd'), 'passwd');
  assert.equal(filename('/etc/shadow'), 'shadow');
  assert.equal(filename('metadata.json'), 'asset-metadata.json');
  assert.equal(filename('METADATA.JSON'), 'asset-METADATA.JSON');
  assert.equal(filename('.bashrc'), 'bashrc');
  assert.equal(filename(''), 'asset.bin');
  assert.equal(filename('model output (1).glb'), 'model-output-1-.glb');
  assert.ok(filename('x'.repeat(500)).length <= 180);
});

test('an uploader cannot store an executable content type', () => {
  assert.equal(mimeType('model/gltf-binary'), 'model/gltf-binary');
  assert.equal(mimeType('video/mp4; codecs=avc1'), 'video/mp4');
  assert.equal(mimeType('text/html'), 'application/octet-stream');
  assert.equal(mimeType('image/svg+xml'), 'application/octet-stream');
  assert.equal(mimeType('application/javascript'), 'application/octet-stream');
  assert.equal(mimeType(''), 'application/octet-stream');
});

test('the gateway refuses traversal and reserved names before touching disk', () => {
  assert.equal(safeFilename('model.glb'), 'model.glb');
  assert.equal(safeFilename('..'), null);
  assert.equal(safeFilename('.'), null);
  assert.equal(safeFilename('%2e%2e%2f%2e%2e%2fetc%2fpasswd'), null);
  assert.equal(safeFilename('metadata.json'), null);
  assert.equal(safeFilename('.hidden'), null);
  assert.equal(safeFilename('%ZZ'), null, 'a malformed escape must not throw');
});

/* ---------- ingress ---------- */

test('ingress rejects an unauthenticated upload', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const res = await fetch(`${v.ingestUrl}/v1/assets`, { method: 'POST', body: 'x' });
  assert.equal(res.status, 401);
});

test('ingress rejects a wrong token', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const res = await upload(v, 'x', {}, 'not-the-token-but-also-long-enough-0123456789');
  assert.equal(res.status, 401);
});

test('an upload is content-addressed, verified and readable back byte for byte', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const body = randomBytes(64 * 1024);
  const digest = sha(body);

  const res = await upload(v, body, {
    'x-mccluster-sha256': digest,
    'x-mccluster-filename': 'motorcycle.glb',
    'content-type': 'model/gltf-binary',
    'x-mccluster-implementation': 'local.hunyuan3d',
    'x-mccluster-node-id': 'gpu-node-1'
  });
  assert.equal(res.status, 201);
  const meta = await res.json();
  assert.equal(meta.sha256, digest);
  assert.equal(meta.bytes, body.length);
  assert.equal(meta.filename, 'motorcycle.glb');
  assert.equal(meta.mime_type, 'model/gltf-binary');
  assert.equal(meta.asset_id, `sha256:${digest}`);
  assert.equal(meta.canonical_url, `https://assets.mccluster.org/a/${digest}/motorcycle.glb`);
  assert.equal(meta.source.implementation, 'local.hunyuan3d');

  const read = await fetch(`${v.readUrl}/a/${digest}/motorcycle.glb`);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(read.headers.get('accept-ranges'), 'bytes');
  assert.match(read.headers.get('cache-control'), /immutable/);
  const back = Buffer.from(await read.arrayBuffer());
  assert.equal(sha(back), digest, 'byte-for-byte round trip');
  assert.deepEqual(back, body);
});

test('a declared SHA-256 that does not match is refused and stores nothing', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const body = randomBytes(1024);
  const wrong = sha(Buffer.from('something else'));
  const res = await upload(v, body, { 'x-mccluster-sha256': wrong });
  assert.equal(res.status, 422);
  const { error, actual } = await res.json();
  assert.match(error, /mismatch/i);
  assert.equal(actual, sha(body));
  const read = await fetch(`${v.readUrl}/a/${sha(body)}/asset.bin`);
  assert.equal(read.status, 404, 'a rejected upload must not be retrievable');
});

test('a truncated upload is refused rather than stored as a different asset', async (t) => {
  const v = await vault();
  t.after(() => v.close());

  /* Driven over a raw socket because a fetch client corrects
     Content-Length for you, which is exactly the mistake this guard
     exists to catch: declare 100 bytes, send 50, close cleanly. Without
     the length check the server stores the partial bytes under their
     own perfectly valid SHA-256 and reports success. */
  const net = await import('node:net');
  const port = Number(new URL(v.ingestUrl).port);
  const socket = net.connect(port, '127.0.0.1');
  await new Promise((r) => socket.once('connect', r));
  socket.write(
    'POST /v1/assets HTTP/1.1\r\nHost: vault\r\n'
    + `Authorization: Bearer ${TOKEN}\r\n`
    + 'Content-Type: application/octet-stream\r\nContent-Length: 100\r\n\r\n'
  );
  socket.write(Buffer.alloc(50, 7));
  socket.end();

  let raw = '';
  socket.on('data', (chunk) => { raw += chunk; });
  await new Promise((r) => socket.once('close', r));
  assert.match(raw.split('\r\n')[0] || '', /^HTTP\/1\.1 400/, `expected 400, got: ${raw.slice(0, 80)}`);

  const partial = createHash('sha256').update(Buffer.alloc(50, 7)).digest('hex');
  const read = await fetch(`${v.readUrl}/a/${partial}/asset.bin`);
  assert.equal(read.status, 404, 'the partial bytes must not have become an asset');
});

test('an upload beyond the size limit is refused', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const res = await upload(v, randomBytes(2 * 1024 * 1024));
  assert.equal(res.status, 413);
});

test('a duplicate upload keeps the first provenance record', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const body = randomBytes(2048);
  const digest = sha(body);

  const first = await upload(v, body, {
    'x-mccluster-filename': 'a.glb', 'x-mccluster-job-id': 'job-original', 'x-mccluster-node-id': 'node-a'
  });
  assert.equal(first.status, 201);

  const second = await upload(v, body, {
    'x-mccluster-filename': 'a.glb', 'x-mccluster-job-id': 'job-later', 'x-mccluster-node-id': 'node-b'
  });
  assert.equal(second.status, 200, 'a duplicate is not a creation');
  const meta = await second.json();
  assert.equal(meta.duplicate, true);
  assert.equal(meta.source.job_id, 'job-original', 'the first upload owns the provenance');

  const onDisk = JSON.parse(await readFile(
    path.join(v.root, 'sha256', digest.slice(0, 2), digest, 'metadata.json'), 'utf8'
  ));
  assert.equal(onDisk.source.job_id, 'job-original');
  assert.equal(onDisk.source.node_id, 'node-a');
});

test('an upload named metadata.json cannot overwrite the sidecar', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const body = randomBytes(256);
  const digest = sha(body);
  const res = await upload(v, body, { 'x-mccluster-filename': 'metadata.json' });
  assert.equal(res.status, 201);
  const meta = await res.json();
  assert.equal(meta.filename, 'asset-metadata.json');

  const sidecar = JSON.parse(await readFile(
    path.join(v.root, 'sha256', digest.slice(0, 2), digest, 'metadata.json'), 'utf8'
  ));
  assert.equal(sidecar.sha256, digest, 'the sidecar is still the provenance record');
});

test('nothing is left behind in .incoming after a successful upload', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  await upload(v, randomBytes(4096));
  const incoming = path.join(v.root, '.incoming');
  const { readdir } = await import('node:fs/promises');
  const left = await readdir(incoming).catch(() => []);
  assert.deepEqual(left, [], 'temporary parts must be renamed or removed');
});

test('ingress health answers without a token', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const res = await fetch(`${v.ingestUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'mccluster-asset-ingress');
});

/* ---------- gateway ---------- */

test('range requests work, which is what video seeking is', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const body = randomBytes(10_000);
  const digest = sha(body);
  await upload(v, body, { 'x-mccluster-filename': 'clip.mp4', 'content-type': 'video/mp4' });

  const mid = await fetch(`${v.readUrl}/a/${digest}/clip.mp4`, { headers: { range: 'bytes=1000-1999' } });
  assert.equal(mid.status, 206);
  assert.equal(mid.headers.get('content-range'), `bytes 1000-1999/10000`);
  assert.equal(mid.headers.get('content-length'), '1000');
  assert.deepEqual(Buffer.from(await mid.arrayBuffer()), body.subarray(1000, 2000));

  const open = await fetch(`${v.readUrl}/a/${digest}/clip.mp4`, { headers: { range: 'bytes=9000-' } });
  assert.equal(open.status, 206);
  assert.deepEqual(Buffer.from(await open.arrayBuffer()), body.subarray(9000));

  const suffix = await fetch(`${v.readUrl}/a/${digest}/clip.mp4`, { headers: { range: 'bytes=-500' } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), body.subarray(9500));

  const bad = await fetch(`${v.readUrl}/a/${digest}/clip.mp4`, { headers: { range: 'bytes=99999-' } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get('content-range'), 'bytes */10000');
});

test('HEAD returns the headers a player needs and no body', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const body = randomBytes(5000);
  const digest = sha(body);
  await upload(v, body, { 'x-mccluster-filename': 'clip.mp4', 'content-type': 'video/mp4' });

  const res = await fetch(`${v.readUrl}/a/${digest}/clip.mp4`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), '5000');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal((await res.arrayBuffer()).byteLength, 0);
});

test('a cross-origin 3D viewer can preflight and read the range headers', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const res = await fetch(`${v.readUrl}/a/${'0'.repeat(64)}/x.glb`, {
    method: 'OPTIONS',
    headers: { origin: 'https://matthew.mccluster.org', 'access-control-request-method': 'GET' }
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-methods'), /GET/);
  assert.match(res.headers.get('access-control-allow-headers'), /range/i);
  assert.match(res.headers.get('access-control-expose-headers'), /content-range/i);
});

test('the gateway will not serve the sidecar through the asset route', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const body = randomBytes(128);
  const digest = sha(body);
  await upload(v, body, { 'x-mccluster-filename': 'a.glb' });

  const direct = await fetch(`${v.readUrl}/a/${digest}/metadata.json`);
  assert.equal(direct.status, 404, 'the sidecar has its own route');

  const meta = await fetch(`${v.readUrl}/meta/${digest}`);
  assert.equal(meta.status, 200);
  assert.equal((await meta.json()).sha256, digest);
});

test('traversal attempts through the read path are refused', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  for (const attempt of [
    `/a/${'a'.repeat(64)}/..`,
    `/a/${'a'.repeat(64)}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`,
    '/a/not-a-sha/file.glb',
    '/a/../../etc/passwd'
  ]) {
    const res = await fetch(`${v.readUrl}${attempt}`);
    assert.ok(res.status === 404, `${attempt} should 404, got ${res.status}`);
  }
});

test('an unknown extension is served as opaque bytes, never as markup', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const body = Buffer.from('<script>alert(1)</script>');
  const digest = sha(body);
  await upload(v, body, { 'x-mccluster-filename': 'payload.html', 'content-type': 'text/html' });

  const res = await fetch(`${v.readUrl}/a/${digest}/payload.html`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('gateway health answers and unknown routes 404', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const health = await fetch(`${v.readUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'mccluster-asset-gateway');

  const missing = await fetch(`${v.readUrl}/nope`);
  assert.equal(missing.status, 404);

  const method = await fetch(`${v.readUrl}/health`, { method: 'DELETE' });
  assert.equal(method.status, 405);
});

test('a large asset streams back intact', async (t) => {
  const v = await vault();
  t.after(() => v.close());
  const body = randomBytes(900 * 1024);
  const digest = sha(body);
  const res = await upload(v, body, { 'x-mccluster-filename': 'big.mp4', 'content-type': 'video/mp4' });
  assert.equal(res.status, 201);

  const read = await fetch(`${v.readUrl}/a/${digest}/big.mp4`);
  const back = Buffer.from(await read.arrayBuffer());
  assert.equal(back.length, body.length);
  assert.equal(sha(back), digest);

  const onDisk = await stat(path.join(v.root, 'sha256', digest.slice(0, 2), digest, 'big.mp4'));
  assert.equal(onDisk.size, body.length);
});
