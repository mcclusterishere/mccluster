/* Control · System · E=Up › Environmental Justice League tab (js/control-room/eup-league.js, mounted by
   js/control-room/eup.js). Synthetic DOM and an in-memory stand-in for the OWNER routes of the frozen League contract
   (workers/mccluster/src/eup/league-contract.js). The stand-in answers with rows that carry exactly the contract's
   shape keys (checked below), keeps receipts by key and compares revisions where the contract's route does; it is a
   fixture, not the Worker and not the SQL. The real router over the real pending SQL drives the same tab in a browser
   in scripts/e2e/control-eup.e2e.mjs.
   Proves: the tab's route table, limits, lifecycle and card fields equal the contract's; the policy check agrees with
   checkDocument; every command carries a fresh key and an expected revision exactly where the route compares one; a
   timed-out or lost command is an unknown outcome that is never resent and is settled by reading its receipt; a 403
   owner_required conceals the workspace and a 403 self_review_denied does not; signed media links live only in the
   media element and memory and are dropped on a League view switch, an E=Up tab switch, an account change and
   expiry (counted from when the read was sent); rendered fields are the contract's (state, publication_state,
   moderation_state, reviews). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as C from '../../workers/mccluster/src/eup/league-contract.js';

/* ---------- a flat DOM: innerHTML is parsed into attribute-bearing elements ---------- */
const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
class El extends EventTarget {
  constructor(tag, attrs, inner) {
    super();
    this.tag = tag || 'div'; this.attrs = attrs || {}; this.inner = inner || ''; this.kids = []; this.children = []; this.dataset = {}; this.isConnected = true;
    this.parentNode = null; this.paused = true; this.loads = 0; this._html = '';
    this.checked = Object.hasOwn(this.attrs, 'checked');
    if (this.tag === 'textarea') this.value = decode(this.inner);
    else if (this.tag === 'select') { const sel = /<option value="([^"]*)" selected>/.exec(this.inner) || /<option value="([^"]*)"/.exec(this.inner); this.value = sel ? decode(sel[1]) : ''; }
    else this.value = this.attrs.value === undefined ? '' : this.attrs.value;
  }
  get type() { return this.tag === 'input' ? (this.attrs.type || 'text') : this.tag === 'select' ? 'select-one' : this.tag; }
  set innerHTML(s) { this._html = String(s); this.kids = parse(this._html); this.kids.forEach((k) => { k.owner = this.kids; }); }
  get innerHTML() { return this._html; }
  get textContent() { return decode((this.kids.length ? this._html : this.inner).replace(/<[^>]+>/g, ' ')); }
  set textContent(v) { this.inner = String(v); this._html = ''; this.kids = []; }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelectorAll(sel) {
    const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel); if (!m) throw new Error('flat DOM selector not supported: ' + sel);
    const pool = this.kids.length ? this.kids : (this.owner || []);
    return pool.filter((k) => k !== this && Object.hasOwn(k.attrs, m[1]) && (m[2] === undefined || k.attrs[m[1]] === m[2]));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  appendChild(el) { if (el.parentNode) el.parentNode.removeChild(el); this.children.push(el); el.parentNode = this; return el; }
  removeChild(el) { this.children = this.children.filter((x) => x !== el); el.parentNode = null; return el; }
  pause() { this.paused = true; }
  load() { this.loads += 1; }
  focus() { document.activeElement = this; }
  click() { if (this.onclick) return this.onclick(); }
}
function parse(html) {
  const out = []; const re = /<([a-z][a-z0-9]*)\b([^>]*)>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = {}; for (const a of m[2].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]);
    const close = html.indexOf('</' + m[1] + '>', re.lastIndex);
    out.push(new El(m[1], attrs, close > 0 ? html.slice(re.lastIndex, close) : ''));
  }
  return out;
}
const created = [];
globalThis.window = new EventTarget();
window.crypto = globalThis.crypto; window.CR = {};
globalThis.document = { activeElement: null, createElement: (tag) => { const el = new El(tag); created.push(el); return el; } };
const flush = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 12; i += 1) await flush(); };
const source = await readFile(new URL('../../js/control-room/eup-league.js', import.meta.url), 'utf8');
await import('../../js/control-room/eup-league.js');
await import('../../js/control-room/eup.js');
const E = window.CR.eup, H = window.CR.eupLeague.helpers;

/* ---------- the stand-in for the owner routes ---------- */
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const OWNER = U(1), TESTER = U(2), PEER = U(3), TENANT = U(9);
const SHA = (n) => String(n).repeat(64).slice(0, 64);
const T0 = '2026-11-10T12:00:00.000Z';
const http = (status, reason, message) => Object.assign(new Error(message || reason || 'HTTP ' + status), { status, detail: reason ? { ok: false, error: message || reason, reason } : null });
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const notice = (id) => ({ revision: 'unit-' + id + '-1', text: 'TEST FIXTURE ' + id + ' notice for the Control League unit test.\nNot policy text.' });
const POLICY = { entitlement: 'none_required', media: { enabled: true, kinds: ['audio'], audio_max_bytes: 4096, max_duration_seconds: 60 }, retention: { completed_days: 30, withdrawn_days: 7 },
  notices: { participation: notice('participation'), private_review: notice('private-review'), publication: notice('publication') } };
const FIXTURE = { schema: 'ejl.campaign-draft/v1', slug: 'unit-fixture-campaign', title: 'Test fixture campaign', purpose: 'A synthetic campaign for the unit test.', missions: [
  { slug: 'write-a-song', template: 'write-a-song', title: 'Test fixture song mission', proof_modes: ['audio', 'video', 'lyrics'], requirements: 'Test fixture requirements.', acceptance: 'Test fixture acceptance.' },
  { slug: 'explain-a-source', template: 'explain-a-source', title: 'Test fixture source mission', proof_modes: ['text', 'link'], requirements: 'Test fixture requirements.', acceptance: 'Test fixture acceptance.' }] };
const ROW = (id) => ({ id, tenant: TENANT, created_at: T0, updated_at: T0 });

