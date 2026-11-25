/* Common provenance for every E=Up intake record (CLAUDE-ADDENDUM, minimum
   data contracts): where it came from, when it was published/observed/fetched,
   which parser produced it, under which rights revision, and its review and
   coverage state. Rows without this do not enter the store (the SQL repeats
   the check). */
export const REVIEW_STATES = Object.freeze(['intake', 'reviewed', 'corrected', 'superseded']);
export const COVERAGE = Object.freeze(['full', 'partial', 'unknown']);

const iso = (value) => (value === null || value === undefined ? null : new Date(value).toISOString());

export function provenance({ source_id, source_record_id, url, observed_at = null, effective_from = null, effective_to = null, upstream_updated_at = null, fetched_at, parser_version, raw_hash = null, rights_revision, review_state = 'intake', coverage = 'unknown' }) {
  for (const [name, value] of Object.entries({ source_id, source_record_id, url, fetched_at, parser_version, rights_revision })) {
    if (typeof value !== 'string' || !value) throw Object.assign(new Error(`provenance.${name} is required`), { status: 400, reason: 'provenance_invalid' });
  }
  if (!/^https:\/\//.test(url)) throw Object.assign(new Error('provenance.url must be https'), { status: 400, reason: 'provenance_invalid' });
  if (!REVIEW_STATES.includes(review_state)) throw Object.assign(new Error('provenance.review_state invalid'), { status: 400, reason: 'provenance_invalid' });
  if (!COVERAGE.includes(coverage)) throw Object.assign(new Error('provenance.coverage invalid'), { status: 400, reason: 'provenance_invalid' });
  return Object.freeze({
    source_id, source_record_id, url,
    observed_at: iso(observed_at), effective_from, effective_to, upstream_updated_at: iso(upstream_updated_at),
    fetched_at: iso(fetched_at), parser_version, raw_hash, rights_revision, review_state, coverage
  });
}

/* SHA-256 of the raw upstream bytes/text, used for duplicate detection. Only
   stored where the source's rights allow retaining a hash (always allowed for
   public government records; the adapter decides). */
export async function rawHash(text) {
  const bytes = new TextEncoder().encode(typeof text === 'string' ? text : JSON.stringify(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Fields a row needs before the intake RPC accepts it. */
export function intakeRecord(external_id, fields, prov, raw_hash = null) {
  if (typeof external_id !== 'string' || !external_id) throw Object.assign(new Error('external_id required'), { status: 400, reason: 'record_invalid' });
  return { external_id, ...fields, raw_hash, provenance: prov };
}
