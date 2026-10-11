/* Source/claim evaluation is deliberately conservative: citations are not proof.
   Pure helpers: never fetch URLs, authorize access or call AI models. */
export function assessClaimEvidence(claim, sources, links, now = new Date()) {
  if (!claim || typeof claim.id !== 'string' || typeof claim.org_id !== 'string') throw new TypeError('Claim identity required');
  if (!Array.isArray(sources) || !Array.isArray(links)) throw new TypeError('Source and link arrays required');
  const time = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(time)) throw new TypeError('Valid evaluation date required');
  const byId = new Map(sources.filter(s => s?.org_id === claim.org_id).map(s => [s.id, s]));
  const evaluated = links.filter(link => link?.claim_id === claim.id && link?.org_id === claim.org_id).map(link => {
    const source = byId.get(link.source_id);
    if (!source) return { sourceId: link.source_id, state: 'missing', relationship: link.relationship };
    const retrieved = Date.parse(source.retrieved_at);
    const expiry = source.retention_until ? Date.parse(source.retention_until) : null;
    if (!Number.isFinite(retrieved) || retrieved > time || (expiry !== null && (!Number.isFinite(expiry) || expiry <= time)))
      return { sourceId: source.id, state: 'unusable', relationship: link.relationship };
    return { sourceId: source.id, state: 'available', relationship: link.relationship };
  });
  const supportCount = evaluated.filter(e => e.state === 'available' && e.relationship === 'supports').length;
  const contradictionCount = evaluated.filter(e => e.state === 'available' && e.relationship === 'contradicts').length;
  return Object.freeze({
    claimId: claim.id,
    supportCount,
    contradictionCount,
    missingOrUnusableCount: evaluated.filter(e => e.state !== 'available').length,
    status: contradictionCount ? 'disputed' : supportCount ? 'cited_unverified' : 'unsupported',
    evidence: evaluated
  });
}
