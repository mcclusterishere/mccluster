// Where normalized records go. The Supabase sink calls only the owner-gated RPCs from
// ai_context_source_pipelines_v1; the memory sink is the dry run and mirrors their dedupe and allow-list rules.
import { createHash } from 'node:crypto';
import { ALLOWED_KEYS } from './allow-list.mjs';

export function createSupabaseSink({ orgId, actorId, rest }) {
  if (!orgId || !actorId) throw new Error('MCCLUSTER_ORG_ID and MCCLUSTER_OWNER_PROFILE_ID are required to write');
  const rpc = async (name, args) => (await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) })).body;
  return {
    kind: 'supabase',
    async cursor(connector, account) {
      const out = await rpc('ops_ai_source_cursor', { p_org: orgId, p_actor: actorId, p_connector: connector, p_account: account });
      return out?.cursor || {};
    },
    async ingest(connector, account, records, cursorAfter, mode) {
      return rpc('ops_ai_source_ingest', {
        p_org: orgId, p_actor: actorId, p_connector: connector, p_account: account,
        p_records: records, p_cursor_after: cursorAfter ?? null, p_mode: mode,
      });
    },
  };
}

export function createMemorySink() {
  const rows = new Map();
  const cursors = new Map();
  const runs = [];
  return {
    kind: 'memory',
    rows,
    runs,
    async cursor(connector, account) { return cursors.get(`${connector}|${account}`) || {}; },
    async ingest(connector, account, records, cursorAfter, mode) {
      const allowed = ALLOWED_KEYS[connector];
      const res = { connector, account_key: account, mode, seen: 0, inserted: 0, updated: 0, unchanged: 0, rejected: 0, errors: [] };
      for (const r of records) {
        res.seen += 1;
        const bad = Object.keys(r).find((k) => !allowed.includes(k));
        if (!r.external_id || bad) {
          res.rejected += 1;
          res.errors.push({ external_id: String(r.external_id || '?').slice(0, 128), error: bad ? `field ${bad} outside allow-list` : 'no external_id' });
          continue;
        }
        const key = `${connector}|${account}|${r.external_id}`;
        const hash = createHash('sha256').update(JSON.stringify(r)).digest('hex');
        const prev = rows.get(key);
        if (prev?.hash === hash) { res.unchanged += 1; continue; }
        rows.set(key, { hash, record: r });
        if (prev) res.updated += 1; else res.inserted += 1;
      }
      if (cursorAfter && (res.rejected === 0 || res.rejected < res.seen)) cursors.set(`${connector}|${account}`, cursorAfter);
      runs.push(res);
      return res;
    },
  };
}
