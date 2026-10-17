/**
 * Bounded evidence projection for Halo. Never infer network connectivity from
 * geographic proximity: links require an explicit, source-backed relationship.
 */
export function buildHaloEvidenceGraph({ entities = [], links = [], maxNodes = 500, maxEdges = 2000 } = {}) {
  if (!Array.isArray(entities) || !Array.isArray(links)) throw new TypeError('Expected arrays');
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 500 ||
      !Number.isInteger(maxEdges) || maxEdges < 1 || maxEdges > 2000) {
    throw new RangeError('Invalid graph bounds');
  }
  const nodes = [];
  const byId = new Map();
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue;
    const id = String(entity.external_id || '').trim();
    if (!id || byId.has(id)) continue;
    if (nodes.length >= maxNodes) throw new RangeError('Halo node limit exceeded');
    const point = entity.point;
    const lat = point?.lat, lon = point?.lon;
    const position = Number.isFinite(lat) && Number.isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
    const node = {
      id, label: String(entity.name || entity.entity_type || id).slice(0, 240),
      source: String(entity.source || entity.source_key || '').slice(0, 100),
      source_url: typeof entity.source_url === 'string' ? entity.source_url : null,
      position
    };
    nodes.push(node);
    byId.set(id, node);
  }
  const edges = [];
  const seen = new Set();
  for (const link of links) {
    if (!link || !['connects', 'supports', 'contradicts', 'context'].includes(link.relationship)) continue;
    const from = String(link.from || ''), to = String(link.to || '');
    if (!byId.has(from) || !byId.has(to) || from === to) continue;
    if (!link.source_url || typeof link.source_url !== 'string') continue;
    const key = [from, to, link.relationship, link.source_url].join('|');
    if (seen.has(key)) continue;
    if (edges.length >= maxEdges) throw new RangeError('Halo edge limit exceeded');
    seen.add(key);
    edges.push({ from, to, kind: link.relationship, source_url: link.source_url });
  }
  return { schema: 'halo.evidence-graph.v1', nodes, edges, inferred_links: 0 };
}
