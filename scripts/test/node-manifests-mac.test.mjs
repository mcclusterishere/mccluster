/* THE MAC NODE (Shiloh Mac, M1), held to the same contract as the laptop.

   core/node-manifests/owner-mac-m1.json is what core/macos/mccluster-mac-node.sh install writes to the Mac's
   capabilities.json (qwen3:8b pruned below 16 GB). It must validate through the protocol, carry the OVH node's
   ai.chat schemas byte for byte (one task claimable on any node), use loopback executors only, say owned, and
   claim no GPU for the lyric machine (faster-whisper runs on the CPU there). The script must never carry a key. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const { validateCapabilityManifest } = await import(pathToFileURL(join(ROOT, 'core/src/compute/protocol.mjs')).href);
const raw = read('core/node-manifests/owner-mac-m1.json');
const mac = JSON.parse(raw);
const ovh = JSON.parse(read('core/node-manifests/ovh-primary.json'));
const laptop = JSON.parse(read('core/node-manifests/owner-windows-gpu.json'));
const ovhChat = ovh.capabilities.find((e) => e.capability === 'ai.chat' && e.implementation === 'qwen3.8b.local');
const script = read('core/macos/mccluster-mac-node.sh');

test('validates with the resident vision 4b, the on-demand 8b and the lyric machine', () => {
  const n = validateCapabilityManifest(mac.capabilities);
  assert.deepEqual(n.map((e) => `${e.capability}/${e.implementation}`), ['ai.chat/qwen3-vl.4b.local', 'ai.chat/qwen3.8b.local', 'lyrics.align/lyrics.machine.local']);
  assert.equal(mac.max_leases, 1);
  assert.deepEqual(mac.labels, { site: 'owner-mac-m1', trust: 'owned', role: 'apple-silicon-laptop', machine: 'shiloh-mac' });
});

test('every ai.chat entry is claimable on any node: the OVH schemas, the laptop\'s implementation', () => {
  for (const e of mac.capabilities.filter((x) => x.capability === 'ai.chat')) {
    assert.deepEqual(e.input_schema, ovhChat.input_schema, e.implementation);
    assert.deepEqual(e.output_schema, ovhChat.output_schema, e.implementation);
    assert.deepEqual(e, laptop.capabilities.find((x) => x.implementation === e.implementation), e.implementation + ' matches the laptop entry');
  }
  assert.equal(mac.capabilities.find((e) => e.implementation === 'qwen3-vl.4b.local').features.vision, true);
});

test('loopback executors only; the lyric machine claims no GPU', () => {
  for (const e of mac.capabilities) for (const k of ['url', 'health_url']) assert.equal(new URL(e.executor[k]).hostname, '127.0.0.1', e.implementation + ' ' + k);
  const lyr = mac.capabilities.find((e) => e.capability === 'lyrics.align');
  assert.equal(lyr.features.gpu, undefined);
  assert.equal(new URL(lyr.executor.url).port, '4792');
});

test('no private strings in the manifest or the script; the script prunes the 8b below 16 GB and keeps no key', () => {
  const PRIVATE = /\/Users\/[A-Za-z]|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?!127\.0\.0\.1\b)\d{1,3}(?:\.\d{1,3}){3}\b/;
  assert.doesNotMatch(raw, PRIVATE);
  assert.doesNotMatch(script, PRIVATE);
  assert.match(script, /Number\(gib\) < 16\) m\.capabilities = m\.capabilities\.filter\(\(e\) => e\.implementation !== "qwen3\.8b\.local"\)/);
  assert.doesNotMatch(script, /SERVICE_ROLE|SUPABASE_[A-Z_]*KEY|sk_live|eyJ[A-Za-z0-9]/);
  assert.match(script, /MCCLUSTER_NODE_ENROLL_TOKEN=\n/, 'the token is left for the owner to fill, never written in');
  assert.match(script, /chmod 600 "\$STATE\/node\.env"/);
  assert.match(script, /\[ "\$\(uname -m\)" = arm64 \]/);
});
