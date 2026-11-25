/* Applies the pending migration to a throwaway in memory Postgres (PGlite) and proves its guards.
   Never touches a real database. Skips when @electric-sql/pglite is not installed
   (set OUTREACH_PGLITE_MODULE to a path of its dist/index.js, or npm i @electric-sql/pglite in a scratch dir). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pending = path.join(here, '..', '..', 'supabase', 'pending');
const forward = fs.readFileSync(path.join(pending, '20261125090000_mentor_outreach_pipeline_v1.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(pending, '20261125090000_mentor_outreach_pipeline_v1.rollback.sql'), 'utf8');

let PGlite = null;
try { ({ PGlite } = await import(process.env.OUTREACH_PGLITE_MODULE ? pathToFileURL(process.env.OUTREACH_PGLITE_MODULE).href : '@electric-sql/pglite')); } catch { PGlite = null; }

test('pending migration applies twice, enforces approval, dashes, caps and frozen text, and rolls back', { skip: !PGlite && 'PGlite not installed' }, async () => {
  const db = new PGlite();
  await db.exec(forward);
  await db.exec(forward); // safe to run twice
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const draft = async (frame, i, status = 'pending_review') => (await one(
    `insert into public.outreach_drafts (recipient_name, to_email, frame, subject, body, status, approved_by, approved_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [`P ${i}`, `p${frame}${i}@x.example`, frame, `Subject ${i}`, `Body ${i}`, status, status === 'approved' ? 'matthew' : null, status === 'approved' ? new Date().toISOString() : null])).id;

  await assert.rejects(db.query(`insert into public.outreach_drafts (recipient_name, to_email, frame, subject, body, status) values ('x','x@x.example','A','s','b','approved')`), /outreach_drafts_approval/);
  await assert.rejects(db.query(`insert into public.outreach_drafts (recipient_name, to_email, frame, subject, body) values ('x','x@x.example','A','s','a \u2014 b')`), /outreach_drafts_no_dashes/);
  await assert.rejects(db.query(`insert into public.outreach_drafts (recipient_name, to_email, frame, subject, body, from_email) values ('x','x@x.example','A','s','b','other@x.example')`), /check/);

  const pendingId = await draft('A', 0);
  await assert.rejects(db.query(`insert into public.outreach_sends (draft_id, to_email, frame, sent_day) values ($1, 'x', 'A', current_date)`, [pendingId]), /not approved/);

  const at = '2026-11-25T15:00:00Z';
  for (let i = 1; i <= 50; i += 1) await db.query(`insert into public.outreach_sends (draft_id, to_email, frame, sent_at, sent_day) values ($1, 'x', 'A', $2, '2000-01-01')`, [await draft('A', i, 'approved'), at]);
  const s = await one(`select sent_day::text as d, frame from public.outreach_sends limit 1`);
  assert.equal(s.d, '2026-11-25', 'the trigger sets the New York day, whatever the caller sent');
  await assert.rejects(db.query(`insert into public.outreach_sends (draft_id, to_email, frame, sent_at, sent_day) values ($1, 'x', 'A', $2, '2000-01-01')`, [await draft('A', 51, 'approved'), at]), /frame A cap/);
  for (const f of ['B', 'C']) for (let i = 1; i <= 50; i += 1) await db.query(`insert into public.outreach_sends (draft_id, to_email, frame, sent_at, sent_day) values ($1, 'x', 'A', $2, '2000-01-01')`, [await draft(f, i, 'approved'), at]);
  /* 04:30 UTC on the 26th is still the 25th in New York */
  await assert.rejects(db.query(`insert into public.outreach_sends (draft_id, to_email, frame, sent_at, sent_day) values ($1, 'x', 'A', '2026-11-26T04:30:00Z', '2000-01-01')`, [await draft('C', 99, 'approved')]), /daily cap of 150/);

  const sentDraft = (await one(`select draft_id from public.outreach_sends limit 1`)).draft_id;
  await db.query(`update public.outreach_drafts set status = 'sent' where id = $1`, [sentDraft]);
  await assert.rejects(db.query(`update public.outreach_drafts set body = 'changed' where id = $1`, [sentDraft]), /cannot change/);
  await assert.rejects(db.query(`update public.outreach_drafts set status = 'sent' where id = $1`, [pendingId]), /only an approved draft/);

  const sendId = (await one(`select id from public.outreach_sends where frame = 'B' limit 1`)).id;
  await db.query(`insert into public.outreach_replies (send_id, frame, from_email, received_at, gmail_message_id) values ($1, 'B', 'x', now(), 'r1')`, [sendId]);
  const stats = (await db.query(`select frame, sent, replied, reply_rate::text as rate from public.outreach_frame_stats order by frame`)).rows;
  assert.deepEqual(stats.map((r) => [r.frame, r.sent, r.replied, r.rate]), [['A', 50, 0, '0.0000'], ['B', 50, 1, '0.0200'], ['C', 50, 0, '0.0000']]);

  await assert.rejects(db.exec(rollback), /rollback refused/);
  await db.exec('rollback'); // the refused file left its transaction aborted; end it the way an apply tool would
  await db.exec('delete from public.outreach_replies; delete from public.outreach_sends;');
  await db.exec(rollback);
  assert.equal((await one(`select to_regclass('public.outreach_drafts') as t`)).t, null);
  await db.close();
});
