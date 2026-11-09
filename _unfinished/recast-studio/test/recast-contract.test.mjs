import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, validateRecastRequest, buildRecastPlan, transitionJob } from '../lib/recast-contract.mjs';

const request = (patch = {}) => ({
  orgId: 'org-demo', operationId: 'op-demo',
  sourceVideo: { id: 'video-demo', seconds: 20, fps: 24, hash: 'a'.repeat(64) },
  characterReferences: [{ id: 'character-a' }, { id: 'character-b' }],
  provider: 'fal-h3-max-recast', resolution: '768P', budgetUsd: 20, territory: 'US',
  attestations: { footageRights: true, likenessConsent: true, providerSharing: true },
  ...patch,
});
const codes = input => validateRecastRequest(input).errors.map(error => error.code);

test('plan separates source and all character references, retains tenant and has no live execution', async () => {
  const plan = await buildRecastPlan(request());
  assert.equal(plan.valid, true);
  assert.equal(plan.state, 'ready');
  assert.equal(plan.sourceVideo.id, 'video-demo');
  assert.deepEqual(plan.characterReferences, [{ id: 'character-a' }, { id: 'character-b' }]);
  assert.equal(plan.proposedSegments.length, 2);
  assert.ok(plan.proposedSegments.every(shot => shot.seconds <= 15 && shot.sourceVideoId === 'video-demo'));
  assert.deepEqual(plan.proposedSegments[1].characterReferenceIds, ['character-a', 'character-b']);
  assert.equal(plan.proposedSegments.reduce((total, shot) => total + shot.seconds, 0), 20);
  assert.equal(plan.proposedSegments.at(-1).endSeconds, 20);
  assert.equal(plan.readyForLive, false);
  assert.equal(plan.liveSubmissionEnabled, false);
  assert.equal(plan.attestationsVerified, false);
  assert.equal(plan.authority.store, 'media_jobs');
  assert.ok(plan.launchGates.length >= 8);
});

test('all three rights declarations are required, never inferred or claimed verified', async () => {
  for (const key of ['footageRights', 'likenessConsent', 'providerSharing']) {
    for (const value of [false, undefined, 'true', 1]) {
      const input = request(); input.attestations[key] = value;
      assert.ok(codes(input).includes('ATTESTATION_REQUIRED'));
    }
  }
  assert.equal((await buildRecastPlan(request({ attestations: {} }))).state, 'draft');
});

test('references never substitute for missing source; overlap, duplicate and missing references rejected', () => {
  assert.ok(codes(request({ sourceVideo: {} })).includes('SOURCE_REQUIRED'));
  assert.ok(codes(request({ characterReferences: [] })).includes('REFERENCES_REQUIRED'));
  assert.ok(codes(request({ characterReferences: [{ id: 'video-demo' }] })).includes('SOURCE_REFERENCE_OVERLAP'));
  assert.ok(codes(request({ characterReferences: [{ id: 'character-a' }, { id: 'character-a' }] })).includes('DUPLICATE_REFERENCE'));
  assert.ok(codes(request({ characterReferences: [{ url: 'https://example.com/ref.png' }] })).includes('INVALID_REFERENCE'));
  assert.ok(codes(request({ characterReferences: Array.from({length: 33}, (_, n) => ({id: `ref-${n}`})) })).includes('REFERENCES_REQUIRED'));
});

test('durations, metadata, ceilings and IDs are strictly validated without number coercion', () => {
  for (const seconds of [0, -1, 4.99, 30.01, Infinity, NaN, '20', undefined]) {
    assert.ok(codes(request({ sourceVideo: { id: 'video-demo', seconds, fps: 24 } })).includes('INVALID_DURATION'));
  }
  for (const seconds of [5, 15, 30]) {
    assert.equal(validateRecastRequest(request({sourceVideo: {id: 'video-demo', seconds, fps: 29.97}})).valid, true);
  }
  for (const budgetUsd of [0, -1, NaN, Infinity, '20', 100001, undefined]) assert.ok(codes(request({ budgetUsd })).includes('INVALID_BUDGET'));
  for (const fps of [0, -1, Infinity, '24', 241]) assert.ok(codes(request({sourceVideo: { id: 'v', seconds: 10, fps }})).includes('INVALID_FPS'));
  assert.ok(codes(request({ sourceVideo: {id: 'v', seconds: 10, fps: 24, hash: 'not-a-hash'} })).includes('INVALID_HASH'));
  assert.ok(codes(request({ orgId: '' })).includes('INVALID_ID'));
  assert.equal(validateRecastRequest(null).valid, false);
});

