/* Shared measurement metadata. Completeness concerns the queried stored rows,
 * never all real-world activity or all events a browser might have lost. */
export const MEASUREMENT_VERSION = 'analytics-measurement/v1';
import { DICTIONARY_VERSION } from './measurement-dictionary.js';

export async function readBoundedRows(readPage, maxRows = 100000, pageSize = 1000) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new TypeError('Positive integer read limits required');
  }
  const rows = [];
  let exhausted = false;
  let pages = 0;
  while (rows.length < maxRows) {
    const size = Math.min(pageSize, maxRows - rows.length);
    const page = await readPage(rows.length, rows.length + size - 1);
    pages++;
    if (!Array.isArray(page)) throw new TypeError('Analytics page must be an array');
    rows.push(...page.slice(0, size));
    if (page.length < size) { exhausted = true; break; }
  }
  // At an exact cap we cannot know whether another row exists. Do not call it
  // complete and do not issue an unbounded or expensive exact-count query.
  Object.defineProperty(rows, 'readMetadata', { value: Object.freeze({
    status: exhausted ? 'complete' : 'limit_reached',
    rows: rows.length, limit: maxRows, pages,
    total_rows: exhausted ? rows.length : null,
    sampled: false
  }) });
  return rows;
}

export function readMetadata(rows) {
  return rows?.readMetadata || {
    status: 'unknown', rows: Array.isArray(rows) ? rows.length : 0,
    limit: null, total_rows: null, sampled: false
  };
}

export function measurementContext({ metricVersion, since, until, datasets, unit, identityBasis, clamped = false }) {
  const reads = Object.fromEntries(Object.entries(datasets).map(([key, rows]) => [key, readMetadata(rows)]));
  const statuses = Object.values(reads).map((x) => x.status);
  return {
    version: MEASUREMENT_VERSION,
    dictionary_version: DICTIONARY_VERSION,
    dictionary_url: '/v1/analytics/measurement-contract',
    metric_version: metricVersion,
    scope: { kind: 'first_party', site_id: null },
    geography: { kind: 'unfiltered', country: null, state: null },
    window: { since, until, bounds: '[since,until)', timezone: 'UTC', clamped },
    snapshot: { kind: 'live_paginated', frozen: false, retrieved_at: new Date().toISOString(), watermark: null },
    identity_basis: identityBasis,
    unit,
    completeness: {
      status: statuses.every((x) => x === 'complete') ? 'observed_complete'
        : statuses.includes('limit_reached') ? 'partial' : 'unknown',
      datasets: reads,
      note: 'Stored rows only. Live pagination is not a frozen snapshot; late arrivals and browser loss are not measured.'
    },
    suppression: { status: 'not_applied', access: 'house_owner' },
    freshness: { status: 'unknown', projection_watermark: null }
  };
}
