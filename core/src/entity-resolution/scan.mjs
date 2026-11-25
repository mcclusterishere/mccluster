// One entity resolution scan: settle owner decisions already taken in Control,
// page through the ontology objects, find candidate pairs, and record them in
// batches. The database picks the band again and writes the audit trail; this
// side never writes a table directly. Contract: docs/control-plane/ENTITY-RESOLUTION.md
import { rest } from '../supabase.mjs';
import { DEFAULT_TYPE_KEYS, MATCHER_VERSION, THRESHOLDS, familyOf, findCandidates } from './match.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OBJECTS = 20000;
const PAGE = 2000;
const BATCH = 200;

export async function supabaseRpc(name, args) {
  const { body } = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
  return body;
}

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function scanOptions(args = {}) {
  const typeKeys = Array.isArray(args.type_keys) && args.type_keys.length
    ? [...new Set(args.type_keys.map((t) => String(t).trim()).filter(Boolean))]
    : [...DEFAULT_TYPE_KEYS];
  const unknown = typeKeys.filter((t) => !familyOf(t));
  if (unknown.length) throw bad(`type_keys outside the person and company families: ${unknown.join(', ')}`);
  const maxObjects = Math.min(MAX_OBJECTS, Math.max(1, Number(args.max_objects || 5000)));
  // Thresholds can be raised for a cautious run, never lowered below the floor.
  const thresholds = {
    auto: Math.min(1, Math.max(THRESHOLDS.auto, Number(args.auto_threshold ?? THRESHOLDS.auto))),
    review: Math.min(1, Math.max(THRESHOLDS.review, Number(args.review_threshold ?? THRESHOLDS.review))),
  };
  return { typeKeys, maxObjects, thresholds, dryRun: args.dry_run === true };
}

export async function runEntityMatchScan({ orgId, actorUserId, args = {}, trigger = 'tool', rpc = supabaseRpc } = {}) {
  if (!UUID.test(String(orgId || ''))) throw bad('org_id must be a UUID');
  if (!UUID.test(String(actorUserId || ''))) throw bad('authenticated actor user_id must be a UUID');
  const { typeKeys, maxObjects, thresholds, dryRun } = scanOptions(args);

  // Decisions the owner already took in Control are applied first, so a scan
  // never re-asks about a pair that was approved or denied minutes ago.
  const settled = dryRun ? { settled: [] } : await rpc('ops_entity_match_settle', { p_org: orgId, p_actor: actorUserId, p_match: null });

  const objects = [];
  let after = null;
  while (objects.length < maxObjects) {
    const limit = Math.min(PAGE, maxObjects - objects.length);
    const page = await rpc('ops_entity_match_objects', { p_org: orgId, p_type_keys: typeKeys, p_after_id: after, p_limit: limit });
    const rows = Array.isArray(page?.objects) ? page.objects : [];
    objects.push(...rows);
    if (rows.length < limit || !page?.next_after_id) break;
    after = page.next_after_id;
  }

  const found = findCandidates(objects, { orgId, thresholds });
  const summary = {
    matcher_version: MATCHER_VERSION,
    thresholds,
    type_keys: typeKeys,
    objects_scanned: found.objects_scanned,
    object_cap_reached: objects.length >= maxObjects,
    pairs_compared: found.pairs_compared,
    below_threshold: found.below_threshold,
    oversized_blocks: found.oversized_blocks,
    candidates: found.candidates.length,
    proposed_auto: found.candidates.filter((c) => c.band === 'auto').length,
    proposed_review: found.candidates.filter((c) => c.band === 'review').length,
    settled: Array.isArray(settled?.settled) ? settled.settled : [],
    dry_run: dryRun,
    safety: { merges: false, deletes: false, source_records_changed: false, reversible: true, communications: false },
  };
  if (dryRun) return { ...summary, preview: found.candidates.slice(0, 100) };

  const runs = [];
  let autoLinked = 0;
  let queued = 0;
  let skipped = 0;
  // An empty scan still records a run, so "nothing found" is auditable too.
  const batches = [];
  for (let i = 0; i < found.candidates.length; i += BATCH) batches.push(found.candidates.slice(i, i + BATCH));
  if (!batches.length) batches.push([]);
  for (const [index, batch] of batches.entries()) {
    const result = await rpc('ops_entity_match_record', {
      p_org: orgId,
      p_actor: actorUserId,
      p_run: {
        matcher_version: MATCHER_VERSION,
        trigger,
        params: { type_keys: typeKeys, thresholds, batch: index + 1, batches: batches.length },
        objects_scanned: index === 0 ? found.objects_scanned : 0,
        pairs_compared: index === 0 ? found.pairs_compared : 0,
        candidates: batch,
      },
    });
    runs.push(result?.run_id || null);
    autoLinked += Number(result?.auto_linked || 0);
    queued += Number(result?.queued_for_review || 0);
    skipped += Number(result?.skipped || 0);
  }
  return { ...summary, run_ids: runs, auto_linked: autoLinked, queued_for_review: queued, unchanged_or_skipped: skipped };
}