test('hypothetical price is not a quote or charge and both resolutions respect budget', async () => {
  const lower = await buildRecastPlan(request());
  assert.equal(lower.cost.estimatedUsd, 6);
  assert.equal(lower.cost.rateUsdPerSecond, 0.30);
  assert.equal(lower.cost.kind, 'hypothetical-estimate');
  assert.equal(lower.cost.quote, false);
  assert.equal(lower.cost.charge, false);
  assert.match(lower.cost.uncertainty, /taxes.*retries/);
  const higher = await buildRecastPlan(request({ resolution: '1080P' }));
  assert.equal(higher.cost.estimatedUsd, 9);
  assert.ok(codes(request({ budgetUsd: 5.99 })).includes('BUDGET_EXCEEDED'));
  assert.equal(validateRecastRequest(request({ budgetUsd: 6 })).valid, true);
  assert.ok(codes(request({ resolution: '1080P', budgetUsd: 8.99 })).includes('BUDGET_EXCEEDED'));
});

test('unsupported providers and resolutions fail closed; profiles cannot be mutated', () => {
  for (const provider of ['other', '__proto__', 'toString', undefined]) assert.ok(codes(request({provider})).includes('UNSUPPORTED_PROVIDER'));
  for (const resolution of ['4K', '720P', '768p', undefined]) assert.ok(codes(request({resolution})).includes('UNSUPPORTED_RESOLUTION'));
  assert.throws(() => { PROVIDERS['fal-h3-max-recast'].ratesUsdPerSecond['768P'] = 0; });
});

test('raw input URLs are never accepted, in asset IDs or nested extras', async () => {
  const variants = [
    { sourceVideo: {id: 'https://example.com/video.mp4', seconds: 10, fps: 24} },
    { sourceVideo: {id: 'video', seconds: 10, fps: 24, url: 'https://example.com/video.mp4'} },
    { characterReferences: [{id: 'blob:demo'}] },
    { sourceUrl: '/untrusted/local/path' },
    { extra: { nested: 'file:///etc/passwd' } },
    { extra: { nested: 'data:video/mp4;base64,abc' } },
  ];
  for (const patch of variants) {
    const plan = await buildRecastPlan(request(patch));
    assert.equal(plan.valid, false);
    assert.ok(plan.errors.some(error => error.code === 'RAW_URL_NOT_ALLOWED'));
    assert.ok(!JSON.stringify(plan).includes('example.com'));
    assert.ok(!JSON.stringify(plan).includes('/etc/passwd'));
  }
});

test('allowlisted output strips secrets and untrusted execution flags from every level', async () => {
  const input = request({ apiKey: 'secret-a', token: 'secret-b', readyForLive: true, liveSubmissionEnabled: true, licenseVerified: true });
  input.sourceVideo.password = 'secret-c';
  input.characterReferences[0].token = 'secret-d';
  input.attestations.verified = true;
  const plan = await buildRecastPlan(input);
  assert.ok(!JSON.stringify(plan).includes('secret-'));
  assert.equal(plan.readyForLive, false);
  assert.equal(plan.liveSubmissionEnabled, false);
  assert.equal(plan.attestationsVerified, false);
});

test('self-hosted H3 licensing fails closed in restricted, unknown and all other regions', async () => {
  for (const territory of ['US', 'EU', 'UK', 'KR', 'OTHER', 'DE', undefined]) {
    const input = request({ provider: 'openjutsu-h3-selfhost', territory,
      licenseVerified: true, licensing: { externallyVerified: true, approved: true },
      attestations: { footageRights: true, likenessConsent: true, providerSharing: true, licensing: true } });
    const plan = await buildRecastPlan(input);
    assert.ok(plan.errors.some(error => error.code === 'LICENSE_VERIFICATION_REQUIRED'));
    assert.equal(plan.valid, false);
    assert.equal(plan.readyForLive, false);
    assert.equal(plan.cost.estimatedUsd, null);
  }
});

test('Wan is uncosted and disabled, not free or silently substituted', async () => {
  const plan = await buildRecastPlan(request({ provider: 'wan22-animate-selfhost', resolution: '480P' }));
  assert.equal(plan.provider, 'wan22-animate-selfhost');
  assert.equal(plan.cost.estimatedUsd, null);
  assert.equal(plan.cost.rateUsdPerSecond, null);
  assert.equal(plan.cost.withinBaseEstimateBudget, null);
  assert.ok(plan.errors.some(error => error.code === 'FUTURE_PROVIDER_DISABLED'));
});

