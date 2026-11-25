/* Independently authored Finance contracts. No network, billing or database writes.
 * Input rows are extracted assertions, NOT a claim that official PDFs are parsed.
 * Grants below must come from trusted server storage, never request JSON. */
export const SOURCES = Object.freeze({
  house: Object.freeze({ host: 'disclosures-clerk.house.gov', collection: 'blocked_pending_review' }),
  senate: Object.freeze({ host: 'efdsearch.senate.gov', collection: 'blocked_pending_review' }),
  sec: Object.freeze({ host: 'www.sec.gov', collection: 'adapter_not_implemented' })
});
export const PRODUCT = Object.freeze({ id: 'finance', schema: 'finance/v1', state: 'development',
  live_data: false, member_release: false, collection_enabled: false,
  pricing: Object.freeze({ currency: 'USD', monthly_target: 6, state: 'proposal', checkout: false }) });
const reject = code => { throw new Error(code); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value) ? value : reject('invalid_identity');
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) reject('invalid_timestamp');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) reject('invalid_timestamp');
  return new Date(ms).toISOString();
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) reject('invalid_date');
  instant(value + 'T00:00:00Z'); return value;
}
const optionalTime = value => value == null ? null : instant(value);
const key = row => JSON.stringify([row.scope.org_id, row.scope.owner_id, row.source, row.report_id, row.row_id]);

export function normalizeDisclosure(input) {
  if (!input || !['house', 'senate'].includes(input.source)) reject('unsupported_source');
  const scope = { org_id: id(input.scope?.org_id), owner_id: id(input.scope?.owner_id) };
  const url = new URL(input.source_url);
  if (url.protocol !== 'https:' || url.hostname !== SOURCES[input.source].host || url.port || url.username || url.password || url.search || url.hash) reject('invalid_source_url');
  if (!/^[a-f0-9]{64}$/.test(input.document_sha256 || '')) reject('invalid_document_hash');
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 10000) reject('invalid_page');
  if (typeof input.asset_description !== 'string' || !input.asset_description.trim() || input.asset_description.length > 2000) reject('invalid_asset');
  if (!['self', 'spouse', 'dependent', 'joint', 'unknown'].includes(input.owner_category)) reject('invalid_owner');
  if (!['purchase', 'sale', 'partial_sale', 'exchange', 'unknown'].includes(input.transaction)) reject('invalid_transaction');
  const { lower, upper } = input.value_range || {};
  if (!Number.isSafeInteger(lower) || lower < 0 || (upper !== null && (!Number.isSafeInteger(upper) || upper < lower))) reject('invalid_value_range');
  const ingested = instant(input.ingested_at), available = optionalTime(input.public_available_at);
  if (available && available > ingested) reject('availability_after_ingestion');
  const row = { schema: 'finance-disclosure/v1', scope, source: input.source,
    report_id: id(input.report_id), row_id: id(input.row_id), filer_id: id(input.filer_id),
    owner_category: input.owner_category, asset_description: input.asset_description.trim(),
    security_id: null, resolution: 'unresolved', transaction: input.transaction,
    transaction_date: day(input.transaction_date), filing_date: day(input.filing_date),
    public_available_at: available, ingested_at: ingested,
    value_range: { lower, upper, currency: 'USD' },
    provenance: { source_url: url.href, document_sha256: input.document_sha256, page: input.page,
      parser_version: id(input.parser_version), synthetic: input.synthetic === true },
    supersedes: input.supersedes == null ? null : { report_id: id(input.supersedes.report_id), row_id: id(input.supersedes.row_id) } };
  if (row.transaction_date > row.filing_date) reject('transaction_after_filing');
  return row;
}

// Immutable append; revision identity must be explicit. Same-row changes need review.
export function appendDisclosure(history, row) {
  const same = history.find(x => key(x) === key(row));
  if (same) {
    if (JSON.stringify(same) === JSON.stringify(row)) return history;
    reject('conflicting_revision');
  }
  if (row.supersedes) {
    const parentKey = key({ ...row, ...row.supersedes });
    const parent = history.find(x => key(x) === parentKey);
    if (!parent || parent.filer_id !== row.filer_id || parent.ingested_at > row.ingested_at) reject('invalid_amendment');
    if (history.some(x => x.supersedes && key({ ...x, ...x.supersedes }) === parentKey)) reject('amendment_conflict');
  }
  return [...history, row];
}

export function disclosuresAsOf(history, scope, at, mode = 'actual') {
  const time = instant(at);
  if (!['actual', 'reconstructed'].includes(mode)) reject('invalid_replay_mode');
  const rows = history.filter(r => r.scope.org_id === scope.org_id && r.scope.owner_id === scope.owner_id &&
    (mode === 'actual' ? r.ingested_at <= time : r.public_available_at !== null && r.public_available_at <= time));
  const replaced = new Set(rows.filter(r => r.supersedes).map(r => key({ ...r, ...r.supersedes })));
  return rows.filter(r => !replaced.has(key(r)));
}

// Independent gates: premium payment never overrides source rights or release policy.
export function authorizeFinance({ principal, resource, capability, release, grants = [], now }) {
  const time = instant(now);
  if (!principal?.id || !principal.org_id || principal.org_id !== resource?.org_id) return false;
  if (!['browse', 'research', 'paper'].includes(capability)) return false;
  const valid = g => {
    try { return g.org_id === principal.org_id && g.principal_id === principal.id && g.product === 'finance' &&
      instant(g.starts_at) <= time && instant(g.expires_at) > time && !g.revoked; } catch { return false; }
  };
  const source = grants.some(g => valid(g) && g.kind === 'source' && g.source === resource.source && g.audience === resource.visibility);
  if (resource.visibility === 'private') return source && release?.owner === true && principal.isHouseOwner === true && principal.id === resource.owner_id;
  if (resource.visibility !== 'member' || release?.member !== true) return false;
  if (resource.owner_id && resource.owner_id !== principal.id) return false;
  return source && (capability === 'browse' || grants.some(g => valid(g) && g.kind === 'feature' && g.capability === capability));
}

export function assertCollectionAllowed(source) {
  if (!SOURCES[source]) reject('unsupported_source');
  reject(SOURCES[source].collection); // No transport exists in this development slice.
}
