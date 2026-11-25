import { readBoundedRows } from './measurement.js';

// Ordered event pages resume at the last (timestamp, UUID), so later pages do
// not repeatedly fetch and discard every earlier row. Preserve timestamp
// strings exactly: PostgreSQL has finer precision than JavaScript Date.
export function readAnalyticsPages(readPage, path, maxRows = 100000, pageSize = 1000) {
  const split = path.indexOf('?');
  const table = path.slice(0, split);
  const base = new URLSearchParams(path.slice(split + 1));
  const order = base.get('order');
  const selected = (base.get('select') || '').split(',');
  const cursorEligible = ['events', 'events_lean'].includes(table) &&
    ['at.asc,id.asc', 'at.desc,id.desc'].includes(order) &&
    selected.includes('at') && selected.includes('id') && !base.has('or');
  if (!cursorEligible) return readBoundedRows((start, end) => readPage(path, start, end), maxRows, pageSize);

  let cursor = null;
  const comparison = order === 'at.asc,id.asc' ? 'gt' : 'lt';
  return readBoundedRows(async (start, end) => {
    const query = new URLSearchParams(base);
    if (cursor) {
      // The broad bound is indexable; the OR handles ties without skipping them.
      query.append('at', `${comparison}e.${cursor.at}`);
      query.set('or', `(at.${comparison}.${cursor.at},and(at.eq.${cursor.at},id.${comparison}.${cursor.id}))`);
    }
    const page = await readPage(`${table}?${query}`, 0, end - start);
    if (!Array.isArray(page)) throw new TypeError('Analytics page must be an array');
    if (page.length >= end - start + 1) {
      const last = page.at(-1);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(last?.id || '') ||
          !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(last?.at || '') ||
          !Number.isFinite(Date.parse(last.at))) throw new Error('Invalid analytics page cursor');
      if (cursor && cursor.at === last.at && cursor.id === last.id) throw new Error('Analytics page cursor did not advance');
      cursor = { at: last.at, id: last.id };
    }
    return page;
  }, maxRows, pageSize);
}
