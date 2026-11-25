/** Local PostgreSQL behavior checks. Never connects to a hosted database.
 * Install a pinned test-only runtime outside the Worker:
 *   npm install --prefix .tools --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
 *   node supabase/tests/prim3_level_builder.db.mjs
 * PGLITE_MODULE may point to another local PGlite ESM entry point.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { levelModel } from '../../workers/mccluster/src/prim3/level-validation.js';
import { LEVEL_ASSETS } from '../../workers/mccluster/src/prim3/level-assets.js';

const moduleUrl = process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href
  : new URL('../../.tools/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url).href;
const { PGlite } = await import(moduleUrl);
const db = new PGlite();
const OWNER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok ${passed} - ${name}`); };
const rpc = async (action, id, actor, doc, revision) => {
  const result = await db.query('select public.prim3_level_mutate($1,$2,$3,$4::jsonb,$5) as value', [action, id, actor, doc === null ? null : JSON.stringify(doc), revision]);
  return result.rows[0].value;
};
const rejects = async (operation, code) => assert.rejects(operation, error => error.code === code);
const document = { ...levelModel.createBlank(), id: 'db-level', title: 'Database boundary fixture' };

try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.orgs(id uuid primary key, slug text unique not null);
    create table public.org_members(org_id uuid not null references public.orgs(id), profile_id uuid not null references auth.users(id), role text not null);
    insert into auth.users values ('${OWNER}'), ('${MEMBER}');
    insert into public.orgs values ('${ORG}', 'mccluster');
    insert into public.org_members values ('${ORG}','${OWNER}','owner'), ('${ORG}','${MEMBER}','member');
    grant usage on schema public, auth to service_role, anon, authenticated;
    grant select on public.orgs, public.org_members to service_role;
  `);
  const migration = await readFile(new URL('../pending/prim3_level_builder_v1.sql', import.meta.url), 'utf8');
  await check('pending SQL applies to an empty local PostgreSQL database', () => db.exec(migration));
  await check('both tables have RLS and routines use invoker rights with an empty search path', async () => {
    const tables = await db.query("select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('prim3_levels','prim3_level_versions')");
    assert.equal(tables.rows.length, 2); assert.ok(tables.rows.every(row => row.relrowsecurity));
    const funcs = await db.query("select prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname like 'prim3_level_%'");
    assert.equal(funcs.rows.length, 3);
    assert.ok(funcs.rows.every(row => !row.prosecdef && row.proconfig.includes('search_path=""')));
  });
  await db.exec('set role service_role');
  await check('owner creates a draft at revision one', async () => {
    const row = await rpc('create', document.id, OWNER, document, null);
    assert.equal(row.revision, 1); assert.equal(row.created_by, OWNER); assert.deepEqual(row.draft, document);
  });
  await check('ordinary members cannot mutate even through the server-only function', () => rejects(() => rpc('save', document.id, MEMBER, document, 1), '42501'));
  await check('database allowlist accepts all 24 pinned catalog IDs with valid transforms', async () => {
    assert.equal(Object.keys(LEVEL_ASSETS).length, 24);
    for (const assetId of Object.keys(LEVEL_ASSETS)) {
      const doc = { ...document, objects: [{ id: 'part', assetId, x: 20, y: 20, rotation: 90, elevation: 0, scale: 0.5 }] };
      const result = await db.query('select public.prim3_level_document_valid($1::jsonb) as valid', [JSON.stringify(doc)]);
      assert.equal(result.rows[0].valid, true, assetId);
    }
  });
  await check('unknown assets and null coordinates fail database structural validation', async () => {
    const bad = structuredClone(document);
    bad.objects = [{ id: 'invalid', assetId: 'external-asset', x: 1, y: 1 }];
    await rejects(() => rpc('save', document.id, OWNER, bad, 1), '23514');
    bad.objects = []; bad.extraction.x = null;
    await rejects(() => rpc('save', document.id, OWNER, bad, 1), '23514');
    await rejects(() => rpc(null, document.id, OWNER, null, 1), '22023');
  });
  await check('two saves based on one revision cannot overwrite each other', async () => {
    const changed = { ...document, title: 'First accepted edit' };
    const results = await Promise.allSettled([
      rpc('save', document.id, OWNER, changed, 1),
      rpc('save', document.id, OWNER, { ...document, title: 'Stale edit' }, 1)
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, '40001');
    const row = (await db.query('select title,revision from public.prim3_levels')).rows[0];
    assert.equal(row.revision, 2); assert.equal(row.title, 'First accepted edit');
  });
  await check('publication is immutable and idempotent for a source revision', async () => {
    const first = await rpc('publish', document.id, OWNER, null, 2);
    const second = await rpc('publish', document.id, OWNER, null, 2);
    assert.equal(first.published_version, 1); assert.equal(second.published_version, 1);
    assert.equal(first.revision, 2); assert.equal((await db.query('select * from public.prim3_level_versions')).rows.length, 1);
  });
  await check('later drafts and publications preserve earlier snapshot contents', async () => {
    await rpc('save', document.id, OWNER, { ...document, title: 'Next draft' }, 2);
    await rejects(() => rpc('publish', document.id, OWNER, null, 2), '40001');
    const row = await rpc('publish', document.id, OWNER, null, 3); assert.equal(row.published_version, 2);
    const versions = (await db.query('select version,source_revision,document from public.prim3_level_versions order by version')).rows;
    assert.equal(versions[0].document.title, 'First accepted edit'); assert.equal(versions[0].source_revision, 2);
    assert.equal(versions[1].document.title, 'Next draft'); assert.equal(versions[1].source_revision, 3);
  });
  await check('archive retains snapshots and restore requires the latest revision', async () => {
    const archived = await rpc('archive', document.id, OWNER, null, 3);
    assert.equal(archived.archived, true); assert.equal(archived.revision, 4);
    await rejects(() => rpc('save', document.id, OWNER, document, 4), '55000');
    await rejects(() => rpc('publish', document.id, OWNER, null, 4), '55000');
    await rejects(() => rpc('restore', document.id, OWNER, null, 3), '40001');
    const restored = await rpc('restore', document.id, OWNER, null, 4);
    assert.equal(restored.archived, false); assert.equal(restored.revision, 5);
    assert.equal((await db.query('select * from public.prim3_level_versions')).rows.length, 2);
  });
  await check('service credentials cannot update/delete snapshots or hard-delete drafts', async () => {
    await rejects(() => db.exec("update public.prim3_level_versions set source_revision=99 where version=1"), '42501');
    await rejects(() => db.exec('delete from public.prim3_level_versions'), '42501');
    await rejects(() => db.exec('delete from public.prim3_levels'), '42501');
  });
  await db.exec('reset role');
  await check('snapshot trigger also blocks accidental privileged UPDATE and DELETE', async () => {
    await rejects(() => db.exec('update public.prim3_level_versions set source_revision=99 where version=1'), '55000');
    await rejects(() => db.exec('delete from public.prim3_level_versions'), '55000');
  });
  await check('revoked owner loses mutation access immediately', async () => {
    await db.exec(`update public.org_members set role='member' where profile_id='${OWNER}'; set role service_role`);
    await rejects(() => rpc('save', document.id, OWNER, document, 5), '42501');
    await db.exec(`reset role; update public.org_members set role='owner' where profile_id='${OWNER}'`);
  });
  for (const role of ['anon', 'authenticated']) {
    await check(`${role} cannot read drafts, read snapshots, or invoke mutation`, async () => {
      await db.exec(`set role ${role}`);
      await rejects(() => db.exec('select * from public.prim3_levels'), '42501');
      await rejects(() => db.exec('select * from public.prim3_level_versions'), '42501');
      await rejects(() => rpc('publish', document.id, OWNER, null, 5), '42501');
      await db.exec('reset role');
    });
  }
  await check('RLS still hides records if an operator accidentally grants browser SELECT', async () => {
    await db.exec('grant select on public.prim3_levels,public.prim3_level_versions to authenticated; set role authenticated');
    assert.equal((await db.query('select * from public.prim3_levels')).rows.length, 0);
    assert.equal((await db.query('select * from public.prim3_level_versions')).rows.length, 0);
    await db.exec('reset role; revoke select on public.prim3_levels,public.prim3_level_versions from authenticated');
  });
  console.log(`Passed ${passed} local PostgreSQL checks. No hosted database was contacted.`);
} finally {
  await db.close();
}
