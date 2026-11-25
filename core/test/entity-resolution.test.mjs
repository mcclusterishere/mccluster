import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeEmail, normalizePhone, normalizeDomain, normalizePersonName, normalizeOrgName, isRoleEmail,
  extractIdentity, matchKeys, scorePair, bandFor, findCandidates, requestHash, THRESHOLDS, familyOf,
} from '../src/entity-resolution/match.mjs';
import { runEntityMatchScan } from '../src/entity-resolution/scan.mjs';
import { callEntityMatchTool, ENTITY_MATCH_TOOLS } from '../src/tools/entity-match.mjs';
import { CONTROL_TOOLS, callControlTool } from '../src/tools/control.mjs';
import { entityMatchScan } from '../src/executors/entity-match-scan.mjs';
import { buildCompletionEvidence } from '../src/completion-evidence.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-0000000000aa';
const objects = JSON.parse(await readFile(new URL('./fixtures/entity-resolution/objects.json', import.meta.url), 'utf8'));
const byId = Object.fromEntries(objects.map((o) => [o.id, o]));
const pairOf = (c) => [c.left_object_id.slice(-1), c.right_object_id.slice(-1)].join('~');

test('normalization: email, phone, domain, names', () => {
  assert.equal(normalizeEmail(' Dana.Reyes+events@Example.ORG '), 'dana.reyes@example.org');
  assert.equal(normalizeEmail('T.Brooks@googlemail.com'), 'tbrooks@gmail.com');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizePhone('(203) 555-0147'), '+12035550147');
  assert.equal(normalizePhone('+1 203.555.0147 ext 12'), '+12035550147');
  assert.equal(normalizePhone('555-0147'), null);
  assert.equal(normalizePhone('555-555-5555'), null);
  assert.equal(normalizeDomain('https://www.TheLoftCT.com/events?x=1'), 'theloftct.com');
  assert.equal(normalizeDomain('someone@gmail.com'), null, 'free mail is never a domain key');
  assert.equal(normalizePersonName('Dr. José  Álvarez Jr.'), 'jose alvarez');
  assert.equal(normalizeOrgName('The Harbor Lights, L.L.C.'), 'harbor lights');
  assert.equal(isRoleEmail('booking@theloftct.com'), true);
  assert.equal(familyOf('organization'), null, 'tenant organizations are never matched');
});

test('match keys are deterministic and family-scoped', () => {
  const a = matchKeys(extractIdentity(byId['10000000-0000-4000-8000-000000000001']));
  const b = matchKeys(extractIdentity(byId['10000000-0000-4000-8000-000000000001']));
  assert.deepEqual(a, b);
  assert.ok(a.includes('person|email|dana.reyes@example.org'));
  assert.ok(a.includes('person|phone|+12035550147'));
  const venue = matchKeys(extractIdentity(byId['10000000-0000-4000-8000-000000000006']));
  assert.ok(venue.includes('company|domain|theloftct.com'));
  assert.ok(venue.includes('company|role_email|booking@theloftct.com'));
});

test('scoring and bands on fixtures', () => {
  const id = (n) => extractIdentity(byId[`10000000-0000-4000-8000-00000000000${n}`]);
  const sameEmail = scorePair(id(1), id(2));
  assert.ok(sameEmail.score >= THRESHOLDS.auto && sameEmail.strong);
  assert.equal(bandFor(sameEmail), 'auto');
  const nameOrg = scorePair(id(3), id(4));
  assert.equal(bandFor(nameOrg), 'review', 'name + company without a shared key needs the owner');
  const venue = scorePair(id(5), id(6));
  assert.ok(venue.strong);
  const household = scorePair(id(8), id(9));
  assert.ok(household.penalties.some((p) => p.kind === 'name_conflict'));
  assert.equal(bandFor(household), 'review', 'shared phone, different names: never automatic');
  assert.equal(scorePair(id('a'), id('b')), null, 'a person never matches a company');
  assert.equal(bandFor(scorePair(id('d'), id('e'))), 'none', 'similar names with conflicting emails are dropped');
  // Evidence never stores raw contact details.
  assert.doesNotMatch(JSON.stringify(sameEmail), /example\.org|555/);
});

test('thresholds can be raised, never lowered', () => {
  const scored = { score: 0.96, strong: true };
  assert.equal(bandFor(scored, { auto: 0.5 }), 'auto');
  assert.equal(bandFor(scored, { auto: 0.99 }), 'review');
  assert.equal(bandFor({ score: 0.7, strong: true }, { review: 0.1 }), 'none');
  assert.equal(bandFor({ score: 0.99, strong: false }), 'review', 'no strong key, no automatic link');
});

test('findCandidates over the fixture set is stable and correct', () => {
  const one = findCandidates(objects, { orgId: ORG });
  const two = findCandidates([...objects].reverse(), { orgId: ORG });
  assert.deepEqual(one, two, 'input order must not change the result');
  const bands = Object.fromEntries(one.candidates.map((c) => [pairOf(c), c.band]));
  assert.deepEqual(bands, { '1~2': 'auto', '3~4': 'review', '5~6': 'auto', '8~9': 'review' });
  assert.equal(one.objects_scanned, 13, 'tenant organization type is excluded');
  for (const c of one.candidates) {
    assert.ok(c.left_object_id < c.right_object_id);
    assert.match(c.request_hash, /^[0-9a-f]{64}$/);
    assert.equal(c.request_hash, requestHash({ orgId: ORG, leftId: c.left_object_id, rightId: c.right_object_id, score: c.score, evidence: c.evidence.keys }));
  }
});

