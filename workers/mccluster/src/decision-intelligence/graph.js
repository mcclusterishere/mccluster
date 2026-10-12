/* GEV v0: bounded, org-scoped evidence graph projection; no invented links. */
const MAX_NODES = 500;
const MAX_EDGES = 2000;
function requireOrg(orgId) {
  if (typeof orgId !== 'string' || !orgId.trim()) throw new TypeError('Organization ID required');
}
export function buildEvidenceGraph({ orgId, claims = [], sources = [], evidenceLinks = [], decisionLinks = [] }) {
  requireOrg(orgId);
  for (const rows of [claims, sources, evidenceLinks, decisionLinks]) if (!Array.isArray(rows)) throw new TypeError('Graph inputs must be arrays');
  const nodes = [];
  const edges = [];
  const ids = new Set();
  function node(kind, row, label) {
    if (row?.org_id !== orgId || typeof row.id !== 'string') return;
    const id = kind + ':' + row.id;
    if (ids.has(id)) return;
    if (nodes.length >= MAX_NODES) throw new RangeError('Graph node limit exceeded');
    ids.add(id);
    nodes.push({ id, kind, label: String(label || '').slice(0, 240) });
  }
  for (const row of claims) node('claim', row, row.statement);
  for (const row of sources) node('source', row, row.title);
  for (const row of evidenceLinks) {
    if (row?.org_id !== orgId || !['supports','contradicts','context'].includes(row.relationship)) continue;
    const from = 'source:' + row.source_id, to = 'claim:' + row.claim_id;
    if (!ids.has(from) || !ids.has(to)) continue;
    if (edges.length >= MAX_EDGES) throw new RangeError('Graph edge limit exceeded');
    edges.push({ from, to, kind: row.relationship });
  }
  // Decision records are not included until verified, org-authorized decision
  // retrieval exists. Never synthesize nodes from unverified foreign IDs.
  return Object.freeze({ orgId, nodes, edges, truncated: false, decisionLinksDeferred: decisionLinks.length > 0 });
}