function leagueWorker({ module = { installed: true, state: 'enabled', revision: 1 } } = {}) {
  const s = { policy: { revision: 0, document: null, valid: false, updated_by: null, updated_at: null }, campaigns: [], missions: [], grants: [], applications: [], assignments: [], proofs: [], uploads: [],
    consents: [], publications: [], appeals: [], credits: [], due: [], receipts: new Map(), seq: 1000, hooks: {}, accommodationReads: 0, mediaReads: 0, expiresIn: C.MEDIA.signed_read_seconds };
  const log = [];
  const id = () => U((s.seq += 1));
  const mission = (mid) => s.missions.find((m) => m.id === mid);
  const seats = (mid) => s.assignments.filter((a) => a.mission_id === mid && C.ENUMS.SEAT_STATUSES.includes(a.status)).length;
  const missionRow = (m) => ({ ...m, assigned: seats(m.id) });
  const card = (m) => { const c = s.campaigns.find((x) => x.id === m.campaign_id); return { id: m.id, campaign_id: m.campaign_id, slug: m.slug, title: m.title, template: m.template, state: m.state, open: m.state === 'released' && c.state === 'released',
    requirements_revision: m.requirements_revision, requirements: m.document.requirements, acceptance: m.document.acceptance ?? null, proof_modes: m.proof_modes, rubric: m.document.rubric ?? {}, capacity: m.capacity, seats_taken: seats(m.id) }; };
  const proofRow = (p) => { const { document, media, reviews, uploads, ...row } = p; return row; };
  const proofOut = (p) => ({ ...proofRow(p), document: p.document, media: p.media, reviews: p.reviews });
  /* one keyed command: replay by key, compare the revision where the route does, then apply */
  function command(action, rid, body, apply, revisionOf) {
    if (typeof body?.idempotency_key !== 'string' || !C.PATTERNS.idempotency_key.test(body.idempotency_key)) throw http(400, 'idempotency_key_required');
    const route = C.ROUTES.find((r) => r.surface === 'owner' && r.action === action);
    const { idempotency_key: key, ...rest } = body;
    const digest = JSON.stringify([rid, rest]);
    const prior = s.receipts.get(action + '|' + key);
    if (prior) { if (prior.digest !== digest) throw http(409, 'idempotency_conflict'); return clone(prior.receipt.result); }
    if (route.expected_revision) {
      if (!Number.isSafeInteger(body.expected_revision)) throw http(400, 'expected_revision_required');
      if (revisionOf && body.expected_revision !== revisionOf()) throw http(409, 'revision_conflict');
    }
    const result = apply();
    s.receipts.set(action + '|' + key, { digest, receipt: { surface: 'owner', operation: action, idempotency_key: key, result: clone(result), created_at: T0 } });
    return clone(result);
  }
  const lifecycle = (row, to) => { if (!(C.STATE_MACHINES.campaign.transitions.some((t) => t.from === row.state && t.to === to))) throw http(422, 'invalid'); };
  const routes = {
    'GET policy': () => ({ policy: clone(s.policy) }),
    'POST policy': (b) => ({ policy: command('policy.set', '', b, () => {
      if (C.checkDocument(C.DOCUMENTS.policy_set, { policy: b.policy, reason: b.reason })) throw http(422, 'invalid');
      s.policy = { revision: s.policy.revision + 1, document: clone(b.policy), valid: true, updated_by: OWNER, updated_at: T0 }; return s.policy;
    }, () => s.policy.revision) }),
    'GET fixture': () => ({ fixture: clone(FIXTURE) }),
    'GET campaigns': () => ({ campaigns: s.campaigns.map((c) => ({ ...clone(c), missions: s.missions.filter((m) => m.campaign_id === c.id).map(missionRow) })) }),
    'POST campaigns': (b) => ({ campaign: command('campaigns.create', '', b, () => {
      if (C.checkDocument(C.DOCUMENTS.campaign_create, b.campaign)) throw http(422, 'invalid');
      if (s.campaigns.some((c) => c.slug === b.campaign.slug)) throw http(409, 'exists');
      const c = { ...ROW(id()), slug: b.campaign.slug, title: b.campaign.title, state: 'draft', audience: 'admin_preview', revision: 1, document: clone(b.campaign), created_by: OWNER };
      s.campaigns.push(c); return c;
    }) }),
    'POST campaigns/:id/transition': (b, cid) => { const c = s.campaigns.find((x) => x.id === cid); if (!c) throw http(404, 'not_found');
      return { campaign: command('campaigns.transition', cid, b, () => { lifecycle(c, b.to); c.state = b.to; c.revision += 1; return c; }, () => c.revision) }; },
    'POST campaigns/:id/audience': (b, cid) => { const c = s.campaigns.find((x) => x.id === cid); if (!c) throw http(404, 'not_found');
      return { campaign: command('campaigns.audience.set', cid, b, () => { if (!C.ENUMS.AUDIENCES.includes(b.audience)) throw http(422, 'invalid'); c.audience = b.audience; c.revision += 1; return c; }, () => c.revision) }; },
    'GET campaigns/:id/audience/grants': (b, cid) => ({ grants: clone(s.grants.filter((g) => g.campaign_id === cid)) }),
    'POST campaigns/:id/audience/grants': (b, cid) => ({ grant: command('audience.grants.grant', cid, b, () => {
      if (C.checkDocument(C.DOCUMENTS.grant, b.grant)) throw http(422, 'invalid');
      if (s.grants.some((g) => g.campaign_id === cid && g.account === b.grant.account && g.state === 'open')) throw http(409, 'exists');
      const g = { id: id(), tenant: TENANT, campaign_id: cid, account: b.grant.account, state: 'open', note: b.grant.note ?? null, granted_by: OWNER, granted_at: T0, revoked_by: null, revoked_at: null };
      s.grants.push(g); return g;
    }) }),
    'POST audience/grants/:id/revoke': (b, gid) => { const g = s.grants.find((x) => x.id === gid); if (!g) throw http(404, 'not_found');
      return { grant: command('audience.grants.revoke', gid, b, () => { if (g.state !== 'open') throw http(409, 'revision_conflict'); g.state = 'revoked'; g.revoked_by = OWNER; g.revoked_at = T0; return g; }) }; },
    'POST campaigns/:id/missions': (b, cid) => ({ mission: command('missions.create', cid, b, () => {
      if (C.checkDocument(C.DOCUMENTS.mission_create, b.mission)) throw http(422, 'invalid');
      const m = { ...ROW(id()), campaign_id: cid, slug: b.mission.slug, title: b.mission.title, template: b.mission.template, state: 'draft', revision: 1, requirements_revision: 1, capacity: b.mission.capacity ?? null,
        proof_modes: b.mission.proof_modes, document: clone(b.mission), created_by: OWNER };
      s.missions.push(m); return missionRow(m);
    }) }),
    'PATCH missions/:id': (b, mid) => { const m = mission(mid); if (!m) throw http(404, 'not_found');
      return { mission: command('missions.update', mid, b, () => {
        if (C.checkDocument(C.DOCUMENTS.mission_update, b.mission)) throw http(422, 'invalid');
        if (b.mission.capacity !== undefined && b.mission.capacity !== null && b.mission.capacity < seats(mid)) throw http(409, 'capacity_exhausted');
        if (C.REQUIREMENTS_FIELDS.some((f) => b.mission[f] !== undefined && JSON.stringify(b.mission[f]) !== JSON.stringify(f === 'proof_modes' ? m.proof_modes : m.document[f]))) m.requirements_revision += 1;
        Object.assign(m.document, clone(b.mission)); if (b.mission.title) m.title = b.mission.title; if (b.mission.proof_modes) m.proof_modes = b.mission.proof_modes; if (b.mission.capacity !== undefined) m.capacity = b.mission.capacity;
        m.revision += 1; return missionRow(m);
      }, () => m.revision) }; },
    'POST missions/:id/transition': (b, mid) => { const m = mission(mid); if (!m) throw http(404, 'not_found');
      return { mission: command('missions.transition', mid, b, () => {
        lifecycle(m, b.to);
        if (b.to === 'released' && (s.campaigns.find((c) => c.id === m.campaign_id).state !== 'released' || !C.ENUMS.RELEASABLE_TEMPLATES.includes(m.template))) throw http(422, 'invalid');
        m.state = b.to; m.revision += 1; return missionRow(m);
      }, () => m.revision) }; },
    'GET missions/:id/preview': (b, mid) => { const m = mission(mid); if (!m) throw http(404, 'not_found'); return { mission: card(m) }; },
    'GET applications': (b, x, query) => ({ applications: clone(s.applications.filter((a) => !query.get('status') || a.status === query.get('status'))) }),
    'POST applications/:id/decision': (b, aid) => { const a = s.applications.find((x) => x.id === aid); if (!a) throw http(404, 'not_found');
      return { application: command('applications.decide', aid, b, () => {
        if (a.applicant === OWNER) throw http(403, 'self_review_denied');
        if (a.status !== 'submitted') throw http(409, 'revision_conflict');
        const doc = { decision: b.decision, ...(b.reason !== undefined ? { reason: b.reason } : {}), ...(b.rubric !== undefined ? { rubric: b.rubric } : {}) };
        if (C.checkDocument(C.DOCUMENTS.application_decide, doc)) throw http(422, 'invalid');
        const m = mission(a.mission_id), crit = m.document.rubric?.application ?? [];
        if ((b.rubric ?? []).length !== crit.length || (b.decision === 'approved' && (b.rubric ?? []).some((x) => !x.met))) throw http(422, 'invalid');
        let assignment = null;
        if (b.decision === 'approved') {
          if (m.capacity !== null && seats(m.id) >= m.capacity) throw http(409, 'capacity_exhausted');
          assignment = { ...ROW(id()), application_id: a.id, mission_id: m.id, participant: a.applicant, status: 'offered', revision: 1, offered_requirements_revision: m.requirements_revision,
            accepted_requirements_revision: null, accepted_notice_revision: null, accepted_at: null, completed_at: null, withdrawn_at: null };
          s.assignments.push(assignment);
        }
        a.status = b.decision; a.revision += 1; a.decided_by = OWNER; a.decision_reason = b.reason ?? null; a.decided_at = T0;
        a.decisions.push({ decision: b.decision, reason: b.reason ?? null, rubric: b.rubric ?? [], requirements_revision: a.requirements_revision, decided_by: OWNER, decided_at: T0 });
        const { document, decisions, ...row } = a; return { ...row, assignment };
      }, () => a.revision) }; },
    'GET applications/:id/accommodation': (b, aid) => { const a = s.applications.find((x) => x.id === aid); if (!a) throw http(404, 'not_found'); s.accommodationReads += 1;
      return { accommodation: { application_id: a.id, applicant: a.applicant, accommodation: a.accommodation ?? null, read_at: T0 } }; },
    'GET assignments': () => ({ assignments: clone(s.assignments) }),
    'GET proofs': (b, x, query) => ({ proofs: clone(s.proofs.filter((p) => !query.get('state') || p.state === query.get('state')).map(proofOut)) }),
    'GET proofs/:id/media': (b, pid, query) => { const p = s.proofs.find((x) => x.id === pid); if (!p) throw http(404, 'not_found');
      if (Number(query.get('revision')) !== p.revision) throw http(409, 'revision_conflict');
      if (p.moderation_state === 'held') throw http(409, 'moderation_hold');
      s.mediaReads += 1;
      return { proof: clone({ ...proofOut(p), uploads: p.uploads }), media: p.media.map((m) => ({ ...m, url: 'https://league-unit.invalid/storage/v1/object/sign/x?token=signed-' + s.mediaReads + '-' + m.upload_id.slice(-4), expires_in: s.expiresIn })) }; },
    'POST proofs/:id/review': (b, pid) => { const p = s.proofs.find((x) => x.id === pid); if (!p) throw http(404, 'not_found');
      return { proof: command('proofs.review', pid, b, () => {
        if (p.participant === OWNER) throw http(403, 'self_review_denied');
        if (p.state !== 'submitted') throw http(409, 'revision_conflict');
        if (p.moderation_state === 'held') throw http(409, 'moderation_hold');
        if (C.checkDocument(C.DOCUMENTS.proof_review, b.review)) throw http(422, 'invalid');
        if (b.review.asset_revision !== p.asset_revision) throw http(409, 'media_binding');
        const decision = C.reviewOutcome(b.review);
        const review = { id: id(), proof_id: p.id, proof_revision: p.revision, asset_revision: p.asset_revision, reviewer: OWNER, mission_decision: b.review.mission_decision, rights_decision: b.review.rights_decision,
          safety_decision: b.review.safety_decision, decision, rubric: b.review.rubric ?? [], reason: b.review.reason ?? null, created_at: T0 };
        p.reviews.push(review); p.state = decision; p.reviewed_revision = p.revision;
        let credit = null;
        if (decision === 'accepted') {
          const asg = s.assignments.find((a) => a.id === p.assignment_id); asg.status = 'completed';
          credit = { id: id(), tenant: TENANT, campaign_id: mission(asg.mission_id).campaign_id, mission_id: asg.mission_id, assignment_id: asg.id, participant: p.participant, proof_id: p.id, proof_revision: p.revision,
            asset_revision: p.asset_revision, review_id: review.id, kind: 'mission_completion', created_at: T0 };
          s.credits.push(credit);
        }
        return { ...proofRow(p), review, credit };
      }, () => p.revision) }; },
    'POST proofs/:id/moderation': (b, pid) => { const p = s.proofs.find((x) => x.id === pid); if (!p) throw http(404, 'not_found');
      return { proof: command('proofs.moderate', pid, b, () => {
        if (b.hold === (p.moderation_state === 'held')) throw http(409, 'revision_conflict');
        p.moderation_state = b.hold ? 'held' : 'clear';
        if (b.hold) s.publications.filter((x) => x.proof_id === p.id && x.state === 'published').forEach((x) => { x.state = 'withdrawn'; x.effective = false; x.withdrawn_reason = 'moderation_hold'; x.withdrawn_at = T0; p.publication_state = 'withdrawn'; });
        return proofRow(p);
      }, () => p.revision) }; },
    'POST proofs/:id/publication': (b, pid) => { const p = s.proofs.find((x) => x.id === pid); if (!p) throw http(404, 'not_found');
      return { publication: command('publications.decide', pid, b, () => {
        if (b.decision === 'published') {
          const k = s.consents.find((x) => x.id === b.consent_id);
          if (!k || k.state !== 'open' || k.purpose !== 'publish_proof' || k.proof_revision !== p.revision || k.asset_revision !== p.asset_revision) throw http(409, 'consent_scope');
          const asg = s.assignments.find((a) => a.id === p.assignment_id), m = mission(asg.mission_id);
          const pub = { id: id(), tenant: TENANT, campaign_id: m.campaign_id, mission_id: m.id, assignment_id: asg.id, proof_id: p.id, proof_revision: p.revision, asset_revision: p.asset_revision, consent_id: k.id,
            audience: 'released_audience', state: 'published', effective: true, published_by: OWNER, published_at: T0, withdrawn_by: null, withdrawn_at: null, withdrawn_reason: null };
          s.publications.push(pub); p.publication_state = 'published_released_audience'; return pub;
        }
        const pub = s.publications.find((x) => x.proof_id === p.id && x.state === 'published');
        if (!pub) throw http(409, 'revision_conflict');
        Object.assign(pub, { state: 'withdrawn', effective: false, withdrawn_by: OWNER, withdrawn_at: T0, withdrawn_reason: 'owner' }); p.publication_state = 'withdrawn'; return pub;
      }, () => p.revision) }; },
    /* as the SQL answers consents.list: one proof's rows when ?proof= names it, oldest first, at most LIMITS.list.rows */
    'GET consents': (b, x, query) => ({ consents: clone(s.consents.filter((k) => !query.get('proof') || k.proof_id === query.get('proof'))
      .sort((p, q) => (p.granted_at < q.granted_at ? -1 : p.granted_at > q.granted_at ? 1 : p.id < q.id ? -1 : p.id > q.id ? 1 : 0)).slice(0, C.LIMITS.list.rows)) }),
    'GET publications': () => ({ publications: clone(s.publications) }),
    'GET appeals': (b, x, query) => ({ appeals: clone(s.appeals.filter((a) => !query.get('state') || a.state === query.get('state'))) }),
    'POST appeals/:id/resolve': (b, xid) => { const x = s.appeals.find((a) => a.id === xid); if (!x) throw http(404, 'not_found');
      return { appeal: command('appeals.resolve', xid, b, () => {
        if (x.appellant === OWNER) throw http(403, 'self_review_denied');
        if (x.state !== 'open') throw http(409, 'revision_conflict');
        x.state = b.outcome; x.resolved_by = OWNER; x.resolution_reason = b.reason; x.resolved_at = T0;
        const { statement, ...row } = x; return row;
      }) }; },
    'GET credits': () => ({ credits: clone(s.credits) }),
    'GET media/due': () => ({ due: { retention_evaluated: s.policy.valid, uploads: clone(s.due) } }),
    'POST media/purge': (b) => ({ purge: command('media.purged', '', b, () => {
      if (!b.uploads.every((u) => s.due.some((d) => d.id === u && d.due))) throw http(409, 'revision_conflict');
      s.due = s.due.filter((d) => !b.uploads.includes(d.id)); return { purged: b.uploads, already_purged: [], publications_withdrawn: [] };
    }) }),
    'GET receipts/:operation/:key': (b, x, query, params) => { const r = s.receipts.get(params.operation + '|' + params.key); if (!r) throw http(404, 'not_found'); return { receipt: clone(r.receipt) }; }
  };
  const overview = { ok: true, modules: [{ id: 'league', label: 'Environmental Justice League', state: 'draft', policy_module: 'league', policy: { installed: true, state: 'enabled', revision: 1, updated_at: T0 } }], module_policy: { status: 'available', reason: null },
    geography: { selected: null }, campaigns: { drafts: 0, released: 0 }, queues: { applications: 0, proofs: 0, reviews: 0 }, freshness: [], blockers: [] };
  const modules = () => ({ ok: true, installationId: 'mccluster', modules: ['environment', 'league', 'intake'].map((m) => m === 'league' ? { moduleId: m, ...module, updated_at: T0, updated_by: OWNER, last_command: null } : { moduleId: m, installed: false, state: null, revision: null, updated_at: null, updated_by: null, last_command: null }), commands: [] });
  function answer(path, method, body) {
    const url = new URL('https://api.mccluster.org' + path);
    if (url.pathname === '/v1/eup/overview') return overview;
    if (url.pathname === '/v1/eup/modules') return modules();
    const rest = url.pathname.slice(C.PREFIX.owner.length + 1);
    const hit = C.matchRoute('owner', method, rest);
    if (!url.pathname.startsWith(C.PREFIX.owner + '/') || !hit) throw http(404, 'not_found');
    const key = method + ' ' + hit.route.path;
    if (!routes[key]) throw new Error('stand-in has no route ' + key);
    return { ok: true, ...routes[key](body, hit.params.id, url.searchParams, hit.params) };
  }
  const request = (path, opts = {}) => {
    const method = opts.method || 'GET', body = clone(opts.body);
    log.push({ path, method, body, signal: opts.signal });
    const url = new URL('https://api.mccluster.org' + path), hit = C.matchRoute('owner', method, url.pathname.slice(C.PREFIX.owner.length + 1));
    const hook = hit && s.hooks[hit.route.action ?? 'fixture'];
    const h = typeof hook === 'function' ? hook(path, method, body) : hook;
    if (h === 'refuse') { if (typeof hook !== 'function') delete s.hooks[hit.route.action]; return Promise.reject(new TypeError('Failed to fetch')); }
    if (h instanceof Error) return Promise.reject(h);
    if (h && typeof h.then === 'function') return h;
    let out;
    try { out = answer(path, method, body); } catch (e) { if (h === 'hang' || h === 'drop') delete s.hooks[hit.route.action]; return h === 'hang' ? new Promise(() => {}) : Promise.reject(h === 'drop' ? new TypeError('Failed to fetch') : e); }
    if (h === 'hang' || h === 'drop') { if (typeof hook !== 'function') delete s.hooks[hit.route.action]; return h === 'hang' ? new Promise(() => {}) : Promise.reject(new TypeError('Failed to fetch')); }
    return Promise.resolve(out);
  };
  return { s, log, request, writes: () => log.filter((l) => l.method !== 'GET'), reads: (p) => log.filter((l) => l.method === 'GET' && l.path.startsWith(p)).length };
}

