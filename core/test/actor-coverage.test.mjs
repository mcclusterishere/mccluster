import test from 'node:test';
import assert from 'node:assert/strict';
import { planActorCoverage, coverageJobId, coverageStatus, DEFAULT_COVERAGE_POLICY } from '../src/actors/coverage.mjs';
import { validatePersonaConfig, selectedPersonas, personaForActor, personaConfigFromActors } from '../src/actors/persona.mjs';
const now = new Date('2026-11-01T12:00:00Z');
// Synthetic identities used only to exercise the cast contract; not Hitman canon.
const character = (key, rhythm) => ({ actor_key: key, name: 'Test ' + key, identity_kind: 'fictional_ai', identity_status: 'approved', approval_ref: 'test-only-owner-approval',
  canon: { version: 'fixture-v1', status: 'verified', approval_ref: 'test-only-canon-approval', sources: [{ ref: 'synthetic-fixture', version: '1', status: 'OWNER_APPROVED' }] },
  voice: { perspective: 'Practical questions', rhythm, humor: 'Gentle', motivation: 'Understand the detail' }, topics: ['community'], surfaces: ['news', 'song', 'post'] });
const config = { schema: 'actor-persona/v1', version: 'fixture-only-1', selected_cast: ['test.one', 'test.two'], characters: [character('test.one', 'Short and direct'), character('test.two', 'Warm and patient')] };
const policy = { ...DEFAULT_COVERAGE_POLICY, enabled: true };
const load = { pending: 0, daily: 0, per_actor: {} };
const items = ['news', 'song', 'post'].flatMap((kind, index) => [0, 1, 2].map(n => ({ kind, id: `${kind}${n}`, visibility: 'public', topics: ['community'], created_at: `2026-11-01T0${index + n}:00:00Z`, revision: 'v1' })));
const plan = extra => planActorCoverage({ orgId: 'house', items, personaConfig: config, policy, load, now, ...extra });

