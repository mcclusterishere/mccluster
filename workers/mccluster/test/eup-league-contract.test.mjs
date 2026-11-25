// E=Up League wire contract: INTERNAL CONSISTENCY ONLY.
// This file proves that workers/mccluster/src/eup/league-contract.js agrees with itself and with the frozen
// build decisions (guard classes, error table, media rules, exclusions). It proves nothing about the SQL, the
// Worker routes or the pages: those lanes are tested against this contract in their own files.
// Every value below is synthetic. Notice texts and caps are test fixtures, not defaults.
// Run: (cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/eup-league-contract.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as C from '../src/eup/league-contract.js';
import { CAMPAIGN_FIXTURE } from '../src/eup/league-fixture.js';

const SOURCE = readFileSync(new URL('../src/eup/league-contract.js', import.meta.url), 'utf8');
const TABLES = { owner: C.OWNER_ACTIONS, member: C.MEMBER_ACTIONS, media: C.MEDIA_SEAL };
const allActions = () => Object.entries(TABLES).flatMap(([surface, table]) => Object.entries(table).map(([name, spec]) => ({ surface, name, spec })));
const known = (ref) => { const [surface, name] = ref.split(':'); return Boolean(TABLES[surface] && Object.hasOwn(TABLES[surface], name)); };
const ok = (name, value) => assert.equal(C.checkDocument(C.DOCUMENTS[name], value), null, `${name} should accept ${JSON.stringify(value).slice(0, 120)}`);
const no = (name, value, why) => assert.notEqual(C.checkDocument(C.DOCUMENTS[name], value), null, `${name} should refuse: ${why}`);
const U = (n) => `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'a'.repeat(64);

/* Synthetic documents shared by several tests. */
const NOTICE = (id) => ({ revision: `fixture-${id}-1`, text: `TEST FIXTURE notice (${id}). Not real policy text.\nSecond line.` });
const POLICY = {
  entitlement: 'none_required',
  media: { enabled: true, kinds: ['audio', 'video'], audio_max_bytes: 1000, video_max_bytes: 2000, max_duration_seconds: 30 },
  retention: { completed_days: 2, withdrawn_days: 1 },
  notices: { participation: NOTICE('participation'), private_review: NOTICE('review'), publication: NOTICE('publication') }
};
const RIGHTS = { version: 'music-rights-v1', owns_master: true, controls_composition: true, samples_cleared: true, collaborators_cleared: true, parody_or_derivative: false, derivative_permissions: '' };
const PROOF = { title: 'Fixture song', lyrics: 'Verse one\nChorus\twith a tab', credits: [{ name: 'Fixture Person', role: 'writer' }], rights: RIGHTS,
  media: [{ upload_id: U(4), sha256: SHA }], review_notice_revision: 'fixture-review-1' };
const SONG = { slug: 'write-a-song', title: 'Write a song', template: 'write-a-song', proof_modes: ['audio', 'video', 'lyrics'], requirements: 'Fixture requirements\nline two' };

test('the module is dependency-free and deeply frozen', () => {
  assert.doesNotMatch(SOURCE, /^\s*import\s/m, 'no import statement');
  assert.doesNotMatch(SOURCE, /\brequire\s*\(|\bimport\s*\(/, 'no require and no dynamic import');
  const walk = (value, path) => {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value), `${path} is frozen`);
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  for (const [name, value] of Object.entries(C)) if (typeof value === 'object') walk(value, name);
  assert.throws(() => { C.ERRORS.EU011.member_status = 200; }, TypeError);
  assert.throws(() => { C.ROUTES.push({}); }, TypeError);
  assert.equal(C.PATTERNS.uuid.test(U(1)), true); assert.equal(C.PATTERNS.uuid.test('nope'), false); assert.equal(C.PATTERNS.uuid.test(U(1)), true);
  assert.deepEqual(C.RPC, { owner: 'eup_league_command', member: 'eup_league_member_command', seal: 'eup_league_media_seal' });
  assert.deepEqual(C.RPC_ARGUMENTS.owner, ['p_action', 'p_actor', 'p_id', 'p_document', 'p_revision', 'p_key']);
  assert.deepEqual(C.RPC_ARGUMENTS.member, C.RPC_ARGUMENTS.owner);
  assert.deepEqual(C.RPC_ARGUMENTS.seal, ['p_upload', 'p_actor', 'p_result']);
});

test('the source quotes no pending table or helper name, only the three RPC names', () => {
  const quoted = [...SOURCE.matchAll(/(['"`])(eup_[a-z0-9_]+)\1/g)].map((m) => m[2]);
  assert.deepEqual([...new Set(quoted)].sort(), Object.values(C.RPC).sort());
});

test('every action is complete: kind, guard class, id, document, revision, result, errors', () => {
  const ROWS = ['policy', 'campaign', 'mission', 'application', 'assignment', 'draft', 'proof'];
  const IDS = [null, 'campaign', 'mission', 'application', 'assignment', 'proof', 'upload', 'consent', 'appeal', 'grant', 'subject', 'outbox_seq'];
  /* 36 since the review of 2026-11-10 added media.purging: the purge decision, kept before anything is deleted. */
  assert.equal(Object.keys(C.OWNER_ACTIONS).length, 36);
  assert.equal(Object.keys(C.MEMBER_ACTIONS).length, 15);
  assert.deepEqual(Object.keys(C.MEDIA_SEAL), ['media.seal']);
  for (const { surface, name, spec } of allActions()) {
    const at = `${surface}:${name}`;
    assert.match(name, /^[a-z]+(\.[a-z]+){0,2}$/, at);
    assert.ok(['read', 'mutation'].includes(spec.kind), `${at} kind`);
    assert.ok(C.ENUMS.GUARD_CLASSES.includes(spec.guard), `${at} guard class`);
    assert.equal(spec.guard === 'none', spec.kind === 'read', `${at}: reads are never guarded, mutations always are`);
    assert.ok(IDS.includes(spec.id), `${at} id ${spec.id}`);
    if (spec.id_optional) assert.equal(spec.kind, 'read', `${at}: only a read filters by an optional id`);
    if (spec.document !== null) assert.ok(Object.hasOwn(C.DOCUMENTS, spec.document), `${at} document ${spec.document}`);
    if (spec.kind === 'mutation') assert.notEqual(spec.document, null, `${at}: a mutation always sends a document object`);
    assert.ok(spec.revision === null || ROWS.includes(spec.revision), `${at} revision ${spec.revision}`);
    assert.ok([0, 1].includes(spec.revision_min), `${at} revision_min`);
    if (spec.revision_min === 0) assert.notEqual(spec.revision, null, `${at}: 0 only means "no row yet" for a compare-and-swap`);
    if (spec.kind === 'read') { assert.equal(spec.revision, null, at); assert.equal(spec.outbox, false, at); assert.equal(spec.keyed, false, at); }
    assert.ok(C.shapeFields(spec.result.replace(/\[\]$/, '')), `${at} result shape ${spec.result}`);
    assert.ok(spec.errors.length >= 3, at);
    for (const code of spec.errors) assert.ok(Object.hasOwn(C.ERRORS, code), `${at} error ${code} is in ERRORS`);
    assert.deepEqual([...spec.errors].sort(), spec.errors, `${at} errors sorted`);
    for (const always of ['42501', '22023', 'PGRST202']) assert.ok(spec.errors.includes(always), `${at} can raise ${always}`);
    assert.equal(spec.errors.includes('EU003'), spec.keyed, `${at}: EU003 exactly when the action takes a key`);
    assert.equal(spec.errors.includes('40P01'), spec.kind === 'mutation', `${at}: 40P01 exactly for mutations`);
    assert.ok(!spec.errors.some((code) => code.startsWith('EUM')), `${at}: EUM codes are not listed here`);
    if (spec.reduce_when) {
      assert.equal(spec.guard, 'enabled', at);
      const field = C.DOCUMENTS[spec.document].fields[spec.reduce_when.field];
      assert.ok(field, `${at} reduce_when field exists`);
      for (const v of spec.reduce_when.values) assert.ok(field.type === 'boolean' ? typeof v === 'boolean' : field.values.includes(v), `${at} reduce_when value ${v}`);
    }
    if (surface !== 'owner') {
      assert.ok(Array.isArray(spec.gates), `${at} gates`);
      for (const gate of spec.gates) assert.ok(C.ENUMS.MEMBER_GATES.includes(gate), `${at} gate ${gate}`);
      const gated = ['audience', 'readiness', 'entitlement'].every((g) => spec.gates.includes(g));
      assert.equal(['EU010', 'EU011', 'EU012'].every((code) => spec.errors.includes(code)), gated, `${at}: the three gate codes exactly when the three gates apply`);
      if (spec.guard === 'reduce') assert.deepEqual(spec.gates, ['ownership'], `${at}: a reduce-only member action checks ownership only`);
      if (spec.kind === 'mutation' && spec.guard === 'enabled') assert.ok(gated, `${at}: every other member mutation passes all gates`);
    } else {
      assert.equal(spec.gates, undefined, at);
    }
  }
  /* A receipt is keyed by (tenant, actor, operation, key): one operation name must mean one function. */
  const mutations = allActions().filter((a) => a.spec.kind === 'mutation').map((a) => a.name);
  assert.equal(new Set(mutations).size, mutations.length, 'mutation names are unique across the three functions');
  assert.equal(C.MEDIA_SEAL['media.seal'].keyed, false);
  assert.equal(C.OWNER_ACTIONS['outbox.ack'].outbox, false);
  assert.ok(allActions().filter((a) => a.spec.kind === 'mutation' && a.name !== 'outbox.ack').every((a) => a.spec.outbox === true));
  assert.deepEqual(Object.entries(C.OWNER_ACTIONS).filter(([, a]) => a.audited).map(([n]) => n), ['applications.accommodation.get']);
});