/* A world in mid-journey, built directly in the stand-in: a released, invited campaign with the song mission (two
   application criteria, one proof criterion, capacity 2); applications from the tester (submitted), the peer
   (submitted, with an accommodation request) and the owner (submitted: self-approval); an accepted assignment with a
   submitted proof (one sealed audio upload); a second, accepted proof with an open publication consent; the owner's
   own submitted proof; an appeal; a due upload. */
function world(w) {
  const s = w.s;
  s.policy = { revision: 1, document: clone(POLICY), valid: true, updated_by: OWNER, updated_at: T0 };
  const camp = { ...ROW(U(100)), slug: 'unit-campaign', title: 'Test fixture campaign', state: 'released', audience: 'invited', revision: 4, document: { slug: 'unit-campaign', title: 'Test fixture campaign', purpose: 'Synthetic.' }, created_by: OWNER };
  const rubric = { application: [{ id: 'fit', label: 'Says what the song is about' }, { id: 'safe', label: 'Names no private person' }], proof: [{ id: 'complete', label: 'Lyrics, credits and a take' }] };
  const song = { ...ROW(U(101)), campaign_id: camp.id, slug: 'write-a-song', title: 'Test fixture song mission', template: 'write-a-song', state: 'released', revision: 3, requirements_revision: 2, capacity: 2,
    proof_modes: ['audio', 'video', 'lyrics'], document: { slug: 'write-a-song', title: 'Test fixture song mission', template: 'write-a-song', proof_modes: ['audio', 'video', 'lyrics'], requirements: 'Test fixture requirements.', acceptance: 'Test fixture acceptance.', rubric }, created_by: OWNER };
  s.campaigns.push(camp); s.missions.push(song);
  s.grants.push({ id: U(110), tenant: TENANT, campaign_id: camp.id, account: TESTER, state: 'open', note: 'Unit tester.', granted_by: OWNER, granted_at: T0, revoked_by: null, revoked_at: null });
  const app = (n, applicant, extra = {}) => ({ ...ROW(U(n)), mission_id: song.id, requirements_revision: 2, applicant, recorded_by: null, status: 'submitted', revision: 2, accommodation_requested: false, decided_by: null,
    decision_reason: null, decided_at: null, document: { statement: 'Test fixture statement ' + n + '.' }, decisions: [], ...extra });
  s.applications.push(app(120, TESTER), { ...app(121, PEER, { accommodation_requested: true }), accommodation: { statement: 'Test fixture: I need to take part in writing.' } }, app(122, OWNER));
  const asg = (n, participant, status = 'accepted') => ({ ...ROW(U(n)), application_id: U(n + 1000), mission_id: song.id, participant, status, revision: 3, offered_requirements_revision: 2, accepted_requirements_revision: 2,
    accepted_notice_revision: POLICY.notices.participation.revision, accepted_at: T0, completed_at: null, withdrawn_at: null });
  s.assignments.push(asg(130, TESTER), asg(131, PEER, 'completed'), asg(132, OWNER));
  const upload = (n, assignment, participant) => ({ ...ROW(U(n)), assignment_id: assignment, participant, kind: 'audio', mime: 'audio/webm', ext: 'webm', declared_bytes: 640, max_bytes: 4096, duration_seconds: 30, state: 'sealed',
    scan_state: 'not_scanned', expires_at: T0, bytes: 640, sha256: SHA(n % 10), family: 'ebml', rejected_reason: null, sealed_at: T0, discarded_at: null, purged_at: null, storage: { object_id: U(n + 5000), etag: 'etag-' + n, size: 640 } });
  const RIGHTS = { version: 'music-rights-v1', owns_master: true, controls_composition: true, samples_cleared: true, collaborators_cleared: true, parody_or_derivative: false, derivative_permissions: '' };
  const proof = (n, assignment, participant, state, extra = {}) => {
    const up = upload(n + 10, assignment, participant);
    return { ...ROW(U(n)), assignment_id: assignment, participant, revision: 1, state, reviewed_revision: state === 'submitted' ? null : 1, asset_revision: SHA((n + 3) % 10), moderation_state: 'clear', publication_state: 'private',
      document: { title: 'Test fixture song ' + n, lyrics: 'Line one of fixture ' + n + '\nLine two', credits: [{ name: 'Fixture Writer', role: 'lyrics' }], rights: RIGHTS, media: [{ upload_id: up.id, sha256: up.sha256 }], review_notice_revision: POLICY.notices.private_review.revision },
      media: [{ upload_id: up.id, kind: 'audio', mime: 'audio/webm', bytes: 640, sha256: up.sha256 }], reviews: [], uploads: [up], ...extra };
  };
  s.proofs.push(proof(140, U(130), TESTER, 'submitted'), proof(141, U(131), PEER, 'accepted'), proof(142, U(132), OWNER, 'submitted'));
  const accepted = s.proofs[1];
  s.credits.push({ id: U(150), tenant: TENANT, campaign_id: camp.id, mission_id: song.id, assignment_id: U(131), participant: PEER, proof_id: accepted.id, proof_revision: 1, asset_revision: accepted.asset_revision, review_id: U(151), kind: 'mission_completion', created_at: T0 });
  s.consents.push({ id: U(160), tenant: TENANT, mission_id: song.id, assignment_id: U(131), proof_id: accepted.id, proof_revision: 1, asset_revision: accepted.asset_revision, actor: PEER, purpose: 'publish_proof', audience: 'released_audience',
    notice_revision: POLICY.notices.publication.revision, state: 'open', granted_at: T0, expires_at: '2026-12-10T12:00:00.000Z', revoked_at: null, revoked_by: null, superseded_at: null });
  s.appeals.push({ id: U(170), tenant: TENANT, subject: 'application', subject_id: U(121), appellant: PEER, state: 'open', resolved_by: null, resolution_reason: null, created_at: T0, resolved_at: null, statement: 'Test fixture appeal statement.' });
  s.due.push({ id: U(180), tenant: TENANT, assignment_id: U(130), ext: 'webm', kind: 'audio', state: 'discarded', due: true, reason: 'discarded', due_at: T0 }, { id: U(181), tenant: TENANT, assignment_id: U(130), ext: 'webm', kind: 'audio', state: 'sealed', due: false, reason: null, due_at: null });
  return { camp, song };
}

/* ---------- mounting and driving the tab ---------- */
function mount(w, opts = {}) {
  window.CR.eup.helpers.resetModel(); E.helpers.model().section = 'overview'; E.helpers.model().geo = { country: null, state: null };
  const root = new El('div'); root.innerHTML = E.render(); E.bind(root, { request: w.request, deadlineMs: opts.deadlineMs, now: opts.now });
  const pane = () => root.querySelector('[data-eup-pane]');
  const m = {
    root, pane, status: () => root.querySelector('[data-eup-status]').textContent, host: root.querySelector('[data-eup]'),
    q: (sel) => pane().querySelector(sel), qa: (sel) => pane().querySelectorAll(sel), text: () => pane().textContent, html: () => pane().innerHTML,
    tab: (id) => root.querySelector('[data-eup-tabs]').querySelector('[data-eup-tab="' + id + '"]'),
    view: () => E.helpers.league().inspect(),
    input: (form, field) => pane().querySelector('[data-eup-league-input="' + form + '|' + field + '"]'),
    set(form, field, v) { const el = m.input(form, field); assert.ok(el, 'no field ' + form + '|' + field); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.oninput(); },
    button(action, id = '', arg = '') { return pane().querySelectorAll('[data-eup-league-command="' + action + '"]').find((b) => b.attrs['data-eup-league-id'] === id && b.attrs['data-eup-league-arg'] === arg) || null; },
    async press(action, id = '', arg = '') { const b = m.button(action, id, arg); assert.ok(b, 'no button ' + [action, id, arg].join(' ')); b.click(); await settle(); },
    async ui(what, id = '') { const b = pane().querySelectorAll('[data-eup-league-do="' + what + '"]').find((x) => x.attrs['data-eup-league-id'] === id); assert.ok(b, 'no ui button ' + what + ' ' + id); b.click(); await settle(); },
    async league(view) { m.tab('league').click(); await settle(); if (view && view !== 'setup') { pane().querySelector('[data-eup-league-tab="' + view + '"]').click(); await settle(); } },
    outcome: (slot) => { const n = pane().querySelectorAll('[data-eup-league-outcome]').find((x) => x.attrs['data-eup-league-outcome'].startsWith(slot + ':')); return n ? { kind: n.attrs['data-eup-note'], text: n.textContent } : null; }
  };
  return m;
}
const lastWrite = (w) => w.writes().at(-1);
const UUIDV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/* ================================================================== the contract mirror */
test('mirror: every command and read of the tab is an owner route of the contract, with its method, path, revision rule and answer key', () => {
  const owner = C.ROUTES.filter((r) => r.surface === 'owner');
  for (const [action, cmd] of Object.entries(H.COMMANDS)) {
    const route = owner.find((r) => r.action === action);
    assert.ok(route, action + ' is an owner route');
    assert.equal(cmd.method, route.method, action + ' method');
    assert.equal(cmd.path, route.path, action + ' path');
    assert.equal(route.idempotency_key, true, action + ' takes a key');
    assert.equal(!!cmd.expected_revision, route.expected_revision, action + ': expected_revision exactly where the route compares one');
    if (route.expected_revision) assert.equal(cmd.revision_min ?? 1, route.revision_min, action + ' revision_min');
    assert.equal(cmd.response, route.response, action + ' answer key');
    assert.equal(C.OWNER_ACTIONS[action].kind, 'mutation');
  }
  const unused = owner.filter((r) => r.action && C.OWNER_ACTIONS[r.action].kind === 'mutation' && !H.COMMANDS[r.action]).map((r) => r.action).sort();
  assert.deepEqual(unused, ['applications.create', 'outbox.ack'], 'the only owner mutations the tab does not send: recording an application for an account, and acknowledging the outbox');
  for (const [name, read] of Object.entries({ ...H.READS, ...H.RECORD_READS })) {
    const route = owner.find((r) => r.method === 'GET' && r.path === read.path);
    assert.ok(route, name + ' reads an owner GET route');
    assert.equal(read.response, route.response, name + ' answer key');
    if (read.filter) assert.equal(Object.values(route.query).includes(read.filter), true, name + ' filters by a query value the route maps');
    if (route.action) assert.equal(read.list, C.OWNER_ACTIONS[route.action].result.endsWith('[]'), name + ' is a list exactly when the action answers one');
  }
  assert.equal(H.PREFIX, C.PREFIX.owner);
  for (const k of Object.keys(H.PATTERNS)) assert.equal(H.PATTERNS[k].source, C.PATTERNS[k].source, 'pattern ' + k);
  for (const k of Object.keys(H.LIMITS.text)) assert.equal(H.LIMITS.text[k], C.LIMITS.text[k], 'text limit ' + k);
  assert.deepEqual(H.LIMITS.policy, C.LIMITS.policy);
  assert.equal(H.LIMITS.count.rubric_criteria, C.LIMITS.count.rubric_criteria); assert.equal(H.LIMITS.count.capacity, C.LIMITS.count.capacity); assert.equal(H.LIMITS.list.purge_batch, C.LIMITS.list.purge_batch);
  for (const k of Object.keys(H.ENUMS)) if (k !== 'NOTICES') assert.deepEqual(H.ENUMS[k], C.ENUMS[k], 'enum ' + k);
  assert.deepEqual(H.ENUMS.NOTICES, Object.keys(C.DOCUMENTS.policy.fields.notices.fields));
  assert.deepEqual(H.TEMPLATE_RULES, C.TEMPLATE_RULES);
  for (const machine of ['campaign', 'mission']) {
    const pairs = C.STATE_MACHINES[machine].transitions.filter((t) => t.from !== null).map((t) => t.from + '>' + t.to).sort();
    assert.deepEqual(Object.entries(H.LIFECYCLE).flatMap(([from, tos]) => tos.map((to) => from + '>' + to)).sort(), pairs, machine + ' lifecycle');
  }
  assert.deepEqual([...H.CARD_FIELDS].sort(), Object.keys(C.shapeFields('mission_card')).sort(), 'the preview draws every mission_card field and nothing else');
});

