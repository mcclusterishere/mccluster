// The Environmental Justice League member journey, HTTP only, through the REAL Worker router over the REAL pending
// SQL (scripts/test/support/eup-league-plane.mjs: PGlite, the media lane's storage double, a token map for the
// session check; that file's header says exactly what is emulated).
//
//   PGLITE_MODULE=<pglite>/dist/index.js node scripts/test/eup-league-journey.integration.mjs
//
// Every step an actor takes is one HTTP request a page or the Control tab would send: the owner installs and enables
// the module, sets a synthetic League policy, creates and releases the campaign and the song mission FROM THE FIXTURE
// ROUTE, invites a tester; the tester applies (draft, then submit), is approved, accepts the current requirements,
// saves lyrics, records (an upload grant, a PUT of synthetic audio bytes to storage, complete: sealed and digest
// shown), submits privately; the owner plays the media through the 300 s link and accepts on three dimensions; one
// credit; consent, publication to the campaign audience, revocation that withdraws it in the same step, the credit
// unchanged. Then: the accommodation path with the same credit; needs_changes, a retake and revision 2 (a review of
// revision 1 refused, of revision 2 accepted); a proof-submit answer lost after the commit, read back from the receipt
// and resent with the same key, and the key never answering for another account; pause and withdrawal mid-way; one
// account never completing another's upload, draft or proof; the module drained and disabled mid-journey (new work
// refused with the module codes, revocation and withdrawals still open, own records readable, re-enable resumes);
// self-approval and self-review refused when the owner is also the participant; and the route table, every row of
// the contract's ROUTES for {no bearer, an account invited nowhere, a tester of another campaign, the tester, the
// owner}.
// The test may READ the database and the storage double as evidence (named "evidence" below); it never writes them.
// NOT PROVEN HERE: concurrency and lock order (PGlite is one session: scripts/test/eup-league.native.integration.mjs),
// real storage, real PostgREST, the Worker runtime (Node; the Worker's outbound fetch goes through asWorkerFetch), and
// a browser (the member and Control lanes mount this plane in Playwright).
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as C from '../../workers/mccluster/src/eup/league-contract.js';
import { createLeaguePlane, ACCOUNTS, RIGHTS } from './support/eup-league-plane.mjs';
import { LEAGUE_DECOYS } from './support/eup-league-database.mjs';

let count = 0;
const ok = (c, m) => { assert.ok(c, m); count += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); count += 1; };
const O = (rest = '') => `${C.PREFIX.owner}${rest ? `/${rest}` : ''}`;
const M = (rest = '') => `${C.PREFIX.member}${rest ? `/${rest}` : ''}`;
const key = (label) => `journey-${label}-${randomUUID().slice(0, 8)}`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const keysOf = (shape) => Object.keys(C.shapeFields(shape)).sort();
const sorted = (o) => Object.keys(o).sort();
const NOT_AVAILABLE = { ok: false, error: 'Not available', reason: 'not_available' };
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

/* A League policy with clearly synthetic values. TEST FIXTURE values and notices, not defaults and not policy. */
const notice = (id) => ({ revision: `journey-${id}-1`, text: `TEST FIXTURE ${id} notice for the League journey test. Not real policy text.\nSecond line of the fixture.` });
const POLICY = {
  entitlement: 'none_required',
  media: { enabled: true, kinds: ['audio', 'video'], audio_max_bytes: 4096, video_max_bytes: 8192, max_duration_seconds: 120 },
  retention: { completed_days: 30, withdrawn_days: 7 },
  notices: { participation: notice('participation'), private_review: notice('private-review'), publication: notice('publication') }
};
/* Synthetic audio: the WebM (EBML) magic of the contract's vectors, then filler. It describes no recording. */
const WEBM_HEAD = C.bytesFromHex(C.MAGIC_VECTORS.find((v) => v.name === 'webm').hex);
function synthAudio(size, seed) {
  const bytes = new Uint8Array(size);
  bytes.set(WEBM_HEAD);
  for (let i = WEBM_HEAD.length; i < size; i += 1) bytes[i] = (i * 131 + seed * 17) & 0xff;
  return bytes;
}
const LYRICS = 'Line one of the test fixture song\nLine two: the river runs clear\nLínea tres \u{1F30D}';
const CREDITS = [{ name: 'Journey Fixture Writer', role: 'lyrics' }, { name: 'Journey Fixture Singer', role: 'voice' }];

