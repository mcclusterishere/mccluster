// The World's mission SQL on a disposable PostgreSQL built to production's shape: join scope, mission details,
// the Drawdown import and its publish, applied in order, rerun, then each rolled back. Production's side is
// supabase/tests/action_mission_catalog.stub.sql plus the four applied globe migrations, and every function the
// pending SQL replaces or calls is checked against production's md5(prosrc) (read, SELECT only, 2026-11-17).
//
//   ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> \
//     node scripts/test/mission-catalog.native.integration.mjs
//
// Disposable server only (scripts/test/support/native-postgres.mjs); never the canonical project.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { refuseUnlessAllowed, startNativePostgres, supabaseShapedDatabase } from './support/native-postgres.mjs';
import {
  readCatalog, driftedFiles, missionId, NAMESPACE, ID_NAME_PREFIX, OUTPUT_FILES, PRODUCTION_MISSION_COLUMNS,
  PRODUCTION_MISSION_CHECKS, CC_BY,
} from '../../tools/build-mission-import.mjs';

refuseUnlessAllowed('mission-catalog.native');

const DB = 'mission_catalog_native';
const FILES = {
  joinScope: 'supabase/pending/20261117100000_action_globe_join_scope_v1.sql',
  joinScopeRollback: 'supabase/pending/20261117100000_action_globe_join_scope_v1.rollback.sql',
  details: 'supabase/pending/20261117100100_action_mission_details.sql',
  detailsRollback: 'supabase/pending/20261117100100_action_mission_details.rollback.sql',
  import: OUTPUT_FILES.import,
  importRollback: OUTPUT_FILES.importRollback,
  publish: OUTPUT_FILES.publish,
  publishRollback: OUTPUT_FILES.publishRollback,
};
const MIGRATIONS = [
  'supabase/migrations/20261014013557_action_globe_regions.sql',
  'supabase/migrations/20261014013601_action_globe_song_portfolios.sql',
  'supabase/migrations/20261014014547_action_globe_region_activation.sql',
  'supabase/migrations/20261014184518_action_globe_join_authorization.sql',
];
// Production, read-only 2026-11-17: md5(prosrc) and the grants of every function in the chain.
const JOIN = 'public.join_action_mission(uuid)';
const CAN_JOIN = 'public.action_globe_can_join_mission(uuid,uuid)';
const PRODUCTION_PROSRC_MD5 = {
  [JOIN]: 'e0684ebe350296c5e6c06de55624ed42',
  [CAN_JOIN]: 'a73db92bb2c4b4e6da84b1e311c82b84',
  'public.action_globe_public_region_missions()': '99a7234b1083bddc8d5e9567dd462954',
  'public.action_globe_region_unlock_status(text)': 'b131a3e491a60bde824132c128573ece',
  'public.current_m_uid()': '3b9b6acf1f38a5edfc482ea9a451d022',
  'public.eu_is_admin()': '0d9f702478dbb0c7f9fe8456a4f1ece5',
  'public.intel_action_readiness_guard()': '678f4ab72dc0726b0f0a502861996de2',
};
const PRODUCTION_ACL = {
  [JOIN]: ['authenticated=X/postgres', 'postgres=X/postgres', 'service_role=X/postgres'],
  [CAN_JOIN]: ['postgres=X/postgres', 'service_role=X/postgres'],
};
const FREE_RIDE = '302dcb4e-ca21-4289-b633-9c397985fb9d';
const ANA = '00000000-0000-4000-8000-0000000000a1'; // a member with no region
const BEA = '00000000-0000-4000-8000-0000000000b2'; // members who consent to Georgia
const CAL = '00000000-0000-4000-8000-0000000000c3';
const ADA = '00000000-0000-4000-8000-0000000000d4'; // an admin (eu_profiles.role = 'admin')
const mUid = (id) => id.replace(/^00000000/, '10000000');