test('plan hashes are deterministic, order-normalized by schema and bind all consequential inputs', async () => {
  const input = request();
  const plan = await buildRecastPlan(input);
  const reverse = Object.fromEntries(Object.entries(input).reverse());
  assert.equal((await buildRecastPlan(reverse)).planHash, plan.planHash);
  assert.equal((await buildRecastPlan({...input, token: 'discarded'})).planHash, plan.planHash);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  for (const patch of [{ orgId: 'org-other' }, { operationId: 'op-other' }, { budgetUsd: 21 }, { resolution: '1080P' },
    { sourceVideo: {...input.sourceVideo, hash: 'b'.repeat(64)} }, { characterReferences: [...input.characterReferences].reverse() }]) {
    assert.notEqual((await buildRecastPlan(request(patch))).planHash, plan.planHash);
  }
  // Same operation and different content must be rejected by the future durable
  // server reservation. A client plan hash is not proof of idempotent submission.
  const changed = await buildRecastPlan(request({budgetUsd: 21}));
  assert.equal(changed.idempotencyKey, plan.idempotencyKey);
  assert.notEqual(changed.planHash, plan.planHash);
});

test('local state transitions preserve identity and reconcile uncertainty without retrying', async () => {
  const plan = await buildRecastPlan(request());
  let job = {...plan, state: 'draft', token: 'secret'};
  job = transitionJob(job, 'ready');
  job = transitionJob(job, 'queued');
  job = transitionJob(job, 'running');
  assert.throws(() => transitionJob(job, 'failed'), /Verified outcome/);
  job = transitionJob(job, 'reconciling');
  assert.equal(job.uncertain, true);
  assert.throws(() => transitionJob(job, 'queued', {outcomeVerified: true}), /Invalid transition/);
  assert.throws(() => transitionJob(job, 'ready', {outcomeVerified: true}), /Invalid transition/);
  assert.throws(() => transitionJob(job, 'running'), /Verified outcome/);
  assert.throws(() => transitionJob(job, 'succeeded'), /Verified outcome/);
  assert.deepEqual(transitionJob(job, 'reconciling'), job);
  job = transitionJob(job, 'succeeded', {outcomeVerified: true});
  assert.equal(job.operationId, plan.operationId);
  assert.equal(job.planHash, plan.planHash);
  assert.equal(job.idempotencyKey, plan.idempotencyKey);
  assert.equal(job.uncertain, false);
  assert.equal(job.readyForLive, false);
  assert.ok(!JSON.stringify(job).includes('secret'));
  assert.deepEqual(transitionJob(job, 'succeeded'), job);
  assert.throws(() => transitionJob(job, 'queued', {outcomeVerified: true}), /Invalid transition/);
});

test('cancellation before queue is local; final statuses after submission need outcome evidence', async () => {
  const plan = await buildRecastPlan(request());
  assert.equal(transitionJob(plan, 'canceled').state, 'canceled');
  for (const state of ['succeeded', 'failed', 'canceled']) {
    const queued = transitionJob(plan, 'queued');
    assert.throws(() => transitionJob(queued, state), /Verified outcome/);
    assert.equal(transitionJob(queued, state, {outcomeVerified: true}).state, state);
  }
  assert.throws(() => transitionJob({...plan, planHash: 'fake'}, 'queued'), /valid planHash/);
  assert.throws(() => transitionJob(plan, 'retry'), /Unknown job state/);
});


test('proposed segments are not shot evidence, even for a 30-second uncut source', async () => {
  const plan = await buildRecastPlan(request({ sourceVideo: {id: 'uncut', seconds: 30, fps: 24} }));
  assert.equal(plan.proposedSegments.length, 2);
  assert.equal(plan.shots, undefined);
  assert.equal(plan.segmentation.verifiedShotDetection, false);
  assert.equal(plan.segmentation.perShotLimitVerified, false);
  assert.match(plan.segmentation.warning, /not detected shots/);
  assert.ok(plan.launchGates.some(gate => gate.includes('Verified shot boundaries')));
});

test('fractional cents are rounded upward and budget validation uses the same amount', async () => {
  const input = request({sourceVideo: {id: 'video', seconds: 5.01, fps: 24}, budgetUsd: 1.50});
  const plan = await buildRecastPlan(input);
  assert.equal(plan.cost.estimatedUsd, 1.51);
  assert.ok(codes(input).includes('BUDGET_EXCEEDED'));
  assert.equal(validateRecastRequest({...input, budgetUsd: 1.51}).valid, true);
});

