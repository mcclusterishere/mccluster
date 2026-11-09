// Environmental Justice League admin-only intake against the actual pending SQL and Worker handler in isolated PGlite.
// Proves: apply → rollback → re-apply; owner CAS/capacity/idempotency; self-review denial; pause/withdraw recovery;
// anon/authenticated denial; and that no admin-intake row lands in the public projections.
import assert from 'node:assert/strict';
import { createLeagueDatabase, OWNER, PEER, REVIEWER } from './support/eup-league-database.mjs';
const { db, as, rpc, handle, apply, rollback, close } = await createLeagueDatabase();
let count = 0;
const ok = (c, m) => { assert.ok(c, m); count++; };
async function rejects(fn, code, m) { await assert.rejects(fn, (e) => e.code === code, m); count++; }
const key = (s) => `k-${s}-00000000`;
try {
  // schema is re-creatable: rollback then apply again (plain CREATE, so twice means via rollback)
  await rollback(); await apply(); ok(true, 'rollback and re-apply');
  // denial before any data
  await rejects(() => rpc({ p_action: 'campaigns.list', p_actor: PEER }), '42501', 'member is not the house owner');
  await rejects(() => as('anon', () => db.query('select * from public.eup_campaigns')), '42501', 'anon cannot read');
  await rejects(() => as('authenticated', () => db.query("select public.eup_league_command('campaigns.list',$1,'',null,null,null)", [OWNER])), '42501', 'authenticated cannot execute');
  // campaign draft with idempotency
  const cDoc = { slug: 'environmental-justice-league', title: 'Environmental Justice League', purpose: 'First gamified campaign.', audience: 'admin_preview' };
  const c1 = await rpc({ p_action: 'campaigns.create', p_actor: OWNER, p_document: cDoc, p_key: key('c1') });
  const c1b = await rpc({ p_action: 'campaigns.create', p_actor: OWNER, p_document: cDoc, p_key: key('c1') });
  ok(c1.id === c1b.id && c1.state === 'draft' && c1.revision === 1, 'idempotent replay returns the same draft');
  await rejects(() => rpc({ p_action: 'campaigns.create', p_actor: OWNER, p_document: { ...cDoc, title: 'Other' }, p_key: key('c1') }), 'EU003', 'key reuse with a different payload fails');
  await rejects(() => rpc({ p_action: 'campaigns.create', p_actor: OWNER, p_document: { ...cDoc, slug: 'x-ejl' }, p_key: key('c-bad') }).then(() => rpc({ p_action: 'campaigns.create', p_actor: OWNER, p_document: { ...cDoc, slug: 'x-ejl' }, p_key: key('c-bad2') })), '23505', 'duplicate slug refused');
  await rejects(() => rpc({ p_action: 'campaigns.create', p_actor: OWNER, p_document: { ...cDoc, slug: 'paid', points_policy: { per: 10 } }, p_key: key('c-pts') }), '22023', 'points policy is a separate decision');
  ok((await rpc({ p_action: 'campaigns.list', p_actor: OWNER })).length === 2, 'owner lists drafts');
  // mission under the campaign
  const mDoc = { slug: 'write-a-song', template: 'write-a-song', title: 'Write a song for a healthier world', proof_modes: ['audio', 'lyrics'], capacity: 1, requirements: 'Original song, lyrics, credits, rights declaration.' };
  const m1 = await rpc({ p_action: 'missions.create', p_actor: OWNER, p_id: c1.id, p_document: mDoc, p_key: key('m1') });
  ok(m1.state === 'draft' && m1.capacity === 1 && m1.revision === 1, 'mission draft');
  await rejects(() => rpc({ p_action: 'missions.create', p_actor: OWNER, p_id: c1.id, p_document: { ...mDoc, slug: 'bad', proof_modes: ['stream'] }, p_key: key('m-bad') }), '22023', 'unknown proof mode');
  await rejects(() => rpc({ p_action: 'missions.transition', p_actor: OWNER, p_id: m1.id, p_document: { to: 'released' }, p_revision: 1, p_key: key('m1-rel-early') }), '22023', 'mission cannot release before the campaign');
  await rejects(() => rpc({ p_action: 'campaigns.transition', p_actor: OWNER, p_id: c1.id, p_document: { to: 'released' }, p_revision: 7, p_key: key('c1-stale') }), '40001', 'stale campaign revision');
  const c1r = await rpc({ p_action: 'campaigns.transition', p_actor: OWNER, p_id: c1.id, p_document: { to: 'released' }, p_revision: 1, p_key: key('c1-rel') });
  ok(c1r.state === 'released' && c1r.revision === 2, 'campaign released with CAS');
  const m1r = await rpc({ p_action: 'missions.transition', p_actor: OWNER, p_id: m1.id, p_document: { to: 'released' }, p_revision: 1, p_key: key('m1-rel') });
  ok(m1r.state === 'released' && m1r.revision === 2, 'mission released');
  // applications: two applicants, capacity 1 → second approval refused atomically
  const a1 = await rpc({ p_action: 'applications.create', p_actor: OWNER, p_id: m1.id, p_document: { applicant: PEER, note: 'I write songs.', accommodation: { needs: 'private' } }, p_revision: 2, p_key: key('a1') });
  ok(a1.status === 'submitted' && !('accommodation' in a1), 'application recorded; accommodation never echoed');
  await rejects(() => rpc({ p_action: 'applications.create', p_actor: OWNER, p_id: m1.id, p_document: { applicant: PEER }, p_revision: 2, p_key: key('a1-dup') }), '23505', 'one application per applicant');
  const a2 = await rpc({ p_action: 'applications.create', p_actor: OWNER, p_id: m1.id, p_document: {}, p_revision: 2, p_key: key('a2') });
  ok(a2.applicant === OWNER, 'default applicant is the acting owner');
  const [d1, d2] = await Promise.all([
    rpc({ p_action: 'applications.decide', p_actor: REVIEWER, p_id: a1.id, p_document: { decision: 'approved' }, p_revision: 1, p_key: key('d1') }),
    rpc({ p_action: 'applications.decide', p_actor: REVIEWER, p_id: a2.id, p_document: { decision: 'approved' }, p_revision: 1, p_key: key('d2') }).catch((e) => e)
  ]);
  ok(d1.status === 'approved' && d1.assignment?.participant === PEER, 'first approval creates the assignment');
  ok(d2 instanceof Error && d2.code === 'EU001', 'capacity 1 refuses the second approval');
  ok((await db.query('select count(*)::int as n from eup_assignments')).rows[0].n === 1, 'exactly one assignment');
  await rejects(() => rpc({ p_action: 'applications.decide', p_actor: REVIEWER, p_id: a1.id, p_document: { decision: 'declined' }, p_revision: 2, p_key: key('d1-again') }), '40001', 'already decided');
  // acceptance is version-bound and participant-only
  const s1 = d1.assignment;
  await rejects(() => rpc({ p_action: 'assignments.accept', p_actor: OWNER, p_id: s1.id, p_document: {}, p_revision: 1, p_key: key('acc-owner') }), '42501', 'only the participant accepts');
  const s1a = await rpc({ p_action: 'assignments.accept', p_actor: PEER, p_id: s1.id, p_document: {}, p_revision: 1, p_key: key('acc') }).catch((e) => e);
  ok(s1a instanceof Error && s1a.code === '42501', 'a non-owner participant cannot reach the command (admin-only release)');
  // Admin-only release: make PEER a house owner for the rest of the loop (the owner acts as participant in preview).
  await db.exec(`update org_members set role='owner' where profile_id='${PEER}'`);
  const s1acc = await rpc({ p_action: 'assignments.accept', p_actor: PEER, p_id: s1.id, p_document: {}, p_revision: 1, p_key: key('acc2') });
  ok(s1acc.status === 'accepted' && s1acc.accepted_revision === 2, 'acceptance binds the mission revision');
  // pause → assignment paused → re-release restores it
  const m1p = await rpc({ p_action: 'missions.transition', p_actor: OWNER, p_id: m1.id, p_document: { to: 'paused' }, p_revision: 2, p_key: key('m1-pause') });
  ok((await rpc({ p_action: 'assignments.list', p_actor: OWNER, p_id: m1.id }))[0].status === 'paused', 'pause pauses assignments');
  await rejects(() => rpc({ p_action: 'proofs.submit', p_actor: PEER, p_id: s1.id, p_document: { mode: 'lyrics', body: 'la', credits: 'me', rights_declaration: 'original' }, p_key: key('p-paused') }), '22023', 'no proof while paused');
  await rpc({ p_action: 'missions.transition', p_actor: OWNER, p_id: m1.id, p_document: { to: 'released' }, p_revision: m1p.revision, p_key: key('m1-rel2') });
  ok((await rpc({ p_action: 'assignments.list', p_actor: OWNER, p_id: m1.id }))[0].status === 'accepted', 're-release restores accepted assignments');
  // proof: mode must be allowed; song needs credits + rights; no location
  await rejects(() => rpc({ p_action: 'proofs.submit', p_actor: PEER, p_id: s1.id, p_document: { mode: 'link', url: 'https://example.invalid/x', credits: 'me', rights_declaration: 'original' }, p_key: key('p-mode') }), '22023', 'link is not an allowed mode here');
  await rejects(() => rpc({ p_action: 'proofs.submit', p_actor: PEER, p_id: s1.id, p_document: { mode: 'lyrics', body: 'la la', credits: 'me', rights_declaration: 'original', gps: [1, 2] }, p_key: key('p-gps') }), '22023', 'precise location refused');
  await rejects(() => rpc({ p_action: 'proofs.submit', p_actor: PEER, p_id: s1.id, p_document: { mode: 'lyrics', body: 'la la' }, p_key: key('p-rights') }), '22023', 'song proof needs credits and rights');
  const p1 = await rpc({ p_action: 'proofs.submit', p_actor: PEER, p_id: s1.id, p_document: { mode: 'lyrics', body: 'Verse one about clean air.', credits: 'Synthetic Participant', rights_declaration: 'original' }, p_key: key('p1') });
  ok(p1.state === 'submitted' && p1.revision === 1 && p1.publication_state === 'private', 'proof submitted privately');
  await rejects(() => rpc({ p_action: 'proofs.review', p_actor: PEER, p_id: p1.id, p_document: { decision: 'accepted' }, p_revision: 1, p_key: key('r-self') }), 'EU002', 'no self-review');
  const r1 = await rpc({ p_action: 'proofs.review', p_actor: REVIEWER, p_id: p1.id, p_document: { decision: 'needs_changes', reason: 'Add the chorus.' }, p_revision: 1, p_key: key('r1') });
  ok(r1.state === 'needs_changes' && r1.review.proof_revision === 1, 'review bound to revision 1');
  const p2 = await rpc({ p_action: 'proofs.submit', p_actor: PEER, p_id: s1.id, p_document: { mode: 'lyrics', body: 'Verse one and a chorus.', credits: 'Synthetic Participant', rights_declaration: 'original' }, p_revision: 1, p_key: key('p2') });
  ok(p2.revision === 2 && p2.state === 'submitted', 'resubmission is revision 2');
  await rejects(() => rpc({ p_action: 'proofs.review', p_actor: REVIEWER, p_id: p1.id, p_document: { decision: 'accepted' }, p_revision: 1, p_key: key('r-stale') }), '40001', 'stale proof revision refused');
  const r2 = await rpc({ p_action: 'proofs.review', p_actor: REVIEWER, p_id: p1.id, p_document: { decision: 'accepted' }, p_revision: 2, p_key: key('r2') });
  ok(r2.state === 'accepted' && r2.reviewed_revision === 2, 'accepted at revision 2');
  ok((await rpc({ p_action: 'assignments.list', p_actor: OWNER, p_id: m1.id }))[0].status === 'completed', 'acceptance completes the assignment');
  // consent is exact and revocable; publication_state stays private
  await rejects(() => rpc({ p_action: 'consents.set', p_actor: REVIEWER, p_id: p1.id, p_document: { purpose: 'publish_proof', audience: 'public', notice_revision: 'n1', granted: true }, p_revision: 2, p_key: key('k-rev') }), '42501', 'only the participant consents');
  const k1 = await rpc({ p_action: 'consents.set', p_actor: PEER, p_id: p1.id, p_document: { purpose: 'publish_proof', audience: 'public', notice_revision: 'n1', granted: true }, p_revision: 2, p_key: key('k1') });
  ok(k1.granted === true && k1.proof_revision === 2 && k1.revoked_at === null, 'consent binds exact revision');
  await rpc({ p_action: 'consents.set', p_actor: PEER, p_id: p1.id, p_document: { purpose: 'publish_proof', audience: 'public', notice_revision: 'n1', granted: false }, p_revision: 2, p_key: key('k2') });
  const consents = await rpc({ p_action: 'consents.list', p_actor: OWNER, p_id: p1.id });
  ok(consents.length === 1 && consents[0].revoked_at !== null, 'revocation closes the grant');
  ok((await rpc({ p_action: 'proofs.list', p_actor: OWNER, p_id: s1.id }))[0].publication_state === 'private', 'publication never happens here');
  // withdraw: open applications declined, assignments withdrawn, receipts intact
  const m1w = await rpc({ p_action: 'missions.transition', p_actor: OWNER, p_id: m1.id, p_document: { to: 'withdrawn' }, p_revision: (await rpc({ p_action: 'missions.list', p_actor: OWNER, p_id: c1.id }))[0].revision, p_key: key('m1-wd') });
  ok(m1w.state === 'withdrawn', 'mission withdrawn');
  ok((await rpc({ p_action: 'applications.list', p_actor: OWNER, p_id: m1.id, p_document: { status: 'declined' } })).length === 1, 'open applications declined on withdrawal');
  ok((await db.query('select count(*)::int as n from eup_command_receipts')).rows[0].n > 10, 'receipts retained');
  // public projections untouched
  for (const t of ['action_missions', 'network_groups', 'action_policy_bills']) ok((await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n === 0, `${t} untouched`);
  // overview
  const ov = await rpc({ p_action: 'overview', p_actor: OWNER });
  ok(ov.campaigns.released === 1 && ov.queues.applications === 0 && ov.queues.proofs === 0, 'overview counts');
  // Worker routes over the same database
  const h = (path, init = {}) => handle(new Request('https://local.invalid/v1/eup/' + path, { headers: { authorization: 'Bearer local-owner', 'content-type': 'application/json' }, ...init }));
  let r = await h('league/campaigns'); ok(r.status === 200 && (await r.json()).campaigns.length === 2, 'GET campaigns');
  r = await h('league/campaigns', { method: 'POST', body: JSON.stringify({ campaign: { slug: 'second', title: 'Second', purpose: 'p' } }) }); ok(r.status === 400 && (await r.json()).reason === 'idempotency_key_required', 'key required');
  r = await h('league/campaigns', { method: 'POST', body: JSON.stringify({ idempotency_key: 'route-c2-0001', campaign: { slug: 'second', title: 'Second', purpose: 'p' } }) }); const c2 = (await r.json()).campaign; ok(r.status === 200 && c2.state === 'draft', 'POST campaign');
  r = await h(`league/campaigns/${c2.id}/transition`, { method: 'POST', body: JSON.stringify({ idempotency_key: 'route-c2-rel1', to: 'released', expected_revision: 9 }) }); ok(r.status === 409 && (await r.json()).reason === 'revision_conflict', 'stale → 409');
  r = await h(`league/campaigns/${c2.id}/missions`, { method: 'POST', body: JSON.stringify({ idempotency_key: 'route-m2-0001', mission: { ...mDoc, slug: 'explain-a-source', template: 'explain-a-source', proof_modes: ['text'] } }) }); ok(r.status === 200, 'POST mission');
  r = await h('league/overview'); ok(r.status === 404, 'no stray league route');
  r = await h('overview'); const o = await r.json(); ok(r.status === 200 && o.modules.find((m) => m.id === 'consumer_environment').state === 'held' && o.campaigns.drafts === 2, 'overview route');
  r = await handle(new Request('https://local.invalid/v1/eup/league/campaigns', { headers: { authorization: 'Bearer member' } })); ok(r.status === 403, 'member denied at the route');
  r = await h('league/publish', { method: 'POST', body: '{}' }); ok(r.status === 501, 'publication is not implemented');
  console.log(`${count} league assertions passed.`);
} finally { await close(); }
