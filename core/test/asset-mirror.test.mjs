import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  assertPublicHttpUrl,
  buildStoragePath,
  downloadAsset,
  mirrorAsset,
} from '../src/show-studio/asset-mirror.mjs';
import { assetMirror } from '../src/executors/asset-mirror.mjs';
import { buildCompletionEvidence } from '../src/completion-evidence.mjs';

const ORG = '123e4567-e89b-42d3-a456-426614174000';

function response(bytes, { status = 200, headers = {} } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => map.get(String(name).toLowerCase()) ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => '',
  };
}

// ---- SSRF boundary --------------------------------------------------------

test('an asset url pointing inside the host is refused', () => {
  // Core deliberately runs Halo and friends on loopback, and its cloud
  // metadata answers on a link-local address. A provider-supplied url that
  // reached either would turn the mirror into an exfiltration path.
  for (const url of [
    'http://127.0.0.1:8080/secret',
    'http://localhost/secret',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/internal',
    'http://192.168.1.10/internal',
    'http://172.16.0.9/internal',
    'http://[::1]/secret',
    'http://halo.internal/secret',
  ]) {
    assert.throws(() => assertPublicHttpUrl(url), /not public/, `expected ${url} to be refused`);
  }
});

test('a non-http scheme is refused', () => {
  assert.throws(() => assertPublicHttpUrl('file:///etc/shadow'), /must be http/);
  assert.throws(() => assertPublicHttpUrl('gopher://example.com/'), /must be http/);
});

test('an ordinary provider url passes', () => {
  assert.equal(assertPublicHttpUrl('https://v3.fal.media/files/x/out.glb').protocol, 'https:');
});

// ---- content addressing ---------------------------------------------------

test('storage paths are content-addressed and namespaced by org', () => {
  const sha = 'a'.repeat(64);
  assert.equal(
    buildStoragePath({ orgId: ORG, sha256: sha, url: new URL('https://x.test/out.glb'), mimeType: null }),
    `${ORG}/aa/${sha}.glb`
  );
});

test('a storage path cannot be built without a real hash', () => {
  assert.throws(() => buildStoragePath({ orgId: ORG, sha256: 'nope', url: new URL('https://x.test/a.png') }), /requires a sha256/);
});

test('the extension falls back to the mime type when the url has none', () => {
  const sha = 'b'.repeat(64);
  assert.ok(
    buildStoragePath({ orgId: ORG, sha256: sha, url: new URL('https://x.test/download'), mimeType: 'model/gltf-binary' })
      .endsWith('.glb')
  );
});

// ---- download guards ------------------------------------------------------

test('an oversized asset is refused on the declared length, before it is buffered', async () => {
  await assert.rejects(
    () => downloadAsset(
      { url: 'https://x.test/huge.mp4' },
      { fetchImpl: async () => response(new Uint8Array(4), { headers: { 'content-length': '999999999' } }), maxBytes: 1024 }
    ),
    /over the 1024 mirror limit/
  );
});

test('an asset that lies about its length is still refused once measured', async () => {
  await assert.rejects(
    () => downloadAsset(
      { url: 'https://x.test/huge.mp4' },
      { fetchImpl: async () => response(new Uint8Array(4096)), maxBytes: 1024 }
    ),
    /over the 1024 mirror limit/
  );
});

test('an empty asset is not treated as mirrored', async () => {
  await assert.rejects(
    () => downloadAsset({ url: 'https://x.test/a.png' }, { fetchImpl: async () => response(new Uint8Array(0)) }),
    /empty asset/
  );
});

test('the hash is of the bytes actually received', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const result = await downloadAsset(
    { url: 'https://x.test/a.png' },
    { fetchImpl: async () => response(bytes, { headers: { 'content-type': 'image/png' } }) }
  );
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.mimeType, 'image/png');
});

// ---- mirroring ------------------------------------------------------------

function recordingRest() {
  const calls = [];
  return {
    calls,
    restImpl: async (path, init) => {
      calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
      return { body: [] };
    },
  };
}

