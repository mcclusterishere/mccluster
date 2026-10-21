/* Owner business counters: one server-side scan of first-party non-bot
 * events instead of 18 independent exact PostgREST counts. No approximate
 * totals, no fabricated zeroes, and no browser-role RPC access. */
export const EVENT_COUNT_FIELDS = Object.freeze([
  "events_total",
  "events_window",
  "page_views_total",
  "page_views_window",
  "clicks_total",
  "clicks_window",
  "acquired_total",
  "acquired_window",
  "legacy_plays_total",
  "legacy_plays_window",
  "music_plays_total",
  "music_plays_window",
  "preview_plays_total",
  "preview_plays_window",
  "full_plays_total",
  "full_plays_window",
  "completes_total",
  "completes_window"
]);

export function parseBusinessEventCounts(rows, {windowed = true} = {}) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object')
    throw new Error('Business event counters response is unavailable');
  const source = rows[0];
  const result = {};
  for (const field of EVENT_COUNT_FIELDS) {
    if (!windowed && field.endsWith('_window')) {
      if (source[field] !== null) throw new Error('Unbounded event window must be null');
      result[field] = null;
      continue;
    }
    const value = source[field];
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid event counter: ' + field);
    result[field] = n;
  }
  return result;
}

export async function loadBusinessEventCounts(readRpc, {since = null, until = null} = {}) {
  if ((since === null) !== (until === null)) throw new Error('Both window bounds are required');
  const rows = await readRpc('rpc/analytics_business_event_counts', {
    method: 'POST', body: JSON.stringify({p_since: since, p_until: until})
  });
  return parseBusinessEventCounts(rows, {windowed: since !== null});
}
