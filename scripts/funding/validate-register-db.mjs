// Isolated PostgreSQL/WASM regression. No production connection or credentials.
// Set PGLITE_MODULE to an installed, reviewed PGlite entry point.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.PGLITE_MODULE) throw Error('Set PGLITE_MODULE to the reviewed local PGlite module path');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create function public.eu_is_admin() returns boolean language sql stable as
    $$select coalesce(current_setting('test.is_admin', true),'false') = 'true'$$;`);
  const root = new URL('../../', import.meta.url);
  await db.exec(await readFile(new URL('supabase/migrations/20261016020407_action_partner_opportunity_drafts_v1.sql',root),'utf8'));
  const sql = await readFile(new URL('supabase/pending/20261020193357_funding_criteria_register_v1.sql',root),'utf8');
  await db.exec(sql);
  const count = await db.query('select count(*)::int as n from action_funding_opportunities');
  assert.equal(count.rows[0].n,72);
  const legacy = await db.query("select eligibility_note,criteria_register->'previous_catalog_record' as previous from action_funding_opportunities where opportunity_id='cities-deliver-2026'");
  assert.match(legacy.rows[0].previous.eligibility_note,/eligible nonprofit lead/);
  assert.doesNotMatch(legacy.rows[0].eligibility_note,/eligible nonprofit lead/);
  assert.equal((await db.query('select count(*)::int as n from action_partner_mission_drafts')).rows[0].n,10);
  await db.exec("update action_funding_opportunities set criteria_register=jsonb_set(criteria_register,'{test_review_retained}','true') where opportunity_id='cities-deliver-2026'");
  await db.exec(sql);
  assert.equal((await db.query("select criteria_register->>'test_review_retained' as retained from action_funding_opportunities where opportunity_id='cities-deliver-2026'")).rows[0].retained,'true');
  assert.equal((await db.query('select count(*)::int as n from action_funding_opportunities')).rows[0].n,72);
  await assert.rejects(db.exec("update action_funding_opportunities set criteria_register='[]'::jsonb where opportunity_id='cities-deliver-2026'"));
  await assert.rejects(db.exec("update action_funding_opportunities set criteria_register='{}'::jsonb where opportunity_id='cities-deliver-2026'"));
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from action_funding_opportunities'));
  await db.exec('reset role; set role authenticated');
  assert.equal((await db.query('select * from action_funding_opportunities')).rows.length,0);
  await assert.rejects(db.exec("update action_funding_opportunities set availability='open'"));
  await db.exec("set test.is_admin='true'");
  assert.equal((await db.query('select * from action_funding_opportunities')).rows.length,72);
  await db.exec('reset role');
  console.log('PASS: 72 rows, 4 civic IDs preserved, 10 private drafts unchanged; repeat seed preserves review; malformed metadata rejected; anon denied, member hidden, admin reads; browser mutation denied.');
} finally { await db.close(); }