test('policy check agrees with the contract\'s checkDocument on every document, and the form ships no value', () => {
  const ok = (doc) => C.checkDocument(C.DOCUMENTS.policy, doc) === null;
  const variants = [clone(POLICY)];
  const edit = (f) => { const d = clone(POLICY); f(d); variants.push(d); };
  edit((d) => { d.entitlement = 'not_decided'; }); edit((d) => { d.entitlement = 'paid'; }); edit((d) => { delete d.entitlement; }); edit((d) => { d.extra = 1; });
  edit((d) => { d.media = { enabled: false }; }); edit((d) => { d.media.enabled = 'yes'; }); edit((d) => { delete d.media.kinds; }); edit((d) => { d.media.kinds = []; }); edit((d) => { d.media.kinds = ['audio', 'audio']; });
  edit((d) => { d.media.kinds = ['audio', 'video']; }); edit((d) => { d.media.kinds = ['audio', 'video']; d.media.video_max_bytes = 8192; }); edit((d) => { d.media.kinds = ['image']; });
  edit((d) => { d.media.audio_max_bytes = 0; }); edit((d) => { d.media.audio_max_bytes = 104857600; }); edit((d) => { d.media.audio_max_bytes = 104857601; }); edit((d) => { d.media.audio_max_bytes = 1.5; });
  edit((d) => { delete d.media.audio_max_bytes; }); edit((d) => { delete d.media.max_duration_seconds; }); edit((d) => { d.media.max_duration_seconds = 3601; }); edit((d) => { d.media.max_duration_seconds = null; }); edit((d) => { d.media.colour = 'red'; });
  edit((d) => { d.media = { enabled: false, kinds: ['video'] }; }); edit((d) => { d.media = { enabled: false, audio_max_bytes: -1 }; });
  edit((d) => { d.retention.completed_days = 0; }); edit((d) => { d.retention.withdrawn_days = 3651; }); edit((d) => { delete d.retention.withdrawn_days; }); edit((d) => { d.retention.extra = 1; }); edit((d) => { d.retention = null; });
  edit((d) => { d.notices.participation.revision = ''; }); edit((d) => { d.notices.participation.revision = 'has space'; }); edit((d) => { d.notices.publication.revision = 'x'.repeat(65); });
  edit((d) => { d.notices.private_review.text = ''; }); edit((d) => { d.notices.private_review.text = 'a\rb'; }); edit((d) => { d.notices.private_review.text = 'tab\tand\nline'; }); edit((d) => { d.notices.private_review.text = 'x'.repeat(8001); });
  edit((d) => { d.notices.private_review.text = '\u{1F30D}'.repeat(8000); }); edit((d) => { delete d.notices.publication; }); edit((d) => { d.notices.extra = notice('extra'); }); edit((d) => { d.notices.participation.lang = 'en'; });
  variants.push(null, [], 'policy', {});
  let valid = 0;
  for (const doc of variants) {
    assert.equal(H.policyProblem(doc) === null, ok(doc), 'agrees on ' + JSON.stringify(doc)?.slice(0, 160));
    if (ok(doc)) valid += 1;
  }
  assert.ok(valid >= 6 && valid < variants.length - 20, 'the battery holds valid and invalid documents (' + valid + ' valid of ' + variants.length + ')');
  for (const doc of variants.filter(ok)) assert.deepEqual(H.policyFromForm(H.policyForm(doc)).document, doc, 'a stored policy survives the form unchanged');
  assert.deepEqual(H.policyForm(null), {}, 'no stored policy: nothing is pre-filled');
  assert.match(H.policyFromForm({}).problem, /entitlement/, 'an empty form is refused, never filled in');
  assert.match(H.policyFromForm({ ...H.policyForm(POLICY), audio_max_bytes: '12kb' }).problem, /whole number/);
  assert.match(H.policyFromForm({ ...H.policyForm(POLICY), completed_days: '0' }).problem, /from 1 to 3650/);
  assert.equal(H.policyFromForm({ ...H.policyForm(POLICY), video_max_bytes: '' }).document.media.video_max_bytes, undefined, 'an empty number is left out, never zero');
});

test('review outcome, rubric parsing and mission changes follow the contract', () => {
  const D = C.ENUMS.DIMENSION_DECISIONS;
  for (const a of D) for (const b of D) for (const c of D) assert.equal(H.reviewOutcome(a, b, c), C.reviewOutcome({ mission_decision: a, rights_decision: b, safety_decision: c }), [a, b, c].join(','));
  assert.equal(H.reviewOutcome('pass', 'pass', ''), null); assert.equal(H.reviewOutcome('pass', 'ok', 'pass'), null);
  assert.deepEqual(H.parseRubric('fit: Says what it is about\n\n safe :  Names no private person ', 'Application').list, [{ id: 'fit', label: 'Says what it is about' }, { id: 'safe', label: 'Names no private person' }]);
  assert.match(H.parseRubric('Fit: x', 'Application').problem, /not a criterion id/); assert.match(H.parseRubric('fit x', 'Proof').problem, /write it as/);
  assert.match(H.parseRubric('a: x\na: y', 'Proof').problem, /appears twice/); assert.match(H.parseRubric(Array.from({ length: 13 }, (_, i) => 'c' + i + ': x').join('\n'), 'Proof').problem, /at most 12/);
  assert.match(H.parseRubric('a: ' + 'x'.repeat(201), 'Proof').problem, /longer than 200/);
  const m = { id: U(5), title: 'Song', template: 'write-a-song', capacity: null, proof_modes: ['audio', 'lyrics'], requirements_revision: 1,
    document: { title: 'Song', template: 'write-a-song', proof_modes: ['audio', 'lyrics'], requirements: 'Req.', acceptance: 'Acc.', rubric: { application: [{ id: 'fit', label: 'Fit' }] } } };
  assert.deepEqual(H.missionChanges(m, { title: 'Song', requirements: 'Req.', capacity: '', rubric_application: 'fit: Fit', rubric_proof: '' }), { nothing: true }, 'unchanged fields send nothing');
  assert.deepEqual(H.missionChanges(m, { capacity: '3' }).document, { capacity: 3 }, 'capacity alone');
  assert.deepEqual(H.missionChanges({ ...m, capacity: 3 }, { capacity: '' }).document, { capacity: null }, 'an emptied capacity means no limit');
  assert.deepEqual(H.missionChanges(m, { rubric_proof: 'done: A take' }).document, { rubric: { application: [{ id: 'fit', label: 'Fit' }], proof: [{ id: 'done', label: 'A take' }] } }, 'the rubric is sent whole');
  assert.deepEqual(H.missionChanges(m, { mode_video: true }).document, { proof_modes: ['audio', 'video', 'lyrics'] });
  assert.match(H.missionChanges(m, { mode_lyrics: false }).problem, /always needs lyrics/); assert.match(H.missionChanges(m, { mode_text: true }).problem, /takes only/);
  assert.match(H.missionChanges(m, { acceptance: '  ' }).problem, /cannot be emptied/); assert.match(H.missionChanges(m, { capacity: '0' }).problem, /from 1 to 100000/);
});

test('failures: only documented refusals are settled; a timeout, a lost connection, an unnamed 5xx and an unreadable answer are unknown', () => {
  const f = (e) => { const r = H.commandFailure(e); return [r.kind, r.settled, r.again]; };
  assert.deepEqual(f({ timeout: true, deadline: 15000 }), ['unknown', false, false]);
  assert.deepEqual(f(new TypeError('Failed to fetch')), ['unknown', false, false]);
  assert.deepEqual(f(Object.assign(new Error('x'), { malformed: true })), ['unknown', false, false]);
  for (const reason of ['storage_unavailable', 'unavailable', 'authorization_unavailable', '']) assert.deepEqual(f(http(503, reason)), ['unknown', false, false], '503 ' + reason);
  for (const status of [500, 502, 504, 408]) assert.deepEqual(f(http(status, 'x')), ['unknown', false, false], 'status ' + status);
  assert.deepEqual(f(http(409, 'revision_conflict')), ['conflict', true, false]);
  for (const reason of ['retry_conflict', 'module_busy', 'module_policy_changed']) assert.deepEqual(f(http(reason === 'module_busy' ? 503 : 409, reason)), ['busy', true, true], reason + ': the same key may go again');
  for (const [status, reason] of [[409, 'capacity_exhausted'], [403, 'self_review_denied'], [409, 'exists'], [409, 'idempotency_conflict'], [503, 'policy_unavailable'], [409, 'requirements_changed'], [409, 'media_binding'],
    [409, 'consent_scope'], [409, 'moderation_hold'], [429, 'rate_limited'], [422, 'invalid'], [404, 'not_found'], [503, 'module_not_installed'], [503, 'module_draining'], [409, 'module_disabled'], [503, 'schema_not_applied'],
    [501, 'not_implemented'], [400, 'expected_revision_required'], [413, 'body_too_large'], [403, 'entitlement_required']]) assert.deepEqual(f(http(status, reason)), ['error', true, false], status + ' ' + reason);
  assert.match(H.commandFailure(http(409, 'capacity_exhausted')).text, /no seat is free/); assert.match(H.commandFailure(http(403, 'self_review_denied')).text, /nobody approves, reviews or resolves their own work/);
  assert.match(H.commandFailure({ timeout: true, deadline: 15000 }).text, /no answer within 15s\. The outcome is unknown and it was not resent\./);
  assert.equal(H.ownerLost(http(403, 'owner_required')), true); assert.equal(H.ownerLost(http(403)), true); assert.equal(H.ownerLost(http(401)), true);
  assert.equal(H.ownerLost(http(403, 'self_review_denied')), false, 'a self-review refusal conceals nothing'); assert.equal(H.ownerLost(http(403, 'entitlement_required')), false);
  for (const reason of Object.keys(C.HTTP_REASONS).concat(Object.values(C.ERRORS).map((e) => e.code))) {
    const status = C.HTTP_REASONS[reason] ?? Object.values(C.ERRORS).find((e) => e.code === reason).owner_status;
    if (status === 401 || (status === 403 && reason === 'owner_required')) continue;
    const r = H.commandFailure(http(status, reason));
    /* authorization_unavailable is documented since review 2026-11-10 (F26); it stays unknown, as line 437 pins and as
       the member page treats it (UNKNOWN_503). */
    if (status === 503 && ['storage_unavailable', 'authorization_unavailable'].includes(reason)) assert.equal(r.settled, false, reason + ' stays unknown');
    else assert.equal(r.settled, true, 'every documented refusal of the contract is settled: ' + status + ' ' + reason);
  }
});

/* ================================================================== Setup */
test('setup: the policy form starts empty; saving sends a fresh key, expected revision 0, the typed document and the reason, and reads back', async () => {
  const w = leagueWorker();
  const m = mount(w); await settle();
  await m.league();
  assert.equal(m.q('[data-eup-league-policy-revision]').attrs['data-eup-league-policy-revision'], '0');
  assert.match(m.text(), /No League policy is stored\. Nothing ships a default/);
  for (const field of ['audio_max_bytes', 'video_max_bytes', 'max_duration_seconds', 'completed_days', 'withdrawn_days', 'participation_revision', 'participation_text', 'reason']) assert.equal(m.input('policy', field).value, '', field + ' starts empty');
  assert.equal(m.input('policy', 'entitlement').value, '', 'no entitlement is chosen for the owner'); assert.equal(m.input('policy', 'media_enabled').checked, false);
  await m.press('policy.set');
  assert.equal(w.writes().length, 0, 'an empty form sends nothing'); assert.match(m.outcome('policy').text, /Choose the entitlement rule\. Nothing was sent\./);
  const form = H.policyForm(POLICY);
  for (const [k, v] of Object.entries(form)) m.set('policy', k, v);
  await m.press('policy.set');
  assert.equal(w.writes().length, 0); assert.match(m.outcome('policy').text, /A reason is required/); assert.equal(document.activeElement.attrs['data-eup-focus'], 'league:policy|reason', 'focus goes to the reason');
  m.set('policy', 'reason', '  Unit test: the first synthetic policy.  ');
  await m.press('policy.set');
  const post = lastWrite(w);
  assert.equal(post.path, '/v1/eup/league/policy'); assert.equal(post.method, 'POST');
  assert.deepEqual(Object.keys(post.body).sort(), ['expected_revision', 'idempotency_key', 'policy', 'reason']);
  assert.match(post.body.idempotency_key, UUIDV4); assert.equal(post.body.expected_revision, 0); assert.deepEqual(post.body.policy, POLICY); assert.equal(post.body.reason, 'Unit test: the first synthetic policy.');
  assert.equal(m.outcome('policy').kind, 'done'); assert.match(m.outcome('policy').text, /^Save the League policy: recorded · rev 1 · valid/);
  assert.equal(m.q('[data-eup-league-policy-revision]').attrs['data-eup-league-policy-revision'], '1', 'read back');
  assert.equal(m.input('policy', 'audio_max_bytes').value, '4096', 'the stored value is shown after the save'); assert.equal(m.input('policy', 'reason').value, '', 'the reason is not kept');
  m.set('policy', 'withdrawn_days', '9'); m.set('policy', 'reason', 'Unit test: second revision.');
  w.s.policy.revision = 5; /* changed elsewhere */
  await m.press('policy.set');
  assert.equal(lastWrite(w).body.expected_revision, 1, 'the revision that was read is what is sent');
  assert.equal(m.outcome('policy').kind, 'conflict'); assert.match(m.outcome('policy').text, /changed since it was read/);
  assert.equal(m.input('policy', 'withdrawn_days').value, '9', 'what was typed survives a refusal');
});

