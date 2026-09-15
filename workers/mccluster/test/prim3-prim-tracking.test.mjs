import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const htmlPath = resolve(root, 'prim3.html');
const trackingPath = resolve(root, 'js', 'prim3-tracking.js');
const modalityPath = resolve(root, 'docs', 'prim3', 'LEARNING-MODALITY-CONTRACT.md');
const backendPath = resolve(root, 'docs', 'prim3', 'PRIM-BACKEND-TRACKING.md');

async function text(path) {
  return readFile(path, 'utf8');
}

test('public PRIM copy assigns one learning modality to each letter', async () => {
  const html = await text(htmlPath);
  assert.match(html, />PRINCIPLES</);
  assert.match(html, />RHYTHM</);
  assert.match(html, />IMMERSION</);
  assert.match(html, />MISSIONS</);
  assert.match(html, /Learn it\. Remember it\./);
  assert.match(html, /See it\. Do it\./);
  assert.match(html, /Principles · Reasoning · Instruction · Mastery/);
  assert.match(html, /Patterns · Rhythm · Imagery · Memory/);
  assert.match(html, /Plot · Relevance · Immersion · Meaning/);
  assert.match(html, /Practice · Response · Interaction · Mastery/);
});

test('PRIM dashboard exposes four modality meters and three exam trackers', async () => {
  const html = await text(htmlPath);
  for (const id of ['primPValue','primRValue','primIValue','primMValue','securityObjectiveValue','networkObjectiveValue','aPlusObjectiveValue']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /js\/prim3-tracking\.js/);
  assert.match(html, /css\/prim3-tracking\.css/);
});

test('tracking uses the existing authenticated PRIM3 progress API and mastery field', async () => {
  const source = await text(trackingPath);
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /\/v1\/prim3\/progress/);
  assert.match(source, /\/v1\/prim3\/course/);
  assert.match(source, /mastery/);
  assert.match(source, /recordModality/);
  assert.match(source, /\["R", "I", "M"\]/);
  assert.doesNotMatch(source, /recordModality\([^)]*"P"/);
});

test('objective tracker reads all three certification maps without making A Plus a completion gate', async () => {
  const source = await text(trackingPath);
  assert.match(source, /SECURITY-PLUS-TOPIC-LEDGER\.json/);
  assert.match(source, /NETWORK-PLUS-TOPIC-LEDGER\.json/);
  assert.match(source, /APLUS-PRECURSOR-MAP\.json/);
  const modality = await text(modalityPath);
  assert.match(modality, /Security Plus and Network Plus remain mandatory complete coverage targets/);
  assert.match(modality, /A Plus is a supporting precursor and overlap tracker/);
});

test('backend contract preserves Cloudflare Supabase and VPS authority boundaries', async () => {
  const backend = await text(backendPath);
  assert.match(backend, /Cloudflare is the public edge/);
  assert.match(backend, /Supabase remains the system of record for learner state/);
  assert.match(backend, /VPS is the persistent execution plane/);
  assert.match(backend, /browser must never connect directly to the VPS/);
  assert.match(backend, /ops_agent_jobs/);
  assert.match(backend, /must not create a VPS only learner profile database/);
});