test('the existing owner actions stay, move or are added exactly as the design map lists', () => {
  const owner = Object.keys(C.OWNER_ACTIONS);
  const stay = ['campaigns.list', 'missions.list', 'applications.list', 'assignments.list', 'proofs.list', 'consents.list', 'overview',
    'campaigns.create', 'campaigns.transition', 'missions.create', 'missions.update', 'missions.transition', 'applications.create', 'applications.decide', 'proofs.review'];
  const added = ['policy.get', 'policy.set', 'campaigns.audience.set', 'audience.grants.list', 'audience.grants.grant', 'audience.grants.revoke', 'missions.preview',
    'applications.accommodation.get', 'proofs.get', 'proofs.moderate', 'appeals.list', 'appeals.resolve', 'publications.list', 'publications.decide', 'credits.list',
    'media.due', 'media.purged', 'outbox.list', 'outbox.ack', 'receipts.get',
    'media.purging']; // review 2026-11-10: the purge decision is kept before the Worker deletes anything
  assert.deepEqual([...owner].sort(), [...stay, ...added].sort());
  for (const moved of ['assignments.accept', 'proofs.submit', 'consents.set']) assert.ok(!owner.includes(moved), `${moved} left the owner function`);
  assert.deepEqual(Object.keys(C.MEMBER_ACTIONS).sort(), ['me.get', 'applications.save', 'applications.withdraw', 'assignments.accept', 'assignments.withdraw', 'drafts.save',
    'uploads.begin', 'uploads.discard', 'uploads.get', 'proofs.submit', 'consents.grant', 'consents.revoke', 'appeals.open', 'appeals.withdraw', 'receipts.get'].sort());
});

test('the reduce-only set equals DECISIONS.md section 4', () => {
  /* member consents.revoke, applications.withdraw, assignments.withdraw, uploads.discard, appeals.withdraw;
     owner campaign/mission transitions to paused or withdrawn, publication withdrawal, proofs.moderate when it places
     a hold, media.purged, audience grant revoke. Everything else uses the normal guard. media.purging (review
     2026-11-10) is the first half of the purge, so it is reduce-only as media.purged is. */
  const expected = [
    'member:consents.revoke', 'member:applications.withdraw', 'member:assignments.withdraw', 'member:uploads.discard', 'member:appeals.withdraw',
    'owner:campaigns.transition?to=paused', 'owner:campaigns.transition?to=withdrawn', 'owner:missions.transition?to=paused', 'owner:missions.transition?to=withdrawn',
    'owner:publications.decide?decision=withdrawn', 'owner:proofs.moderate?hold=true', 'owner:media.purging', 'owner:media.purged', 'owner:audience.grants.revoke'
  ].sort();
  assert.deepEqual([...C.REDUCE_ONLY], expected);
  /* The same set, derived a second way: ask guardClass about every action and every value its conditional field can take. */
  const derived = [];
  for (const { surface, name, spec } of allActions()) {
    if (spec.kind !== 'mutation') { assert.equal(C.guardClass(surface, name, {}), 'none'); continue; }
    if (!spec.reduce_when) { if (C.guardClass(surface, name, {}) === 'reduce') derived.push(`${surface}:${name}`); continue; }
    const field = C.DOCUMENTS[spec.document].fields[spec.reduce_when.field];
    for (const value of field.type === 'boolean' ? [true, false] : field.values) {
      if (C.guardClass(surface, name, { [spec.reduce_when.field]: value }) === 'reduce') derived.push(`${surface}:${name}?${spec.reduce_when.field}=${value}`);
    }
    assert.equal(C.guardClass(surface, name, null), 'enabled', `${name} without a document takes the normal guard`);
  }
  assert.deepEqual(derived.sort(), expected);
  assert.equal(C.guardClass('owner', 'campaigns.transition', { to: 'released' }), 'enabled');
  assert.equal(C.guardClass('owner', 'proofs.moderate', { hold: false, reason: 'x' }), 'enabled');
  assert.equal(C.guardClass('owner', 'publications.decide', { decision: 'published' }), 'enabled');
  assert.equal(C.guardClass('media', 'media.seal', { outcome: 'rejected' }), 'enabled');
  assert.equal(C.guardClass('member', 'me.get'), 'none');
  assert.equal(C.guardClass('member', 'campaigns.create'), null);
  assert.equal(C.guardClass('owner', 'constructor'), null);
});

test('ERRORS is one row per SQLSTATE with both surfaces, and defines no module-policy code', () => {
  const required = ['42501', '40001', '40P01', 'P0002', '22023', '23505', 'EU001', 'EU002', 'EU003', 'EU010', 'EU011', 'EU012', 'EU013', 'EU014', 'EU015', 'EU016', 'EU017', 'PGRST202'];
  for (const code of required) assert.ok(Object.hasOwn(C.ERRORS, code), code);
  for (const [code, row] of Object.entries(C.ERRORS)) {
    assert.match(row.code, /^[a-z_]+$/, code);
    for (const status of [row.owner_status, row.member_status]) assert.ok([403, 404, 409, 422, 429, 503].includes(status), `${code} ${status}`);
    assert.equal(typeof row.member_detail, 'boolean', code);
    assert.ok(row.meaning.length > 10, code);
    assert.ok(!code.startsWith('EUM'), 'EUM codes come from MODULE_POLICY_ERRORS in ./modules.js');
  }
  const expected = { '42501': [403, 'owner_required'], '40001': [409, 'revision_conflict'], '40P01': [409, 'retry_conflict'], P0002: [404, 'not_found'], '22023': [422, 'invalid'],
    '23505': [409, 'exists'], EU001: [409, 'capacity_exhausted'], EU002: [403, 'self_review_denied'], EU003: [409, 'idempotency_conflict'], EU010: [503, 'policy_unavailable'],
    EU012: [403, 'entitlement_required'], EU013: [409, 'requirements_changed'], EU014: [409, 'media_binding'], EU015: [409, 'consent_scope'], EU016: [409, 'moderation_hold'],
    EU017: [429, 'rate_limited'], PGRST202: [503, 'schema_not_applied'] };
  for (const [code, [status, reason]] of Object.entries(expected)) assert.deepEqual(C.errorFor(code, 'owner'), { status, code: reason, detail: true }, code);
  /* Member routes: the audience answer is 404 not_available with no detail, and so is an unapplied schema. */
  assert.deepEqual(C.errorFor('EU011', 'member'), { status: 404, code: 'not_available', detail: false });
  assert.deepEqual(C.errorFor('PGRST202', 'member'), { status: 404, code: 'not_available', detail: false });
  assert.deepEqual(C.errorFor('PGRST202', 'owner'), { status: 503, code: 'schema_not_applied', detail: true });
  /* One 404 for "no such row", "not your row" and "not in the audience": a member route never confirms a foreign record. */
  assert.deepEqual(C.errorFor('P0002', 'member'), C.errorFor('EU011', 'member'));
  assert.deepEqual(C.errorFor('42501', 'member'), C.errorFor('EU011', 'member'));
  assert.deepEqual(C.errorFor('EU010', 'member'), { status: 503, code: 'policy_unavailable', detail: true });
  assert.deepEqual(C.errorFor('40P01', 'member'), { status: 409, code: 'retry_conflict', detail: true });
  for (const surface of ['owner', 'member']) assert.deepEqual(C.errorFor('XX000', surface), { status: 503, code: 'storage_unavailable', detail: false });
  assert.deepEqual(C.errorFor('toString', 'owner'), { status: 503, code: 'storage_unavailable', detail: false });
  assert.deepEqual(C.errorFor(undefined, 'member'), { status: 503, code: 'storage_unavailable', detail: false });
  for (const code of ['EUM00', 'EUM02', 'EUM03', 'EUM07', '55P03', '57014']) assert.equal(C.errorFor(code, 'owner'), null, `${code} belongs to ./modules.js`);
  assert.deepEqual({ ...C.MODULE_ERRORS, also: [...C.MODULE_ERRORS.also] }, { prefix: 'EUM', also: ['55P03', '57014'], source: './modules.js', export: 'MODULE_POLICY_ERRORS', defined_here: false });
  /* The only refinement of 22023: upload begin, so the Worker can answer 415 and 413. */
  assert.deepEqual(C.errorFor('22023', 'member', 'media_type_not_allowed'), { status: 415, code: 'media_type_not_allowed', detail: true });
  assert.deepEqual(C.errorFor('22023', 'member', 'media_too_large'), { status: 413, code: 'media_too_large', detail: true });
  assert.deepEqual(C.errorFor('22023', 'member', 'something else'), { status: 422, code: 'invalid', detail: true });
  assert.deepEqual(C.errorFor('40001', 'member', 'media_too_large'), { status: 409, code: 'revision_conflict', detail: true });
  for (const [hint, row] of Object.entries(C.REFUSAL_HINTS)) { assert.equal(row.sqlstate, '22023'); assert.equal(C.HTTP_REASONS[hint], row.status); }
  assert.equal(C.HTTP_REASONS.not_implemented, 501);
});