test('editorial controls are normalized and bound to the plan hash', async () => {
  const baseline = await buildRecastPlan(request());
  for (const editorial of [{startSeconds: 1, durationSeconds: 19}, {durationSeconds: 10}, {direction: 'Hold the framing'}, {characterLabel: 'Lead'}]) {
    const plan = await buildRecastPlan(request({editorial}));
    assert.equal(plan.valid, true);
    assert.notEqual(plan.planHash, baseline.planHash);
  }
  const plan = await buildRecastPlan(request({editorial: {direction: '  Hold   framing  ', characterLabel: ' Lead ', token: 'secret-extra'}}));
  assert.deepEqual(plan.editorial, {startSeconds: 0, durationSeconds: 20, direction: 'Hold framing', characterLabel: 'Lead'});
  assert.ok(!JSON.stringify(plan).includes('secret-extra'));
  const canonical = await buildRecastPlan(request({editorial: {direction: 'Hold framing', characterLabel: 'Lead'}}));
  assert.equal(canonical.planHash, plan.planHash);
});

test('editorial numeric bounds and plain text limits reject malformed input safely', async () => {
  for (const startSeconds of [-1, 20, 100000, Infinity, NaN, '1', null]) {
    assert.ok(codes(request({editorial: {startSeconds}})).includes('INVALID_START'));
  }
  for (const editorial of [{direction: '<script>alert(1)</script>'}, {characterLabel: 'a'.repeat(121)},
    {direction: 'a'.repeat(2001)}, {direction: 'bad\u0000text'}, {characterLabel: 'bad\u202etext'},
    {direction: 'https://untrusted.test'}, {direction: 17}, {characterLabel: null}]) {
    const plan = await buildRecastPlan(request({editorial}));
    assert.ok(plan.errors.some(error => error.code === 'INVALID_EDITORIAL_TEXT'));
    assert.ok(!JSON.stringify(plan).includes('<script>'));
    assert.ok(!JSON.stringify(plan).includes('untrusted.test'));
  }
  assert.ok(codes(request({editorial: []})).includes('INVALID_EDITORIAL'));
});

test('Wan resolution planning options are distinct, unverified, uncosted and always disabled', async () => {
  for (const resolution of ['480P', '720P']) {
    const plan = await buildRecastPlan(request({provider: 'wan22-animate-selfhost', resolution}));
    assert.equal(plan.resolution, resolution);
    assert.ok(!plan.errors.some(error => error.code === 'UNSUPPORTED_RESOLUTION'));
    assert.ok(plan.errors.some(error => error.code === 'FUTURE_PROVIDER_DISABLED'));
    assert.equal(plan.cost.estimatedUsd, null);
    assert.equal(plan.readyForLive, false);
  }
  assert.equal(PROVIDERS['wan22-animate-selfhost'].constraintsVerified, false);
  assert.ok(codes(request({provider: 'wan22-animate-selfhost', resolution: '1080P'})).includes('UNSUPPORTED_RESOLUTION'));
  assert.ok(codes(request({resolution: '720P'})).includes('UNSUPPORTED_RESOLUTION'));
});


test('full source and selected duration are distinct, with bounded selection and selected-only cost', async () => {
  const input = request({sourceVideo: {id: 'long-source', seconds: 60, fps: 24}, editorial: {startSeconds: 40, durationSeconds: 10}});
  const plan = await buildRecastPlan(input);
  assert.equal(plan.valid, true);
  assert.equal(plan.sourceVideo.seconds, 60);
  assert.equal(plan.editorial.durationSeconds, 10);
  assert.equal(plan.cost.estimatedUsd, 3);
  assert.equal(plan.proposedSegments[0].startSeconds, 40);
  assert.equal(plan.proposedSegments.at(-1).endSeconds, 50);
  assert.equal(plan.sourceMetadataVerified, false);
  assert.ok(codes({...input, editorial: {startSeconds: 50, durationSeconds: 20}}).includes('SELECTION_OUT_OF_BOUNDS'));
  assert.ok(codes({...input, editorial: {startSeconds: 0}}).includes('INVALID_DURATION'));
  for (const seconds of [0, -1, 86401, NaN, Infinity, '60']) {
    assert.ok(codes({...input, sourceVideo: {id: 'v', seconds, fps: 24}}).includes('INVALID_SOURCE_DURATION'));
  }
  for (const durationSeconds of [0, 4.99, 30.01, NaN, Infinity, '10', null]) {
    assert.ok(codes({...input, editorial: {startSeconds: 0, durationSeconds}}).includes('INVALID_DURATION'));
  }
});