test('broader coverage is disabled by default; publishing and unbounded backfill are invalid', () => {
  assert.equal(plan({ policy: DEFAULT_COVERAGE_POLICY }).jobs.length, 0);
  assert.throws(() => plan({ policy: { ...policy, mode: 'publish' } }), /preview/);
  assert.throws(() => plan({ policy: { ...policy, audience_targeting: { demographic: 'fixture' } } }), /preview/);
  assert.throws(() => plan({ policy: { ...policy, purpose: 'fictional_mission_campaign' } }), /preview/);
  assert.throws(() => plan({ policy: { ...policy, max_batch: 500 } }), /limit/);
  assert.throws(() => plan({ policy: { ...policy, backfill: true } }), /Backfill/);
  assert.throws(() => plan({ load: {} }), /load snapshot/);
});
test('each item gets one selected approved actor and fair surface rotation, not every character', () => {
  const p = plan(); assert.equal(p.jobs.length, 3); assert.deepEqual(p.jobs.map(j => j.input.kind), ['news', 'song', 'post']);
  assert.ok(p.jobs.every(j => config.selected_cast.includes(j.targetId) && j.jobType === 'actor_comment_preview' && j.maxAttempts === 2));
  assert.equal(new Set(p.jobs.map(j => j.input.coverage_key)).size, 3);
  assert.equal(p.dispatchable, false); assert.match(p.dispatch_blocker, /atomic shared budget/);
});
test('cast approval and sources are required; unrelated characters and copied voices are excluded', () => {
  const cfg = structuredClone(config); cfg.characters.push(character('test.unselected', 'Very terse'));
  assert.deepEqual(selectedPersonas(cfg, 'news').map(p => p.actor_key), config.selected_cast);
  cfg.characters[0].identity_status = 'pending'; assert.equal(selectedPersonas(cfg, 'news').length, 1);
  cfg.characters[1].canon.sources = []; assert.throws(() => validatePersonaConfig(cfg), /source-backed/);
  const copied = structuredClone(config); copied.characters[1].voice = copied.characters[0].voice; assert.throws(() => validatePersonaConfig(copied), /distinct/);
  const noApproval = structuredClone(config); delete noApproval.characters[0].approval_ref; assert.throws(() => validatePersonaConfig(noApproval), /approval/);
  const proposed = structuredClone(config); proposed.characters[0].canon.sources[0].status = 'PROPOSED'; assert.throws(() => validatePersonaConfig(proposed), /not canon/);
  assert.throws(() => personaForActor({ actor_key: 'test.unselected' }, config), /selected adaptation cast/);
  const v = personaForActor({ actor_key: 'test.one' }, config); assert.equal(v.canon.version, 'fixture-v1'); assert.equal(v.disclosure.is_ai, true);
});
test('duplicates, completed and retry-exhausted jobs never create another actor job', () => {
  const p = plan({ items: [...items, ...items], existing: [{ kind: 'news', item_id: 'news0', status: 'completed' }, { kind: 'song', item_id: 'song0', status: 'failed', attempts: 2 }] });
  assert.equal(new Set(p.jobs.map(j => j.jobId)).size, p.jobs.length);
  assert.ok(!p.jobs.some(j => ['news:news0', 'song:song0'].includes(j.input.coverage_key)));
  assert.ok(p.outcomes.some(o => o.reason === 'retry_exhausted'));
});
test('concurrent plans use the same existing queue idempotency key, independent of cast/config', async () => {
  const [a, b] = await Promise.all([Promise.resolve(plan()), Promise.resolve(plan())]);
  assert.deepEqual(a.jobs.map(j => j.jobId), b.jobs.map(j => j.jobId));
  const changed = structuredClone(config); changed.version = 'fixture-only-2'; changed.selected_cast.reverse();
  assert.deepEqual(a.jobs.map(j => j.jobId), plan({ personaConfig: changed }).jobs.map(j => j.jobId));
  assert.equal(coverageJobId('house', items[0]), coverageJobId('house', { ...items[0], revision: 'v2' }));
  assert.notEqual(coverageJobId('house', items[0]), coverageJobId('another', items[0]));
});
test('pending, daily, actor and backfill limits bound proposals; deferred work is not checkpointed away', () => {
  const p = plan({ load: { ...load, pending: 5 } }); assert.equal(p.jobs.length, 1); assert.equal(p.checkpoint.scanned, 1);
  const next = plan({ checkpoint: p.checkpoint, existing: [{ kind: p.jobs[0].input.kind, item_id: p.jobs[0].input.item_id, status: 'queued' }] });
  assert.equal(next.jobs[0].input.kind, 'song'); assert.ok(!next.jobs.some(j => j.jobId === p.jobs[0].jobId));
  assert.equal(plan({ load: { ...load, daily: 12 } }).jobs.length, 0);
  assert.equal(plan({ load: { ...load, per_actor: { 'test.one': 3, 'test.two': 3 } } }).jobs.length, 0);
  const limited = plan({ policy: { ...policy, backfill: { since: '2026-10-01', max_items: 2 } } });
  assert.equal(limited.jobs.length, 2); assert.equal(limited.checkpoint.scanned, 2);
});
test('private, removed and group posts are skipped; owner status reports actual outcomes', () => {
  const p = plan({ items: [{ ...items[6], visibility: 'private' }] }); assert.equal(p.jobs.length, 0); assert.equal(p.outcomes[0].reason, 'not_public_or_removed');
  const status = coverageStatus([{ id: 'job', target_id: 'test.one', status: 'completed', attempts: 1, input: { kind: 'news', item_id: 'n' }, output: { status: 'withheld', reason: 'review_withheld', published: false } }]);
  assert.equal(status[0].status, 'withheld'); assert.equal(status[0].published, false);
});

test('missing approved cast defers coverage without losing the checkpoint', () => {
  const p = plan({ personaConfig: { ...config, selected_cast: [] } });
  assert.equal(p.jobs.length, 0); assert.equal(p.counts.deferred, 9); assert.equal(p.checkpoint.scanned, 0);
  assert.deepEqual(p.checkpoint.after, {});
});
test('owner configuration reuses actor rows and rejects identity or version mismatches', () => {
  const rows = config.characters.map(character => ({ actor_key: character.actor_key, persona: { commenting: { config_version: config.version, selected: true, character } } }));
  assert.deepEqual(personaConfigFromActors(rows), config);
  assert.equal(personaConfigFromActors([{ actor_key: 'existing', persona: { name: 'Existing' } }]), null);
  const changed = structuredClone(rows); changed[1].persona.commenting.config_version = 'other'; assert.throws(() => personaConfigFromActors(changed), /versions disagree/);
  changed[1].persona.commenting.config_version = config.version; changed[1].actor_key = 'wrong'; assert.throws(() => personaConfigFromActors(changed), /identity mismatch/);
});