test('ROUTES: every route names a known action and states what is required before any RPC', () => {
  assert.equal(C.LIMITS.body_max_bytes, 65536);
  assert.deepEqual([...C.REFUSED_MEMBER_FIELDS], ['actor', 'applicant', 'participant', 'user_id', 'tenant']);
  assert.deepEqual(C.PREFIX, { owner: '/v1/eup/league', member: '/v1/eup/member/league' });
  const seen = new Set();
  const reached = new Set();
  for (const r of C.ROUTES) {
    const at = `${r.surface} ${r.method} ${r.path}`;
    assert.ok(['owner', 'member'].includes(r.surface), at);
    assert.ok(['GET', 'POST', 'PATCH'].includes(r.method), `${at}: CORS allows GET, POST, PATCH; PUT is gone`);
    assert.ok(!seen.has(at), `${at} is listed once`); seen.add(at);
    assert.match(r.response, /^[a-z_]+$/, at);
    if (r.action === null) { assert.equal(r.path, 'fixture'); assert.equal(r.rpc, null); assert.equal(r.method, 'GET'); continue; }
    assert.ok(r.rpc === r.surface || (r.rpc === 'media' && r.surface === 'member'), `${at} rpc`);
    const spec = TABLES[r.rpc][r.action];
    assert.ok(spec, `${at} names the known action ${r.rpc}:${r.action}`);
    reached.add(`${r.rpc}:${r.action}`);
    assert.equal(r.method === 'GET', spec.kind === 'read', `${at}: GET exactly for reads`);
    assert.equal(r.idempotency_key, spec.keyed, `${at}: idempotency_key exactly when the action takes a key`);
    assert.equal(r.expected_revision, spec.revision !== null, `${at}: expected_revision exactly when the action compares a revision`);
    assert.equal(r.revision_min, spec.revision_min, `${at} revision_min`);
    /* p_id */
    const pathParams = r.path.split('/').filter((s) => s.startsWith(':')).map((s) => s.slice(1));
    const queryId = Object.entries(r.query).filter(([, to]) => to === 'id').map(([q]) => q);
    if (spec.id === null) { assert.equal(r.id, null, at); assert.equal(queryId.length, 0, at); }
    else if (spec.id_optional) { assert.equal(r.id, null, at); assert.equal(queryId.length, 1, `${at}: the optional id is one query parameter`); }
    else { assert.ok(pathParams.includes(r.id), `${at}: p_id comes from the path`); assert.equal(r.id === 'seq', spec.id === 'outbox_seq', at); }
    for (const p of pathParams) assert.ok(p === r.id || Object.hasOwn(r.params, p), `${at}: path parameter ${p} is used`);
    /* p_document: every field the route can fill exists in the action document, and every required field can be filled. */
    const doc = spec.document ? C.DOCUMENTS[spec.document] : null;
    const fills = [...r.fields, ...Object.keys(r.fixed), ...Object.values(r.query).filter((to) => to !== 'id'), ...Object.values(r.params)];
    if (!doc) { assert.equal(fills.length, 0, at); assert.equal(r.wrapper, null, at); continue; }
    const body = doc.type === 'union' ? null : doc.fields;
    if (body) {
      for (const f of fills) assert.ok(Object.hasOwn(body, f), `${at}: ${f} is a field of ${spec.document}`);
      assert.equal(new Set(fills).size, fills.length, `${at}: no field is filled twice`);
      if (!r.wrapper) for (const [f, field] of Object.entries(body)) if (field.required) assert.ok(fills.includes(f), `${at}: required field ${f} can be sent`);
      for (const q of r.required_query) assert.ok(Object.hasOwn(r.query, q), at);
      for (const [f, v] of Object.entries(r.fixed)) assert.equal(C.checkDocument(body[f], v), null, `${at}: fixed ${f} is valid`);
    }
    if (r.wrapper) { assert.equal(r.fields.length, 0, `${at}: a wrapper or named fields, not both`); assert.match(r.wrapper, /^[a-z_]+$/); assert.notEqual(r.method, 'GET', at); }
    if (r.method === 'GET') assert.equal(r.fields.length, 0, `${at}: a GET has no body fields`);
    /* What a route calls first is a read, or (review 2026-11-10) the one reduce-only keyed decision the purge route
       records with the request's own key before it deletes anything. */
    for (const b of r.before) {
      assert.ok(Object.hasOwn(C[r.surface === 'owner' ? 'OWNER_ACTIONS' : 'MEMBER_ACTIONS'], b), `${at} before ${b}`);
      const first = TABLES[r.surface][b];
      assert.ok(first.kind === 'read' || (first.guard === 'reduce' && first.keyed && r.idempotency_key && b === 'media.purging'), `${at}: ${b} is a read or the purge decision`);
      reached.add(`${r.surface}:${b}`); // the purge decision is reached through the purge route only
    }
    if (r.media) assert.ok(Object.hasOwn(C.MEDIA_MODULE.functions, r.media), `${at} media function ${r.media}`);
    if (r.answer) assert.ok(C.shapeFields(r.answer), `${at} answer shape`);
  }
  /* Every action is reachable, except the one the Overview section calls. */
  const unreachable = allActions().map((a) => `${a.surface}:${a.name}`).filter((a) => !reached.has(a));
  assert.deepEqual(unreachable, ['owner:overview']);
  assert.deepEqual(Object.keys(C.MEDIA_MODULE.functions).sort(), [...new Set(C.ROUTES.map((r) => r.media).filter(Boolean))].sort(), 'every media function has a route and the reverse');
  assert.deepEqual(Object.keys(C.MEDIA_MODULE.functions).sort(), ['beginUpload', 'completeUpload', 'discardUpload', 'purgeDue', 'signOwnRead', 'signReviewRead']);
  for (const fn of Object.values(C.MEDIA_MODULE.functions)) for (const reason of fn.fails) assert.ok(Object.hasOwn(C.HTTP_REASONS, reason), reason);
  assert.equal(C.ROUTES.filter((r) => r.surface === 'member').length, 17);
  assert.equal(C.ROUTES.filter((r) => r.surface === 'owner').length, 35);
  /* The upload completion is the only keyless mutation route: the seal is idempotent by state. */
  assert.deepEqual(C.ROUTES.filter((r) => r.method !== 'GET' && !r.idempotency_key).map((r) => r.path), ['uploads/:id/complete']);
  /* A member route never answers a raw upload row (it carries the storage identity). */
  for (const r of C.ROUTES.filter((x) => x.surface === 'member' && x.action)) {
    const result = TABLES[r.rpc][r.action].result;
    if (result === 'upload') assert.ok(r.answer && !Object.hasOwn(C.shapeFields(r.answer), 'storage'), `${r.path} narrows the upload row`);
  }
});

test('matchRoute resolves every route unambiguously and refuses malformed parameters', () => {
  const sample = { id: U(7).toUpperCase(), seq: '42', operation: 'proofs.submit', key: 'fixture-key-0001' };
  const PARAM = { id: C.PATTERNS.uuid, seq: C.PATTERNS.outbox_seq, operation: C.PATTERNS.operation, key: C.PATTERNS.idempotency_key };
  for (const r of C.ROUTES) {
    const rest = r.path.split('/').map((s) => (s.startsWith(':') ? sample[s.slice(1)] : s)).join('/');
    const hit = C.matchRoute(r.surface, r.method, rest);
    assert.equal(hit?.route, r, `${r.surface} ${r.method} ${r.path}`);
    if (r.path.includes(':id')) assert.equal(hit.params.id, U(7), 'uuid parameters are lower-cased');
    /* Independent of matchRoute's first-match order: no other route's pattern accepts this path. */
    const accepts = (x) => { const want = x.path ? x.path.split('/') : []; const got = rest ? rest.split('/') : [];
      return want.length === got.length && want.every((s, i) => (s.startsWith(':') ? PARAM[s.slice(1)].test(got[i]) : s === got[i])); };
    assert.deepEqual(C.ROUTES.filter((x) => x.surface === r.surface && x.method === r.method && accepts(x)), [r], `${rest} matches one route`);
  }
  assert.equal(C.matchRoute('member', 'GET', '').route.action, 'me.get');
  assert.equal(C.matchRoute('member', 'POST', 'assignments/not-a-uuid/accept'), null);
  assert.equal(C.matchRoute('member', 'POST', `assignments/${U(1)}/accept/extra`), null);
  assert.equal(C.matchRoute('owner', 'PUT', `missions/${U(1)}`), null, 'no PUT route remains');
  assert.equal(C.matchRoute('owner', 'PATCH', `missions/${U(1)}`).route.action, 'missions.update');
  assert.equal(C.matchRoute('owner', 'POST', 'outbox/0/ack'), null);
  assert.equal(C.matchRoute('owner', 'POST', `outbox/${U(1)}/ack`), null);
  assert.equal(C.matchRoute('member', 'GET', 'receipts/proofs.submit/short'), null);
  assert.equal(C.matchRoute('member', 'GET', 'receipts/Proofs.Submit/fixture-key-0001'), null);
  /* Owner-only actions have no member route, whatever the path. */
  for (const r of C.ROUTES.filter((x) => x.surface === 'owner')) assert.equal(C.matchRoute('member', r.method, r.path)?.route.surface ?? 'member', 'member');
  for (const segment of C.NOT_IMPLEMENTED_SEGMENTS) for (const method of ['GET', 'POST', 'PATCH']) assert.equal(C.matchRoute('owner', method, segment), null);
});

test('member bodies cannot name another account', () => {
  assert.equal(C.refusedMemberField({ idempotency_key: 'fixture-key-0001', application: { submit: true } }), null);
  assert.equal(C.refusedMemberField({ actor: U(1) }), 'actor');
  assert.equal(C.refusedMemberField({ application: { applicant: U(1) } }), 'application.applicant');
  assert.equal(C.refusedMemberField({ proof: { credits: [{ name: 'x', participant: U(1) }] } }), 'proof.credits.0.participant');
  assert.equal(C.refusedMemberField({ draft: { nested: { deep: { user_id: 1 } } } }), 'draft.nested.deep.user_id');
  assert.equal(C.refusedMemberField({ tenant: null }), 'tenant');
  assert.equal(C.refusedMemberField(null), null);
  /* The SQL refuses them too: every document is closed, so the keys are unknown fields there. */
  for (const key of C.REFUSED_MEMBER_FIELDS) {
    no('application_save', { submit: false, requirements_revision: 1, [key]: U(1) }, `${key} in a member application`);
    no('proof_submit', { ...PROOF, [key]: U(1) }, `${key} in a proof`);
    no('draft_save', { [key]: U(1) }, `${key} in a draft`);
  }
});

