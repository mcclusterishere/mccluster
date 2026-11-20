// Isolated PostgreSQL proof. This module never accepts a connection URL or calls the canonical project.
// PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test/drawdown-credit-fallback.integration.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCatalog, buildImportParts, OUTPUT_FILES, detailsRow } from '../../tools/build-mission-import.mjs';
import { readPolicy, prepare, publicationDetails } from '../../tools/build-drawdown-credit-fallback.mjs';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const pg = new PGlite();
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const input = readCatalog(), policy = readPolicy(), targets = prepare(input, policy).targets;
const forward = read(policy.forward_file), rollbacks = policy.rollback_files.map(read);
const other = '33333333-3333-4333-8333-333333333333';
const exec = async (sql) => { try { await pg.exec(sql); } catch (e) { await pg.exec('rollback').catch(() => {}); throw e; } };
const rows = async (sql, params = []) => (await pg.query(sql, params)).rows;
let checks = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const fails = async (sql, message) => {
  await assert.rejects(exec(sql), (e) => e.code === '55000', message); checks++;
};
const dump = (table) => rows(`select to_jsonb(t) as row from public.${table} t order by ${table === 'action_missions' ? 'id' : 'mission_id'}`);
const withoutTimes = (a) => a.map(({ row: { created_at, updated_at, ...row } }) => row);
const schema = () => rows(`select c.relname, c.relacl::text, c.relrowsecurity,
  (select jsonb_agg(to_jsonb(p) order by p.policyname) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('action_missions','action_mission_details') order by c.relname`);
const asAnon = async () => {
  await pg.exec('begin; set local role anon;');
  try { return await rows("select d.* from public.action_mission_details d where d.catalog='drawdown' order by d.mission_id"); }
  finally { await pg.exec('rollback'); }
};

try {
  await exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema public, auth to anon, authenticated, service_role;`);
  await exec(read('supabase/tests/action_mission_catalog.stub.sql'));
  await exec(read('supabase/migrations/20261118021521_action_mission_details.sql'));
  for (const p of buildImportParts(input)) await exec(read(p.file));
  await pg.query("insert into public.action_missions(id,title,status) values ($1,'Unrelated mission','draft')", [other]);
  await pg.query("insert into public.action_mission_details(mission_id,catalog,slug,credit_line,about,about_credit) values ($1,'unrelated','unrelated-mission','Unrelated credit','Unrelated excerpt','Unrelated attribution')", [other]);
  const beforeMissions = await dump('action_missions'), beforeDetails = await dump('action_mission_details'), beforeSchema = await schema();
  eq((await asAnon()).length, 0, 'draft catalog details are not readable to guests');

  // A late changed target forces rollback of every earlier update in the transaction.
  const last = targets.at(-1);
  await pg.query('update public.action_mission_details set credit_line=$2 where mission_id=$1', [last.id, 'Owner edited credit']);
  const edited = await dump('action_mission_details');
  await fails(forward, 'unexpected credit refuses atomically');
  eq(await dump('action_mission_details'), edited, 'no earlier quote was removed on refusal');
  await pg.query('update public.action_mission_details set credit_line=$2 where mission_id=$1', [last.id, last.before.credit_line]);
  await pg.query("update public.action_missions set status='open' where id=$1", [last.id]);
  await fails(forward, 'unverified public quote requires publication rollback first');
  await pg.query("update public.action_missions set status='draft' where id=$1", [last.id]);
  // Original mission timestamps are not touched by this correction; the fixture's status changes did not alter them.
  eq(await dump('action_missions'), beforeMissions, 'failed correction preserves every mission column');

  // Missing imported details refuse, even if it is one of the 38 unquoted rows.
  const unquoted = input.catalog.missions.find((m) => m.about == null), unquotedId = detailsRow(unquoted).mission_id;
  const savedUnquoted = (await rows('select * from public.action_mission_details where mission_id=$1', [unquotedId]))[0];
  await pg.query('delete from public.action_mission_details where mission_id=$1', [unquotedId]);
  const missing = await dump('action_mission_details');
  await fails(forward, 'all 125 imported details are required');
  eq(await dump('action_mission_details'), missing, 'missing details refusal changes nothing');
  const cols = Object.keys(savedUnquoted);
  await pg.query(`insert into public.action_mission_details(${cols.join(',')}) values (${cols.map((_,i)=>'$'+(i+1)).join(',')})`, Object.values(savedUnquoted));
  await pg.query("update public.action_mission_details set about='Unexpected excerpt',about_credit='Unexpected attribution' where mission_id=$1", [unquotedId]);
  const extraQuote = await dump('action_mission_details');
  await fails(forward, 'a new quotation outside the known 87 is not silently retained');
  eq(await dump('action_mission_details'), extraQuote, 'postcondition failure rolls back known-row removals');
  await pg.query('update public.action_mission_details set about=null,about_credit=null where mission_id=$1', [unquotedId]);

  await exec(forward);
  const afterDetails = await dump('action_mission_details');
  for (const m of input.catalog.missions) {
    const expected = publicationDetails(m), actual = afterDetails.find(({row}) => row.mission_id === expected.mission_id).row;
    for (const [key, value] of Object.entries(expected)) eq(actual[key], value, `${m.slug}: ${key}`);
  }
  eq(await dump('action_missions'), beforeMissions, 'all original mission columns and timestamps survive');
  eq(await schema(), beforeSchema, 'no RLS, policies or table privileges changed');
  eq(afterDetails.find(({row})=>row.mission_id===other), beforeDetails.find(({row})=>row.mission_id===other), 'unrelated catalog untouched');
  eq(afterDetails.filter(({row})=>row.catalog==='drawdown' && row.license_name==='CC BY 4.0').length, 43, '43 licensed assessments remain');
  await exec(forward);
  eq(await dump('action_mission_details'), afterDetails, 'rerunning the correction changes no row or timestamp');

  await exec(read(OUTPUT_FILES.publish));
  const publicRows = await asAnon();
  eq(publicRows.length, 125, 'exact publish exposes all 125 missions through production policies');
  eq(publicRows.filter((d)=>d.about!=null || d.about_credit!=null || /used with permission/i.test(d.credit_line)).length, 0, 'guests receive no website quote or unsupported permission claim');
  const published = await dump('action_mission_details');
  for (const sql of rollbacks) await fails(sql, 'recovery never restores quotations into a public catalog');
  eq(await dump('action_mission_details'), published, 'recovery refusal preserves the safe public details');
  await exec(forward);
  eq(await dump('action_mission_details'), published, 'a clean published catalog permits an inert forward rerun');
  await exec(read(OUTPUT_FILES.publishRollback));
  eq((await asAnon()).length, 0, 'publication rollback hides the whole catalog before recovery');
  await exec(rollbacks[1]);
  await exec(rollbacks[0]);
  eq(withoutTimes(await dump('action_mission_details')), withoutTimes(beforeDetails), 'both recovery parts restore the exact historical details, in either order');
  const restored = await dump('action_mission_details');
  for (const sql of rollbacks) await exec(sql);
  eq(await dump('action_mission_details'), restored, 'recovery reruns are inert');
  await exec(forward);
  eq(withoutTimes(await dump('action_mission_details')), withoutTimes(afterDetails), 'forward correction is repeatable after controlled recovery');
  console.log(`Drawdown credit fallback: ${checks} checks passed on isolated PostgreSQL ${(await rows("select current_setting('server_version') as v"))[0].v}.`);
} finally { await pg.close(); }