test('setup: campaign and mission from the fixture, editing, transitions, audience and grants each send a key and the revision that was read', async () => {
  const w = leagueWorker();
  w.s.policy = { revision: 1, document: clone(POLICY), valid: true, updated_by: OWNER, updated_at: T0 };
  const m = mount(w); await settle();
  await m.league();
  assert.match(m.text(), /Test fixture song mission/); assert.match(m.text(), /stays a draft/);
  assert.equal(m.input('campaign-new', 'slug').value, FIXTURE.slug, 'prefilled from the fixture, editable');
  await m.press('campaigns.create');
  let c = w.s.campaigns[0];
  assert.deepEqual(lastWrite(w).body.campaign, { slug: FIXTURE.slug, title: FIXTURE.title, purpose: FIXTURE.purpose }); assert.equal(lastWrite(w).body.expected_revision, undefined, 'campaigns.create compares no revision');
  assert.equal(m.q('[data-eup-league-campaign="' + c.id + '"]').attrs['data-eup-league-status'], 'draft');
  await m.press('campaigns.create');
  assert.equal(m.outcome('campaign:new').kind, 'error'); assert.match(m.outcome('campaign:new').text, /already exists/);
  await m.press('missions.create', c.id);
  const song = w.s.missions[0];
  assert.deepEqual(lastWrite(w).body.mission, { slug: 'write-a-song', title: FIXTURE.missions[0].title, template: 'write-a-song', proof_modes: ['audio', 'video', 'lyrics'], requirements: FIXTURE.missions[0].requirements, acceptance: FIXTURE.missions[0].acceptance });
  assert.match(m.q('[data-eup-league-blocked="' + song.id + '"]').textContent, /Release the campaign first/, 'a mission of a draft campaign is not offered for release, and says why');
  assert.equal(m.button('missions.transition', song.id, 'released'), null);
  await m.ui('edit', song.id);
  m.set('mission:' + song.id, 'capacity', '1');
  m.set('mission:' + song.id, 'rubric_application', 'fit: Says what the song is about');
  m.set('mission:' + song.id, 'rubric_proof', 'complete: Lyrics, credits and a take');
  await m.press('missions.update', song.id);
  let patch = lastWrite(w);
  assert.equal(patch.method, 'PATCH'); assert.equal(patch.path, '/v1/eup/league/missions/' + song.id); assert.equal(patch.body.expected_revision, 1);
  assert.deepEqual(patch.body.mission, { capacity: 1, rubric: { application: [{ id: 'fit', label: 'Says what the song is about' }], proof: [{ id: 'complete', label: 'Lyrics, credits and a take' }] } }, 'only what changed');
  assert.equal(w.s.missions[0].requirements_revision, 2); assert.equal(m.q('[data-eup-league-editor="' + song.id + '"]'), null, 'the editor closes once saved');
  await m.press('campaigns.transition', c.id, 'released');
  assert.deepEqual([lastWrite(w).body.to, lastWrite(w).body.expected_revision], ['released', 1]);
  await m.press('missions.transition', song.id, 'released');
  assert.deepEqual([lastWrite(w).body.to, lastWrite(w).body.expected_revision], ['released', 2]);
  await m.press('campaigns.audience.set', c.id, 'invited');
  assert.deepEqual([lastWrite(w).body.audience, lastWrite(w).body.expected_revision], ['invited', 2]);
  m.set('grant:' + c.id, 'account', 'not-a-uuid');
  await m.press('audience.grants.grant', c.id);
  assert.equal(lastWrite(w).path.endsWith('/audience'), true, 'an invalid account id sends nothing'); assert.match(m.outcome('grants:' + c.id).text, /account id is a uuid/);
  m.set('grant:' + c.id, 'account', TESTER.toUpperCase()); m.set('grant:' + c.id, 'note', 'Unit tester.');
  await m.press('audience.grants.grant', c.id);
  assert.deepEqual(lastWrite(w).body.grant, { account: TESTER, note: 'Unit tester.' });
  const g = w.s.grants[0];
  assert.equal(m.q('[data-eup-league-grant="' + g.id + '"]').attrs['data-eup-league-status'], 'open');
  await m.press('audience.grants.revoke', g.id, c.id);
  assert.deepEqual(Object.keys(lastWrite(w).body), ['idempotency_key'], 'grants.revoke compares no revision');
  assert.equal(m.q('[data-eup-league-grant="' + g.id + '"]').attrs['data-eup-league-status'], 'revoked');
  await m.press('missions.transition', song.id, 'paused');
  assert.deepEqual([lastWrite(w).body.to, lastWrite(w).body.expected_revision], ['paused', 3]);
  assert.equal(m.button('missions.transition', song.id, 'withdrawn'), null, 'withdrawal asks first');
  await m.ui('confirm', 'mission:' + song.id);
  assert.match(m.q('[data-eup-league-confirm="mission:' + song.id + '"]').textContent, /Withdrawing is final/);
  assert.equal(document.activeElement.attrs['data-eup-focus'], 'league:do:cancel:mission:' + song.id, 'focus lands on the choice that keeps it');
  await m.press('missions.transition', song.id, 'withdrawn');
  assert.deepEqual([lastWrite(w).body.to, lastWrite(w).body.expected_revision], ['withdrawn', 4]);
  assert.equal(w.s.missions[0].state, 'withdrawn');
  c = w.s.campaigns[0];
  w.s.campaigns[0].revision = 9; /* changed elsewhere */
  await m.press('campaigns.transition', c.id, 'paused');
  assert.equal(lastWrite(w).body.expected_revision, 3); assert.equal(m.outcome('campaign:' + c.id).kind, 'conflict');
  await m.press('campaigns.transition', c.id, 'paused');
  assert.equal(lastWrite(w).body.expected_revision, 9, 'after the read-back the next command carries the new revision');
  assert.notEqual(w.writes().at(-1).body.idempotency_key, w.writes().at(-2).body.idempotency_key, 'a new decision is a new key');
});

test('setup: the member preview draws every mission_card field with the value the route answered', async () => {
  const w = leagueWorker(); const { song } = world(w);
  const m = mount(w); await settle();
  await m.league();
  await m.ui('preview', song.id);
  const card = w.request('/v1/eup/league/missions/' + song.id + '/preview').then((d) => d.mission);
  const expected = await card;
  const fields = m.qa('[data-eup-league-card-field]');
  assert.deepEqual(fields.map((f) => f.attrs['data-eup-league-card-field']).sort(), Object.keys(C.shapeFields('mission_card')).sort());
  for (const f of fields) assert.deepEqual(JSON.parse(f.attrs['data-eup-league-card-value']), expected[f.attrs['data-eup-league-card-field']], 'field ' + f.attrs['data-eup-league-card-field']);
  assert.match(m.q('[data-eup-league-card-field="open"]').textContent, /yes: members in the audience see it now/);
  assert.match(m.q('[data-eup-league-card-field="rubric"]').textContent, /Says what the song is about \(fit\)/);
});

/* ================================================================== Applications */
test('applications: decisions carry the rubric, the reason and the application revision; capacity and self-approval refusals are said; the accommodation read is restricted', async () => {
  const w = leagueWorker(); const { song } = world(w);
  w.s.missions[0].capacity = 4; /* three seats are taken in the world; one is free */
  const m = mount(w); await settle();
  await m.league('applications');
  const [tester, peer, own] = w.s.applications;
  assert.equal(m.qa('[data-eup-league-application]').length, 3);
  assert.match(m.q('[data-eup-league-application="' + tester.id + '"]').textContent, /Test fixture song mission · Test fixture campaign/);
  m.set('decide:' + tester.id, 'decision', 'approved');
  await m.press('applications.decide', tester.id);
  assert.equal(w.writes().length, 0, 'approval with a criterion unmet sends nothing'); assert.match(m.outcome('application:' + tester.id).text, /approval needs every criterion met/);
  m.set('decide:' + tester.id, 'met:fit', true); m.set('decide:' + tester.id, 'met:safe', true); m.set('decide:' + tester.id, 'note:fit', ' Clear. ');
  await m.press('applications.decide', tester.id);
  assert.deepEqual(lastWrite(w).body, { idempotency_key: lastWrite(w).body.idempotency_key, expected_revision: 2, decision: 'approved', rubric: [{ id: 'fit', met: true, note: 'Clear.' }, { id: 'safe', met: true }] });
  assert.match(m.outcome('application:' + tester.id).text, /recorded · status approved · rev 3 · .*one offered assignment/);
  m.set('decide:' + peer.id, 'decision', 'declined');
  await m.press('applications.decide', peer.id);
  assert.match(m.outcome('application:' + peer.id).text, /A reason is required/); assert.equal(document.activeElement.attrs['data-eup-focus'], 'league:decide:' + peer.id + '|reason');
  m.set('decide:' + peer.id, 'decision', 'approved'); m.set('decide:' + peer.id, 'met:fit', true); m.set('decide:' + peer.id, 'met:safe', true);
  await m.press('applications.decide', peer.id);
  assert.equal(m.outcome('application:' + peer.id).kind, 'error'); assert.match(m.outcome('application:' + peer.id).text, /no seat is free on this mission/, 'capacity exhausted');
  assert.equal(w.s.applications[1].status, 'submitted');
  m.set('decide:' + peer.id, 'decision', 'changes_requested'); m.set('decide:' + peer.id, 'reason', 'Test fixture: please say more.');
  await m.press('applications.decide', peer.id);
  assert.deepEqual([lastWrite(w).body.decision, lastWrite(w).body.reason, lastWrite(w).body.expected_revision], ['changes_requested', 'Test fixture: please say more.', 2]);
  assert.equal(m.q('[data-eup-league-application="' + peer.id + '"]').attrs['data-eup-league-status'], 'changes_requested');
  m.set('decide:' + own.id, 'decision', 'approved'); m.set('decide:' + own.id, 'met:fit', true); m.set('decide:' + own.id, 'met:safe', true);
  await m.press('applications.decide', own.id);
  assert.equal(m.outcome('application:' + own.id).kind, 'error'); assert.match(m.outcome('application:' + own.id).text, /nobody approves, reviews or resolves their own work/, 'self-approval');
  assert.equal(m.qa('[data-eup-note="denied"]').length, 0, 'a self-approval refusal conceals nothing');
  /* the restricted accommodation read */
  assert.doesNotMatch(m.text(), /I need to take part in writing/, 'the owner row carries a flag, never the text');
  await m.ui('accommodation', peer.id);
  assert.equal(w.s.accommodationReads, 1); assert.match(m.q('[data-eup-league-accommodation-text="' + peer.id + '"]').textContent, /I need to take part in writing/);
  assert.match(m.text(), /recorded with your account and the time, not the text/);
  await m.league('proofs');
  await m.league('applications');
  assert.doesNotMatch(m.text(), /I need to take part in writing/, 'a view switch drops the restricted text');
  assert.equal(w.s.accommodationReads, 1, 'and nothing reads it again by itself');
  void song;
});