test('state machines: states match the enums and every transition names a known action', () => {
  const need = { campaign: 'CAMPAIGN_STATES', mission: 'MISSION_STATES', application: 'APPLICATION_STATUSES', assignment: 'ASSIGNMENT_STATUSES', upload: 'UPLOAD_STATES',
    proof: 'PROOF_STATES', moderation: 'MODERATION_STATES', publication: 'PUBLICATION_STATES', consent: 'CONSENT_STATES', appeal: 'APPEAL_STATES', grant: 'GRANT_STATES' };
  assert.deepEqual(Object.keys(C.STATE_MACHINES).sort(), Object.keys(need).sort());
  const performers = new Set();
  for (const [name, machine] of Object.entries(C.STATE_MACHINES)) {
    assert.deepEqual([...machine.states], [...C.ENUMS[need[name]]], `${name} states`);
    assert.ok(machine.states.includes(machine.initial), `${name} initial`);
    for (const t of machine.terminal) assert.ok(machine.states.includes(t), `${name} terminal ${t}`);
    const pairs = new Set();
    for (const t of machine.transitions) {
      const at = `${name} ${t.from} -> ${t.to}`;
      assert.ok(t.from === null || machine.states.includes(t.from), at);
      assert.ok(machine.states.includes(t.to), at);
      assert.ok(!pairs.has(at), `${at} listed once`); pairs.add(at);
      assert.ok(t.by.length > 0, at);
      for (const by of t.by) {
        if (by === 'clock') continue;
        assert.ok(known(by), `${at} names the known action ${by}`);
        const [surface, action] = by.split(':');
        assert.equal(TABLES[surface][action].kind, 'mutation', `${at}: ${by} is a mutation`);
        performers.add(by);
      }
      if (t.from !== null) assert.ok(!machine.terminal.includes(t.from), `${at}: nothing leaves a terminal state`);
    }
    /* Every state is reachable from creation. */
    const reach = new Set(machine.transitions.filter((t) => t.from === null).map((t) => t.to));
    if (reach.size === 0) reach.add(machine.initial);
    for (let grew = true; grew;) { grew = false; for (const t of machine.transitions) if (reach.has(t.from) && !reach.has(t.to)) { reach.add(t.to); grew = true; } }
    assert.deepEqual([...reach].sort(), [...machine.states].sort(), `${name}: every state is reachable`);
  }
  /* Every mutation that is not pure configuration or bookkeeping moves at least one machine. */
  const still = allActions().filter((a) => a.spec.kind === 'mutation').map((a) => `${a.surface}:${a.name}`).filter((a) => !performers.has(a)).sort();
  /* media.purging (review 2026-11-10) records the purge decision and moves no state: media.purged does. */
  assert.deepEqual(still, ['member:drafts.save', 'owner:campaigns.audience.set', 'owner:media.purging', 'owner:outbox.ack', 'owner:policy.set']);
  /* Seats: no stored paused assignment; a withdrawal frees the seat. */
  assert.deepEqual([...C.ENUMS.SEAT_STATUSES], ['offered', 'accepted', 'completed']);
  assert.ok(!C.ENUMS.ASSIGNMENT_STATUSES.includes('paused'));
  /* A consent can be revoked from every state it can still be live or lapsed in. */
  for (const from of ['open', 'expired']) assert.ok(C.STATE_MACHINES.consent.transitions.some((t) => t.from === from && t.to === 'revoked' && t.by.includes('member:consents.revoke')));
  /* Whatever withdraws a publication without the owner's publication command is reduce-only or a cascade of one. */
  const withdraw = C.STATE_MACHINES.publication.transitions.find((t) => t.from === 'published_released_audience' && t.to === 'withdrawn');
  for (const by of withdraw.by) {
    const [surface, action] = by.split(':');
    assert.ok(TABLES[surface][action].guard === 'reduce' || TABLES[surface][action].reduce_when, `${by} can run while the module is draining or disabled`);
  }
});

test('document specs are well formed', () => {
  const TYPES = ['uuid', 'boolean', 'sha256', 'timestamp', 'integer', 'text', 'multiline', 'pattern', 'enum', 'list', 'object', 'union'];
  const walk = (spec, path) => {
    assert.ok(TYPES.includes(spec.type), `${path} type ${spec.type}`);
    assert.ok(!Object.hasOwn(spec, 'default'), `${path}: the contract ships no default value`);
    if (spec.type === 'pattern') assert.ok(C.PATTERNS[spec.pattern] instanceof RegExp, path);
    if (spec.type === 'integer' || spec.type === 'text' || spec.type === 'multiline' || spec.type === 'list') assert.ok(Number.isInteger(spec.min) && Number.isInteger(spec.max) && spec.min <= spec.max, path);
    if (spec.type === 'enum') assert.ok(spec.values.length > 0, path);
    if (spec.type === 'list') walk(spec.of, `${path}[]`);
    if (spec.type === 'union') for (const [k, v] of Object.entries(spec.variants)) walk(v, `${path}<${k}>`);
    if (spec.type === 'object') {
      for (const rule of spec.rules) assert.equal(typeof C.RULES[rule]?.check, 'function', `${path} rule ${rule}`);
      for (const [key, field] of Object.entries(spec.fields)) {
        assert.match(key, /^[a-z][a-z0-9_]*$/, `${path}.${key}`);
        assert.equal(typeof field.required, 'boolean', `${path}.${key} says required or optional`);
        walk(field, `${path}.${key}`);
      }
    }
  };
  for (const [name, spec] of Object.entries(C.DOCUMENTS)) walk(spec, name);
  const used = new Set();
  const collect = (spec) => { if (spec.type === 'object') { spec.rules.forEach((r) => used.add(r)); Object.values(spec.fields).forEach(collect); } if (spec.type === 'list') collect(spec.of); if (spec.type === 'union') Object.values(spec.variants).forEach(collect); };
  Object.values(C.DOCUMENTS).forEach(collect);
  assert.deepEqual([...used].sort(), Object.keys(C.RULES).sort(), 'every rule is used and every used rule exists');
  const referenced = new Set(allActions().map((a) => a.spec.document).filter(Boolean));
  assert.deepEqual(Object.keys(C.DOCUMENTS).filter((d) => !referenced.has(d)), ['policy'], 'every document belongs to an action (policy is the body of policy.set)');
});

test('League policy: configuration only, owner-set, fails closed when incomplete', () => {
  ok('policy', POLICY);
  ok('policy_set', { policy: POLICY, reason: 'Fixture reason' });
  no('policy_set', { policy: POLICY }, 'a reason is mandatory');
  /* No second on/off switch (module state lives in the module policy authority) and nothing about money. */
  const top = Object.keys(C.DOCUMENTS.policy.fields);
  assert.deepEqual(top, ['entitlement', 'media', 'retention', 'notices']);
  for (const key of ['state', 'enabled', 'status', 'draining', 'points', 'payment', 'payout', 'commission', 'broadcast']) no('policy', { ...POLICY, [key]: true }, `policy.${key}`);
  /* Uploads need media.enabled true AND every cap; with media off the caps may be absent. */
  ok('policy', { ...POLICY, media: { enabled: false } });
  no('policy', { ...POLICY, media: { enabled: true } }, 'enabled without caps');
  no('policy', { ...POLICY, media: { enabled: true, kinds: ['audio', 'video'], audio_max_bytes: 10, max_duration_seconds: 5 } }, 'video listed without a video cap');
  ok('policy', { ...POLICY, media: { enabled: true, kinds: ['audio'], audio_max_bytes: 10, max_duration_seconds: 5 } });
  no('policy', { ...POLICY, media: { ...POLICY.media, audio_max_bytes: C.MEDIA.hard_max_bytes + 1 } }, 'a cap above the hard ceiling');
  no('policy', { ...POLICY, media: { ...POLICY.media, kinds: ['audio', 'audio'] } }, 'duplicate kind');
  no('policy', { ...POLICY, media: { ...POLICY.media, kinds: ['image'] } }, 'unknown kind');
  for (const missing of top) { const p = { ...POLICY }; delete p[missing]; no('policy', p, `missing ${missing}`); }
  for (const n of ['participation', 'private_review', 'publication']) { const notices = { ...POLICY.notices }; delete notices[n]; no('policy', { ...POLICY, notices }, `missing notice ${n}`); }
  no('policy', { ...POLICY, notices: { ...POLICY.notices, publication: { revision: 'has space', text: 'x' } } }, 'notice revision pattern');
  no('policy', { ...POLICY, retention: { completed_days: 0, withdrawn_days: 1 } }, 'retention below one day');
  /* Entitlement must say none_required explicitly; the other valid value denies with EU012, anything else is invalid. */
  assert.deepEqual([...C.ENUMS.ENTITLEMENT_RULES], ['none_required', 'not_decided']);
  ok('policy', { ...POLICY, entitlement: 'not_decided' });
  no('policy', { ...POLICY, entitlement: 'paid' }, 'unknown entitlement');
  /* Technical limits are separate from owner values: every owner field exists in the spec, and LIMITS holds none of their values. */
  for (const field of C.OWNER_POLICY_FIELDS) {
    const node = field.split('.').reduce((spec, key) => spec?.fields?.[key], C.DOCUMENTS.policy);
    assert.ok(node, `owner policy field ${field} is in the policy document`);
  }
  for (const banned of ['audio_max_bytes', 'video_max_bytes', 'max_duration_seconds', 'completed_days', 'withdrawn_days', 'notice']) assert.ok(!JSON.stringify(C.LIMITS).includes(`"${banned}"`), `LIMITS carries no ${banned}`);
  assert.deepEqual([...C.LIMITS.policy.bytes], [1, 104857600]);
  assert.equal(C.LIMITS.document_max_bytes < C.LIMITS.body_max_bytes, true);
  assert.ok(C.LIMITS.text.lyrics * 4 + 4096 < C.LIMITS.document_max_bytes, 'the longest lyric fits the document cap in UTF-8');
  for (const [name, value] of Object.entries(C.LIMITS.rate)) assert.ok(Number.isInteger(value) && value > 0, `rate bound ${name}`);
  assert.ok(C.LIMITS.rate.uploads_staged_per_assignment <= C.LIMITS.rate.uploads_total_per_assignment);
  assert.equal(C.PATTERNS.idempotency_key.source, '^[A-Za-z0-9._:-]{8,128}$');
  assert.equal(C.LIMITS.idempotency_key, C.PATTERNS.idempotency_key.source);
});