test('oversized blocks are skipped, not exploded', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`, type_key: 'lead', display_name: `Person ${i}`, properties: { phone: '203-555-0100' } }));
  const out = findCandidates(many, { orgId: ORG });
  assert.equal(out.candidates.length, 0);
  assert.deepEqual(out.oversized_blocks, [{ key_kind: 'phone', size: 60 }]);
});

function fakeRpc(pages) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'ops_entity_match_settle') return { settled: [] };
    if (name === 'ops_entity_match_objects') {
      const start = args.p_after_id ? pages.findIndex((o) => o.id === args.p_after_id) + 1 : 0;
      const rows = pages.slice(start, start + args.p_limit);
      return { objects: rows, next_after_id: rows.at(-1)?.id ?? null };
    }
    if (name === 'ops_entity_match_record') {
      const c = args.p_run.candidates;
      return { run_id: '40000000-0000-4000-8000-000000000001', auto_linked: c.filter((x) => x.band === 'auto').length, queued_for_review: c.filter((x) => x.band === 'review').length, skipped: 0 };
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  return { rpc, calls };
}

test('scan settles first, pages objects, records one batch in the owner\'s name', async () => {
  const sorted = [...objects].sort((a, b) => (a.id < b.id ? -1 : 1));
  const { rpc, calls } = fakeRpc(sorted);
  const out = await runEntityMatchScan({ orgId: ORG, actorUserId: OWNER, rpc, args: { max_objects: 100 } });
  assert.deepEqual(calls.map((c) => c.name), ['ops_entity_match_settle', 'ops_entity_match_objects', 'ops_entity_match_record']);
  const record = calls.at(-1).args;
  assert.equal(record.p_actor, OWNER);
  assert.equal(record.p_run.matcher_version, 'entity-match:v1');
  assert.equal(out.auto_linked, 2);
  assert.equal(out.queued_for_review, 2);
  assert.deepEqual(out.safety, { merges: false, deletes: false, source_records_changed: false, reversible: true, communications: false });
});

test('dry run writes nothing', async () => {
  const { rpc, calls } = fakeRpc([...objects].sort((a, b) => (a.id < b.id ? -1 : 1)));
  const out = await runEntityMatchScan({ orgId: ORG, actorUserId: OWNER, rpc, args: { dry_run: true } });
  assert.deepEqual(calls.map((c) => c.name), ['ops_entity_match_objects']);
  assert.equal(out.preview.length, 4);
});

test('tools: registered, owner-gated, validated', async () => {
  const names = new Set(CONTROL_TOOLS.map((t) => t.name));
  for (const t of ENTITY_MATCH_TOOLS) assert.ok(names.has(t.name), `${t.name} not registered`);
  await assert.rejects(() => callControlTool('core.entity.match.scan', { org_id: ORG }), /authenticated actor user_id must be a UUID/);
  await assert.rejects(() => callControlTool('core.entity.match.unlink', { org_id: ORG, match_id: OWNER, reason: 'x' }, { actor: { user_id: 'nope' } }), /actor/);
  await assert.rejects(() => callEntityMatchTool('core.entity.match.scan', { org_id: ORG, type_keys: ['organization'] }, { actor: { user_id: OWNER } }, { rpc: async () => ({}) }), /outside the person and company families/);
  await assert.rejects(() => callEntityMatchTool('core.entity.match.unlink', { org_id: ORG, match_id: OWNER, reason: ' ' }, { actor: { user_id: OWNER } }, { rpc: async () => ({}) }), /reason is required/);
  let queued;
  const out = await callEntityMatchTool('core.entity.match.scan', { org_id: ORG, queue: true }, { actor: { user_id: OWNER } }, { enqueue: async (j) => { queued = j; return { id: 'job-1', job_type: j.jobType }; } });
  assert.equal(out.queued, true);
  assert.equal(queued.jobType, 'entity_match_scan');
  assert.equal(queued.input.actor_user_id, OWNER);
});

test('executor output satisfies completion evidence', async () => {
  const { rpc } = fakeRpc([...objects].sort((a, b) => (a.id < b.id ? -1 : 1)));
  const job = { id: 'job-1', org_id: ORG, job_type: 'entity_match_scan', input: { actor_user_id: OWNER } };
  const output = await entityMatchScan(job, { rpc });
  assert.equal(output.executor, 'entity_match_scan:v1');
  const evidence = buildCompletionEvidence(job, output);
  assert.ok(JSON.stringify(evidence).includes('entity_resolution'));
});

test('catalog binds every entity match tool and the runner owns the job type', async () => {
  const catalog = JSON.parse(await readFile(new URL('../capabilities/catalog.json', import.meta.url), 'utf8'));
  for (const t of ENTITY_MATCH_TOOLS) {
    const id = t.name.replace(/^core\./, '');
    assert.equal(catalog.capabilities.find((c) => c.id === id)?.lifecycle, 'active', id);
    assert.ok(catalog.bindings.some((b) => b.capability === id && b.tool === t.name && b.status === 'active'), id);
  }
  const runner = await readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /\['entity_match_scan', entityMatchScan\]/);
});
