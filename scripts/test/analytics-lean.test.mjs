/* THE DASHBOARD READS THE LEAN COPY.
   The Overview's 30-day, 90-day and all-time reads walked the full events
   table (about 1.3 KB a row) and ran past the 8 s statement limit. These
   pins keep the dashboard functions on public.events_lean and keep the
   copying trigger from ever stopping an event being recorded. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

test('every dashboard function reads events_lean, never the fat events table', async () => {
  const sql = await read('supabase/migrations/20261002063334_analytics_read_events_lean.sql');
  for (const fn of ['analytics_daily', 'analytics_totals', 'analytics_top', 'analytics_content_events', 'analytics_content', 'analytics_acquisition', 'analytics_paths', 'analytics_funnel']) {
    const body = sql.slice(sql.indexOf(`function public.${fn}(`), sql.indexOf('$$;', sql.indexOf(`function public.${fn}(`)));
    assert.ok(body.length > 0, `${fn} is defined`);
    assert.match(body, /public\.events_lean/, `${fn} reads the lean copy`);
    assert.doesNotMatch(body, /public\.events\b(?!_lean)/, `${fn} does not read public.events`);
  }
  /* the swap does not carry a full-table backfill: one statement over all of
     public.events restarted the production instance */
  assert.doesNotMatch(sql, /insert into public\.events_lean/);
});

test('the copy trigger can never stop an event being recorded', async () => {
  const sql = await read('supabase/migrations/20261002061954_analytics_events_lean.sql');
  assert.match(sql, /exception when others then[\s\S]*?return null;/);
  assert.match(sql, /after insert or update on public\.events/);
  assert.match(sql, /set local lock_timeout = '5s';/);
  assert.match(sql, /revoke all on table public\.events_lean from public, anon, authenticated;/);
});