test('campaign, mission and application documents', () => {
  ok('campaign_create', { slug: 'environmental-justice-league', title: 'Fixture campaign', purpose: 'Line one\nline two' });
  ok('campaign_create', { slug: 'x-y', title: 't', purpose: 'p', audience: 'admin_preview' });
  for (const audience of ['invited', 'members', 'public']) no('campaign_create', { slug: 'x-y', title: 't', purpose: 'p', audience }, `created ${audience}`);
  for (const key of ['points_policy', 'payment_policy', 'agency_commission_policy', 'live_broadcast_enabled']) no('campaign_create', { slug: 'x-y', title: 't', purpose: 'p', [key]: null }, key);
  ok('audience_set', { audience: 'invited' });
  for (const audience of ['public', 'members', 'everyone']) no('audience_set', { audience }, audience);
  ok('mission_create', SONG);
  ok('mission_create', { ...SONG, capacity: 3, acceptance: 'Fixture', rubric: { application: [{ id: 'fit', label: 'Fits' }], proof: [{ id: 'complete', label: 'Complete' }, { id: 'credits', label: 'Credited' }] } });
  ok('mission_create', { ...SONG, capacity: null });
  no('mission_create', { ...SONG, proof_modes: ['audio', 'video'] }, 'a song without lyrics');
  no('mission_create', { ...SONG, proof_modes: ['lyrics'] }, 'a song with neither audio nor video');
  no('mission_create', { ...SONG, proof_modes: ['audio', 'lyrics', 'link'] }, 'a mode the song template does not allow');
  no('mission_create', { ...SONG, proof_modes: ['audio', 'audio', 'lyrics'] }, 'duplicate mode');
  no('mission_create', { ...SONG, rubric: { proof: [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }] } }, 'duplicate criterion id');
  no('mission_create', { ...SONG, capacity: 0 }, 'capacity zero');
  for (const key of ['points', 'reward', 'payout']) no('mission_create', { ...SONG, [key]: 10 }, key);
  ok('mission_create', { slug: 'explain-a-source', title: 't', template: 'explain-a-source', proof_modes: ['text', 'link'], requirements: 'r' });
  assert.deepEqual([...C.ENUMS.RELEASABLE_TEMPLATES], ['write-a-song']);
  assert.deepEqual(Object.keys(C.TEMPLATE_RULES), [...C.ENUMS.RELEASABLE_TEMPLATES], 'a template is releasable exactly when it has a proof rule');
  ok('mission_update', { capacity: 5 });
  ok('mission_update', { requirements: 'changed' });
  no('mission_update', {}, 'an empty update');
  no('mission_update', { slug: 'other' }, 'slug never changes');
  no('mission_update', { template: 'explain-a-source' }, 'template never changes');
  for (const f of C.REQUIREMENTS_FIELDS) assert.ok(Object.hasOwn(C.DOCUMENTS.mission_update.fields, f), `${f} can be updated`);
  assert.ok(!C.REQUIREMENTS_FIELDS.includes('capacity'), 'capacity alone never asks for re-acceptance');
  ok('application_save', { submit: false, requirements_revision: 1 });
  ok('application_save', { submit: false, requirements_revision: 1, statement: '' });
  ok('application_save', { submit: true, requirements_revision: 1, statement: 'Why I apply\nsecond line', accommodation: { statement: 'Fixture accommodation request' } });
  ok('application_save', { submit: false, requirements_revision: 1, accommodation: null });
  no('application_save', { submit: true, requirements_revision: 1 }, 'submit without a statement');
  no('application_save', { submit: true, requirements_revision: 1, statement: '' }, 'submit with an empty statement');
  no('application_save', { submit: true, statement: 'x' }, 'no requirements revision');
  ok('application_create', { applicant: U(2), requirements_revision: 1, statement: 'Recorded by the owner' });
  no('application_create', { requirements_revision: 1, statement: 'x' }, 'owner-recorded application without an applicant');
  ok('application_decide', { decision: 'approved', rubric: [{ id: 'fit', met: true }] });
  ok('application_decide', { decision: 'changes_requested', reason: 'Please add detail' });
  no('application_decide', { decision: 'declined' }, 'decline without a reason');
  no('application_decide', { decision: 'approved', rubric: [{ id: 'fit', met: true }, { id: 'fit', met: false }] }, 'a criterion answered twice');
  ok('assignment_accept', { requirements_revision: 2, notice_revision: 'fixture-participation-1' });
  no('assignment_accept', { requirements_revision: 2 }, 'acceptance without the notice revision');
});

test('the draft catalogue the owner creates from fits the contract', () => {
  /* The fixture carries schema and null policy markers the create command does not take; the Control tab sends these keys only. */
  const { slug, title, purpose } = CAMPAIGN_FIXTURE;
  ok('campaign_create', { slug, title, purpose });
  no('campaign_create', { slug, title, purpose, points_policy: CAMPAIGN_FIXTURE.points_policy }, 'the fixture policy markers are not sent');
  assert.equal(CAMPAIGN_FIXTURE.audience, C.ENUMS.AUDIENCES[0]);
  for (const mission of CAMPAIGN_FIXTURE.missions) {
    ok('mission_create', { ...mission });
    assert.ok(C.ENUMS.TEMPLATES.includes(mission.template), mission.slug);
  }
  assert.deepEqual(CAMPAIGN_FIXTURE.missions.map((m) => m.template).sort(), [...C.ENUMS.TEMPLATES].sort());
  /* The first complete mission is the song, and it is the releasable one. */
  assert.equal(CAMPAIGN_FIXTURE.missions[0].template, C.ENUMS.RELEASABLE_TEMPLATES[0]);
});

test('proof, review, consent, publication and appeal documents', () => {
  ok('proof_submit', PROOF);
  const { media: _media, ...words } = PROOF;
  ok('proof_submit', { ...words, accommodation: { statement: 'I cannot record.\nHere are my words.' } }); // D8: equal standing
  no('proof_submit', words, 'neither media nor accommodation');
  no('proof_submit', { ...PROOF, accommodation: { statement: 'both' } }, 'both media and accommodation');
  no('proof_submit', { ...PROOF, media: [] }, 'an empty media list');
  no('proof_submit', { ...PROOF, media: [{ upload_id: U(4), sha256: SHA }, { upload_id: U(4).toUpperCase(), sha256: SHA }] }, 'one upload twice');
  no('proof_submit', { ...PROOF, media: [1, 2, 3, 4].map((n) => ({ upload_id: U(n), sha256: SHA })) }, 'more than three uploads');
  no('proof_submit', { ...PROOF, media: [{ upload_id: U(4), sha256: SHA.toUpperCase() }] }, 'upper-case digest');
  no('proof_submit', { ...PROOF, media: [{ upload_id: U(4), sha256: SHA, object_ref: 'anything/at/all.mp3' }] }, 'a caller-supplied object reference');
  no('proof_submit', { ...PROOF, credits: [] }, 'no credits');
  no('proof_submit', { ...words, accommodation: { statement: 'x' }, rights: undefined }, 'no rights attestation');
  for (const key of ['location', 'gps', 'latitude', 'mode', 'url', 'object_ref', 'path']) no('proof_submit', { ...PROOF, [key]: 'x' }, `${key} in a proof`);
  /* Text rules: multi-line lyrics with LF and TAB; carriage return and every other control character refused. */
  ok('proof_submit', { ...PROOF, lyrics: 'a\nb\n\n\tc' });
  for (const bad of ['a\r\nb', 'a\u0000b', 'a\u0007b', 'a\u001bb', 'a\u007fb', 'a\ud800b']) no('proof_submit', { ...PROOF, lyrics: bad }, `lyrics with ${JSON.stringify(bad)}`);
  no('proof_submit', { ...PROOF, title: 'two\nlines' }, 'a title is one line');
  no('proof_submit', { ...PROOF, lyrics: '' }, 'empty lyrics');
  ok('proof_submit', { ...PROOF, lyrics: '\u{1F30D}'.repeat(C.LIMITS.text.lyrics) }); // length counts code points, as SQL length() does
  no('proof_submit', { ...PROOF, lyrics: 'x'.repeat(C.LIMITS.text.lyrics + 1) }, 'lyrics over the bound');
  /* D7: the music-rights-v1 fields, all of them. */
  assert.deepEqual(Object.keys(C.DOCUMENTS.proof_submit.fields.rights.fields), ['version', 'owns_master', 'controls_composition', 'samples_cleared', 'collaborators_cleared', 'parody_or_derivative', 'derivative_permissions']);
  for (const key of Object.keys(RIGHTS)) { const r = { ...RIGHTS }; delete r[key]; no('proof_submit', { ...PROOF, rights: r }, `rights without ${key}`); }
  no('proof_submit', { ...PROOF, rights: { ...RIGHTS, parody_or_derivative: true } }, 'derivative without permissions');
  ok('proof_submit', { ...PROOF, rights: { ...RIGHTS, parody_or_derivative: true, derivative_permissions: 'Fixture permission note' } });
  no('proof_submit', { ...PROOF, rights: { ...RIGHTS, version: 'music-rights-v2' } }, 'unknown attestation version');
  /* The draft is lenient where the proof is strict. */
  ok('draft_save', {});
  ok('draft_save', { title: '', lyrics: 'half a line', credits: [{ name: '', role: '' }], rights: { owns_master: true }, media: [U(4)], accommodation: null });
  no('draft_save', { lyrics: 'a\rb' }, 'carriage return in a draft');
  /* Review: three decisions, one derived outcome, bound to the digest. */
  ok('proof_review', { asset_revision: SHA, mission_decision: 'pass', rights_decision: 'pass', safety_decision: 'pass' });
  ok('proof_review', { asset_revision: SHA, mission_decision: 'changes', rights_decision: 'pass', safety_decision: 'pass', reason: 'Add the missing credit', rubric: [{ id: 'credits', met: false, note: 'missing' }] });
  no('proof_review', { asset_revision: SHA, mission_decision: 'changes', rights_decision: 'pass', safety_decision: 'pass' }, 'no reason');
  no('proof_review', { mission_decision: 'pass', rights_decision: 'pass', safety_decision: 'pass' }, 'no asset revision');
  no('proof_review', { asset_revision: SHA, mission_decision: 'pass', rights_decision: 'pass' }, 'only two decisions');
  no('proof_review', { asset_revision: SHA, mission_decision: 'pass', rights_decision: 'pass', safety_decision: 'pass', decision: 'accepted' }, 'a separate overall decision');
  for (const m of C.ENUMS.DIMENSION_DECISIONS) for (const r of C.ENUMS.DIMENSION_DECISIONS) for (const s of C.ENUMS.DIMENSION_DECISIONS) {
    const all = [m, r, s];
    const expected = all.includes('fail') ? 'rejected' : all.every((d) => d === 'pass') ? 'accepted' : 'needs_changes';
    assert.equal(C.reviewOutcome({ mission_decision: m, rights_decision: r, safety_decision: s }), expected);
    assert.ok(C.ENUMS.PROOF_STATES.includes(expected));
  }
  assert.throws(() => C.reviewOutcome({ mission_decision: 'pass', rights_decision: 'pass' }), TypeError);
  ok('proof_moderate', { hold: true, reason: 'Fixture hold' });
  no('proof_moderate', { hold: true }, 'a hold without a reason');
  /* Consent: exact scope, finite expiry, released audience only. */
  const consent = { purpose: 'publish_proof', audience: 'released_audience', asset_revision: SHA, notice_revision: 'fixture-publication-1', expires_at: '2027-01-01T00:00:00Z' };
  ok('consent_grant', consent);
  for (const audience of ['public', 'members', 'reviewers']) no('consent_grant', { ...consent, audience }, `publish consent for ${audience}`);
  no('consent_grant', { ...consent, purpose: 'private_review' }, 'private review is granted by proof submission, not by command');
  for (const key of Object.keys(consent)) { const c = { ...consent }; delete c[key]; no('consent_grant', c, `consent without ${key}`); }
  for (const bad of ['2027-01-01', '2027-01-01T00:00:00+02:00', '2027-13-01T00:00:00Z', 'never']) no('consent_grant', { ...consent, expires_at: bad }, `expiry ${bad}`);
  assert.deepEqual(C.CONSENT_SCOPES, { private_review: 'reviewers', publish_proof: 'released_audience' });
  ok('publication_decide', { decision: 'published', consent_id: U(5) });
  ok('publication_decide', { decision: 'withdrawn', reason: 'Fixture withdrawal' });
  no('publication_decide', { decision: 'published' }, 'publishing without naming the consent');
  no('publication_decide', { decision: 'withdrawn' }, 'withdrawing without a reason');
  no('publication_decide', { decision: 'published', consent_id: U(5), audience: 'public' }, 'an audience on the command');
  ok('appeal_open', { subject: 'proof', statement: 'Fixture appeal' });
  no('appeal_open', { subject: 'credit', statement: 'x' }, 'unknown subject');
  ok('appeal_resolve', { outcome: 'overturned', reason: 'Fixture reason' });
  no('appeal_resolve', { outcome: 'overturned' }, 'resolution without a reason');
  ok('empty', {});
  no('empty', { anything: 1 }, 'a key in an empty document');
  ok('receipt_get', { operation: 'proofs.submit', key: 'fixture-key-0001' });
  no('receipt_get', { operation: 'proofs.submit', key: 'short' }, 'bad key');
});