/* ================================================================== Proofs and links */
test('proofs: the review read feeds a media element only; three decisions carry the opened revision and the shown digest; stale revision and self-review are said', async () => {
  const w = leagueWorker(); world(w);
  const m = mount(w); await settle();
  await m.league('proofs');
  const [p, accepted, own] = w.s.proofs;
  const card = m.q('[data-eup-league-proof="' + p.id + '"]');
  assert.equal(card.attrs['data-eup-league-status'], 'submitted:clear:private', 'state, moderation_state and publication_state are the contract fields');
  assert.match(m.text(), /Not scanned: when each file was sealed its type and size were checked, never its safety/);
  assert.match(m.q('[data-eup-league-credit="' + accepted.id + '"]').textContent, /mission_completion/);
  created.length = 0;
  await m.ui('review', p.id);
  assert.equal(created.length, 1, 'one media element for one upload'); const player = created[0];
  assert.equal(player.tag, 'audio'); assert.match(player.attrs.src, /^https:\/\/league-unit\.invalid\/.*token=signed-1-/); assert.equal(player.attrs.preload, 'metadata');
  assert.equal(player.parentNode.attrs['data-eup-league-player'], p.media[0].upload_id, 'placed in its slot');
  assert.doesNotMatch(m.html(), /token=|league-unit\.invalid/, 'the link is in no DOM text or attribute but the media element');
  assert.match(m.q('[data-eup-league-scan="' + p.media[0].upload_id + '"]').textContent, /^Not scanned/);
  assert.match(m.q('[data-eup-league-lyrics]').textContent, /Line one of fixture 140/); assert.match(m.q('[data-eup-league-rights]').textContent, /Owns the master recording: yes/);
  assert.equal(m.view().links, 1); assert.equal(m.view().players, 1);
  m.set('review:' + p.id, 'mission', 'pass'); m.set('review:' + p.id, 'rights', 'pass'); m.set('review:' + p.id, 'safety', 'changes');
  assert.equal(m.q('[data-eup-league-outcome-preview]').attrs['data-eup-league-outcome-preview'], 'needs_changes', 'the derived outcome follows the three choices');
  assert.equal(created.length, 1, 'redraws move the same element, they never make a new one');
  await m.press('proofs.review', p.id);
  assert.match(m.outcome('proof:' + p.id).text, /a mission pass needs every criterion met/);
  m.set('review:' + p.id, 'met:complete', true);
  await m.press('proofs.review', p.id);
  assert.match(m.outcome('proof:' + p.id).text, /A reason is required/, 'changes needed on safety needs a reason');
  assert.equal(w.writes().length, 0, 'nothing was sent for either');
  m.set('review:' + p.id, 'safety', 'pass');
  const shown = p.asset_revision;
  /* the participant resubmits meanwhile (a new revision and digest), and the list is read again under the open review */
  w.s.proofs[0].revision = 2; w.s.proofs[0].asset_revision = SHA(7);
  m.q('[data-eup-league-tab="proofs"]').click(); await settle();
  assert.ok(m.q('[data-eup-league-review-panel="' + p.id + '"]'), 'the open review stays open while the list is read again');
  await m.press('proofs.review', p.id);
  const sent = lastWrite(w);
  assert.equal(sent.body.expected_revision, 1, 'the revision that was opened'); assert.equal(sent.body.review.asset_revision, shown, 'the digest that was shown, not the one the list now holds');
  assert.deepEqual(Object.keys(sent.body.review).sort(), ['asset_revision', 'mission_decision', 'rights_decision', 'rubric', 'safety_decision']);
  assert.equal(m.outcome('proof:' + p.id).kind, 'conflict'); assert.match(m.outcome('proof:' + p.id).text, /changed since it was read/);
  assert.equal(m.view().review, null, 'a stale review closes'); assert.equal(m.view().links, 0); assert.equal(player.attrs.src, undefined, 'its link is dropped'); assert.equal(player.parentNode, null);
  /* the read-back holds revision 2: that is what opens now */
  await m.ui('review', p.id);
  assert.ok(m.q('[data-eup-league-review-panel="' + p.id + '"]')); assert.match(m.q('[data-eup-league-review-panel="' + p.id + '"]').attrs['aria-label'], /revision 2$/);
  m.set('review:' + p.id, 'mission', 'pass'); m.set('review:' + p.id, 'rights', 'pass'); m.set('review:' + p.id, 'safety', 'pass'); m.set('review:' + p.id, 'met:complete', true);
  await m.press('proofs.review', p.id);
  assert.equal(lastWrite(w).body.expected_revision, 2, 'the newly opened revision'); assert.equal(lastWrite(w).body.review.asset_revision, SHA(7), 'and the digest it showed');
  assert.match(m.outcome('proof:' + p.id).text, /recorded · state accepted .* one completion credit/);
  assert.equal(m.q('[data-eup-league-proof="' + p.id + '"]').attrs['data-eup-league-status'], 'accepted:clear:private');
  await m.ui('review', own.id);
  m.set('review:' + own.id, 'mission', 'pass'); m.set('review:' + own.id, 'rights', 'pass'); m.set('review:' + own.id, 'safety', 'pass'); m.set('review:' + own.id, 'met:complete', true);
  await m.press('proofs.review', own.id);
  assert.equal(m.outcome('proof:' + own.id).kind, 'error'); assert.match(m.outcome('proof:' + own.id).text, /nobody approves, reviews or resolves their own work/, 'self-review');
  assert.equal(m.qa('[data-eup-note="denied"]').length, 0);
  /* moderation: a hold needs a reason, carries the proof revision and closes an open review */
  m.set('moderate:' + own.id, 'reason', 'Test fixture: hold for a check.');
  await m.press('proofs.moderate', own.id, 'hold');
  assert.deepEqual([lastWrite(w).body.hold, lastWrite(w).body.expected_revision, lastWrite(w).body.reason], [true, 1, 'Test fixture: hold for a check.']);
  assert.equal(m.view().review, null); assert.equal(m.q('[data-eup-league-proof="' + own.id + '"]').attrs['data-eup-league-status'], 'submitted:held:private');
  assert.equal(m.qa('[data-eup-league-do="review"]').some((b) => b.attrs['data-eup-league-id'] === own.id), false, 'a held proof is not opened for review');
});

test('links: dropped on a League view switch, on an E=Up tab switch, on closing, on an account change and when they expire (counted from the send)', async () => {
  let clock = Date.parse(T0);
  const w = leagueWorker(); world(w);
  const m = mount(w, { now: () => clock }); await settle();
  await m.league('proofs');
  const p = w.s.proofs[0];
  const reviewButton = () => m.qa('[data-eup-league-do="review"]').find((b) => b.attrs['data-eup-league-id'] === p.id);
  const open = async () => { created.length = 0; reviewButton().click(); await settle(); assert.equal(created.length, 1, 'one media element'); assert.match(created[0].attrs.src, /token=signed-/); return created[0]; };
  const dropped = (el, why) => {
    assert.equal(el.attrs.src, undefined, why + ': src removed'); assert.equal(el.paused, true, why + ': paused'); assert.ok(el.loads >= 1, why + ': load() aborts the fetch');
    assert.equal(el.parentNode, null, why + ': out of the page'); assert.equal(E.helpers.league().inspect().links, 0, why + ': nothing held in memory'); assert.equal(E.helpers.league().inspect().players, 0);
  };
  let el = await open();
  await m.league('appeals'); dropped(el, 'League view switch');
  await m.league('proofs'); el = await open();
  m.tab('sources').click(); await settle(); dropped(el, 'E=Up tab switch');
  await m.league('proofs'); el = await open();
  m.q('[data-eup-league-do="review-close"]').click(); await settle(); dropped(el, 'closing the review');
  /* expiry is counted from when the read was SENT: an answer that arrives 299.7 s later lives 300 ms more */
  let give;
  w.s.hooks['proofs.get'] = () => new Promise((r) => { give = r; });
  created.length = 0;
  reviewButton().click(); await settle();
  delete w.s.hooks['proofs.get'];
  clock += 299700;
  give(await w.request('/v1/eup/league/proofs/' + p.id + '/media?revision=1')); await settle();
  el = created.find((x) => x.tag === 'audio');
  assert.ok(el && el.attrs.src, 'a late answer still plays for what is left of its life');
  await wait(500); await settle();
  dropped(el, 'expiry');
  assert.match(m.q('[data-eup-league-expired="' + p.id + '"]').textContent, /The 300-second media link expired and was dropped/);
  assert.match(m.status(), /expired and was dropped/);
  assert.equal(m.qa('[data-eup-league-player]').length, 0, 'no player slot is left');
  el = await open();
  assert.match(el.attrs.src, /token=signed-/, 'opening again signs a new link');
  /* an answer that arrives after the link's whole life never reaches a player */
  m.q('[data-eup-league-do="review-close"]').click(); await settle();
  w.s.hooks['proofs.get'] = () => new Promise((r) => { give = r; });
  reviewButton().click(); await settle();
  delete w.s.hooks['proofs.get'];
  clock += 301000; created.length = 0;
  give(await w.request('/v1/eup/league/proofs/' + p.id + '/media?revision=1')); await settle(); await wait(20); await settle();
  assert.equal(created.length, 0, 'no media element was ever made for it'); assert.ok(m.q('[data-eup-league-expired="' + p.id + '"]'));
  /* the account changes while a link is held */
  el = await open();
  window.dispatchEvent(new Event('mcc:auth-changed')); await settle();
  dropped(el, 'account change');
  assert.equal(m.qa('[data-eup-note="signed_out"]').length, 1, 'the workspace is concealed');
  assert.equal(E.helpers.league().inspect().review, null); assert.deepEqual(E.helpers.league().inspect().outcomes, {});
});

/* ================================================================== unknown outcomes and receipts */
test('unknown outcome: a timed-out command is not resent; its receipt settles it: found means recorded, not found offers the same key by hand', async () => {
  const w = leagueWorker(); world(w);
  const m = mount(w, { deadlineMs: 100 }); await settle();
  await m.league('appeals');
  const x = w.s.appeals[0];
  /* 1. the store committed and the answer never came: the receipt is found */
  w.s.hooks['appeals.resolve'] = 'hang';
  m.set('resolve:' + x.id, 'outcome', 'upheld'); m.set('resolve:' + x.id, 'reason', 'Test fixture: the decision stands.');
  m.button('appeals.resolve', x.id).click(); await flush();
  assert.equal(m.outcome('appeal:' + x.id).kind, 'pending'); assert.equal(m.button('appeals.resolve', x.id).attrs['aria-disabled'], 'true');
  m.button('appeals.resolve', x.id).click(); await flush();
  assert.equal(w.writes().length, 1, 'a second press while waiting sends nothing');
  await wait(250); await settle();
  assert.equal(w.writes().length, 1, 'never resent automatically');
  const key = w.writes()[0].body.idempotency_key;
  assert.equal(w.reads('/v1/eup/league/receipts/appeals.resolve/' + key), 1, 'the receipt is read by its key');
  assert.equal(m.outcome('appeal:' + x.id).kind, 'done'); assert.match(m.outcome('appeal:' + x.id).text, /Resolve the appeal was recorded: its receipt was found by its key \(state upheld\b.*\)\. It was not resent\./);
  assert.equal(m.q('[data-eup-league-appeal="' + x.id + '"]').attrs['data-eup-league-status'], 'upheld', 'and read back');
  /* 2. the request never reached the store: the receipt is not found, the same command is offered by hand */
  await m.league('applications');
  const peer = w.s.applications[1];
  w.s.hooks['applications.decide'] = 'refuse';
  m.set('decide:' + peer.id, 'decision', 'declined'); m.set('decide:' + peer.id, 'reason', 'Test fixture: declined.');
  await m.press('applications.decide', peer.id); await wait(10); await settle();
  assert.equal(m.outcome('application:' + peer.id).kind, 'unknown');
  assert.match(m.outcome('application:' + peer.id).text, /not recorded when its receipt was read .* It was not resent\. Send the same command again/);
  const first = lastWrite(w);
  assert.equal(w.writes().filter((l) => l.path.endsWith('/decision')).length, 1);
  await m.ui('resend', 'application:' + peer.id);
  const again = lastWrite(w);
  assert.deepEqual(again.body, first.body, 'the same body: the same key and the same expected revision'); assert.equal(again.path, first.path);
  assert.equal(m.outcome('application:' + peer.id).kind, 'done'); assert.equal(w.s.applications[1].status, 'declined');
  assert.equal(m.qa('[data-eup-league-do="resend"]').length, 0, 'nothing is offered again once it is recorded');
  /* 3. the receipt itself cannot be read: no resend, a second receipt read is offered */
  const own = w.s.applications[2];
  w.s.hooks['applications.decide'] = 'drop';
  const receiptsDown = http(503, 'storage_unavailable');
  w.s.hooks['receipts.get'] = receiptsDown;
  m.set('decide:' + own.id, 'decision', 'declined'); m.set('decide:' + own.id, 'reason', 'Test fixture.');
  await m.press('applications.decide', own.id); await wait(10); await settle();
  assert.equal(m.outcome('application:' + own.id).kind, 'unknown'); assert.match(m.outcome('application:' + own.id).text, /its receipt could not be read \(HTTP 503 storage_unavailable\)\. It was not resent\. Read the receipt again/);
  assert.equal(m.qa('[data-eup-league-do="resend"]').length, 0, 'no resend while the receipt is unread');
  delete w.s.hooks['receipts.get'];
  await m.ui('receipt', 'application:' + own.id);
  /* the dropped command had in fact been refused by the store (self-approval), so no receipt exists */
  assert.equal(m.outcome('application:' + own.id).kind, 'unknown'); assert.match(m.outcome('application:' + own.id).text, /not recorded when its receipt was read/);
  const before = w.writes().length;
  await m.ui('resend', 'application:' + own.id);
  assert.equal(w.writes().length, before + 1); assert.deepEqual(lastWrite(w).body, w.writes().at(-2).body, 'the same key and body once more');
  assert.equal(m.outcome('application:' + own.id).kind, 'error'); assert.match(m.outcome('application:' + own.id).text, /nobody approves, reviews or resolves their own work/, 'and the store\'s answer is now known');
  /* 4. a receipt that names another key is not this command's receipt */
  const tester = w.s.applications[0];
  w.s.hooks['applications.decide'] = 'drop';
  w.s.hooks['receipts.get'] = () => Promise.resolve({ ok: true, receipt: { surface: 'owner', operation: 'applications.decide', idempotency_key: 'another-command-key-0001', result: { status: 'declined', revision: 3 }, created_at: T0 } });
  m.set('decide:' + tester.id, 'decision', 'declined'); m.set('decide:' + tester.id, 'reason', 'Test fixture.');
  await m.press('applications.decide', tester.id); await wait(10); await settle();
  assert.equal(m.outcome('application:' + tester.id).kind, 'unknown'); assert.match(m.outcome('application:' + tester.id).text, /its receipt could not be read \(an unreadable answer\)/);
  delete w.s.hooks['receipts.get'];
  await m.ui('receipt', 'application:' + tester.id);
  assert.equal(m.outcome('application:' + tester.id).kind, 'done', 'its own receipt, read again, says it was recorded');
  assert.equal(w.writes().filter((l) => l.path === '/v1/eup/league/applications/' + tester.id + '/decision').length, 1, 'and it was sent once');
});