const repo = (p) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; console.log(`ok ${n} ${m}`); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; console.log(`ok ${n} ${m}`); };
const fails = async (p, code, re, m) => {
  let error = null;
  try { await p; } catch (e) { error = e; }
  assert.ok(error, `${m}: it succeeded`);
  assert.equal(error.code, code, `${m}: ${error.message}`);
  if (re) assert.match(error.message, re, m);
  n += 1; console.log(`ok ${n} ${m}`);
  return error;
};

const { catalog } = readCatalog();
const ids = catalog.missions.map((m) => missionId(m.slug));
const ccByCount = catalog.missions.filter((m) => m.source?.license === CC_BY.name).length;
const aboutCount = catalog.missions.filter((m) => m.about !== null).length;
const sourceCount = catalog.missions.filter((m) => m.source?.explorer_url).length;
const N = ids.length;

const server = await startNativePostgres();
const clients = [];
let admin;
try {
  eq(driftedFiles(), [], 'the generated import and publish files are current with the catalog');
  admin = await supabaseShapedDatabase(server, DB);
  clients.push(admin);
  const sql = Object.fromEntries(await Promise.all(Object.entries(FILES).map(async ([k, f]) => [k, await repo(f)])));
  const apply = (text) => admin.query(text);
  const refused = async (text, code, re, m) => {
    const e = await fails(admin.query(text), code, re, m);
    await admin.query('rollback');
    return e;
  };
  const one = async (q, params = []) => (await admin.query(q, params)).rows[0];
  const md5Of = async (sig) => (await one('select md5(prosrc) as d from pg_proc where oid = $1::regprocedure', [sig])).d;
  const aclOf = async (sig) => (await one('select array(select unnest(proacl)::text order by 1) as a from pg_proc where oid = $1::regprocedure', [sig])).a;
  const security = async (sig) => one('select prosecdef, proconfig from pg_proc where oid = $1::regprocedure', [sig]);
  const digest = async (q) => (await one(q)).d;
  const missionsDigest = () => digest("select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) as d from public.action_missions t");
  const missionsContent = () => digest("select md5(coalesce(string_agg((to_jsonb(t) - 'updated_at')::text, '|' order by t.id), '')) as d from public.action_missions t");
  const detailsDigest = () => digest("select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.mission_id), '')) as d from public.action_mission_details t");
  const statusCounts = async () => Object.fromEntries((await admin.query('select status, count(*)::int as c from public.action_missions where id = any ($1) group by 1 order by 1', [ids])).rows.map((r) => [r.status, r.c]));
  const persona = async (role, user) => {
    const c = await server.client(DB);
    clients.push(c);
    const claims = role === 'authenticated' ? { sub: user, role, email: `${user}@example.test` } : { role };
    await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
    await c.query(`set role ${role}`);
    return c;
  };
  const sees = async (c) => {
    const m = (await c.query('select count(*)::int as c from public.action_missions where id = any ($1)', [ids])).rows[0].c;
    const d = (await c.query('select count(*)::int as c from public.action_mission_details')).rows[0].c;
    return [m, d];
  };
  const join = (c, id) => c.query('select public.join_action_mission($1) as r', [id]).then((r) => r.rows[0].r.status);
  const pin = (mission, region, published, scope) => (scope
    ? admin.query('insert into public.action_globe_mission_regions(mission_id, region_key, published, join_scope) values ($1, $2, $3, $4)', [mission, region, published, scope])
    : admin.query('insert into public.action_globe_mission_regions(mission_id, region_key, published) values ($1, $2, $3)', [mission, region, published]));

  /* ---- production's shape -------------------------------------------------------------------------------- */
  await admin.query('create extension if not exists "uuid-ossp"');
  await apply(await repo('supabase/tests/action_mission_catalog.stub.sql'));
  for (const f of MIGRATIONS) await apply(await repo(f));
  // join_action_mission's grants in production (an earlier migration made them; read 2026-11-17)
  await apply('revoke all on function public.join_action_mission(uuid) from public, anon; grant execute on function public.join_action_mission(uuid) to authenticated, service_role;');
  for (const [sig, md5] of Object.entries(PRODUCTION_PROSRC_MD5)) eq(await md5Of(sig), md5, `PostgreSQL ${server.version}: ${sig} is production's (md5(prosrc) ${md5})`);
  for (const [sig, acl] of Object.entries(PRODUCTION_ACL)) eq(await aclOf(sig), acl, `${sig} has production's grants`);
  const columns = (await admin.query("select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as \"notNull\" from pg_attribute a where a.attrelid = 'public.action_missions'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum")).rows;
  eq(columns, PRODUCTION_MISSION_COLUMNS.map((c) => ({ ...c })), "public.action_missions has production's 18 columns, in order");
  const checks = Object.fromEntries((await admin.query("select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.action_missions'::regclass and contype = 'c' order by 1")).rows.map((r) => [r.conname, r.def]));
  eq(checks, { ...PRODUCTION_MISSION_CHECKS }, "and production's nine checks, exactly as the import tool validated against them");

  // production's rows on 2026-11-17: one open mission, three regions, no pin, no member region
  await apply(`insert into public.action_missions(id, title, description, domain, status, kind)
    values ('${FREE_RIDE}', 'Give someone a free ride', 'fixture', 'mutual_aid', 'open', 'civic')`);
  await apply(`insert into public.action_globe_regions(region_key, country_code, subdivision_code, region_label, centroid_lat, centroid_lon) values
    ('US-CT','US','CT','Connecticut',41.6032,-73.0877), ('US-GA','US','GA','Georgia',32.1656,-82.9001), ('CD-HK','CD','HK','Haut-Katanga',-10.7,27.5)`);
  for (const id of [ANA, BEA, CAL, ADA]) {
    await admin.query('insert into auth.users(id) values ($1)', [id]);
    await admin.query('insert into public.m_people(id) values ($1)', [mUid(id)]);
    await admin.query('insert into public.m_auth_user_links(auth_user_id, m_uid) values ($1, $2)', [id, mUid(id)]);
  }
  await admin.query("insert into public.eu_profiles(id, role) values ($1, 'admin')", [ADA]);
  const anon = await persona('anon');
  const ana = await persona('authenticated', ANA);
  const bea = await persona('authenticated', BEA);
  const ada = await persona('authenticated', ADA);
  const service = await persona('service_role');
  const beforeAll = await missionsDigest();

  /* ---- the bug, as production has it today --------------------------------------------------------------- */
  await pin(FREE_RIDE, 'US-CT', false);
  await fails(join(ana, FREE_RIDE), 'P0001', /regional mission not eligible for this member/, 'production today: one UNPUBLISHED pin makes the free ride unjoinable for a member with no region');
  await apply('delete from public.action_globe_mission_regions');

  /* ---- 1. join scope ------------------------------------------------------------------------------------- */
  await apply(sql.joinScope); await apply(sql.joinScope);
  const col = await one("select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'action_globe_mission_regions' and column_name = 'join_scope'");
  eq([col.column_default, col.is_nullable], ["'anywhere'::text", 'NO'], "join scope applies twice: join_scope text not null default 'anywhere'");
  await fails(pin(FREE_RIDE, 'US-CT', true, 'members_only'), '23514', /join_scope_check/, 'join_scope accepts only anywhere and region_members');
  ok((await md5Of(JOIN)) !== PRODUCTION_PROSRC_MD5[JOIN] && (await md5Of(CAN_JOIN)) !== PRODUCTION_PROSRC_MD5[CAN_JOIN], 'both join functions now have the new bodies');
  for (const sig of [JOIN, CAN_JOIN]) {
    eq(await security(sig), { prosecdef: true, proconfig: ['search_path=""'] }, `${sig} keeps SECURITY DEFINER and search_path ''`);
    eq(await aclOf(sig), PRODUCTION_ACL[sig], `${sig} keeps production's grants`);
  }
  await fails(anon.query('select public.join_action_mission($1)', [FREE_RIDE]), '42501', /permission denied/, 'a guest still cannot call join_action_mission');
  await fails(ana.query('select public.action_globe_can_join_mission($1, $2)', [mUid(ANA), FREE_RIDE]), '42501', /permission denied/, 'a member still cannot call the eligibility helper');

  /* ---- 2. mission details -------------------------------------------------------------------------------- */
  await refused(sql.import, '55000', /apply 20261117100100_action_mission_details\.sql/, 'the import refuses, changing nothing, before the details table exists');
  eq(await statusCounts(), {}, 'and wrote no mission');
  await apply(sql.details); await apply(sql.details);
  const priv = (await admin.query(`select r as role, has_table_privilege(r, 'public.action_mission_details', 'SELECT') as s,
      has_table_privilege(r, 'public.action_mission_details', 'INSERT') or has_table_privilege(r, 'public.action_mission_details', 'UPDATE')
        or has_table_privilege(r, 'public.action_mission_details', 'DELETE') or has_table_privilege(r, 'public.action_mission_details', 'TRUNCATE') as w
    from unnest(array['anon','authenticated','service_role']) r order by 1`)).rows;
  eq(priv, [{ role: 'anon', s: true, w: false }, { role: 'authenticated', s: true, w: false }, { role: 'service_role', s: true, w: true }],
    'details apply twice; anon and authenticated may only SELECT (Supabase default privileges revoked), the service role writes');
  eq((await one("select relrowsecurity as r from pg_class where oid = 'public.action_mission_details'::regclass")).r, true, 'row level security is on');
  const policies = (await admin.query("select polname, polcmd, array(select rolname::text from pg_roles where oid = any (polroles) order by 1) as roles from pg_policy where polrelid = 'public.action_mission_details'::regclass order by 1")).rows;
  eq(policies, [
    { polname: 'admins manage mission details', polcmd: '*', roles: ['authenticated'] },
    { polname: 'public reads open mission details', polcmd: 'r', roles: ['anon', 'authenticated'] },
  ], 'two policies: public reads (anon, authenticated) and admins manage (authenticated)');

  /* ---- 3. import: one transaction, drafts only ----------------------------------------------------------- */
  const stray = '00000000-0000-4000-8000-00000000ee01';
  await apply(`insert into public.action_missions(id, title, status) values ('${stray}', 'stray', 'draft')`);
  await apply(`insert into public.action_mission_details(mission_id, catalog, slug, credit_line) values ('${stray}', 'drawdown', '${catalog.missions[0].slug}', 'x')`);
  await refused(sql.import, '23505', /action_mission_details_catalog_slug_key/, 'one failing row (a slug already taken) aborts the whole import');
  eq(await statusCounts(), {}, 'and leaves no mission behind: it is one transaction');
  await apply(`delete from public.action_missions where id = '${stray}'`);
  const preImport = await missionsDigest();
  eq(preImport, beforeAll, 'the missions table is back to production\'s rows before the import');
  await apply(sql.import);
  eq(await statusCounts(), { draft: N }, `the import writes ${N} missions, every one a draft`);
  const shape = await one(`select count(*) filter (where kind = 'civic' and proof_required and campaign_id is null and capacity is null and starts_at is null and ends_at is null)::int as c
    from public.action_missions where id = any ($1)`, [ids]);
  eq(shape.c, N, 'every one civic, proof required, with no campaign, capacity or dates');
  const d = await one(`select count(*)::int as all, count(*) filter (where license_name = 'CC BY 4.0' and license_url is not null and doi is not null)::int as cc,
      count(*) filter (where about is not null and about_credit is not null)::int as about, count(*) filter (where source_url is not null)::int as src,
      count(*) filter (where credit_line <> '' and proof_hint is not null and safety_note is not null)::int as credit
    from public.action_mission_details where mission_id = any ($1)`, [ids]);
  eq([d.all, d.cc, d.about, d.src, d.credit], [N, ccByCount, aboutCount, sourceCount, N], `${N} details rows: ${ccByCount} CC BY with licence and DOI, ${aboutCount} quotations with their credit, ${sourceCount} source links, a credit line on every one`);
  const v5 = await one(`select count(*)::int as c from unnest($1::text[], $2::uuid[]) as x(slug, id)
    where uuid_generate_v5($3::uuid, $4 || x.slug) = x.id`, [catalog.missions.map((m) => m.slug), ids, NAMESPACE, ID_NAME_PREFIX]);
  eq(v5.c, N, 'every id equals PostgreSQL uuid-ossp uuid_generate_v5 of mccluster:mission:drawdown:<slug> under the namespace');
  eq(await sees(anon), [0, 0], 'a guest reads no draft and no draft\'s details');
  eq(await sees(ana), [0, 0], 'neither does a signed-in member');
  eq(await sees(ada), [N, N], 'an admin reads the drafts and their details');
  const afterImport = [await missionsDigest(), await detailsDigest()];
  await apply(sql.import);
  eq([await missionsDigest(), await detailsDigest()], afterImport, 'rerunning the import changes nothing');
  const firstTitle = (await one('select title from public.action_missions where id = $1', [ids[0]])).title;
  await apply(`update public.action_missions set title = 'Edited by the owner' where id = '${ids[0]}'`);
  await apply(sql.import);
  eq((await one('select title from public.action_missions where id = $1', [ids[0]])).title, 'Edited by the owner', 'a rerun never overwrites a mission the owner edited');
  await admin.query('update public.action_missions set title = $2 where id = $1', [ids[0], firstTitle]);
  const draftContent = await missionsContent();

  /* ---- 4. publish ---------------------------------------------------------------------------------------- */
  await apply(`update public.action_missions set status = 'paused' where id = '${ids[1]}'`);
  await apply(sql.publish);
  eq(await statusCounts(), { open: N - 1, paused: 1 }, 'publish opens the drafts and leaves a mission the owner paused alone');
  await apply(`update public.action_missions set status = 'draft' where id = '${ids[1]}'`);
  await apply(sql.publish);
  eq(await statusCounts(), { open: N }, `run again it opens the one draft left: all ${N} open`);
  eq((await one("select count(*)::int as c from public.action_missions where status = 'open' and not (id = any ($1))", [ids])).c, 1, 'and touched no other mission (the free ride stays as it was)');
  eq(await sees(anon), [N, N], `a guest reads the ${N} published missions and their ${N} details rows`);
  const credits = await anon.query('select count(*)::int as c from public.action_missions m join public.action_mission_details d on d.mission_id = m.id where m.id = any ($1) and length(d.credit_line) > 0', [ids]);
  eq(credits.rows[0].c, N, 'every published mission a guest reads has its credit line');
  const afterPublish = [await missionsDigest(), await detailsDigest()];
  await apply(sql.publish);
  eq([await missionsDigest(), await detailsDigest()], afterPublish, 'rerunning the publish changes nothing');
  await service.query(`update public.action_missions set status = 'draft' where id = $1`, [ids[2]]);
  eq(await sees(anon), [N - 1, N - 1], 'a mission set back to draft disappears for a guest, its details with it');
  eq((await anon.query('select count(*)::int as c from public.action_mission_details where mission_id = $1', [ids[2]])).rows[0].c, 0, 'a guest cannot read that draft\'s details by id');
  await service.query(`update public.action_missions set status = 'open' where id = $1`, [ids[2]]);
  await fails(anon.query("insert into public.action_mission_details(mission_id, catalog, slug, credit_line) values ($1, 'x1', 'abc', 'x')", [FREE_RIDE]), '42501', /permission denied/, 'a guest cannot write details');
  await fails(ada.query("update public.action_mission_details set credit_line = 'changed' where mission_id = $1", [ids[0]]), '42501', /permission denied/, 'neither can an admin through the API: only the service role writes');
  await fails(publishWithout(), '55000', /Drawdown publish refused: 1 of the/, 'publish refuses, changing nothing, when one mission has lost its details row');

  /* ---- 5. joining ---------------------------------------------------------------------------------------- */
  const [U, X, Y, Z] = [ids[3], ids[4], ids[5], ids[6]];
  eq(await join(ana, U), 'in_progress', 'a member with no region joins an unpinned published mission');
  await pin(X, 'US-CT', true);
  eq((await one('select join_scope from public.action_globe_mission_regions where mission_id = $1', [X])).join_scope, 'anywhere', "a new pin is 'anywhere' by default");
  eq(await join(ana, X), 'in_progress', "the same member joins a mission pinned in Connecticut with join_scope 'anywhere'");
  await pin(Y, 'US-GA', true, 'region_members');
  await fails(join(ana, Y), 'P0001', /regional mission not eligible for this member/, "a 'region_members' pin in a locked region (Georgia, no member) refuses her");
  await pin(Z, 'US-GA', false, 'region_members');
  eq(await join(ana, Z), 'in_progress', "an UNPUBLISHED 'region_members' pin does not gate");
  const pins = (await anon.query('select mission_id, region_key, latitude, longitude from public.action_globe_public_region_missions() order by region_key')).rows;
  eq(pins.map((p) => [p.mission_id, p.region_key]), [[X, 'US-CT'], [Y, 'US-GA']], 'a guest sees the two published pins and not the unpublished one');
  ok(pins.every((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0)), 'at their regions\' label points, never 0,0');
  await apply(`insert into public.action_globe_member_regions(m_uid, region_key) values ('${mUid(BEA)}', 'US-GA'), ('${mUid(CAL)}', 'US-GA')`);
  eq(await join(bea, Y), 'in_progress', 'once two members consent to Georgia it unlocks, and a Georgia member joins');
  await fails(join(ana, Y), 'P0001', /regional mission not eligible/, 'a member from elsewhere still cannot');

  /* ---- 6. rollbacks, in reverse order -------------------------------------------------------------------- */
  await apply(`update public.action_missions set status = 'closed' where id = '${ids[7]}'`);
  await apply(sql.publishRollback);
  eq(await statusCounts(), { closed: 1, draft: N - 1 }, 'the publish rollback sets the open missions back to draft and leaves one the owner closed alone');
  await apply(`update public.action_missions set status = 'draft' where id = '${ids[7]}'`);
  eq(await missionsContent(), draftContent, 'every column but updated_at is as it was after the import');
  eq(await sees(anon), [0, 0], 'a guest reads none of them again');
  const afterPublishRollback = await missionsDigest();
  await apply(sql.publishRollback);
  eq(await missionsDigest(), afterPublishRollback, 'rerunning the publish rollback changes nothing');
  await refused(sql.detailsRollback, '55000', new RegExp(`still holds ${N} row`), 'the details rollback refuses while the imported rows are there');
  await apply(`insert into public.action_proofs(assignment_id, user_id, proof_type) select id, user_id, 'text' from public.action_mission_assignments where mission_id = '${U}'`);
  const e1 = await refused(sql.importRollback, '55000', /public\.action_mission_assignments\.mission_id: 4/, 'the import rollback refuses while member assignments (one with a proof) reference the missions');
  ok(/public\.action_globe_mission_regions\.mission_id: 3/.test(e1.message), 'and names the three pins too');
  eq(await statusCounts(), { draft: N }, 'and deleted nothing');
  await apply('delete from public.action_mission_assignments; delete from public.action_globe_mission_regions;');
  await apply(`insert into public.social_content_items(action_mission_id) values ('${X}')`);
  await refused(sql.importRollback, '55000', /social_content_items\.action_mission_id: 1/, 'a reference that would be set to null on delete refuses it as well');
  await apply('delete from public.social_content_items');
  await apply(`insert into public.action_creator_funding(mission_id) values ('${X}')`);
  await refused(sql.importRollback, '55000', /action_creator_funding\.mission_id: 1/, 'so does a mission_id held without a foreign key');
  await apply('delete from public.action_creator_funding');
  await apply(sql.importRollback);
  eq(await missionsDigest(), preImport, 'the import rollback leaves public.action_missions exactly as before the import');
  eq((await one('select count(*)::int as c from public.action_mission_details')).c, 0, 'and no details row');
  await apply(sql.importRollback);
  eq(await missionsDigest(), preImport, 'rerunning the import rollback changes nothing');
  await apply(sql.detailsRollback); await apply(sql.detailsRollback);
  eq((await one("select to_regclass('public.action_mission_details') is null as gone")).gone, true, 'the details rollback drops the empty table, and runs twice');
  await apply(sql.joinScopeRollback); await apply(sql.joinScopeRollback);
  for (const sig of [JOIN, CAN_JOIN]) {
    eq(await md5Of(sig), PRODUCTION_PROSRC_MD5[sig], `the join scope rollback restores ${sig} to production's md5(prosrc) ${PRODUCTION_PROSRC_MD5[sig]}`);
    eq(await security(sig), { prosecdef: true, proconfig: ['search_path=""'] }, `${sig}: SECURITY DEFINER, search_path ''`);
    eq(await aclOf(sig), PRODUCTION_ACL[sig], `${sig}: production's grants`);
  }
  eq((await one("select count(*)::int as c from information_schema.columns where table_schema = 'public' and table_name = 'action_globe_mission_regions' and column_name = 'join_scope'")).c, 0, 'join_scope is gone');
  await pin(FREE_RIDE, 'US-CT', true);
  await fails(join(ana, FREE_RIDE), 'P0001', /regional mission not eligible/, "and production's behaviour is back: a pin locks its mission");
  await apply('delete from public.action_globe_mission_regions');
  eq(await missionsDigest(), beforeAll, "public.action_missions ends as production's rows began");

  /* ---- 7. the whole chain again, after its rollbacks ----------------------------------------------------- */
  for (const k of ['joinScope', 'details', 'import', 'publish']) await apply(sql[k]);
  eq(await statusCounts(), { open: N }, 'after every rollback the four files apply again from the start');
  for (const k of ['publishRollback', 'importRollback', 'detailsRollback', 'joinScopeRollback']) await apply(sql[k]);
  eq([await missionsDigest(), await md5Of(JOIN), await md5Of(CAN_JOIN)], [beforeAll, PRODUCTION_PROSRC_MD5[JOIN], PRODUCTION_PROSRC_MD5[CAN_JOIN]], 'and roll back again to production\'s state');

  console.log(`mission catalog native: ${n} passed on PostgreSQL ${server.version}`);

  /** The publish, run while one imported mission has lost its details row (put back afterwards). */
  async function publishWithout() {
    const row = await one('select * from public.action_mission_details where mission_id = $1', [ids[8]]);
    await apply(`update public.action_missions set status = 'draft' where id = '${ids[9]}'`);
    await admin.query('delete from public.action_mission_details where mission_id = $1', [ids[8]]);
    const before = await missionsDigest();
    try {
      await admin.query(sql.publish);
    } catch (error) {
      await admin.query('rollback');
      assert.equal(await missionsDigest(), before, 'the refused publish changed nothing');
      throw error;
    } finally {
      await admin.query(`insert into public.action_mission_details select * from json_populate_record(null::public.action_mission_details, $1)`, [JSON.stringify(row)]);
      await apply(`update public.action_missions set status = 'open' where id = '${ids[9]}'`);
    }
  }
} finally {
  for (const c of clients) await c.end().catch(() => {});
  server.stop();
}