test('result shapes resolve, mutation results are lean and member answers carry no other account', () => {
  const BASE = ['uuid', 'int', 'text', 'bool', 'timestamp', 'sha256', 'seq', 'json'];
  const refs = (name) => Object.values(C.shapeFields(name)).filter((t) => t.startsWith('shape:')).map((t) => t.slice(6).replace(/(\[\])?(\|null)?$/, ''));
  for (const [name, shape] of Object.entries(C.SHAPES)) {
    if (shape.extends) assert.ok(Object.hasOwn(C.SHAPES, shape.extends), `${name} extends ${shape.extends}`);
    for (const [field, type] of Object.entries(C.shapeFields(name))) {
      const at = `${name}.${field}: ${type}`;
      const m = /^(?:(enum|shape|document):)?([A-Za-z_0-9]+)(\[\])?(\|null)?$/.exec(type);
      assert.ok(m, at);
      if (m[1] === 'enum') assert.ok(Array.isArray(C.ENUMS[m[2]]), at);
      else if (m[1] === 'shape') assert.ok(Object.hasOwn(C.SHAPES, m[2]), at);
      else if (m[1] === 'document') assert.ok(Object.hasOwn(C.DOCUMENTS, m[2]), at);
      else assert.ok(BASE.includes(m[2]), at);
      assert.doesNotMatch(field, /point|payout|payment|commission|broadcast|reward|price|path|url|token/, at);
    }
  }
  const closure = (roots) => { const seen = new Set(); const todo = [...roots]; while (todo.length) { const n = todo.pop(); if (seen.has(n)) continue; seen.add(n); todo.push(...refs(n)); } return seen; };
  /* Member-safe: everything a member route can answer. */
  const memberRoots = C.ROUTES.filter((r) => r.surface === 'member' && r.action).map((r) => r.answer || TABLES[r.rpc][r.action].result.replace(/\[\]$/, ''));
  for (const name of closure(memberRoots)) {
    const fields = Object.keys(C.shapeFields(name));
    if (name === 'receipt') continue; // a receipt wraps the actor's own stored result
    for (const foreign of C.FOREIGN_ID_FIELDS) assert.ok(!fields.includes(foreign), `member-visible shape ${name} has no ${foreign}`);
    assert.ok(!fields.includes('storage'), `member-visible shape ${name} has no storage identity`);
  }
  /* Lean: no mutation result (so no stored receipt) carries member-written text. */
  for (const { surface, name, spec } of allActions().filter((a) => a.spec.kind === 'mutation')) {
    if (['policy.set', 'campaigns.create', 'campaigns.transition', 'campaigns.audience.set', 'missions.create', 'missions.update', 'missions.transition'].includes(name)) continue; // owner-written configuration
    for (const shape of closure([spec.result.replace(/\[\]$/, '')])) {
      for (const [field, type] of Object.entries(C.shapeFields(shape))) {
        assert.ok(!type.startsWith('document:'), `${surface}:${name} result ${shape}.${field} carries no document`);
        assert.ok(!['statement', 'lyrics', 'accommodation', 'document', 'title', 'credits'].includes(field), `${surface}:${name} result ${shape}.${field}`);
      }
    }
  }
  /* The credit never depends on, or reveals, publication, consent, media or the accommodation path. */
  assert.deepEqual(Object.keys(C.SHAPES.credit), ['id', 'tenant', 'campaign_id', 'mission_id', 'assignment_id', 'participant', 'proof_id', 'proof_revision', 'asset_revision', 'review_id', 'kind', 'created_at']);
  /* The owner preview is the member projection. */
  assert.equal(C.OWNER_ACTIONS['missions.preview'].result, 'mission_card');
  assert.ok(Object.values(C.SHAPES.member_campaign).includes('shape:mission_card[]'));
  assert.deepEqual(C.projectShape('proof_media', { upload_id: U(4), kind: 'audio', mime: 'audio/webm', bytes: 4, sha256: SHA, participant: U(9), storage: { etag: 'x' } }), { upload_id: U(4), kind: 'audio', mime: 'audio/webm', bytes: 4, sha256: SHA });
  assert.equal(C.projectShape('member_upload', { id: U(4), storage: { etag: 'x' }, tenant: U(1) }).storage, undefined);
  assert.equal(C.projectShape('nope', {}), null);
  /* Outbox payloads: ids and revisions only. */
  for (const key of C.OUTBOX.payload_keys) assert.match(key, /(_id|_ids|revision)$/, key);
});