/* ------------------------------------------------------------------ one HTTP request, audited */
const FOREIGN = new Set(C.FOREIGN_ID_FIELDS);
const MEMBER_NEVER = new Set(['storage', 'family', 'object_id', 'etag']); // storage identity never reaches a member
function walk(value, visit, path = '$', parent = null) {
  visit(path, value, parent);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, `${path}[${i}]`, path));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, visit, `${path}.${k}`, path);
}
/* Where a signed location may appear in an answer: the grant, the member's own or audience read, the owner's review read. */
const SIGNED_AT = /^\$\.(grant\.url|url|media\[\d+\]\.url)$/;
function makeApi(plane) {
  const serviceKey = plane.serviceKeyHeaders().apikey;
  return async function api(as, method, path, body, { status = 200, reason, raw, headers, label } = {}) {
    const r = await plane.call(as, method, path, body, { raw, headers });
    const where = label || `${as ?? 'no bearer'} ${method} ${path}`;
    assert.equal(r.status, status, `${where}: expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
    count += 1;
    if (reason !== undefined) eq(r.body?.reason, reason, `${where}: reason`);
    // Every answer: private and not cached, no service key, signed locations only where the contract puts them.
    const member = path.startsWith(C.PREFIX.member);
    const problems = [];
    if (r.headers.get('cache-control') !== 'private, no-store') problems.push(`cache-control ${r.headers.get('cache-control')}`);
    if (member && r.headers.get('vary') !== 'Origin, Authorization') problems.push(`vary ${r.headers.get('vary')}`);
    if (JSON.stringify(r.body).includes(serviceKey)) problems.push('the service key');
    walk(r.body, (p, v, parent) => {
      const name = p.slice(p.lastIndexOf('.') + 1);
      if (member && parent !== null && !/\]$/.test(p) && FOREIGN.has(name)) problems.push(`foreign id field ${p}`);
      if (member && parent !== null && !/\]$/.test(p) && MEMBER_NEVER.has(name)) problems.push(`storage identity ${p}`);
      if (typeof v === 'string' && (v.includes('token=') || v.includes('league/v1/t/')) && !SIGNED_AT.test(p)) problems.push(`signed location at ${p}`);
    });
    eq(problems, [], `${where}: answer audit`);
    return r.body;
  };
}

const plane = await createLeaguePlane({ enable: false });
const api = makeApi(plane);
const ids = ACCOUNTS;
try {
  /* ================================================================== 0. the module: installed and enabled over HTTP */
  let control = await api('owner', 'GET', '/v1/eup/modules');
  eq(control.modules.find((m) => m.moduleId === 'league').installed, false, 'the League module starts not installed');
  const before = await api('owner', 'GET', O('policy'));
  eq([before.policy.revision, before.policy.document, before.policy.valid], [0, null, false], 'reads answer before install: no League policy yet');
  await api('owner', 'POST', O('campaigns'), { idempotency_key: key('early'), campaign: { slug: 'journey-early', title: 'Test fixture', purpose: 'Test fixture.' } },
    { status: 503, reason: 'module_not_installed', label: 'a League write before install' });
  await api('tester', 'GET', M(), undefined, { status: 404, label: 'the member read before install' });
  const installed = await api('owner', 'POST', '/v1/eup/modules/league/install', { idempotency_key: key('install'), reason: 'Journey test: install the League module.' });
  eq([installed.receipt.policy.state, installed.receipt.policy.revision], ['disabled', 0], 'install creates the module disabled at revision 0');
  await api('owner', 'POST', O('campaigns'), { idempotency_key: key('early'), campaign: { slug: 'journey-early', title: 'Test fixture', purpose: 'Test fixture.' } },
    { status: 409, reason: 'module_disabled', label: 'a League write while installed but disabled' });
  const enabled = await api('owner', 'POST', '/v1/eup/modules/league/state', { idempotency_key: key('enable'), expected_revision: 0, state: 'enabled', reason: 'Journey test: enable the League module.' });
  eq([enabled.receipt.policy.state, enabled.receipt.policy.revision], ['enabled', 1], 'enable moves it to enabled, revision 1');
  control = await api('owner', 'GET', '/v1/eup/modules');
  eq(control.modules.find((m) => m.moduleId === 'league').state, 'enabled', 'the owner read shows it enabled');

  /* ================================================================== 1. the owner sets up from the fixture */
  const fixture = (await api('owner', 'GET', O('fixture'))).fixture;
  const songFixture = fixture.missions.find((m) => m.template === 'write-a-song');
  eq(songFixture.title, 'Write a song for a healthier world', 'the fixture carries the song mission');
  const policy = (await api('owner', 'POST', O('policy'), { idempotency_key: key('policy'), expected_revision: 0, policy: POLICY, reason: 'Journey test: synthetic test-fixture League policy.' })).policy;
  eq([policy.revision, policy.valid, policy.document], [1, true, POLICY], 'the policy is stored as sent, valid, revision 1');
  await api('owner', 'POST', O('policy'), { idempotency_key: key('policy-stale'), expected_revision: 0, policy: POLICY, reason: 'Journey test: stale.' }, { status: 409, reason: 'revision_conflict' });

  let campaignA = (await api('owner', 'POST', O('campaigns'), { idempotency_key: key('campaign'), campaign: { slug: fixture.slug, title: fixture.title, purpose: fixture.purpose } })).campaign;
  eq([campaignA.state, campaignA.audience, campaignA.revision], ['draft', 'admin_preview', 1], 'the campaign is created draft and admin_preview');
  const missionDocument = (m) => ({ slug: m.slug, title: m.title, template: m.template, proof_modes: m.proof_modes, requirements: m.requirements, acceptance: m.acceptance });
  let missionA = (await api('owner', 'POST', O(`campaigns/${campaignA.id}/missions`), { idempotency_key: key('mission'), mission: missionDocument(songFixture) })).mission;
  eq([missionA.state, missionA.title, missionA.requirements_revision, missionA.proof_modes], ['draft', songFixture.title, 1, songFixture.proof_modes], 'the song mission is created draft from the fixture');
  await api('owner', 'POST', O(`missions/${missionA.id}/transition`), { idempotency_key: key('early-release'), expected_revision: missionA.revision, to: 'released' },
    { status: 422, reason: 'invalid', label: 'a mission is not released before its campaign' });
  campaignA = (await api('owner', 'POST', O(`campaigns/${campaignA.id}/transition`), { idempotency_key: key('release'), expected_revision: campaignA.revision, to: 'released' })).campaign;
  missionA = (await api('owner', 'POST', O(`missions/${missionA.id}/transition`), { idempotency_key: key('mission-release'), expected_revision: missionA.revision, to: 'released' })).mission;
  eq([campaignA.state, missionA.state], ['released', 'released'], 'both released');
  await api('tester', 'GET', M(), undefined, { status: 404, label: 'released but admin_preview: the tester sees nothing' });
  campaignA = (await api('owner', 'POST', O(`campaigns/${campaignA.id}/audience`), { idempotency_key: key('audience'), expected_revision: campaignA.revision, audience: 'invited' })).campaign;
  eq(campaignA.audience, 'invited', 'the campaign is open to invited accounts');
  await api('owner', 'POST', O(`campaigns/${campaignA.id}/audience`), { idempotency_key: key('public'), expected_revision: campaignA.revision, audience: 'public' },
    { status: 422, reason: 'invalid', label: 'an audience wider than invited is refused' });
  const grantTester = (await api('owner', 'POST', O(`campaigns/${campaignA.id}/audience/grants`), { idempotency_key: key('grant'), grant: { account: ids.tester, note: 'Journey test tester.' } })).grant;
  const grantPeer = (await api('owner', 'POST', O(`campaigns/${campaignA.id}/audience/grants`), { idempotency_key: key('grant'), grant: { account: ids.peer, note: 'Journey test: accommodation path.' } })).grant;
  eq([grantTester.state, grantTester.account, grantPeer.state], ['open', ids.tester, 'open'], 'two open grants');
  await api('owner', 'POST', O(`campaigns/${campaignA.id}/audience/grants`), { idempotency_key: key('grant-again'), grant: { account: ids.tester } }, { status: 409, reason: 'exists' });
  const grants = (await api('owner', 'GET', O(`campaigns/${campaignA.id}/audience/grants`))).grants;
  eq(grants.map((g) => g.account).sort(), [ids.tester, ids.peer].sort(), 'the grant list');
  const preview = (await api('owner', 'GET', O(`missions/${missionA.id}/preview`))).mission;
  eq([preview.open, preview.requirements, preview.seats_taken], [true, songFixture.requirements, 0], 'the owner preview is the member card');

  // Campaign B, for the tester of another campaign: the same fixture mission under a synthetic slug.
  let campaignB = (await api('owner', 'POST', O('campaigns'), { idempotency_key: key('campaign-b'), campaign: { slug: 'journey-campaign-b', title: 'Test fixture: second campaign', purpose: 'A synthetic second campaign for the journey test.' } })).campaign;
  let missionB = (await api('owner', 'POST', O(`campaigns/${campaignB.id}/missions`), { idempotency_key: key('mission-b'), mission: missionDocument(songFixture) })).mission;
  campaignB = (await api('owner', 'POST', O(`campaigns/${campaignB.id}/transition`), { idempotency_key: key('release-b'), expected_revision: campaignB.revision, to: 'released' })).campaign;
  missionB = (await api('owner', 'POST', O(`missions/${missionB.id}/transition`), { idempotency_key: key('mission-release-b'), expected_revision: missionB.revision, to: 'released' })).mission;
  campaignB = (await api('owner', 'POST', O(`campaigns/${campaignB.id}/audience`), { idempotency_key: key('audience-b'), expected_revision: campaignB.revision, audience: 'invited' })).campaign;
  await api('owner', 'POST', O(`campaigns/${campaignB.id}/audience/grants`), { idempotency_key: key('grant-b'), grant: { account: ids.tester_b, note: 'Journey test: tester of campaign B.' } });

  /* ================================================================== 2. who sees what */
  await api(null, 'GET', M(), undefined, { status: 401, reason: 'authentication_required' });
  eq(await api('outsider', 'GET', M(), undefined, { status: 404 }), NOT_AVAILABLE, 'an account invited nowhere: not available, nothing else');
  let meB = (await api('tester_b', 'GET', M())).league;
  eq(meB.catalogue.map((c) => c.id), [campaignB.id], 'the tester of campaign B sees campaign B only');
  let me = (await api('tester', 'GET', M())).league;
  eq([me.actor, me.catalogue.map((c) => c.id), me.applications, me.assignments, me.published], [ids.tester, [campaignA.id], [], [], []], 'the tester sees campaign A and has no records yet');
  eq(me.catalogue[0].missions, [preview], 'the member card equals the owner preview, field for field');
  eq([me.policy.revision, me.policy.notices], [1, POLICY.notices], 'the member read carries the policy notices');
  await api('tester_b', 'POST', M(`missions/${missionA.id}/application`), { idempotency_key: key('cross-apply'), expected_revision: 0, application: { submit: false, requirements_revision: 1 } },
    { status: 404, label: 'the tester of campaign B cannot apply to campaign A' });

  /* ================================================================== 3. apply with a draft, submit, approval */
  const saveApplication = (as, mission, revision, application, opts) =>
    api(as, 'POST', M(`missions/${mission}/application`), { idempotency_key: key('apply'), expected_revision: revision, application }, opts);
  let app = (await saveApplication('tester', missionA.id, 0, { submit: false, requirements_revision: 1, statement: 'Test fixture draft: I would like to write a song.' })).application;
  eq([app.status, app.revision, sorted(app)], ['draft', 1, keysOf('member_application')], 'a draft application, answered without its text');
  await saveApplication('tester', missionA.id, 0, { submit: true, requirements_revision: 1, statement: 'Test fixture.' }, { status: 409, reason: 'revision_conflict', label: 'revision 0 once a draft exists' });
  app = (await saveApplication('tester', missionA.id, 1, { submit: true, requirements_revision: 1, statement: 'Test fixture: I would like to write a song for a healthier world.' })).application;
  eq([app.status, app.revision, app.requirements_revision], ['submitted', 2, 1], 'submitted against requirements revision 1');
  const submittedList = (await api('owner', 'GET', O(`applications?mission=${missionA.id}&status=submitted`))).applications;
  eq(submittedList.map((a) => [a.id, a.applicant, a.status, a.document]), [[app.id, ids.tester, 'submitted', { statement: 'Test fixture: I would like to write a song for a healthier world.' }]], 'the owner sees the submitted application');
  const decided = (await api('owner', 'POST', O(`applications/${app.id}/decision`), { idempotency_key: key('approve'), expected_revision: 2, decision: 'approved' })).application;
  eq([decided.status, decided.assignment.status, decided.assignment.participant], ['approved', 'offered', ids.tester], 'approved: one offered assignment');
  let assignment = decided.assignment;

  /* ================================================================== 4. accept the current requirements, save lyrics, pause mid-way */
  me = (await api('tester', 'GET', M())).league;
  eq([me.assignments.length, me.assignments[0].status, me.assignments[0].mission.requirements_revision], [1, 'offered', 1], 'the tester sees the offer');
  const accept = (as, id, revision, notice_revision, opts) => api(as, 'POST', M(`assignments/${id}/accept`), { idempotency_key: key('accept'), expected_revision: revision, requirements_revision: 1, notice_revision }, opts);
  await accept('tester', assignment.id, assignment.revision, 'journey-not-the-current-notice', { status: 409, reason: 'requirements_changed', label: 'a notice that is not current' });
  assignment = (await accept('tester', assignment.id, assignment.revision, POLICY.notices.participation.revision)).assignment;
  eq([assignment.status, assignment.accepted_requirements_revision, assignment.accepted_notice_revision], ['accepted', 1, POLICY.notices.participation.revision], 'accepted: requirements revision 1 under the current notice');
  const saveDraft = (as, id, revision, draft, opts) => api(as, 'POST', M(`assignments/${id}/draft`), { idempotency_key: key('draft'), expected_revision: revision, draft }, opts);
  let draft = (await saveDraft('tester', assignment.id, 0, { title: 'Test fixture: river song', lyrics: 'Line one of the test fixture song' })).draft;
  eq([draft.revision, sorted(draft)], [1, keysOf('draft_saved')], 'the draft is saved; the answer carries no lyrics');

  // Pause the mission: own records stay readable, new work is refused, re-release resumes at the same requirements.
  missionA = (await api('owner', 'POST', O(`missions/${missionA.id}/transition`), { idempotency_key: key('pause'), expected_revision: missionA.revision, to: 'paused' })).mission;
  me = (await api('tester', 'GET', M())).league;
  eq([me.assignments[0].status, me.assignments[0].mission.state, me.assignments[0].mission.open, me.assignments[0].draft.document.lyrics],
    ['accepted', 'paused', false, 'Line one of the test fixture song'], 'paused: the tester still reads the assignment and the draft, and sees why work stopped');
  eq(me.catalogue[0].missions, [], 'paused: the mission leaves the catalogue');
  eq(await saveDraft('tester', assignment.id, 1, { title: 'Test fixture: river song', lyrics: LYRICS }, { status: 404, label: 'paused: new work is refused' }), NOT_AVAILABLE, 'paused: not available');
  missionA = (await api('owner', 'POST', O(`missions/${missionA.id}/transition`), { idempotency_key: key('resume'), expected_revision: missionA.revision, to: 'released' })).mission;
  eq([missionA.state, missionA.requirements_revision], ['released', 1], 're-released at the same requirements revision');
  // Pause the campaign: the same, one level up.
  campaignA = (await api('owner', 'POST', O(`campaigns/${campaignA.id}/transition`), { idempotency_key: key('pause-campaign'), expected_revision: campaignA.revision, to: 'paused' })).campaign;
  me = (await api('tester', 'GET', M())).league;
  eq([me.catalogue.length, me.assignments[0].mission.open, me.applications[0].status], [0, false, 'approved'], 'campaign paused: out of the catalogue, own records kept');
  await api('tester', 'POST', M(`assignments/${assignment.id}/uploads`), { idempotency_key: key('begin'), upload: { kind: 'audio', mime: 'audio/webm', bytes: 640 } }, { status: 404, label: 'campaign paused: no upload' });
  campaignA = (await api('owner', 'POST', O(`campaigns/${campaignA.id}/transition`), { idempotency_key: key('resume-campaign'), expected_revision: campaignA.revision, to: 'released' })).campaign;
  draft = (await saveDraft('tester', assignment.id, 1, { title: 'Test fixture: river song', lyrics: LYRICS, credits: CREDITS })).draft;
  eq(draft.revision, 2, 'released again: the draft saves');

  /* ================================================================== 5. record: grant, PUT, complete; nobody else can */
  const AUDIO = synthAudio(640, 1);
  const DIGEST = sha256(AUDIO);
  const begin = (as, id, upload, opts) => api(as, 'POST', M(`assignments/${id}/uploads`), { idempotency_key: key('begin'), upload }, opts);
  await begin('tester', assignment.id, { kind: 'audio', mime: 'audio/webm', bytes: POLICY.media.audio_max_bytes + 1 }, { status: 413, reason: 'media_too_large', label: 'above the policy cap: the SQL hint answers 413' });
  await begin('tester', assignment.id, { kind: 'audio', mime: 'image/png', bytes: 640 }, { status: 415, reason: 'media_type_not_allowed', label: 'not a media type of the table' });
  const begun = await begin('tester', assignment.id, { kind: 'audio', mime: 'audio/webm', bytes: AUDIO.byteLength, duration_seconds: 42 });
  const upload = begun.upload;
  eq([sorted(upload), upload.state, upload.scan_state, upload.declared_bytes, upload.max_bytes], [keysOf('member_upload'), 'staged', 'not_scanned', 640, POLICY.media.audio_max_bytes],
    'staged, not scanned, capped by the policy; a member_upload without storage identity');
  eq([begun.grant.method, begun.grant.headers, begun.grant.expires_in], ['PUT', { 'content-type': 'audio/webm', 'x-upsert': 'false' }, C.MEDIA.upload_grant_seconds], 'one upload grant');
  const objectPath = C.mediaObjectPath({ tenant: ids.owner, assignment: assignment.id, upload: upload.id, ext: 'webm' });
  ok(begun.grant.url.startsWith(`${plane.supabase}/storage/v1/object/upload/sign/${C.MEDIA.bucket}/${objectPath}?token=`), 'the grant is for the path made from the row ids, in the private bucket');
  await api('tester', 'POST', M(`uploads/${upload.id}/complete`), {}, { status: 409, reason: 'upload_missing', label: 'complete before the file arrived' });
  const put = await plane.fetch(begun.grant.url, { method: begun.grant.method, headers: { ...begun.grant.headers, origin: 'https://matthew.mccluster.org' }, body: AUDIO });
  eq([put.status, put.headers.get('access-control-allow-origin')], [200, '*'], 'the browser PUT with the grant lands');
  const overwrite = await plane.fetch(begun.grant.url, { method: 'PUT', headers: begun.grant.headers, body: synthAudio(640, 9) });
  ok(overwrite.status >= 400, 'the grant does not overwrite what it stored');
  // Account B cannot complete, discard, read or write around account A's upload, draft or proof.
  for (const as of ['tester_b', 'peer', 'owner', 'outsider']) {
    eq(await api(as, 'POST', M(`uploads/${upload.id}/complete`), {}, { status: 404 }), NOT_AVAILABLE, `${as} cannot complete the tester's upload`);
    await api(as, 'POST', M(`uploads/${upload.id}/discard`), { idempotency_key: key('steal') }, { status: 404, label: `${as} cannot discard it` });
    await api(as, 'GET', M(`uploads/${upload.id}/url`), undefined, { status: 404, label: `${as} cannot read it` });
    await saveDraft(as, assignment.id, 2, { title: 'not mine', lyrics: 'not mine' }, { status: 404, label: `${as} cannot write the tester's draft` });
  }
  eq(plane.storage.object(objectPath).size, 640, 'evidence: the object is still the one the tester stored');
  const sealed = (await api('tester', 'POST', M(`uploads/${upload.id}/complete`), {})).upload;
  eq([sealed.state, sealed.bytes, sealed.sha256, sorted(sealed)], ['sealed', 640, DIGEST, keysOf('member_upload')], 'sealed with the digest of exactly the bytes stored');
  const storageCalls = plane.storage.calls.length;
  eq((await api('tester', 'POST', M(`uploads/${upload.id}/complete`), {})).upload, sealed, 'a second complete answers the same row');
  eq(plane.storage.calls.length, storageCalls, 'and touches storage not at all');
  const own = await api('tester', 'GET', M(`uploads/${upload.id}/url`));
  eq([own.media, own.expires_in], [{ upload_id: upload.id, kind: 'audio', mime: 'audio/webm', bytes: 640, sha256: DIGEST }, C.MEDIA.signed_read_seconds], 'the own read: proof_media and a 300 s link');
  const played = await plane.fetch(own.url);
  eq([played.status, sha256(new Uint8Array(await played.arrayBuffer()))], [200, DIGEST], 'the link plays exactly the sealed bytes');

  /* ================================================================== 6. submit privately; the answer is lost; receipt; same-key resend */
  const PROOF_KEY = key('proof');
  const proofBody = (patch = {}) => ({ idempotency_key: PROOF_KEY, expected_revision: 0, proof: { title: 'Test fixture: river song', lyrics: LYRICS, credits: CREDITS, rights: RIGHTS,
    media: [{ upload_id: upload.id, sha256: DIGEST }], review_notice_revision: POLICY.notices.private_review.revision, ...patch } });
  for (const as of ['tester_b', 'peer', 'owner']) {
    eq(await api(as, 'POST', M(`assignments/${assignment.id}/proof`), proofBody(), { status: 404 }), NOT_AVAILABLE, `${as} cannot submit the tester's proof`);
  }
  const drop = plane.faults.add({ method: 'POST', path: M(`assignments/${assignment.id}/proof`), as: 'tester', mode: 'drop' });
  let lostAnswer = null;
  try { await plane.call('tester', 'POST', M(`assignments/${assignment.id}/proof`), proofBody()); } catch (error) { lostAnswer = error; }
  eq([lostAnswer?.planeFault, drop.hits], ['drop', 1], 'the proof submit committed and its answer was lost');
  const receipt = (await api('tester', 'GET', M(`receipts/proofs.submit/${PROOF_KEY}`))).receipt;
  eq([receipt.surface, receipt.operation, receipt.idempotency_key, sorted(receipt.result)], ['member', 'proofs.submit', PROOF_KEY, keysOf('proof_submitted')], 'the receipt tells the outcome');
  const resent = (await api('tester', 'POST', M(`assignments/${assignment.id}/proof`), proofBody())).proof;
  eq(resent, receipt.result, 'the same key resent answers the stored result');
  eq([resent.revision, resent.state, resent.consent.purpose, resent.consent.audience], [1, 'submitted', 'private_review', 'reviewers'], 'revision 1, submitted, with the private review consent');
  for (const as of ['tester_b', 'peer', 'owner', 'outsider']) {
    eq(await api(as, 'GET', M(`receipts/proofs.submit/${PROOF_KEY}`), undefined, { status: 404 }), NOT_AVAILABLE, `${as} never reads the tester's receipt`);
  }
  await api('owner', 'GET', O(`receipts/proofs.submit/${PROOF_KEY}`), undefined, { status: 404, label: 'nor does the owner surface' });
  await api('tester', 'POST', M(`assignments/${assignment.id}/proof`), proofBody({ title: 'Test fixture: another title' }), { status: 409, reason: 'idempotency_conflict', label: 'the same key with another payload' });
  let proofs = (await api('owner', 'GET', O(`proofs?assignment=${assignment.id}`))).proofs;
  eq(proofs.map((p) => [p.revision, p.state, p.participant]), [[1, 'submitted', ids.tester]], 'evidence over HTTP: exactly one proof revision');
  const proof = proofs[0];

  /* ================================================================== 7. review through the 300 s link; accept; one credit */
  await api('owner', 'GET', O(`proofs/${proof.id}/media?revision=2`), undefined, { status: 409, reason: 'revision_conflict', label: 'a revision that is not current' });
  await api('owner', 'GET', O(`proofs/${proof.id}/media`), undefined, { status: 400, reason: 'expected_revision_required', label: 'the revision is required' });
  const review = await api('owner', 'GET', O(`proofs/${proof.id}/media?revision=1`));
  eq([review.proof.id, review.media.length, review.media[0].upload_id, review.media[0].sha256, review.media[0].expires_in], [proof.id, 1, upload.id, DIGEST, 300], 'the review read: one signed 300 s link per upload');
  const heard = await plane.fetch(review.media[0].url);
  eq(sha256(new Uint8Array(await heard.arrayBuffer())), DIGEST, 'the reviewer hears exactly the sealed bytes');
  const decide = (as, id, revision, decisions, opts) => api(as, 'POST', O(`proofs/${id}/review`), { idempotency_key: key('review'), expected_revision: revision, review: decisions }, opts);
  const PASS = { mission_decision: 'pass', rights_decision: 'pass', safety_decision: 'pass' };
  const reviewed = (await decide('owner', proof.id, 1, { asset_revision: proof.asset_revision, ...PASS })).proof;
  eq([reviewed.state, reviewed.review.decision, reviewed.review.reviewer, reviewed.credit.participant, reviewed.credit.kind], ['accepted', 'accepted', ids.owner, ids.tester, 'mission_completion'], 'accepted on three dimensions; one credit');
  let credits = (await api('owner', 'GET', O(`credits?mission=${missionA.id}`))).credits;
  eq(credits.length, 1, 'exactly one credit exists');
  const credit = credits[0];
  eq([sorted(credit), credit.proof_revision, credit.asset_revision], [keysOf('credit'), 1, proof.asset_revision], 'the credit names the reviewed revision and digest, and nothing else');
  me = (await api('tester', 'GET', M())).league;
  eq([me.assignments[0].status, me.assignments[0].proof.state, me.assignments[0].credit], ['completed', 'accepted', credit], 'the tester sees completion and the credit');

  /* ================================================================== 8. consent, publication, revocation */
  const grantConsent = (as, proofId, revision, consent, opts) => api(as, 'POST', M(`proofs/${proofId}/consent`), { idempotency_key: key('consent'), expected_revision: revision, consent }, opts);
  const CONSENT = { purpose: 'publish_proof', audience: 'released_audience', asset_revision: proof.asset_revision, notice_revision: POLICY.notices.publication.revision, expires_at: inDays(30) };
  await grantConsent('tester', proof.id, 1, { ...CONSENT, notice_revision: POLICY.notices.participation.revision }, { status: 409, reason: 'consent_scope', label: 'a consent under another notice' });
  await grantConsent('tester', proof.id, 1, { ...CONSENT, expires_at: inDays(400) }, { status: 409, reason: 'consent_scope', label: 'a consent beyond 366 days' });
  await grantConsent('peer', proof.id, 1, CONSENT, { status: 404, label: 'only the participant consents' });
  const consent = (await grantConsent('tester', proof.id, 1, CONSENT)).consent;
  eq([consent.state, consent.purpose, consent.audience, consent.proof_revision], ['open', 'publish_proof', 'released_audience', 1], 'an open, exact-scope publication consent');
  await grantConsent('tester', proof.id, 1, CONSENT, { status: 409, reason: 'exists', label: 'one open publication consent per proof' });
  eq((await api('peer', 'GET', M())).league.published, [], 'a consent publishes nothing');
  const publish = (id, revision, body, opts) => api('owner', 'POST', O(`proofs/${id}/publication`), { idempotency_key: key('publish'), expected_revision: revision, ...body }, opts);
  const publication = (await publish(proof.id, 1, { decision: 'published', consent_id: consent.id })).publication;
  eq([publication.state, publication.effective, publication.audience, publication.consent_id], ['published', true, 'released_audience', consent.id], 'published to the campaign audience, bound to the consent');
  const seen = (await api('peer', 'GET', M())).league.published;
  eq(seen.map((p) => [p.publication_id, p.title, p.lyrics, p.credits, p.media]), [[publication.id, 'Test fixture: river song', LYRICS, CREDITS, [{ upload_id: upload.id, kind: 'audio', mime: 'audio/webm', bytes: 640, sha256: DIGEST }]]],
    'the released audience sees the words, the credits and the media, and no account');
  const audience = await api('peer', 'GET', M(`uploads/${upload.id}/url`));
  eq(audience.media, own.media, 'the audience plays it through the same narrow answer');
  eq(sha256(new Uint8Array(await (await plane.fetch(audience.url)).arrayBuffer())), DIGEST, 'and hears the sealed bytes');
  eq((await api('tester_b', 'GET', M())).league.published, [], 'another campaign\'s tester does not see it');
  await api('tester_b', 'GET', M(`uploads/${upload.id}/url`), undefined, { status: 404, label: 'nor play it' });
  const revoked = (await api('tester', 'POST', M(`consents/${consent.id}/revoke`), { idempotency_key: key('revoke') })).consent;
  eq([revoked.state, revoked.publication.id, revoked.publication.state, revoked.publication.withdrawn_reason, revoked.publication.effective],
    ['revoked', publication.id, 'withdrawn', 'consent_revoked', false], 'revocation withdraws the publication in the same step');
  eq((await api('peer', 'GET', M())).league.published, [], 'the audience no longer sees it');
  await api('peer', 'GET', M(`uploads/${upload.id}/url`), undefined, { status: 404, label: 'nor plays it' });
  eq((await api('owner', 'GET', O(`publications?campaign=${campaignA.id}`))).publications.map((p) => [p.id, p.state, p.withdrawn_reason]), [[publication.id, 'withdrawn', 'consent_revoked']], 'the owner sees it withdrawn');
  credits = (await api('owner', 'GET', O(`credits?mission=${missionA.id}`))).credits;
  eq(credits, [credit], 'the credit is unchanged');

  /* ================================================================== 9. the accommodation path earns the same credit */
  const REQUEST = { statement: 'Test fixture: I need to take part in writing.' };
  const ACCOMMODATION = { statement: 'Test fixture: recording is not possible for me.\nI am sending the words and this statement instead.' };
  const peerApp = (await saveApplication('peer', missionA.id, 0, { submit: true, requirements_revision: 1, statement: 'Test fixture: I would like to take part.', accommodation: REQUEST })).application;
  eq([peerApp.status, peerApp.accommodation_requested], ['submitted', true], 'an application that asks for an accommodation');
  const peerRow = (await api('owner', 'GET', O(`applications?mission=${missionA.id}&status=submitted`))).applications.find((a) => a.id === peerApp.id);
  eq([peerRow.accommodation_requested, Object.hasOwn(peerRow, 'accommodation'), JSON.stringify(peerRow).includes(REQUEST.statement)], [true, false, false], 'the owner row carries a flag, never the text');
  const readsBefore = (await plane.league.admin('select count(*)::int as n from public.eup_accommodation_reads where application_id = $1', [peerApp.id]))[0].n;
  const accommodation = (await api('owner', 'GET', O(`applications/${peerApp.id}/accommodation`))).accommodation;
  eq([accommodation.application_id, accommodation.applicant, accommodation.accommodation], [peerApp.id, ids.peer, REQUEST], 'the restricted read gives the owner the text');
  eq((await plane.league.admin('select count(*)::int as n, max(actor::text) as actor from public.eup_accommodation_reads where application_id = $1', [peerApp.id]))[0], { n: readsBefore + 1, actor: ids.owner },
    'evidence: the read was recorded with who read it, and no content');
  const peerDecided = (await api('owner', 'POST', O(`applications/${peerApp.id}/decision`), { idempotency_key: key('approve'), expected_revision: peerApp.revision, decision: 'approved' })).application;
  const peerAssignment = (await accept('peer', peerDecided.assignment.id, peerDecided.assignment.revision, POLICY.notices.participation.revision)).assignment;
  const peerProof = (await api('peer', 'POST', M(`assignments/${peerAssignment.id}/proof`), { idempotency_key: key('proof'), expected_revision: 0,
    proof: { title: 'Test fixture: written song', lyrics: LYRICS, credits: [{ name: 'Journey Fixture Peer', role: 'lyrics' }], rights: RIGHTS, accommodation: ACCOMMODATION, review_notice_revision: POLICY.notices.private_review.revision } })).proof;
  eq([peerProof.state, peerProof.media, peerProof.consent.purpose], ['submitted', [], 'private_review'], 'an accommodation proof: submitted privately, no media');
  const peerReview = await api('owner', 'GET', O(`proofs/${peerProof.id}/media?revision=1`));
  eq([peerReview.media, peerReview.proof.document.accommodation], [[], ACCOMMODATION], 'the review read of an accommodation proof: the statement, no link');
  const peerReviewed = (await decide('owner', peerProof.id, 1, { asset_revision: peerProof.asset_revision, ...PASS })).proof;
  eq([peerReviewed.state, peerReviewed.credit.participant], ['accepted', ids.peer], 'accepted on the same three dimensions');
  credits = (await api('owner', 'GET', O(`credits?mission=${missionA.id}`))).credits;
  eq(credits.map((c) => c.participant), [ids.tester, ids.peer], 'two credits on the mission');
  eq([sorted(credits[1]), credits[1].kind, credits[1].mission_id, credits[1].campaign_id], [sorted(credit), credit.kind, credit.mission_id, credit.campaign_id],
    'the accommodation proof earns the identical credit: the same fields, the same kind, nothing saying how the work was made');

  /* ================================================================== 10. needs changes, a retake, revision 2 */
  const appB = (await saveApplication('tester_b', missionB.id, 0, { submit: true, requirements_revision: 1, statement: 'Test fixture: campaign B.' })).application;
  const decidedB = (await api('owner', 'POST', O(`applications/${appB.id}/decision`), { idempotency_key: key('approve'), expected_revision: appB.revision, decision: 'approved' })).application;
  const assignmentB = (await accept('tester_b', decidedB.assignment.id, decidedB.assignment.revision, POLICY.notices.participation.revision)).assignment;
  async function record(as, assignmentId, bytes) {
    const started = await begin(as, assignmentId, { kind: 'audio', mime: 'audio/webm', bytes: bytes.byteLength });
    eq((await plane.fetch(started.grant.url, { method: started.grant.method, headers: started.grant.headers, body: bytes })).status, 200, `${as}: the take is stored`);
    const done = (await api(as, 'POST', M(`uploads/${started.upload.id}/complete`), {})).upload;
    eq([done.state, done.sha256], ['sealed', sha256(bytes)], `${as}: the take is sealed`);
    return done;
  }
  const take1 = synthAudio(700, 2);
  const take2 = synthAudio(720, 3);
  const u1 = await record('tester_b', assignmentB.id, take1);
  const songB = (media) => ({ title: 'Test fixture: campaign B song', lyrics: LYRICS, credits: CREDITS, rights: RIGHTS, media, review_notice_revision: POLICY.notices.private_review.revision });
  const proofB1 = (await api('tester_b', 'POST', M(`assignments/${assignmentB.id}/proof`), { idempotency_key: key('proof'), expected_revision: 0, proof: songB([{ upload_id: u1.id, sha256: u1.sha256 }]) })).proof;
  const changes = (await decide('owner', proofB1.id, 1, { asset_revision: proofB1.asset_revision, mission_decision: 'changes', rights_decision: 'pass', safety_decision: 'pass', reason: 'Test fixture: please record a second take.' })).proof;
  eq([changes.state, changes.review.decision, changes.credit], ['needs_changes', 'needs_changes', null], 'needs changes: no credit');
  meB = (await api('tester_b', 'GET', M())).league;
  eq(meB.assignments[0].proof.reviews.map((r) => [r.proof_revision, r.decision, r.reason]), [[1, 'needs_changes', 'Test fixture: please record a second take.']], 'the participant reads the decision and the reason');
  const u2 = await record('tester_b', assignmentB.id, take2);
  const proofB2 = (await api('tester_b', 'POST', M(`assignments/${assignmentB.id}/proof`), { idempotency_key: key('proof'), expected_revision: 1, proof: songB([{ upload_id: u2.id, sha256: u2.sha256 }]) })).proof;
  eq([proofB2.id, proofB2.revision, proofB2.state, proofB2.asset_revision !== proofB1.asset_revision], [proofB1.id, 2, 'submitted', true], 'the retake is revision 2 with a new digest');
  await decide('owner', proofB1.id, 1, { asset_revision: proofB1.asset_revision, ...PASS }, { status: 409, reason: 'revision_conflict', label: 'a review of revision 1 is refused' });
  await decide('owner', proofB1.id, 2, { asset_revision: proofB1.asset_revision, ...PASS }, { status: 409, reason: 'media_binding', label: 'revision 2 reviewed with the digest of revision 1 is refused' });
  await api('owner', 'GET', O(`proofs/${proofB1.id}/media?revision=1`), undefined, { status: 409, reason: 'revision_conflict', label: 'revision 1 no longer opens for review' });
  const reviewB2 = await api('owner', 'GET', O(`proofs/${proofB1.id}/media?revision=2`));
  eq(reviewB2.media.map((m) => [m.upload_id, m.sha256]), [[u2.id, sha256(take2)]], 'revision 2 plays the retake');
  eq(sha256(new Uint8Array(await (await plane.fetch(reviewB2.media[0].url)).arrayBuffer())), sha256(take2), 'and the link serves its bytes');
  const acceptedB = (await decide('owner', proofB1.id, 2, { asset_revision: proofB2.asset_revision, ...PASS })).proof;
  eq([acceptedB.state, acceptedB.credit.proof_revision, acceptedB.credit.asset_revision], ['accepted', 2, proofB2.asset_revision], 'revision 2 accepted: the credit names revision 2 and its digest');
  await api('tester_b', 'POST', M(`uploads/${u2.id}/discard`), { idempotency_key: key('discard') }, { status: 409, reason: 'media_binding', label: 'the take the accepted revision lists is not discarded' });
  const pathU1 = C.mediaObjectPath({ tenant: ids.owner, assignment: assignmentB.id, upload: u1.id, ext: 'webm' });
  ok(plane.storage.object(pathU1) !== null, 'evidence: the first take is still stored');
  eq((await api('tester_b', 'POST', M(`uploads/${u1.id}/discard`), { idempotency_key: key('discard') })).upload.state, 'discarded', 'the first take, no longer listed, is discarded');
  eq(plane.storage.object(pathU1), null, 'evidence: and its object deleted');

  /* ================================================================== 11. self-approval and self-review */
  const ownApp = (await saveApplication('owner', missionA.id, 0, { submit: true, requirements_revision: 1, statement: 'Test fixture: the owner takes part.' })).application;
  await api('owner', 'POST', O(`applications/${ownApp.id}/decision`), { idempotency_key: key('self-approve'), expected_revision: ownApp.revision, decision: 'approved' },
    { status: 403, reason: 'self_review_denied', label: 'the owner does not approve their own application' });
  const ownDecided = (await api('reviewer', 'POST', O(`applications/${ownApp.id}/decision`), { idempotency_key: key('approve'), expected_revision: ownApp.revision, decision: 'approved' })).application;
  eq([ownDecided.status, ownDecided.decided_by], ['approved', ids.reviewer], 'a second house owner approves it');
  const ownAssignment = (await accept('owner', ownDecided.assignment.id, ownDecided.assignment.revision, POLICY.notices.participation.revision)).assignment;
  const ownProof = (await api('owner', 'POST', M(`assignments/${ownAssignment.id}/proof`), { idempotency_key: key('proof'), expected_revision: 0,
    proof: { title: 'Test fixture: owner song', lyrics: LYRICS, credits: [{ name: 'Journey Fixture Owner', role: 'lyrics' }], rights: RIGHTS, accommodation: { statement: 'Test fixture: the owner writes it.' }, review_notice_revision: POLICY.notices.private_review.revision } })).proof;
  await decide('owner', ownProof.id, 1, { asset_revision: ownProof.asset_revision, ...PASS }, { status: 403, reason: 'self_review_denied', label: 'the owner does not review their own proof' });
  const ownReviewed = (await decide('reviewer', ownProof.id, 1, { asset_revision: ownProof.asset_revision, ...PASS })).proof;
  eq([ownReviewed.state, ownReviewed.review.reviewer, ownReviewed.credit.participant], ['accepted', ids.reviewer, ids.owner], 'a second house owner reviews it');

  /* ================================================================== 12. the module drained and disabled mid-journey */
  let missionA2 = (await api('owner', 'POST', O(`campaigns/${campaignA.id}/missions`), { idempotency_key: key('mission-2'), mission: { ...missionDocument(songFixture), slug: 'journey-second-song', title: 'Test fixture: a second song mission' } })).mission;
  missionA2 = (await api('owner', 'POST', O(`missions/${missionA2.id}/transition`), { idempotency_key: key('release-2'), expected_revision: missionA2.revision, to: 'released' })).mission;
  const app2 = (await saveApplication('tester', missionA2.id, 0, { submit: true, requirements_revision: 1, statement: 'Test fixture: a second song.' })).application;
  const decided2 = (await api('owner', 'POST', O(`applications/${app2.id}/decision`), { idempotency_key: key('approve'), expected_revision: app2.revision, decision: 'approved' })).application;
  const x2 = (await accept('tester', decided2.assignment.id, decided2.assignment.revision, POLICY.notices.participation.revision)).assignment;
  const staged = await begin('tester', x2.id, { kind: 'audio', mime: 'audio/webm', bytes: 600 });
  eq((await plane.fetch(staged.grant.url, { method: 'PUT', headers: staged.grant.headers, body: synthAudio(600, 4) })).status, 200, 'a take stored but not completed');
  const stagedPath = C.mediaObjectPath({ tenant: ids.owner, assignment: x2.id, upload: staged.upload.id, ext: 'webm' });
  const peerDraft = (await saveApplication('peer', missionA2.id, 0, { submit: false, requirements_revision: 1, statement: 'Test fixture: a draft.' })).application;
  const consent2 = (await grantConsent('tester', proof.id, 1, { ...CONSENT, expires_at: inDays(10) })).consent;
  const publication2 = (await publish(proof.id, 1, { decision: 'published', consent_id: consent2.id })).publication;
  eq([publication2.effective, (await api('peer', 'GET', M())).league.published.length], [true, 1], 'published again, seen by the audience');

  const setModule = async (state) => {
    const unit = (await api('owner', 'GET', '/v1/eup/modules')).modules.find((m) => m.moduleId === 'league');
    const answer = await api('owner', 'POST', '/v1/eup/modules/league/state', { idempotency_key: key(state), expected_revision: unit.revision, state, reason: `Journey test: set the League ${state}.` });
    eq(answer.receipt.policy.state, state, `the League module is ${state}`);
  };
  await setModule('draining');
  const DRAINING = { status: 503, reason: 'module_draining' };
  await saveDraft('tester', x2.id, 0, { title: 'Test fixture', lyrics: 'Line' }, { ...DRAINING, label: 'draining: no new draft' });
  await begin('tester', x2.id, { kind: 'audio', mime: 'audio/webm', bytes: 600 }, { ...DRAINING, label: 'draining: no new upload' });
  await api('tester', 'POST', M(`uploads/${staged.upload.id}/complete`), {}, { ...DRAINING, label: 'draining: the seal is new work' });
  ok(plane.storage.object(stagedPath) !== null, 'evidence: the refused seal kept the stored take');
  await saveApplication('peer', missionA2.id, peerDraft.revision, { submit: true, requirements_revision: 1, statement: 'Test fixture.' }, { ...DRAINING, label: 'draining: no application' });
  await api('owner', 'POST', O('campaigns'), { idempotency_key: key('campaign'), campaign: { slug: 'journey-late', title: 'Test fixture', purpose: 'Test fixture.' } }, { ...DRAINING, label: 'draining: no owner work either' });
  me = (await api('tester', 'GET', M())).league;
  eq([me.assignments.length, me.assignments[0].credit, me.assignments[1].uploads[0].state], [2, credit, 'staged'], 'draining: own records are readable');
  eq((await api('tester', 'POST', M(`assignments/${assignment.id}/proof`), proofBody())).proof, receipt.result, 'draining: an exact replay still answers');
  eq((await api('owner', 'GET', O(`credits?mission=${missionA.id}`))).credits.length, 3, 'draining: owner reads answer');
  const revoked2 = (await api('tester', 'POST', M(`consents/${consent2.id}/revoke`), { idempotency_key: key('revoke') })).consent;
  eq([revoked2.state, revoked2.publication.state, revoked2.publication.withdrawn_reason], ['revoked', 'withdrawn', 'consent_revoked'], 'draining: revocation still withdraws the publication');
  eq((await api('peer', 'POST', M(`applications/${peerDraft.id}/withdraw`), { idempotency_key: key('withdraw') })).application.status, 'withdrawn', 'draining: an application is still withdrawn');
  campaignB = (await api('owner', 'POST', O(`campaigns/${campaignB.id}/transition`), { idempotency_key: key('pause-b'), expected_revision: campaignB.revision, to: 'paused' })).campaign;
  eq(campaignB.state, 'paused', 'draining: the owner still pauses a campaign');

  await setModule('disabled');
  const DISABLED = { status: 409, reason: 'module_disabled' };
  await saveDraft('tester', x2.id, 0, { title: 'Test fixture', lyrics: 'Line' }, { ...DISABLED, label: 'disabled: no new draft' });
  await api('owner', 'POST', O(`campaigns/${campaignB.id}/transition`), { idempotency_key: key('resume-b'), expected_revision: campaignB.revision, to: 'released' }, { ...DISABLED, label: 'disabled: a release is new work' });
  eq((await api('tester', 'POST', M(`uploads/${staged.upload.id}/discard`), { idempotency_key: key('discard') })).upload.state, 'discarded', 'disabled: an upload is still discarded');
  eq(plane.storage.object(stagedPath), null, 'evidence: and its object deleted');
  eq((await api('tester', 'POST', M(`assignments/${x2.id}/withdraw`), { idempotency_key: key('withdraw') })).assignment.status, 'withdrawn', 'disabled: an assignment is still withdrawn');
  me = (await api('tester', 'GET', M())).league;
  eq([me.assignments[0].status, me.assignments[1].status], ['completed', 'withdrawn'], 'disabled: own records are readable');

  await setModule('enabled');
  campaignB = (await api('owner', 'POST', O(`campaigns/${campaignB.id}/transition`), { idempotency_key: key('resume-b'), expected_revision: campaignB.revision, to: 'released' })).campaign;
  eq(campaignB.state, 'released', 're-enabled: owner work resumes');
  const peerAgain = (await saveApplication('peer', missionA2.id, peerDraft.revision + 1, { submit: true, requirements_revision: 1, statement: 'Test fixture: back again.' })).application;
  eq(peerAgain.status, 'submitted', 're-enabled: member work resumes');

  /* ================================================================== 13. the campaign withdrawn at the end */
  campaignA = (await api('owner', 'GET', O('campaigns'))).campaigns.find((c) => c.id === campaignA.id);
  const withdrawnA = (await api('owner', 'POST', O(`campaigns/${campaignA.id}/transition`), { idempotency_key: key('withdraw-campaign'), expected_revision: campaignA.revision, to: 'withdrawn' })).campaign;
  eq(withdrawnA.state, 'withdrawn', 'campaign A withdrawn');
  await api('owner', 'POST', O(`campaigns/${campaignA.id}/transition`), { idempotency_key: key('revive'), expected_revision: withdrawnA.revision, to: 'released' }, { status: 422, reason: 'invalid', label: 'withdrawn is final' });
  me = (await api('tester', 'GET', M())).league;
  eq([me.catalogue.map((c) => c.id), me.assignments.map((a) => a.status), me.assignments[0].credit], [[], ['completed', 'withdrawn'], credit], 'own records and the credit stay; the catalogue is empty');
  const peerMe = (await api('peer', 'GET', M())).league;
  eq(peerMe.applications.find((a) => a.id === peerAgain.id).status, 'declined', 'an open application is declined by the withdrawal');
  eq(peerMe.applications.find((a) => a.id === peerAgain.id).decisions.at(-1).reason, 'campaign_withdrawn', 'with the reason the contract names for a campaign cascade');
  await saveApplication('peer', missionA2.id, peerAgain.revision + 1, { submit: true, requirements_revision: 1, statement: 'Test fixture.' }, { status: 404, label: 'withdrawn: no new work' });
  eq((await api('owner', 'GET', O(`credits?mission=${missionA.id}`))).credits.map((c) => c.participant), [ids.tester, ids.peer, ids.owner], 'every credit stays');

  /* ================================================================== 14. evidence: the outbox, nothing public, storage */
  const events = [];
  for (let after = 0; ;) {
    const page = (await api('owner', 'GET', O(`outbox?after=${after}&limit=200`))).events;
    events.push(...page);
    if (page.length < 200) break;
    after = page.at(-1).seq;
  }
  const ACTION_NAMES = new Set([...Object.keys(C.OWNER_ACTIONS), ...Object.keys(C.MEMBER_ACTIONS), ...Object.keys(C.MEDIA_SEAL)]);
  const VALUE = { uuid: (v) => typeof v === 'string' && C.PATTERNS.uuid.test(v), int: Number.isSafeInteger, sha256: (v) => typeof v === 'string' && C.PATTERNS.sha256.test(v) };
  const valueOk = (v) => VALUE.uuid(v) || VALUE.int(v) || VALUE.sha256(v) || (Array.isArray(v) && v.every(VALUE.uuid));
  const badEvents = events.filter((e) => !e.type.startsWith(C.OUTBOX.type_prefix) || !ACTION_NAMES.has(e.type.slice(C.OUTBOX.type_prefix.length))
    || !Object.entries(e.payload).every(([k, v]) => C.OUTBOX.payload_keys.includes(k) && valueOk(v)));
  eq(badEvents, [], `the outbox: ${events.length} events, each league.<action> with ids and revisions only`);
  // One event per committed mutation: each distinct (function, actor, action, key) that answered 200 (a replay reuses
  // its key and writes nothing; outbox.ack writes none), plus each seal that answered 200 (every seal here changed a
  // staged row). Taken from the plane's record of the RPCs the Worker made.
  const committed = new Set(plane.rpcLog.filter((c) => (c.name === C.RPC.owner || c.name === C.RPC.member) && c.status === 200 && c.key !== null && c.action !== 'outbox.ack')
    .map((c) => `${c.name}|${c.actor}|${c.action}|${c.key}`));
  const seals = plane.rpcLog.filter((c) => c.name === C.RPC.seal && c.status === 200).length;
  eq(events.length, committed.size + seals, `one event per committed mutation (${committed.size} commands and ${seals} seals)`);
  eq(events.filter((e) => e.type === 'league.proofs.submit' && e.payload.assignment_id === assignment.id).length, 1, 'the lost answer and its resends wrote one event');
  const ack = (await api('owner', 'POST', O(`outbox/${events[0].seq}/ack`), { idempotency_key: key('ack'), consumer: 'journey-consumer' })).consumption;
  eq((await api('owner', 'POST', O(`outbox/${events[0].seq}/ack`), { idempotency_key: key('ack'), consumer: 'journey-consumer' })).consumption, ack, 'acknowledging twice keeps one consumption');
  eq((await api('owner', 'GET', O('outbox?after=0&limit=2&consumer=journey-consumer'))).events.map((e) => e.consumed), [true, false], 'the consumer sees what it acknowledged');
  for (const relation of LEAGUE_DECOYS) {
    eq((await plane.league.admin(`select count(*)::int as n from ${relation}`))[0].n, relation === 'storage.buckets' ? 1 : 0, `evidence: ${relation} untouched`);
  }
  const PATH = new RegExp(`^league/v1/t/${ids.owner}/a/[0-9a-f-]{36}/u/[0-9a-f-]{36}\\.webm$`);
  eq(plane.storage.paths().filter((p) => !PATH.test(p)), [], 'evidence: every stored object sits at the path of its own row ids');
  const overview = await api('owner', 'GET', '/v1/eup/overview');
  eq([overview.league.status, overview.campaigns.withdrawn, overview.campaigns.released, overview.league.policy.valid], ['available', 1, 1, true], 'the Overview reads the same store');

  console.log(`${count} journey assertions passed.`);
} finally {
  await plane.close();
}