test('a mirrored asset records its path, hash and size', async () => {
  const bytes = new Uint8Array([9, 9, 9]);
  const { calls, restImpl } = recordingRest();
  const result = await mirrorAsset(
    { id: 'asset-1', org_id: ORG, url: 'https://x.test/a.glb' },
    {
      env: { SUPABASE_URL: 'https://db.test' },
      fetchImpl: async (target, init) => (init?.method === 'POST' ? response(new Uint8Array(0)) : response(bytes)),
      restImpl,
      headersImpl: () => ({ apikey: 'k' }),
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.bytes, 3);
  const recorded = calls.find((call) => call.path.includes('media_record_asset_mirror'));
  assert.ok(recorded, 'expected the success to be recorded');
  assert.equal(recorded.body.p_sha256, result.sha256);
  assert.equal(recorded.body.p_bytes, 3);
});

test('a failed mirror records the reason and never claims a storage path', async () => {
  const { calls, restImpl } = recordingRest();
  const result = await mirrorAsset(
    { id: 'asset-2', org_id: ORG, url: 'http://169.254.169.254/latest/meta-data/' },
    { env: { SUPABASE_URL: 'https://db.test' }, fetchImpl: async () => response(new Uint8Array([1])), restImpl, headersImpl: () => ({}) }
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /not public/);
  assert.equal(calls.some((call) => call.path.includes('media_record_asset_mirror')), false);
  assert.ok(calls.some((call) => call.path.includes('media_fail_asset_mirror')));
});

// ---- completion evidence --------------------------------------------------

test('the runner accepts a well-formed asset_mirror result', () => {
  const output = {
    executor: 'asset_mirror:v1',
    summary: 'Mirrored 1/1 generated assets into McCluster storage.',
    claimed: 1,
    mirrored: 1,
    failed: 0,
    assets: [{ asset_id: 'asset-1', storage_path: `${ORG}/aa/${'a'.repeat(64)}.glb`, sha256: 'a'.repeat(64), bytes: 12 }],
    failures: [],
  };
  const evidence = buildCompletionEvidence({ id: 'job-1', job_type: 'asset_mirror' }, output);
  const record = evidence.completion_evidence.records.find((r) => r.kind === 'assets_mirrored');
  assert.equal(record.mirrored, 1);
  assert.equal(record.assets[0].bytes, 12);
});

test('a mirror that claims more than it evidenced is rejected', () => {
  // "Mirrored 3" with one hash is the exact shape of a job reporting work it
  // did not do, which is what the evidence policy exists to catch.
  assert.throws(
    () => buildCompletionEvidence({ id: 'job-2', job_type: 'asset_mirror' }, {
      executor: 'asset_mirror:v1',
      claimed: 3,
      mirrored: 3,
      failed: 0,
      assets: [{ asset_id: 'a', storage_path: 'p', sha256: 'a'.repeat(64), bytes: 1 }],
    }),
    /different count than it evidenced/
  );
});

test('a mirrored asset without a real hash is rejected', () => {
  assert.throws(
    () => buildCompletionEvidence({ id: 'job-3', job_type: 'asset_mirror' }, {
      executor: 'asset_mirror:v1',
      claimed: 1,
      mirrored: 1,
      failed: 0,
      assets: [{ asset_id: 'a', storage_path: 'p', sha256: 'not-a-hash', bytes: 1 }],
    }),
    /sha256 of the stored bytes/
  );
});

test('the executor summarises an empty queue without inventing work', async () => {
  const output = await assetMirror({ input: { limit: 1 } }, { restImpl: async () => ({ body: [] }) });
  assert.equal(output.claimed, 0);
  assert.equal(output.mirrored, 0);
  assert.match(output.summary, /No generated assets/);

  // An empty run must still satisfy the evidence policy, or a quiet queue
  // would fail every job it produced.
  const evidence = buildCompletionEvidence({ id: 'job-4', job_type: 'asset_mirror' }, output);
  assert.equal(evidence.completion_evidence.records.find((r) => r.kind === 'assets_mirrored').claimed, 0);
});