test('a dropped answer after commit is found by its receipt; the same key under a resend is recorded once', async () => {
  const w = leagueWorker(); world(w);
  const m = mount(w, { deadlineMs: 30 }); await settle();
  await m.league('retention');
  assert.match(m.text(), /media of completed work is kept 30 days, of withdrawn work 7 days/);
  assert.equal(m.qa('[data-eup-league-due]').length, 2); assert.equal(m.button('media.purged', '', U(180)), null, 'a purge asks first');
  await m.ui('confirm', 'purge');
  w.s.hooks['media.purged'] = 'drop';
  await m.press('media.purged', '', U(180)); await wait(10); await settle();
  assert.deepEqual(lastWrite(w).body.uploads, [U(180)], 'only the due upload'); assert.equal(lastWrite(w).body.expected_revision, undefined);
  assert.equal(m.outcome('purge').kind, 'done'); assert.match(m.outcome('purge').text, /was recorded: its receipt was found by its key \(purged 1 · already purged 0 · publications withdrawn 0 · recorded [^)]+\)\. It was not resent\./);
  assert.equal(w.writes().length, 1, 'not resent'); assert.equal(m.qa('[data-eup-league-due]').length, 1, 'read back: the purged row is gone');
});

/* ================================================================== publication, appeals, 403 */
test('publication: publish binds the participant\'s open consent for this exact revision; withdraw needs a reason; a revoked consent is reflected', async () => {
  const w = leagueWorker(); world(w);
  const m = mount(w); await settle();
  await m.league('publication');
  const p = w.s.proofs[1], k = w.s.consents[0];
  assert.match(m.text(), /Publication means visible to the campaign's released audience only\. Nothing here is public/);
  assert.equal(m.q('[data-eup-league-consent="' + k.id + '"]').attrs['data-eup-league-status'], 'open');
  await m.press('publications.decide', p.id, 'published:' + k.id);
  assert.deepEqual(lastWrite(w).body, { idempotency_key: lastWrite(w).body.idempotency_key, expected_revision: 1, decision: 'published', consent_id: k.id });
  assert.equal(m.q('[data-eup-league-publication-card="' + p.id + '"]').attrs['data-eup-league-status'], 'published_released_audience');
  await m.press('publications.decide', p.id, 'withdrawn');
  assert.match(m.outcome('publication:' + p.id).text, /A reason is required/); assert.equal(w.writes().length, 1);
  m.set('publication:' + p.id, 'reason', 'Test fixture: withdrawn by the owner.');
  await m.press('publications.decide', p.id, 'withdrawn');
  assert.deepEqual([lastWrite(w).body.decision, lastWrite(w).body.reason, lastWrite(w).body.expected_revision], ['withdrawn', 'Test fixture: withdrawn by the owner.', 1]);
  assert.equal(m.qa('[data-eup-league-publication]').find((x) => x.attrs['data-eup-league-status'] === 'withdrawn:owner') !== undefined, true);
  /* the participant revokes elsewhere: the next read shows it, and publishing is no longer offered */
  w.s.consents[0].state = 'revoked'; w.s.consents[0].revoked_at = T0;
  await m.league('publication');
  assert.equal(m.q('[data-eup-league-consent="' + k.id + '"]').attrs['data-eup-league-status'], 'revoked');
  assert.match(m.q('[data-eup-league-blocked="' + p.id + '"]').textContent, /No open publication consent from the participant/);
  assert.equal(m.button('publications.decide', p.id, 'published:' + k.id), null);
});

test('appeals: resolve needs an outcome and a reason, and compares no revision', async () => {
  const w = leagueWorker(); world(w);
  const m = mount(w); await settle();
  await m.league('appeals');
  const x = w.s.appeals[0];
  await m.press('appeals.resolve', x.id);
  assert.match(m.outcome('appeal:' + x.id).text, /choose uphold or overturn/); assert.equal(w.writes().length, 0);
  m.set('resolve:' + x.id, 'outcome', 'overturned');
  await m.press('appeals.resolve', x.id);
  assert.match(m.outcome('appeal:' + x.id).text, /A reason is required/);
  m.set('resolve:' + x.id, 'reason', 'Test fixture: overturned.');
  await m.press('appeals.resolve', x.id);
  assert.deepEqual(Object.keys(lastWrite(w).body).sort(), ['idempotency_key', 'outcome', 'reason']);
  assert.equal(m.q('[data-eup-league-appeal="' + x.id + '"]').attrs['data-eup-league-status'], 'overturned');
});

test('403 owner_required on a League read or command conceals the whole workspace; 401 signs it out', async () => {
  const a = leagueWorker(); world(a);
  a.s.hooks['proofs.list'] = http(403, 'owner_required', 'House owner required');
  const m = mount(a); await settle();
  await m.league('proofs');
  assert.deepEqual(m.qa('[data-eup-note]').map((n) => n.attrs['data-eup-note']), ['denied']);
  assert.doesNotMatch(m.text(), /Test fixture/); assert.deepEqual(E.helpers.model().data, {});
  const b = leagueWorker(); world(b);
  const n = mount(b); await settle();
  await n.league('applications');
  b.s.hooks['applications.decide'] = http(403, 'owner_required');
  const t = b.s.applications[0];
  n.set('decide:' + t.id, 'decision', 'declined'); n.set('decide:' + t.id, 'reason', 'x');
  await n.press('applications.decide', t.id);
  assert.deepEqual(n.qa('[data-eup-note]').map((x) => x.attrs['data-eup-note']), ['denied'], 'a command answered 403 owner_required conceals too');
  assert.deepEqual(E.helpers.league().inspect().outcomes, {}, 'and leaves no outcome behind');
  const c = leagueWorker(); world(c);
  c.s.hooks['campaigns.list'] = http(401);
  const o = mount(c); await settle();
  await o.league();
  assert.ok(o.qa('[data-eup-note="signed_out"]').length >= 1);
});

test('the League panel is aria-busy from the first read of a load until its last dependent read settles', async () => {
  const w = leagueWorker(); const { camp } = world(w);
  let give;
  w.s.hooks['audience.grants.list'] = () => new Promise((r) => { give = r; });
  const m = mount(w); await settle();
  await m.league();
  assert.equal(m.q('[data-eup-league-view]').attrs['aria-busy'], 'true', 'campaigns are read, the grants of each are still on their way');
  delete w.s.hooks['audience.grants.list'];
  give(await w.request('/v1/eup/league/campaigns/' + camp.id + '/audience/grants')); await settle();
  assert.equal(m.q('[data-eup-league-view]').attrs['aria-busy'], 'false');
  assert.equal(m.q('[data-eup-league-grant="' + w.s.grants[0].id + '"]').attrs['data-eup-league-status'], 'open');
});

/* ================================================================== the whole run: keys, revisions, words */
test('every command the tab sends carries a fresh uuid key, and an expected revision exactly where the contract route compares one', async () => {
  const w = leagueWorker(); const { camp, song } = world(w);
  w.s.missions[0].capacity = 5;
  const m = mount(w); await settle();
  await m.league();
  m.set('policy', 'withdrawn_days', '8'); m.set('policy', 'reason', 'Unit test: revision 2.'); await m.press('policy.set');
  await m.press('campaigns.audience.set', camp.id, 'admin_preview');
  await m.press('missions.create', camp.id);
  m.set('mission-new:' + camp.id, 'slug', 'second-song');
  await m.press('missions.create', camp.id);
  await m.ui('edit', song.id); m.set('mission:' + song.id, 'capacity', '4'); await m.press('missions.update', song.id);
  await m.press('missions.transition', song.id, 'paused');
  m.set('grant:' + camp.id, 'account', PEER); await m.press('audience.grants.grant', camp.id);
  await m.league('applications');
  const t = w.s.applications[0];
  m.set('decide:' + t.id, 'decision', 'changes_requested'); m.set('decide:' + t.id, 'reason', 'Test fixture.'); await m.press('applications.decide', t.id);
  await m.league('proofs');
  const p = w.s.proofs[0];
  m.set('moderate:' + p.id, 'reason', 'Test fixture hold.'); await m.press('proofs.moderate', p.id, 'hold');
  m.set('moderate:' + p.id, 'reason', 'Test fixture release.'); await m.press('proofs.moderate', p.id, 'release');
  await m.ui('review', p.id);
  for (const d of ['mission', 'rights', 'safety']) m.set('review:' + p.id, d, 'fail');
  m.set('review:' + p.id, 'reason', 'Test fixture: rejected.'); await m.press('proofs.review', p.id);
  await m.league('publication');
  await m.press('publications.decide', w.s.proofs[1].id, 'published:' + w.s.consents[0].id);
  await m.league('appeals');
  m.set('resolve:' + w.s.appeals[0].id, 'outcome', 'upheld'); m.set('resolve:' + w.s.appeals[0].id, 'reason', 'Test fixture.'); await m.press('appeals.resolve', w.s.appeals[0].id);
  await m.league('retention'); await m.ui('confirm', 'purge'); await m.press('media.purged', '', U(180));
  const writes = w.writes();
  const actions = new Set();
  for (const wr of writes) {
    const url = new URL('https://api.mccluster.org' + wr.path), hit = C.matchRoute('owner', wr.method, url.pathname.slice(C.PREFIX.owner.length + 1));
    assert.ok(hit && hit.route.action, wr.method + ' ' + wr.path + ' is an owner command route');
    actions.add(hit.route.action);
    assert.match(wr.body.idempotency_key, UUIDV4, hit.route.action + ': a uuid key');
    assert.equal(Object.hasOwn(wr.body, 'expected_revision'), hit.route.expected_revision, hit.route.action + ': expected_revision exactly where the route compares one');
    if (hit.route.expected_revision) assert.ok(Number.isSafeInteger(wr.body.expected_revision), hit.route.action + ': an integer revision');
    for (const k of Object.keys(wr.body)) assert.ok(['idempotency_key', 'expected_revision', ...(hit.route.wrapper ? [hit.route.wrapper] : []), ...hit.route.fields].includes(k), hit.route.action + ' sends only fields its route reads: ' + k);
    assert.ok(wr.signal, 'every command carries an AbortSignal');
  }
  assert.equal(new Set(writes.map((x) => x.body.idempotency_key)).size, writes.length, 'a fresh key for every command');
  assert.deepEqual([...actions].sort(), Object.keys(H.COMMANDS).filter((a) => a !== 'campaigns.create' && a !== 'audience.grants.revoke' && a !== 'campaigns.transition').sort(), 'this run sent the other twelve command kinds');
  assert.equal(writes.every((wr) => !JSON.stringify(wr.body).includes(OWNER)), true, 'no command names the acting account: the Worker takes it from the session');
});

test('rendered fields are the contract\'s; the old field names are gone; no mark, price or public wording', () => {
  for (const old of ['review_state', 'publication_consent', 'mission_title', 'applicant_id']) assert.doesNotMatch(source, new RegExp(old), 'the old field name ' + old + ' is gone');
  for (const field of ['publication_state', 'moderation_state', 'reviews', 'asset_revision', 'reviewed_revision', 'accommodation_requested', 'requirements_revision', 'seats_taken', 'scan_state']) assert.match(source, new RegExp('\\b' + field + '\\b'), field + ' is read');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ''); /* the words the page can show, without the comments that explain them */
  assert.doesNotMatch(code, /\b(price|purchase|upgrade|subscribe|subscription|checkout|buy|payouts?)\b/i, 'no sale wording');
  for (const hit of code.match(/.{0,4}\b(points|payment)\b/gi) || []) assert.match(hit, /\bno /i, 'points and payment are only ever named to say there are none: ' + hit);
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.(log|warn|error|info)/, 'nothing is stored or logged');
  assert.doesNotMatch(source, /<svg|<img|logo/i, 'text only, no mark');
  assert.doesNotMatch(source, /Human Uprise/);
});

/* ================================================================== review of 2026-11-10 */
const pressed = async (m, action, id = '', arg = '') => { document.activeElement = null; await m.press(action, id, arg); }; /* the pressed control is replaced by the redraw */
const focusKeyOf = () => (document.activeElement && document.activeElement.attrs ? document.activeElement.attrs['data-eup-focus'] : null);

