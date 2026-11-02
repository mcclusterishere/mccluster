// The owned proposal slice (OWNED-ARCHITECTURE.md): host-bound envelope, bounded single-tile text changes, pure
// preview, stale/dirty rejection. No persistence or network happens anywhere in this module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBase, envelope, validateChanges, candidate, stillValid, createRun, undoEntry, PROPOSAL_SCHEMA, MAX_PROPOSAL_BYTES } from '../../js/website-studio/proposal.mjs';
import { renderPlan } from '../../js/website-studio/contract.mjs';

const tile = (id, kind, headline, body) => ({ id, kind, headline, body, source_ref: null, transition: null, playback: 'manual', action: null });
const DOC = { schema_version: 'website-studio/v1', template_key: 'motion-portfolio', template_version: 1, title: 'T', mode: 'standard', tiles: [tile('tile-1', 'music', 'One', 'First body'), tile('tile-2', 'native_video', 'Two', 'Second body'), tile('tile-3', 'immersive360', 'Three', 'Third body')] };
const base = () => captureBase({ projectId: 'proj-uuid', document: DOC, editorRevision: 12, studioRevision: 4 });

test('capture binds project, both revisions and a digest; the envelope carries only host identities', async () => {
  const b = await base();
  assert.deepEqual(b.baseRevision, { editor: 12, studio: 4 }); assert.match(b.baseDocumentDigest, /^[0-9a-f]{64}$/);
  const env = envelope(b, { proposalId: 'p1', runId: 'r1', tileId: 'tile-2' });
  assert.equal(env.schema, PROPOSAL_SCHEMA); assert.deepEqual(env.target, { projectId: 'proj-uuid', tileId: 'tile-2' });
  assert.throws(() => envelope(b, { proposalId: 'p1', runId: 'r1', tileId: 'tile-9' }), /not in the captured document/);
  await assert.rejects(captureBase({ projectId: 'proj-uuid', document: DOC, editorRevision: 12 }), /both base revisions/);
});

test('a valid headline/body patch changes exactly one stable tile of any kind and preserves everything else', async () => {
  const b = await base();
  for (const id of ['tile-1', 'tile-2', 'tile-3']) {
    const env = envelope(b, { proposalId: 'p', runId: 'r', tileId: id });
    const c = candidate(b, env, validateChanges({ headline: 'A clearer heading', body: 'Reviewed replacement copy.' }));
    assert.equal(c.tileId, id);
    assert.deepEqual(c.document.tiles.map(t => t.id), ['tile-1', 'tile-2', 'tile-3']);
    assert.deepEqual(c.document.tiles.map(t => t.kind), DOC.tiles.map(t => t.kind));
    for (const t of c.document.tiles) if (t.id !== id) assert.deepEqual(t, DOC.tiles.find(x => x.id === t.id));
    assert.equal(c.document.template_key, DOC.template_key); assert.equal(c.document.mode, DOC.mode);
    assert.deepEqual(c.diff.map(d => d.field), ['headline', 'body']);
    assert.equal(renderPlan(c.document).length, renderPlan(DOC).length, 'same renderPlan shape');
  }
  assert.deepEqual(b.document, DOC, 'the base is never mutated');
});

test('unknown fields, empty, oversized, markup, non-text, too long and no-op proposals are rejected, not stripped', async () => {
  const b = await base(); const env = envelope(b, { proposalId: 'p', runId: 'r', tileId: 'tile-1' });
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
  assert.equal(code(() => validateChanges({ headline: 'x', kind: 'music' })), 'unknown_field');
  assert.equal(code(() => validateChanges({ headline: 'x', source_ref: { type: 'media_asset', key: 'k' } })), 'unknown_field');
  assert.equal(code(() => validateChanges({})), 'empty_changes');
  assert.equal(code(() => validateChanges({ body: 'x'.repeat(MAX_PROPOSAL_BYTES) })), 'oversized');
  assert.equal(code(() => validateChanges({ headline: '<b>bold</b>' })), 'markup_refused');
  assert.equal(code(() => validateChanges({ headline: 7 })), 'invalid_text');
  assert.equal(code(() => validateChanges({ headline: '   ' })), 'invalid_text');
  assert.equal(code(() => validateChanges({ headline: 'h'.repeat(121) })), 'too_long');
  assert.equal(code(() => validateChanges({ body: 'b'.repeat(2001) })), 'too_long');
  assert.equal(code(() => candidate(b, env, { headline: 'One', body: 'First body' })), 'no_change');
  assert.equal(code(() => candidate(b, { ...env, baseDocumentDigest: 'ffff' }, { headline: 'x' })), 'stale_base');
  assert.equal(code(() => candidate(b, { schema: 'other' }, { headline: 'x' })), 'invalid_envelope');
});

test('dirty local edits, a moved revision pair or a project change invalidate the proposal', async () => {
  const b = await base();
  assert.deepEqual(await stillValid(b, { document: DOC, editorRevision: 12, studioRevision: 4, projectId: 'proj-uuid' }), { ok: true });
  const dirty = structuredClone(DOC); dirty.tiles[0].headline = 'typed meanwhile';
  assert.equal((await stillValid(b, { document: dirty, editorRevision: 12, studioRevision: 4, projectId: 'proj-uuid' })).reason, 'dirty_draft');
  assert.equal((await stillValid(b, { document: DOC, editorRevision: 13, studioRevision: 4, projectId: 'proj-uuid' })).reason, 'revision_changed');
  assert.equal((await stillValid(b, { document: DOC, editorRevision: 12, studioRevision: 4, projectId: 'other' })).reason, 'project_changed');
});

test('a cancelled run discards late output; an undo entry carries pre/post drafts and the returned tokens', () => {
  const r = createRun(); let got = null; const accept = r.accept(v => { got = v; });
  r.cancel(); accept('late'); assert.equal(got, null); assert.equal(r.run.state, 'cancelled');
  const u = undoEntry({ before: DOC, after: { ...DOC, title: 'x' }, appliedTokens: { editor: 13, studio: 5 }, proposalId: 'p' });
  assert.deepEqual(u.tokens, { editor: 13, studio: 5 }); assert.equal(u.before.title, 'T'); assert.equal(u.after.title, 'x');
});
