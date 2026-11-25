// W3 race proof for the Arcade start key, on a disposable native PostgreSQL (PGlite has one session and cannot
// race): one key reused at once on two missions, once in sequence, and at once on the same mission, in SQL and
// through the Worker handler. Opt-in and local only (scripts/test/support/native-postgres.mjs; never the
// canonical project):
//   ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> \
//     node scripts/test/city-arcade-start-key.native.integration.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { refuseUnlessAllowed, startNativePostgres, supabaseShapedDatabase, waitsOn } from './support/native-postgres.mjs';
import { handleArcade } from '../../workers/mccluster/src/arcade/index.js';
import { TEA_MISSION } from '../../js/city-arcade/tea-action.mjs';

refuseUnlessAllowed('city-arcade-start-key.native.integration.mjs');
const OWNER = '11111111-1111-4111-8111-111111111111';
const ELM = 'bridgeport-main-elm', HILL = 'bridgeport-main-golden-hill';
let count = 0;
const ok = (condition, message) => { assert.ok(condition, message); count++; };
const server = await startNativePostgres();
try {
  const admin = await supabaseShapedDatabase(server, 'arcade_start_key', { owners: [OWNER] });
  await admin.query(await readFile(new URL('../../supabase/migrations/20261109181623_city_arcade_v1.sql', import.meta.url), 'utf8'));
  const session = async () => {
    const c = await server.client('arcade_start_key');
    await c.query('set role service_role');
    c.pid = (await c.query('select pg_backend_pid() as pid')).rows[0].pid;
    return c;
  };
  const call = (c, p) => c.query('select public.arcade_command($1,$2,$3,$4,$5) as result', [p.p_action, p.p_actor, p.p_id, p.p_document, p.p_revision]).then((r) => r.rows[0].result);
  const start = (id, key) => ({ p_action: 'start', p_actor: OWNER, p_id: id, p_revision: 1, p_document: { startKey: key } });
  const runsWithKey = async (key) => (await admin.query('select count(*)::int as n from arcade_runs where start_key = $1', [key])).rows[0].n;
  const s0 = await session();
  for (const id of [ELM, HILL]) {
    await call(s0, { p_action: 'save', p_actor: OWNER, p_id: id, p_revision: 0, p_document: { version: 1, gameId: 'gauranfucking-tea-tea-rush', locationId: id, tea: structuredClone(TEA_MISSION) } });
  }

  // 1. SQL, one key on two missions at once. The missions take different advisory locks, so B's insert waits on
  //    A's uncommitted unique entry and, once A commits, loses on unique(actor,start_key) with 23505.
  {
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', a = await session(), b = await session();
    await a.query('begin'); await b.query('begin');
    const ra = await call(a, start(ELM, key));
    const pb = call(b, start(HILL, key)).then((r) => ({ id: r.id }), (e) => ({ code: e.code, constraint: e.constraint }));
    await waitsOn(admin, b, a, 'B waits on A');
    await a.query('commit');
    const rb = await pb;
    await b.query(rb.code ? 'rollback' : 'commit');
    ok(ra.id && rb.code === '23505' && rb.constraint === 'arcade_runs_actor_start_key_key',
      `a concurrent reuse on another mission loses with 23505 on unique(actor,start_key) (got ${JSON.stringify(rb)})`);
    ok(await runsWithKey(key) === 1, 'the concurrent reuse created no second run');
    // 2. SQL, the same reuse after A has committed: the reuse check refuses it with 40001.
    const sequential = await call(s0, start(HILL, key)).then(() => 'ok', (e) => e.code);
    ok(sequential === '40001', `a sequential reuse on another mission is refused with 40001 (got ${sequential})`);
    await a.end(); await b.end();
  }

  // 3. SQL, one key on the same mission at once. The mission's advisory lock serializes them; the second is an
  //    exact retry and returns the first run.
  {
    const key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', a = await session(), b = await session();
    await a.query('begin'); await b.query('begin');
    const ra = await call(a, start(ELM, key));
    const pb = call(b, start(ELM, key)).then((r) => ({ id: r.id }), (e) => ({ code: e.code }));
    await waitsOn(admin, b, a, 'B waits on the mission lock');
    await a.query('commit');
    const rb = await pb;
    await b.query(rb.code ? 'rollback' : 'commit');
    ok(rb.id === ra.id, `a concurrent exact retry on the same mission returns the same run (got ${JSON.stringify(rb)})`);
    ok(await runsWithKey(key) === 1, 'one run for the key');
    await a.end(); await b.end();
  }

  // 4. Worker, the cross-mission race through handleArcade. Storage answers as PostgREST does (23505 is HTTP 409,
  //    40001 is HTTP 500, the body carries the code); the Worker maps by code. The race loser and the sequential
  //    reuse are both a 409 conflict, never a 503 "service unavailable".
  {
    const key = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', a = await session(), b = await session();
    let release, inserted;
    const held = new Promise((r) => { release = r; }), aInserted = new Promise((r) => { inserted = r; });
    const postgrest = (c, hold) => async (url, options) => {
      const p = JSON.parse(options.body);
      await c.query('begin');
      try {
        const result = await call(c, p);
        if (hold) { inserted(); await held; }
        await c.query('commit');
        return Response.json(result);
      } catch (e) {
        await c.query('rollback');
        return Response.json({ code: e.code, message: e.message }, { status: e.code === '23505' ? 409 : e.code === '40001' ? 500 : 400 });
      }
    };
    const env = { ARCADE_CLOUD_ENABLED: 'true', SUPABASE_URL: 'https://local.invalid', SUPABASE_SERVICE_ROLE_KEY: 'local-fixture-only' };
    const owner = { requireHouseOwner: async () => ({ id: OWNER }) };
    const request = (id) => new Request('https://local.invalid/v1/arcade/start/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1, startKey: key }) });
    const wa = handleArcade(request(ELM), env, { ...owner, fetchImpl: postgrest(a, true) });
    await aInserted;
    const wb = handleArcade(request(HILL), env, { ...owner, fetchImpl: postgrest(b, false) });
    await waitsOn(admin, b, a, 'Worker B waits on Worker A');
    release();
    const [xa, xb] = await Promise.all([wa, wb]);
    ok(xa.status === 201, `the first start is created (got ${xa.status})`);
    const loser = await xb.json();
    ok(xb.status === 409, `the concurrent reuse is answered 409, not as an outage (got ${xb.status} ${JSON.stringify(loser)})`);
    const sequential = await handleArcade(request(HILL), env, { ...owner, fetchImpl: postgrest(s0, false) });
    ok(sequential.status === 409, `the sequential reuse is answered 409 (got ${sequential.status})`);
    ok(await runsWithKey(key) === 1, 'one run for the key');
    await a.end(); await b.end();
  }
  await s0.end(); await admin.end();
  console.log(`${count} start-key race assertions passed on PostgreSQL ${server.version}.`);
} finally {
  server.stop();
}