test('MEDIA: kinds, MIME types, extensions, bucket, path, lifetimes and upload states', () => {
  assert.deepEqual(Object.keys(C.MEDIA.types).sort(), ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/webm', 'audio/ogg', 'video/mp4', 'video/webm', 'video/quicktime'].sort());
  assert.deepEqual(Object.entries(C.MEDIA.types).filter(([, t]) => t.kind === 'audio').map(([m]) => m.split('/')[1]), ['mpeg', 'mp4', 'x-m4a', 'wav', 'webm', 'ogg']);
  assert.deepEqual(Object.entries(C.MEDIA.types).filter(([, t]) => t.kind === 'video').map(([m]) => m.split('/')[1]), ['mp4', 'webm', 'quicktime']);
  assert.deepEqual(Object.fromEntries(Object.entries(C.MEDIA.types).map(([m, t]) => [m, t.ext])), { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav',
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' });
  assert.deepEqual([...C.MEDIA.extensions].sort(), ['m4a', 'mov', 'mp3', 'mp4', 'ogg', 'wav', 'webm']);
  assert.deepEqual(Object.keys(C.MEDIA.families).sort(), [...C.ENUMS.MEDIA_FAMILIES].sort());
  for (const [mime, t] of Object.entries(C.MEDIA.types)) {
    assert.ok(mime.startsWith(`${t.kind}/`), mime);
    for (const family of t.families) assert.ok(C.ENUMS.MEDIA_FAMILIES.includes(family), `${mime} ${family}`);
    assert.equal(C.mediaType(mime), t);
  }
  for (const family of C.ENUMS.MEDIA_FAMILIES) assert.ok(Object.values(C.MEDIA.types).some((t) => t.families.includes(family)), `${family} is used`);
  assert.deepEqual([...C.DOCUMENTS.upload_begin.fields.mime.values], Object.keys(C.MEDIA.types));
  assert.equal(C.mediaType('audio/webm;codecs=opus'), null, 'parameters are not accepted on the wire');
  assert.equal(C.mediaType('constructor'), null);
  assert.equal(C.bareMime(' Audio/WebM; codecs=opus '), 'audio/webm');
  assert.equal(C.bareMime(undefined), '');
  assert.equal(C.MEDIA.bucket, 'equity-uprise-private');
  assert.equal(C.MEDIA.path_template, 'league/v1/t/<tenant>/a/<assignment>/u/<upload>.<ext>');
  assert.equal(C.MEDIA.signed_read_seconds, 300);
  assert.equal(C.MEDIA.hard_max_bytes, 104857600);
  assert.ok(C.MEDIA.upload_grant_seconds < C.MEDIA.staged_ttl_seconds);
  assert.deepEqual([...C.MEDIA.states], ['staged', 'sealed', 'rejected', 'discarded', 'expired', 'purged']);
  assert.equal(C.MEDIA.scan_state, 'not_scanned');
  assert.deepEqual(Object.keys(C.MEDIA.reject_reasons).sort(), [...C.ENUMS.REJECT_REASONS].sort());
  /* Every "surface:action" named in the order of effects exists. */
  for (const [flow, steps] of Object.entries(C.MEDIA.order)) for (const step of steps) { const m = /^(owner|member|media):([a-z.]+)/.exec(step); if (m) assert.ok(known(`${m[1]}:${m[2]}`), `${flow}: ${step}`); }
  assert.ok(C.MEDIA.order.purge.indexOf('delete the due objects') < C.MEDIA.order.purge.findIndex((s) => s.includes('owner:media.purged')), 'purged is recorded only after storage deleted');
  /* Upload documents. */
  ok('upload_begin', { kind: 'audio', mime: 'audio/webm', bytes: 1234 });
  ok('upload_begin', { kind: 'video', mime: 'video/quicktime', bytes: C.MEDIA.hard_max_bytes, duration_seconds: 30 });
  no('upload_begin', { kind: 'audio', mime: 'video/mp4', bytes: 10 }, 'MIME of another kind');
  no('upload_begin', { kind: 'audio', mime: 'audio/flac', bytes: 10 }, 'unsupported MIME');
  no('upload_begin', { kind: 'audio', mime: 'audio/webm', bytes: C.MEDIA.hard_max_bytes + 1 }, 'above the hard ceiling');
  no('upload_begin', { kind: 'audio', mime: 'audio/webm', bytes: 0 }, 'zero bytes');
  for (const key of ['path', 'object_path', 'bucket', 'url', 'name', 'sha256']) no('upload_begin', { kind: 'audio', mime: 'audio/webm', bytes: 10, [key]: 'x' }, `client ${key}`);
  const sealed = { outcome: 'sealed', bytes: 4, sha256: SHA, family: 'ebml', storage: { object_id: U(8), etag: '"fixture-etag"', size: 4 } };
  ok('seal_result', sealed);
  ok('seal_result', { outcome: 'rejected', reason: 'family_mismatch' });
  no('seal_result', { ...sealed, storage: { ...sealed.storage, size: 5 } }, 'bytes differ from the listed size');
  no('seal_result', { ...sealed, url: 'https://fixture.invalid/x' }, 'a URL in a seal');
  no('seal_result', { outcome: 'rejected' }, 'rejection without a reason');
  no('seal_result', { outcome: 'sealed', reason: 'empty' }, 'mixed outcome');
  no('seal_result', { outcome: 'missing' }, 'unknown outcome');
  no('seal_result', null, 'null');
});

test('magic-byte matcher: the frozen vectors', () => {
  const families = new Set();
  for (const v of C.MAGIC_VECTORS) {
    const bytes = C.bytesFromHex(v.hex);
    assert.equal(bytes.length, v.hex.length / 2, v.name);
    assert.ok(bytes.length <= 20, `${v.name} is a header, not a file`);
    assert.equal(C.sniffMediaFamily(bytes), v.family, v.name);
    assert.equal(C.sniffMediaFamily(bytes.subarray(0, C.MEDIA.sniff_bytes)), v.family, `${v.name}: the first ${C.MEDIA.sniff_bytes} bytes decide`);
    for (const mime of Object.keys(C.MEDIA.types)) assert.equal(C.mediaAccepts(mime, bytes), v.accepts.includes(mime), `${v.name} as ${mime}`);
    if (v.family) families.add(v.family);
  }
  assert.deepEqual([...families].sort(), [...C.ENUMS.MEDIA_FAMILIES].sort(), 'every family has an accepting vector');
  for (const name of ['html', 'MZ executable', 'empty']) assert.equal(C.MAGIC_VECTORS.find((v) => v.name === name).family, null);
  /* Family mismatch: real media declared as the wrong type is refused. */
  const wav = C.bytesFromHex(C.MAGIC_VECTORS.find((v) => v.name === 'wav').hex);
  assert.equal(C.mediaAccepts('audio/mpeg', wav), false);
  assert.equal(C.mediaAccepts('audio/wav', wav), true);
  assert.equal(C.mediaAccepts('text/html', wav), false);
  /* Not bytes: no family. */
  for (const bad of [null, undefined, 'RIFF....WAVE', [0x4f, 0x67, 0x67, 0x53], new Uint8Array(3)]) assert.equal(C.sniffMediaFamily(bad), null);
  /* Other MPEG frame headers that are real, and near misses that are not. */
  for (const hex of ['fff3a064', 'ffe3a064', 'fffa9064']) assert.equal(C.sniffMediaFamily(C.bytesFromHex(hex)), 'mpeg', hex);
  for (const hex of ['ffffffff', 'ffeb9064', 'fffbf064', 'fffb9c64', 'fefb9064']) assert.equal(C.sniffMediaFamily(C.bytesFromHex(hex)), null, hex);
});

test('mediaObjectPath takes ids only and refuses anything that is not a uuid', () => {
  const ids = { tenant: U(1), assignment: U(2), upload: U(3) };
  assert.equal(C.mediaObjectPath({ ...ids, ext: 'webm' }), `league/v1/t/${U(1)}/a/${U(2)}/u/${U(3)}.webm`);
  assert.equal(C.mediaObjectPath({ tenant: U(1).toUpperCase(), assignment: U(2).toUpperCase(), upload: U(3).toUpperCase(), ext: 'mp3' }), `league/v1/t/${U(1)}/a/${U(2)}/u/${U(3)}.mp3`);
  for (const ext of C.MEDIA.extensions) assert.match(C.mediaObjectPath({ ...ids, ext }), /^league\/v1\/t\/[0-9a-f-]{36}\/a\/[0-9a-f-]{36}\/u\/[0-9a-f-]{36}\.[a-z0-9]{3,4}$/);
  const bad = ['', '..', '../../other', `${U(1)}/../x`, `${U(1)} `, ` ${U(1)}`, `${U(1)}\n`, U(1).slice(1), `${U(1)}0`, 'league', '%2e%2e', U(1).replace(/-/g, ''), null, undefined, 7, {}, [U(1)], true];
  for (const key of ['tenant', 'assignment', 'upload']) for (const value of bad) {
    assert.throws(() => C.mediaObjectPath({ ...ids, ext: 'webm', [key]: value }), TypeError, `${key} = ${JSON.stringify(value)}`);
  }
  for (const ext of ['', 'exe', 'html', 'webm/..', '.webm', 'WEBM', 'mp3 ', null, undefined, 3]) assert.throws(() => C.mediaObjectPath({ ...ids, ext }), TypeError, `ext ${ext}`);
  assert.throws(() => C.mediaObjectPath(), TypeError);
  /* A client path, name or bucket has no way in: the builder reads four keys and nothing else. */
  assert.equal(C.mediaObjectPath({ ...ids, ext: 'webm', path: 'mine/file.webm', name: 'x', bucket: 'other', object_path: '../x' }), `league/v1/t/${U(1)}/a/${U(2)}/u/${U(3)}.webm`);
  assert.equal(C.mediaObjectPath.length, 0, 'one destructured argument');
});

test('asset_revision: the canonical manifest vectors', async () => {
  assert.equal(C.MANIFEST_VECTORS.length, 2);
  for (const v of C.MANIFEST_VECTORS) {
    const manifest = C.proofManifest(v.input);
    const canonical = C.canonicalJson(manifest);
    assert.equal(canonical, v.canonical, v.name);
    assert.equal(createHash('sha256').update(canonical, 'utf8').digest('hex'), v.asset_revision, `${v.name}: SHA-256 of the UTF-8 bytes`);
    assert.equal(await C.assetRevision(manifest), v.asset_revision, `${v.name}: Web Crypto agrees`);
    assert.match(v.asset_revision, C.PATTERNS.sha256);
    assert.deepEqual(JSON.parse(canonical), manifest, 'the canonical text is JSON for the same value');
    assert.doesNotMatch(canonical.replace(/"(?:[^"\\]|\\.)*"/g, '""'), /\s/, 'no whitespace outside strings');
    assert.equal(C.checkDocument(C.DOCUMENTS.proof_submit, v.input.proof), null, `${v.name}: the vector proof is a valid proof document`);
    assert.equal(manifest.schema, C.MANIFEST_SCHEMA);
    assert.deepEqual(Object.keys(manifest).sort(), ['accommodation', 'assignment_id', 'credits', 'lyrics', 'media', 'mission_id', 'requirements_revision', 'rights', 'schema', 'tenant', 'title']);
  }
  const [withMedia, accommodation] = C.MANIFEST_VECTORS;
  assert.notEqual(withMedia.asset_revision, accommodation.asset_revision);
  assert.equal(withMedia.canonical.startsWith('{"accommodation":null,"assignment_id":"0a000000-'), true);
  assert.ok(withMedia.canonical.includes('"lyrics":"Line one of a test fixture\\nLine \\"two\\"\\twith a tab, a \\\\ backslash, a / slash\\nL\u00ednea tres \u{1F30D}"'), 'LF, TAB, quote and backslash escaped; slash and non-ASCII as themselves');
  assert.ok(accommodation.canonical.includes('"media":[]'));
  /* Identity is case-insensitive for uuids and independent of key order; every content change is a new revision. */
  const base = C.proofManifest(withMedia.input);
  const digest = (m) => createHash('sha256').update(C.canonicalJson(m), 'utf8').digest('hex');
  assert.equal(digest(C.proofManifest({ ...withMedia.input, tenant: withMedia.input.tenant.toLowerCase(), assignment_id: withMedia.input.assignment_id.toUpperCase() })), withMedia.asset_revision);
  assert.equal(digest(Object.fromEntries(Object.entries(base).reverse())), withMedia.asset_revision);
  const change = (edit) => { const input = structuredClone(withMedia.input); edit(input); return digest(C.proofManifest(input)); };
  const edits = [
    (i) => { i.proof.lyrics += ' '; }, (i) => { i.proof.title = 'Other'; }, (i) => { i.proof.credits.reverse(); }, (i) => { i.proof.credits[0].role = 'music'; },
    (i) => { i.proof.rights.samples_cleared = false; }, (i) => { i.proof.rights.derivative_permissions = 'x'; }, (i) => { i.media[0].sha256 = SHA; }, (i) => { i.media[0].bytes = 5; },
    (i) => { i.media[0].mime = 'audio/ogg'; }, (i) => { i.media[0].id = U(9); }, (i) => { i.requirements_revision = 3; }, (i) => { i.assignment_id = U(9); },
    (i) => { i.mission_id = U(9); }, (i) => { i.tenant = U(9); }
  ];
  const digests = new Set(edits.map(change));
  assert.equal(digests.size, edits.length, 'every edit gives a distinct revision');
  assert.ok(!digests.has(withMedia.asset_revision));
  /* The manifest never contains what is not content: the notice revision, the participant, a path, a time. */
  assert.equal(change((i) => { i.proof.review_notice_revision = 'other-notice'; }), withMedia.asset_revision);
  assert.doesNotMatch(withMedia.canonical, /participant|notice|path|created_at|storage|etag/);
  /* Media comes from the SEALED rows, not from what the caller listed. */
  assert.equal(change((i) => { i.proof.media[0].sha256 = SHA; }), withMedia.asset_revision);
});

test('canonicalJson is strict', () => {
  assert.equal(C.canonicalJson({ b: [1, 'x', null, true, false], a: { d: 0, c: '' } }), '{"a":{"c":"","d":0},"b":[1,"x",null,true,false]}');
  assert.equal(C.canonicalJson({ a_10: 1, a_2: 2, a: 3, a0: 4 }), '{"a":3,"a0":4,"a_10":1,"a_2":2}', 'byte order of keys');
  assert.equal(C.canonicalJson('\u0001\u001f\b\f\n\r\t"\\/\u007f\u2028'), '"\\u0001\\u001f\\b\\f\\n\\r\\t\\"\\\\/\u007f\u2028"');
  assert.equal(C.canonicalJson(-0), '0');
  assert.equal(C.canonicalJson([]), '[]');
  assert.equal(C.canonicalJson({}), '{}');
  const bad = [1.5, NaN, Infinity, 2 ** 53, undefined, () => 1, Symbol('x'), 10n, '\ud800', { A: 1 }, { 'a-b': 1 }, { a: undefined }, [undefined], { '': 1 }];
  bad.forEach((value, index) => assert.throws(() => C.canonicalJson(value), TypeError, `refused value #${index}`));
  assert.throws(() => C.proofManifest({ ...C.MANIFEST_VECTORS[0].input, tenant: 'not-a-uuid' }), TypeError);
});

test('nothing for points, payouts, commission, broadcast, or publication beyond the released audience', () => {
  const FORBIDDEN = /point|payout|payment|commission|broadcast|reward|price|livestream/i;
  for (const { surface, name } of allActions()) assert.doesNotMatch(name, FORBIDDEN, `${surface}:${name}`);
  for (const r of C.ROUTES) { assert.doesNotMatch(r.path, FORBIDDEN, r.path); assert.doesNotMatch(r.response, FORBIDDEN, r.path); assert.ok(!C.NOT_IMPLEMENTED_SEGMENTS.includes(r.path.split('/')[0]), `${r.path} is not a 501 segment`); }
  assert.deepEqual([...C.NOT_IMPLEMENTED_SEGMENTS], ['publish', 'broadcast', 'points', 'payouts']);
  /* Audience words: public and members exist only in the list of impossible values. */
  assert.deepEqual([...C.ENUMS.AUDIENCES], ['admin_preview', 'invited']);
  assert.deepEqual([...C.ENUMS.IMPOSSIBLE_AUDIENCES], ['public', 'members']);
  assert.deepEqual([...C.ENUMS.CONSENT_AUDIENCES], ['reviewers', 'released_audience']);
  assert.deepEqual([...C.ENUMS.PUBLICATION_STATES], ['private', 'published_released_audience', 'withdrawn']);
  for (const [name, values] of Object.entries(C.ENUMS)) {
    if (name === 'IMPOSSIBLE_AUDIENCES') continue;
    for (const value of values) { assert.ok(!['public', 'members'].includes(value), `${name} has no ${value}`); assert.doesNotMatch(String(value), FORBIDDEN, `${name}.${value}`); }
  }
  const enumValues = [];
  const fieldNames = [];
  const walk = (spec) => {
    if (spec.type === 'enum') enumValues.push(...spec.values);
    if (spec.type === 'list') walk(spec.of);
    if (spec.type === 'union') Object.values(spec.variants).forEach(walk);
    if (spec.type === 'object') for (const [key, field] of Object.entries(spec.fields)) { fieldNames.push(key); walk(field); }
  };
  Object.values(C.DOCUMENTS).forEach(walk);
  for (const value of enumValues) assert.ok(!['public', 'members'].includes(value), `no document accepts ${value}`);
  for (const key of fieldNames) assert.doesNotMatch(key, FORBIDDEN, `document field ${key}`);
  for (const machine of Object.values(C.STATE_MACHINES)) for (const state of machine.states) assert.ok(!['public', 'members', 'published', 'published_public', 'published_members'].includes(state) || machine.field !== 'publication_state');
  /* The only published state is the released audience; the only way in is the owner command with an exact consent. */
  const into = C.STATE_MACHINES.publication.transitions.filter((t) => t.to === 'published_released_audience');
  assert.ok(into.length > 0 && into.every((t) => t.by.length === 1 && t.by[0] === 'owner:publications.decide'));
  assert.ok(C.DOCUMENTS.publication_decide.fields.consent_id);
  assert.ok(!Object.hasOwn(C.DOCUMENTS.publication_decide.fields, 'audience'));
});

/* ------------------------------------------------------------------ review of 2026-11-10 */

test('a timestamp the contract accepts is a real calendar instant, as the SQL checks it (no Date.parse roll-over)', () => {
  const at = (expires_at) => C.checkDocument(C.DOCUMENTS.consent_grant, { purpose: 'publish_proof', audience: 'released_audience', asset_revision: SHA, notice_revision: 'fixture-1', expires_at });
  for (const impossible of ['2027-02-30T00:00:00Z', '2027-02-29T00:00:00Z', '2100-02-29T00:00:00Z', '2027-04-31T23:59:59Z', '2027-01-01T24:00:00Z', '2027-01-01T24:00:00.000000Z', '0000-01-01T00:00:00Z', '2027-01-01T23:59:60Z']) {
    assert.equal(at(impossible), '$.expires_at: UTC timestamp expected', impossible);
  }
  for (const real of ['2028-02-29T00:00:00Z', '2000-02-29T12:00:00Z', '0001-01-01T00:00:00Z', '2027-12-31T23:59:59.999999Z', '9999-12-31T23:59:59Z']) assert.equal(at(real), null, real);
});

test('answers print timestamps in the result form; inputs stay Z only', () => {
  for (const printed of ['2026-11-10T05:14:00.123+00:00', '2026-11-10T05:14:00.12+00:00', '2026-11-10T05:14:00+00:00', '2026-11-10T05:14:00.123456+00:00', '2026-11-10T05:14:00.123Z']) assert.match(printed, C.RESULT_TIMESTAMP, printed);
  for (const other of ['2026-11-10T00:14:00.123-05:00', '2026-11-10T05:14:00', '2026-11-10 05:14:00+00', '2026-11-10T05:14:00.1234567+00:00']) assert.doesNotMatch(other, C.RESULT_TIMESTAMP, other);
  assert.doesNotMatch('2026-11-10T05:14:00.123+00:00', C.PATTERNS.timestamp, 'an answered timestamp is not an input: a client parses it and never echoes it');
});

test('the publish-consent rules say what the SQL enforces: one unrevoked consent (open or expired), and a bound per proof', () => {
  const grant = C.MEMBER_ACTIONS['consents.grant'];
  assert.match(grant.effects.find((e) => e.includes('23505')), /open or expired.*revoke it, even after it expired/);
  assert.match(C.ERRORS['23505'].meaning, /unrevoked publish consent \(open or expired\)/);
  assert.ok(grant.errors.includes('EU017') && Number.isSafeInteger(C.LIMITS.rate.publish_consents_per_proof));
  assert.ok(C.LIMITS.rate.publish_consents_per_proof + C.LIMITS.rate.proof_revisions_per_assignment <= C.LIMITS.list.rows, 'one proof never has more consent rows than an owner list returns');
});

test('the review read rests on the private_review consent (EU015); the purge decision is kept before anything is deleted', () => {
  assert.ok(C.OWNER_ACTIONS['proofs.get'].errors.includes('EU015'));
  const purging = C.OWNER_ACTIONS['media.purging'];
  assert.deepEqual([purging.kind, purging.guard, purging.keyed, purging.document, purging.result], ['mutation', 'reduce', true, 'media_purged', 'due_list']);
  const route = C.ROUTES.find((r) => r.surface === 'owner' && r.path === 'media/purge');
  assert.deepEqual([route.before, route.action], [['media.purging'], 'media.purged']);
  const order = C.MEDIA.order.purge;
  assert.ok(order.findIndex((s) => s.startsWith('owner:media.purging')) < order.indexOf('delete the due objects'), 'decided before anything is deleted');
});

test('authorization_unavailable is a reason the contract lists (the Worker\'s session or owner check could not answer)', () => {
  assert.equal(C.HTTP_REASONS.authorization_unavailable, 503);
});

test('a member body nested to the body limit is walked without overflowing the stack, in the same order as before', () => {
  let deep = {}; let at = deep;
  for (let i = 0; i < 40000; i += 1) { at.a = [{}]; at = at.a[0]; }
  at.actor = U(1);
  assert.equal(C.refusedMemberField(deep).split('.').length, 80001, 'the account-naming key is found at depth 40000');
  let arrays = [];
  for (let i = 0; i < 40000; i += 1) arrays = [arrays];
  assert.equal(C.refusedMemberField({ a: arrays }), null);
  assert.equal(C.refusedMemberField({ a: { actor: 1 }, actor: 2 }), 'a.actor', 'depth first: a key inside an earlier value wins over a later key');
  assert.equal(C.refusedMemberField([{ x: 1 }, { tenant: 1 }]), '1.tenant', 'array indexes are path segments, never refused keys');
});
