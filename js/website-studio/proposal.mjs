/* THE OWNED PROPOSAL MECHANISM (docs/productization/20261102/OWNED-ARCHITECTURE.md, "First owned slice").

   A proposal is a bounded change to ONE existing tile's headline and/or body, captured against an exact base:
   the owner's draft, both revisions (editor head + Studio draft) and a digest of the captured document. The host
   binds that scope; whatever produced the change (McCluster, or the owner typing it) cannot widen it. Preview is
   pure (no persistence, no network); Apply is the existing dual-revision save and nothing else; Undo after a
   confirmed Apply is a NEW deliberate save of the prior draft on the returned tokens. Model output is text that
   is validated here, never executed, never a component, never a tool call.

   States: idle → requesting → proposed → previewed → applying → applied; rejected / cancelled / failed /
   conflict / unknown-outcome are distinct exits. Chat state never enters the persisted document. */
import { assertDocument } from './contract.mjs';

export const PROPOSAL_SCHEMA = 'mccluster-tile-proposal/v1';
export const MAX_PROPOSAL_BYTES = 8 * 1024;
export const FIELD_LIMITS = Object.freeze({ headline: 120, body: 2000 });
const UTF8 = new TextEncoder();

export function digestOf(document) {
  const bytes = UTF8.encode(JSON.stringify(document));
  // SHA-256 when the platform offers it (browsers, Node); callers await the promise.
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('digest: crypto.subtle unavailable');
  return subtle.digest('SHA-256', bytes).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
}

/* The base a proposal is bound to: an exact immutable capture of what the owner is looking at. */
export async function captureBase({ projectId, document, editorRevision, studioRevision }) {
  assertDocument(document);
  if (typeof projectId !== 'string' || !projectId) throw new Error('capture: project identity required');
  if (!Number.isSafeInteger(editorRevision) || editorRevision < 0 || !Number.isSafeInteger(studioRevision) || studioRevision < 0) throw new Error('capture: both base revisions required');
  const snapshot = structuredClone(document);
  return Object.freeze({ projectId, document: snapshot, baseRevision: Object.freeze({ editor: editorRevision, studio: studioRevision }), baseDocumentDigest: await digestOf(snapshot) });
}

/* The host's envelope for one run. Nothing model-supplied is accepted into target/base. */
export function envelope(base, { proposalId, runId, tileId }) {
  if (!base || !base.document) throw new Error('envelope: base required');
  if (!base.document.tiles.some(t => t.id === tileId)) throw new Error('envelope: target tile is not in the captured document');
  if (typeof proposalId !== 'string' || !proposalId || typeof runId !== 'string' || !runId) throw new Error('envelope: host identities required');
  return Object.freeze({ schema: PROPOSAL_SCHEMA, proposalId, runId, target: Object.freeze({ projectId: base.projectId, tileId }), baseRevision: base.baseRevision, baseDocumentDigest: base.baseDocumentDigest });
}

/* Bounded changes: only headline/body of the one target tile; unknown fields, empty, oversized or non-text are
   rejected, not silently stripped. Returns the accepted {headline?, body?} or throws with .code. */
export function validateChanges(raw) {
  const reject = (code, message) => { throw Object.assign(new Error(message), { code }); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject('invalid_changes', 'The suggestion is not an object of changes.');
  const keys = Object.keys(raw);
  if (!keys.length) reject('empty_changes', 'The suggestion changes nothing.');
  const unknown = keys.filter(k => !(k in FIELD_LIMITS));
  if (unknown.length) reject('unknown_field', 'The suggestion touches fields this slice does not allow: ' + unknown.join(', '));
  if (UTF8.encode(JSON.stringify(raw)).length > MAX_PROPOSAL_BYTES) reject('oversized', 'The suggestion is larger than 8 KiB.');
  const out = {};
  for (const k of keys) {
    const v = raw[k];
    if (typeof v !== 'string') reject('invalid_text', k + ' must be text.');
    if (/[<>]|javascript:/i.test(v)) reject('markup_refused', k + ' may not contain markup.');
    const trimmed = v.replace(/\s+$/, '');
    if (!trimmed.trim().length) reject('invalid_text', k + ' may not be empty.');
    if (trimmed.length > FIELD_LIMITS[k]) reject('too_long', k + ' is longer than ' + FIELD_LIMITS[k] + ' characters.');
    out[k] = trimmed;
  }
  return out;
}

/* A candidate document: the captured document with the accepted changes applied to the one tile, by stable id.
   Everything else (ids, kinds, order, count, template, media, transitions, playback, actions) is untouched; the
   result is re-validated by the shared contract before it can be previewed. */
export function candidate(base, env, changes) {
  if (!env || env.schema !== PROPOSAL_SCHEMA) throw Object.assign(new Error('candidate: envelope required'), { code: 'invalid_envelope' });
  if (env.target.projectId !== base.projectId || env.baseDocumentDigest !== base.baseDocumentDigest) throw Object.assign(new Error('candidate: envelope does not bind this base'), { code: 'stale_base' });
  const doc = structuredClone(base.document);
  const tile = doc.tiles.find(t => t.id === env.target.tileId);
  if (!tile) throw Object.assign(new Error('candidate: target tile missing'), { code: 'missing_target' });
  const before = { headline: tile.headline, body: tile.body };
  for (const k of Object.keys(changes)) tile[k] = changes[k];
  assertDocument(doc);
  const after = { headline: tile.headline, body: tile.body };
  if (before.headline === after.headline && before.body === after.body) throw Object.assign(new Error('The suggestion is identical to the current tile.'), { code: 'no_change' });
  return Object.freeze({ document: doc, tileId: tile.id, before, after, diff: diffFields(before, after) });
}

export function diffFields(before, after) {
  return Object.keys(FIELD_LIMITS).filter(k => before[k] !== after[k]).map(k => ({ field: k, before: before[k], after: after[k] }));
}

/* Is the owner still looking at the base this proposal was made for? Dirty local edits after capture, a changed
   revision pair, or an account/project change all invalidate it: never overwrite them quietly. */
export async function stillValid(base, { document, editorRevision, studioRevision, projectId }) {
  if (projectId !== base.projectId) return { ok: false, reason: 'project_changed' };
  if (editorRevision !== base.baseRevision.editor || studioRevision !== base.baseRevision.studio) return { ok: false, reason: 'revision_changed' };
  if ((await digestOf(document)) !== base.baseDocumentDigest) return { ok: false, reason: 'dirty_draft' };
  return { ok: true };
}

/* One run: the host owns it; late output after cancel/switch is discarded. */
export function createRun() {
  const run = { id: 'run-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36), cancelled: false, state: 'idle' };
  return {
    run,
    cancel() { run.cancelled = true; run.state = 'cancelled'; },
    accept(fn) { return (...args) => { if (run.cancelled) return undefined; return fn(...args); }; }
  };
}

/* The one undo entry an accepted Apply produces: pre/post draft and the tokens the server returned. */
export function undoEntry({ before, after, appliedTokens, proposalId }) {
  return Object.freeze({ kind: 'proposal-apply', proposalId, before: structuredClone(before), after: structuredClone(after), tokens: Object.freeze({ ...appliedTokens }), at: new Date().toISOString() });
}