test('proofs: work the participant withdrew from is not offered for review, and the card says they withdrew', async () => {
  const w = leagueWorker(); world(w);
  const asg = w.s.assignments.find((a) => a.id === U(130)); asg.status = 'withdrawn'; asg.withdrawn_at = T0;
  const m = mount(w); await settle();
  await m.league('proofs');
  const [p, , own] = w.s.proofs;
  const offered = (id) => m.qa('[data-eup-league-do="review"]').some((b) => b.attrs['data-eup-league-id'] === id);
  assert.equal(offered(p.id), false, 'no review is offered for withdrawn work (its private_review consent was revoked with the withdrawal)');
  const said = m.q('[data-eup-league-withdrawn="' + p.id + '"]');
  assert.ok(said, 'the card says why'); assert.match(said.textContent, /participant withdrew from this mission/);
  assert.equal(offered(own.id), true, 'work whose assignment is still accepted is offered as before');
  assert.equal(m.q('[data-eup-league-withdrawn="' + own.id + '"]'), null);
});

test('publication: consents are read per proof, so a League whose consent list passed its cap still shows and publishes a later participant\'s consent', async () => {
  const route = C.ROUTES.find((r) => r.surface === 'owner' && r.method === 'GET' && r.path === 'consents');
  assert.equal(route.query.proof, 'id', 'the contract reads one proof\'s consents by ?proof=<id>');
  const w = leagueWorker(); world(w);
  const p = w.s.proofs[1], k = w.s.consents[0];
  /* an older, revoked consent on each of LIMITS.list.rows other proofs fills the tenant-wide list */
  for (let i = 0; i < C.LIMITS.list.rows; i += 1) w.s.consents.push({ ...k, id: U(20000 + i), proof_id: U(30000 + i), state: 'revoked', granted_at: '2026-11-01T12:00:00.000Z', revoked_at: T0 });
  const m = mount(w); await settle();
  await m.league('publication');
  assert.equal(m.q('[data-eup-league-consent="' + k.id + '"]')?.attrs['data-eup-league-status'], 'open', 'the participant\'s open consent is listed');
  assert.ok(m.button('publications.decide', p.id, 'published:' + k.id), 'and publishing it is offered');
  assert.equal(w.log.filter((l) => l.method === 'GET' && l.path === '/v1/eup/league/consents').length, 0, 'the tenant-wide consent list is not what the page decides from');
  assert.ok(w.log.some((l) => l.method === 'GET' && l.path === '/v1/eup/league/consents?proof=' + p.id), 'each shown proof\'s consents are read by its id');
  await m.press('publications.decide', p.id, 'published:' + k.id);
  assert.equal(m.q('[data-eup-league-publication-card="' + p.id + '"]').attrs['data-eup-league-status'], 'published_released_audience');
  assert.equal(H.LIMITS.list.rows, C.LIMITS.list.rows, 'the list cap the page names is the contract\'s');
  /* one proof's own list at the cap (not reachable through the store, which bounds consents per proof) says so */
  const w2 = leagueWorker(); world(w2);
  const p2 = w2.s.proofs[1];
  for (let i = 0; i < C.LIMITS.list.rows; i += 1) w2.s.consents.push({ ...w2.s.consents[0], id: U(40000 + i), state: 'revoked', granted_at: '2026-11-01T12:00:00.000Z', revoked_at: T0 });
  const n = mount(w2); await settle();
  await n.league('publication');
  assert.match(n.q('[data-eup-league-blocked="' + p2.id + '"]').textContent, /came back at its cap/, 'a list at its cap is not read as "no consent"');
  assert.doesNotMatch(n.q('[data-eup-league-blocked="' + p2.id + '"]').textContent, /No open publication consent/);
});

test('a decided record that no longer matches the view\'s filter keeps its outcome at the top of the view, says so, and takes focus', async () => {
  const w = leagueWorker(); world(w);
  const m = mount(w); await settle();
  /* Applications filtered to submitted: Decline */
  await m.league('applications');
  m.set('filter:applications', 'value', 'submitted'); await m.ui('filter', 'applications');
  const t = w.s.applications[0];
  m.set('decide:' + t.id, 'decision', 'declined'); m.set('decide:' + t.id, 'reason', 'Test fixture: declined.');
  await pressed(m, 'applications.decide', t.id);
  assert.equal(w.s.applications[0].status, 'declined');
  assert.equal(m.q('[data-eup-league-application="' + t.id + '"]'), null, 'its card left the filtered list');
  const a = m.outcome('application:' + t.id);
  assert.ok(a, 'its outcome is still on the page'); assert.equal(a.kind, 'done');
  assert.match(a.text, /recorded · status declined/); assert.match(a.text, /no longer matches the filter \(status submitted\)/); assert.doesNotMatch(a.text, /Read back below/);
  assert.equal(focusKeyOf(), 'league:outcome:application:' + t.id, 'focus lands on the outcome, not the page body');
  assert.match(m.status(), /no longer matches the filter/);
  /* Proofs filtered to submitted: three passes accept the proof */
  await m.league('proofs');
  m.set('filter:proofs', 'value', 'submitted'); await m.ui('filter', 'proofs');
  const p = w.s.proofs[0];
  await m.ui('review', p.id);
  for (const d of ['mission', 'rights', 'safety']) m.set('review:' + p.id, d, 'pass');
  m.set('review:' + p.id, 'met:complete', true);
  await pressed(m, 'proofs.review', p.id);
  assert.equal(w.s.proofs[0].state, 'accepted');
  assert.equal(m.q('[data-eup-league-proof="' + p.id + '"]'), null);
  assert.match(m.outcome('proof:' + p.id)?.text || '', /recorded · state accepted.*no longer matches the filter \(state submitted\)/);
  assert.equal(focusKeyOf(), 'league:outcome:proof:' + p.id);
  /* Appeals filtered to open: resolve upheld */
  await m.league('appeals');
  m.set('filter:appeals', 'value', 'open'); await m.ui('filter', 'appeals');
  const x = w.s.appeals[0];
  m.set('resolve:' + x.id, 'outcome', 'upheld'); m.set('resolve:' + x.id, 'reason', 'Test fixture: the decision stands.');
  await pressed(m, 'appeals.resolve', x.id);
  assert.equal(w.s.appeals[0].state, 'upheld');
  assert.match(m.outcome('appeal:' + x.id)?.text || '', /recorded · state upheld.*no longer matches the filter \(state open\)/);
  assert.equal(focusKeyOf(), 'league:outcome:appeal:' + x.id);
  /* with the filter back to all, the record's own card carries the outcome again, and it reads "Read back below" */
  m.set('filter:appeals', 'value', ''); await m.ui('filter', 'appeals');
  assert.ok(m.q('[data-eup-league-appeal="' + x.id + '"]'));
  assert.match(m.outcome('appeal:' + x.id).text, /Read back below\.$/);
  assert.equal(m.qa('[data-eup-league-away]').length, 0, 'nothing is drawn twice');
});

test('a refreshed token of the same owner, written by another tab, keeps the League (typed text, a pending command\'s answer); another account or no session conceals', async () => {
  const store = {};
  const tokenOf = (sub, n) => 'x.' + Buffer.from(JSON.stringify({ sub, exp: 4102444800, n })).toString('base64url') + '.y';
  const save = (sub, n) => { if (sub) store.mccdb_session = JSON.stringify({ access_token: tokenOf(sub, n), refresh_token: 'fixture-only', user: { id: sub } }); else delete store.mccdb_session; };
  const written = (key = 'mccdb_session') => window.dispatchEvent(Object.assign(new Event('storage'), { key }));
  window.localStorage = { getItem: (k) => (Object.hasOwn(store, k) ? store[k] : null) };
  window.atob = globalThis.atob;
  try {
    save(OWNER, 1);
    const w = leagueWorker(); world(w);
    const m = mount(w); await settle();
    await m.league();
    m.set('policy', 'reason', 'Typed before the token was refreshed.');
    let give;
    w.s.hooks['campaigns.create'] = () => new Promise((r) => { give = r; });
    await m.press('campaigns.create');
    assert.equal(m.outcome('campaign:new').kind, 'pending');
    save(OWNER, 2); written(); await settle();
    written('mcc_privacy_ack'); await settle();
    assert.equal(m.qa('[data-eup-note="signed_out"]').length, 0, 'the same owner with a new token is not an account change');
    assert.doesNotMatch(m.status(), /Account changed/);
    assert.equal(m.input('policy', 'reason')?.value, 'Typed before the token was refreshed.', 'typed text stays');
    delete w.s.hooks['campaigns.create'];
    const sent = w.writes().at(-1);
    give(await w.request(sent.path, { method: sent.method, body: sent.body })); await settle();
    assert.equal(m.outcome('campaign:new')?.kind, 'done', 'the pending command\'s answer is shown'); assert.match(m.outcome('campaign:new').text, /Create the campaign: recorded/);
    assert.equal(m.input('policy', 'reason')?.value, 'Typed before the token was refreshed.');
    /* another account in the stored session conceals, as before */
    save(PEER, 3); written(); await settle();
    assert.equal(m.qa('[data-eup-note="signed_out"]').length, 1, 'another account conceals'); assert.match(m.status(), /Account changed/);
    /* a session that is gone conceals; so does a cleared storage (key null) */
    for (const key of ['mccdb_session', null]) {
      save(OWNER, 4);
      const v = leagueWorker(); world(v);
      const n = mount(v); await settle();
      await n.league();
      save(null); written(key); await settle();
      assert.equal(n.qa('[data-eup-note="signed_out"]').length, 1, 'no stored session conceals (key ' + key + ')');
    }
  } finally { delete window.localStorage; delete window.atob; }
});

test('accessible names: each campaign and mission is a named group, each revoke is described by its account, each review player names its take and revision', async () => {
  const w = leagueWorker(); const { camp, song } = world(w);
  w.s.grants.push({ ...w.s.grants[0], id: U(111), account: PEER, note: 'Second tester.' });
  const p = w.s.proofs[0], up2 = { ...p.uploads[0], id: U(199), sha256: SHA(8), storage: { object_id: U(5199), etag: 'etag-199', size: 640 } };
  p.uploads.push(up2); p.media.push({ upload_id: up2.id, kind: 'audio', mime: 'audio/webm', bytes: 640, sha256: up2.sha256 }); p.document.media.push({ upload_id: up2.id, sha256: up2.sha256 });
  const m = mount(w); await settle();
  await m.league();
  const named = (sel, tag, re) => {
    const box = m.q(sel); assert.ok(box, sel);
    const id = box.attrs['aria-labelledby']; assert.ok(id, sel + ' is named by its heading');
    const head = m.q('[id="' + id + '"]'); assert.ok(head && head.tag === tag, sel + ': ' + id + ' is its ' + tag); assert.match(head.textContent, re);
  };
  named('[data-eup-league-campaign="' + camp.id + '"]', 'h3', /Test fixture campaign/);
  named('[data-eup-league-mission="' + song.id + '"]', 'h5', /Test fixture song mission/);
  const revokes = m.qa('[data-eup-league-command="audience.grants.revoke"]');
  assert.equal(revokes.length, 2);
  const told = revokes.map((b) => { const d = b.attrs['aria-describedby'] && m.q('[id="' + b.attrs['aria-describedby'] + '"]'); return d ? d.textContent : null; });
  assert.deepEqual(told.map((t) => [TESTER, PEER].find((a) => t && t.includes(a)) || null), [TESTER, PEER], 'each Revoke access is described by the account it revokes');
  await m.league('proofs');
  created.length = 0;
  await m.ui('review', p.id);
  const labels = created.filter((e) => e.tag === 'audio').map((e) => e.attrs['aria-label']);
  assert.equal(labels.length, 2);
  assert.equal(new Set(labels).size, 2, 'the two players do not share one name');
  labels.forEach((l, i) => assert.match(l, new RegExp('^Audio ' + (i + 1) + ' of 2, revision 1 under review$')));
  await m.ui('review-close', p.id); /* drops the links and their 300 s expiry timer */
  assert.equal(E.helpers.league().inspect().links, 0);
});

test('League headings wrap a one-word title (1 to 180 code points, one line) inside the card', async () => {
  const css = await readFile(new URL('../../css/control-eup.css', import.meta.url), 'utf8');
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((r) => ({ selectors: r[1].split(',').map((s) => s.trim()), body: r[2] }));
  for (const sel of ['.cr-eup__card h3', '.cr-eup__card h4', '.cr-eup-league h5']) {
    assert.ok(rules.some((r) => r.selectors.includes(sel) && /overflow-wrap:\s*anywhere/.test(r.body)) || rules.some((r) => r.selectors.includes('.cr-eup-league') && /overflow-wrap:\s*anywhere/.test(r.body)),
      sel + ' wraps a long word anywhere');
  }
});
