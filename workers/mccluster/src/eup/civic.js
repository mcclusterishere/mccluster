/* E=Up Civic League reads: jurisdictions → offices → terms, bills with their
   versions/actions/amendments/roll calls, election contests with candidacies,
   results and certification state. Owner-only (router). Every row comes from
   the PRIVATE intake store with its provenance; rows whose source rights are
   held, unreviewed or expired are withheld even if stored. Nothing here reads
   or writes the public civic_* projection or action_policy_bills. */
import { civicRead, readSourceStates, withholdRestricted } from './intake.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guarded(env, ctx, rows) {
  let states = [];
  try { states = await readSourceStates(env, ctx); } catch (error) { if (error?.reason !== 'storage_unavailable') throw error; }
  return withholdRestricted(rows, states, { now: ctx.now() });
}

function uuidParam(url, name, fail, { optional = false } = {}) {
  const value = url.searchParams.get(name);
  if (!value && optional) return null;
  if (!UUID.test(String(value || ''))) throw fail(400, `${name} must be a uuid`, 'invalid_request');
  return value;
}

export async function handleCivic(request, env, ctx) {
  const { parts, url, fail } = ctx;
  if (request.method !== 'GET') throw fail(405, 'Civic League is read-only in this release', 'read_only');
  const [section, id] = parts;
  let rows; let coverage = 'unknown';
  if (section === 'jurisdictions' && !id) {
    const parent = url.searchParams.get('parent') || 'none';
    if (parent !== 'none' && !UUID.test(parent)) throw fail(400, 'parent must be none or a uuid', 'invalid_request');
    rows = await civicRead(env, ctx, 'jurisdictions', { parent });
  } else if (section === 'boundaries' && !id) {
    rows = await civicRead(env, ctx, 'boundaries', { jurisdiction: uuidParam(url, 'jurisdiction', fail) });
  } else if (section === 'offices' && !id) {
    rows = await civicRead(env, ctx, 'offices', { jurisdiction: uuidParam(url, 'jurisdiction', fail) });
  } else if (section === 'terms' && !id) {
    rows = await civicRead(env, ctx, 'terms', { office: uuidParam(url, 'office', fail) });
  } else if (section === 'bills' && !id) {
    rows = await civicRead(env, ctx, 'bills', { jurisdiction: uuidParam(url, 'jurisdiction', fail), session: url.searchParams.get('session') || null });
  } else if (section === 'bills' && id) {
    if (!UUID.test(id)) throw fail(400, 'bill id must be a uuid', 'invalid_request');
    const bill = await civicRead(env, ctx, 'bill', { id });
    if (!bill) throw fail(404, 'Bill not found', 'not_found');
    const { rows: kept } = await guarded(env, ctx, [bill]);
    if (!kept.length) throw fail(403, 'This record is withheld pending rights review', 'rights_withheld');
    return { ok: true, bill: kept[0], law_status: kept[0].law_status, coverage: kept[0].provenance?.coverage || 'unknown' };
  } else if (section === 'elections' && !id) {
    rows = await civicRead(env, ctx, 'elections', { jurisdiction: uuidParam(url, 'jurisdiction', fail) });
  } else {
    throw fail(404, 'Unknown civic route', 'not_found');
  }
  const { rows: kept, withheld } = await guarded(env, ctx, Array.isArray(rows) ? rows : []);
  if (kept.length) coverage = kept.every((r) => r.provenance?.coverage === 'full') ? 'full' : 'partial';
  return { ok: true, [section]: kept, count: kept.length, withheld, coverage, note: kept.length ? null : 'No records in private intake for this selection; absence of coverage, not an empty jurisdiction.' };
}
