// Equity Uprise shared music-platform regression proof; support only, no new capability.
// Pending catalog, distribution and lyrics migrations on native PostgreSQL.
// Default: canonical music SQL with the repository's explicit Auth/Storage
// stand-ins. --full-reset: actual local Supabase reset objects and roles.
// Synthetic identities, bytes, lyrics and job receipts; no production access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { nativeTestDb, resetMigrationPlan } from './native-admin-test-db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const fullReset = process.argv.includes('--full-reset');
assert.deepEqual(process.argv.slice(2), fullReset ? ['--full-reset'] : []);
const C = 'supabase/pending/20261123200000_music_creator_distribution_v1.sql';
const CR = C.replace('.sql', '.rollback.sql');
const F = 'supabase/pending/20261031180000_lyrics_machine_v1.sql';
const FR = F.replace('.sql', '.rollback.sql');
const catalogFiles = [
  ['tinderfessions', 12, 'supabase/pending/20261123180000_tinderfessions_catalog_objects.sql'],
  ['in-hot-pursuit', 8, 'supabase/pending/20261123190000_in_hot_pursuit_catalog_objects.sql'],
];
let checks = 0;
const equal = (actual, expected, label) => {
  // The native driver's Result is an Array subclass with command metadata.
  assert.deepEqual(Array.isArray(actual) ? Array.from(actual) : actual, Array.isArray(expected) ? Array.from(expected) : expected, label); checks++;
};
const ok = (value, label) => { assert.ok(value, label); checks++; };
const deny = async (action, expected, label) => { await assert.rejects(action, expected, label); checks++; };
const hash = value => createHash('sha256').update(value).digest('hex');
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function openReset() {
  const url = new URL(process.env.NATIVE_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'native proof is local only');
  assert.equal(url.port, '54322'); assert.equal(url.pathname, '/postgres');
  const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
  const options = { max: 1, onnotice: () => {}, connection: { application_name: 'music-release-native-proof', statement_timeout: 20000 } };
  const wrap = connection => ({ sql: connection, query: async (text, values = []) => ({ rows: await connection.unsafe(text, values) }),
    exec: text => connection.unsafe(text), transaction: fn => connection.begin(tx => fn(wrap(tx))), close: () => connection.end() });
  const database = wrap(postgres(url.href, options)); database.fork = () => wrap(postgres(url.href, options));
  try {
    const plan = await resetMigrationPlan(root);
    const actual = Array.from((await database.query('select version,name from supabase_migrations.schema_migrations order by version')).rows);
    equal(actual, plan.rows, 'full reset exactly matches canonical ledger files plus replay foundations');
    console.log(JSON.stringify({ baseline: 'canonical Supabase reset', migrations: actual.length, production_migrations: plan.productionCount, replay_only_migrations: plan.replayOnlyCount, latest: actual.at(-1)?.version }));
    return database;
  } catch (error) { await database.close(); throw error; }
}
const db = fullReset ? await openReset() : await nativeTestDb('music_release');
const clients = new Set();
const referenceTable = `private.native_music_catalog_reference_${process.pid}`;
async function session(role, user) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  const connection = db.fork(); clients.add(connection);
  await connection.exec(`set role ${role}`);
  await connection.query("select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claim.sub',$3,false)", [JSON.stringify({ role, ...(user ? { sub: user } : {}) }), role, user || '']);
  return connection;
}
const migration = file => db.transaction(tx => tx.exec(read(file)));
const guard = (file, token, label) => deny(() => migration(file), error => error.code === '55000' && error.message.includes(token), label);
async function boundedBaseline() {
  for (const file of ['supabase/tests/supabase_api_roles.stub.sql', 'supabase/tests/music_creator_onboarding.stub.sql', 'supabase/tests/music_release_integrity.stub.sql',
    'supabase/migrations/20260920041011_music_creator_platform_v1.sql', 'supabase/migrations/20260920041250_music_commerce_v1.sql', 'supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql']) {
    let sql = read(file);
    if (file === 'supabase/tests/music_creator_onboarding.stub.sql') {
      // Keep peripheral stand-ins, but use the actual original track table
      // and its RLS enablement. Its NOT NULL audio URL and row filtering must
      // agree with the canonical reset; the real music migration adds policies.
      const source = read('supabase/replay_migrations/0003_creator_cuts.sql');
      const canonical = source.match(/^create table if not exists public\.creator_tracks \([\s\S]*?^\);/m)?.[0];
      const rowSecurity = source.match(/^alter table public\.creator_tracks enable row level security;$/gm);
      const placeholder = /^create table public\.creator_tracks\([\s\S]*?^\);/m;
      assert.ok(canonical && rowSecurity?.length === 1 && placeholder.test(sql), 'canonical creator-track table, RLS and explicit fixture boundary exist');
      sql = sql.replace(placeholder, `${canonical}\n${rowSecurity[0]}`);
    }
    await db.transaction(tx => tx.exec(sql));
  }
  // Supabase's role accessor accepts the singular claim before JSON claims.
  // This stand-in is used only locally; --full-reset never replaces Auth.
  await db.exec(`create or replace function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'); $$;`);
  const tenancy = read('supabase/replay_migrations/0026_tenancy.sql');
  await db.exec(tenancy.slice(tenancy.indexOf('create table if not exists public.orgs'), tenancy.indexOf('-- The house.')));
  const queue = read('supabase/migrations/20260919053445_operational_ontology_v1.sql');
  await db.exec(queue.slice(0, queue.indexOf('create table if not exists public.ops_ontology_types')));
  const catalog = read('supabase/migrations/20261003233747_action_network_live_governance_v1.sql');
  await db.exec(catalog.slice(catalog.indexOf('create table public.music_catalog_objects('), catalog.indexOf('insert into public.music_catalog_objects(')));
  console.log(JSON.stringify({ baseline: 'canonical music guards, review and queue SQL; peripheral Auth/Storage stand-ins', full_reset: false }));
}
const USER = randomUUID(), OTHER = randomUUID();
let service, owner, other, anon, person, house;
const scalar = async (sql, values = [], connection = db) => (await connection.query(sql, values)).rows[0].value;
const contentDefinition = () => scalar("select pg_get_functiondef('public.music_track_content(public.creator_tracks)'::regprocedure) as value");
const jobRows = id => service.query("select id,status,input,output,attempts from public.ops_agent_jobs where job_type='lyrics_align' and target_type='creator_track' and target_id=$1 order by created_at,id", [id]);
const reviewState = id => scalar(`select jsonb_build_object('status',t.status,'rights_status',t.rights_status,'published_at',t.published_at,
  'reviewed_digest',t.reviewed_digest,'reviewed_snapshot',t.reviewed_snapshot,'reviewed_at',t.reviewed_at,
  'approved_master_version_id',t.approved_master_version_id,'lyrics',t.lyrics,
  'offers',(select coalesce(jsonb_agg(jsonb_build_array(id,active,checkout_enabled) order by id),'[]'::jsonb) from public.music_license_offers where track_id=t.id)) as value
  from public.creator_tracks t where t.id=$1`, [id]);
async function createTrack({ lyrics = null, published = false, master = true } = {}) {
  const id = randomUUID(), objectName = `${USER}/${id}.wav`;
  if (master) {
    await service.query("insert into public.music_creator_assets(bucket_id,object_name,owner_user_id,owner_m_uid) values('creator-masters',$1,$2,$3)", [objectName, USER, person]);
    await db.query("insert into storage.objects(bucket_id,name,owner,owner_id,version,metadata) values('creator-masters',$1,$2,$3,$4,$5::jsonb)", [objectName, USER, USER, randomUUID(), db.sql.json({ eTag: hash(id), size: 4096 })]);
  }
  // An empty preview URL is valid; the private master is independently owned
  // and pinned through the real review flow below. Never weaken its NOT NULL.
  await owner.query("insert into public.creator_tracks(id,title,artist,audio_url,master_path,status,lyrics) values($1,'Synthetic native track','Synthetic artist','',$2,$3,$4::jsonb)", [id, master ? objectName : '', published ? 'pending_review' : 'draft', lyrics === null ? null : owner.sql.json(lyrics)]);
  if (published) {
    const prepared = (await service.query('select * from public.music_prepare_review($1)', [id])).rows[0];
    const syntheticSha = hash(`Synthetic audio bytes for ${id}`);
    await service.query('select public.music_record_asset_sha256($1,$2,$3)', [prepared.version_id, syntheticSha, prepared.size_bytes]);
    const approved = (await service.query("select public.music_operator_review($1,'publish','Synthetic proof',(select updated_at from public.creator_tracks where id=$1),$2) as result", [id, syntheticSha])).rows[0].result;
    equal(approved.status, 'published', 'fixture uses the real reviewed and hashed publication path');
    await service.query("insert into public.music_license_offers(track_id,creator_m_uid,slug,title,license_type,price_cents,currency,terms_text,active,checkout_enabled) values($1,$2,'native-proof','Synthetic offer','commercial_basic',1000,'usd','Synthetic terms',true,true)", [id, person]);
  }
  return id;
}

try {
  if (!fullReset) await boundedBaseline();
  equal(await scalar("select relrowsecurity as value from pg_class where oid='public.creator_tracks'::regclass"), true, 'creator-track authorization uses the canonical RLS boundary');
  for (const file of [C, CR, F, FR]) {
    await deny(() => db.transaction(async tx => {
      await tx.exec('set transaction isolation level repeatable read');
      await tx.exec(read(file));
    }), error => error.code === '55000' && error.message.includes('MUSIC_READ_COMMITTED_REQUIRED'), 'content migrations and recovery refuse an old transaction snapshot');
  }
  equal(await scalar("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_tracks' and column_name in('distribution','lyrics_sheet','lyrics_input_rev')) as value"), false, 'proof begins before the pending column migrations');
  service = await session('service_role'); owner = await session('authenticated', USER); other = await session('authenticated', OTHER); anon = await session('anon');
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [USER, `${USER}@example.invalid`, OTHER, `${OTHER}@example.invalid`]);
  if (!fullReset) {
    for (const user of [USER, OTHER]) { const m = randomUUID(); await db.query('insert into public.m_people(id) values($1)', [m]); await db.query('insert into public.m_auth_user_links(auth_user_id,m_uid) values($1,$2)', [user, m]); }
  }
  person = await scalar('select m_uid as value from public.m_auth_user_links where auth_user_id=$1 and is_primary', [USER]);
  ok(person, 'canonical identity link resolves the synthetic creator');
  await service.query('insert into public.music_creator_profiles(m_uid,handle,artist_name) values($1,$2,$3)', [person, `native-${USER.slice(0, 8)}`, 'Synthetic artist']);
  if (!fullReset) await db.query("insert into public.orgs(slug,name,kind) values('mccluster','Synthetic house','studio')");
  house = await scalar("select id as value from public.orgs where slug='mccluster'"); ok(house, 'canonical house organization exists');
  const reviewedLyrics = { source: 'sheet', reviewed: true, untimed: ['Synthetic words preserved by the proof.'] };
  const published = await createTrack({ lyrics: reviewedLyrics, published: true });
  const beforeReview = await reviewState(published), baselineHelper = await contentDefinition();
  equal((await jobRows(published)).rows, [], 'no lyrics jobs exist before the migration');

  // Public visibility is checked as actual API roles. This disposable proof
  // table uses a real FK to represent a consumer of the stable identity.
  await db.exec(`create table ${referenceTable}(catalog_id uuid primary key references public.music_catalog_objects(id) on delete set null)`);
  const albums = JSON.parse(read('data/albums.json')).albums;
  for (const [albumSlug, expectedCount, file] of catalogFiles) {
    const album = albums.find(item => item.slug === albumSlug);
    equal(album.tracks.length, expectedCount, 'expected catalog size comes from the shipped album');
    const expectedKeys = album.tracks.map(track => `${albumSlug}:${slug(track.title)}`).sort();
    await migration(file);
    const first = (await db.query('select * from public.music_catalog_objects where album_slug=$1 order by catalog_key', [albumSlug])).rows;
    equal(first.map(row => row.catalog_key), expectedKeys, 'catalog keys match every shipped shelf track exactly');
    for (const row of first) {
      const track = album.tracks.find(item => `${albumSlug}:${slug(item.title)}` === row.catalog_key);
      equal([row.album_title, row.track_title, row.artist_name, row.audio_path, row.artwork_path, row.status], [album.name, track.title, album.artist, track.src, album.art, 'active'], 'catalog metadata and assets match the shipped shelf');
      await db.query(`insert into ${referenceTable} values($1)`, [row.id]);
    }
    await migration(file);
    equal((await db.query('select id from public.music_catalog_objects where album_slug=$1 order by catalog_key', [albumSlug])).rows.map(row => row.id), first.map(row => row.id), 'repeat seed preserves stable identities');
    for (const connection of [anon, owner]) equal((await connection.query('select catalog_key from public.music_catalog_objects where album_slug=$1 order by catalog_key', [albumSlug])).rows.map(row => row.catalog_key), expectedKeys, 'public role sees each active seeded object');
    await deny(() => owner.query("update public.music_catalog_objects set status='archived' where album_slug=$1", [albumSlug]), { code: '42501' }, 'ordinary creator cannot mutate catalog seeds');
    await migration(file.replace('.sql', '.rollback.sql')); await migration(file.replace('.sql', '.rollback.sql'));
    equal((await anon.query('select id from public.music_catalog_objects where album_slug=$1', [albumSlug])).rows.length, 0, 'archive rollback removes public visibility');
    equal((await db.query('select id from public.music_catalog_objects where album_slug=$1 and status=\'archived\' order by catalog_key', [albumSlug])).rows.map(row => row.id), first.map(row => row.id), 'archive rollback keeps every stable identity');
    equal(await scalar(`select count(*)::integer as value from ${referenceTable} where catalog_id=any($1::uuid[])`, [first.map(row => row.id)]), expectedCount, 'archive rollback preserves all foreign-key references');
    await migration(file);
    equal((await anon.query('select catalog_key from public.music_catalog_objects where album_slug=$1 order by catalog_key', [albumSlug])).rows.map(row => row.catalog_key), expectedKeys, 'reapply restores public visibility using the same objects');
  }
  console.log('native catalog seeds: exact 12 + 8 keys, roles, stable identities and archived-reference recovery');

  await guard(F, 'MUSIC_DISTRIBUTION_REQUIRED', 'lyrics refuses application before distribution');
  await migration(C); await migration(C);
  equal(await reviewState(published), beforeReview, 'distribution schema addition preserves a published reviewed release');
  const distribution = { release_date: '2027-01-15', master_owner: 'Synthetic artist', credits: [{ name: 'Synthetic writer', role: 'Composer' }], splits: [{ kind: 'master', name: 'Synthetic artist', share_pct: 100 }] };
  await owner.query('update public.creator_tracks set distribution=$2::jsonb where id=$1', [published, owner.sql.json(distribution)]);
  equal(await scalar('select distribution as value from public.creator_tracks where id=$1', [published]), distribution, 'actual creator PATCH saves distribution details');
  equal(await reviewState(published), beforeReview, 'distribution-only PATCH keeps status, reviewed digest, lyrics and live offers');
  try {
    equal((await other.query('update public.creator_tracks set distribution=$2::jsonb where id=$1 returning id', [published, other.sql.json({ master_owner: 'Unrelated account' })])).rows.length, 0, 'another creator cannot edit the published row');
  } catch (error) { ok(error.code === '42501' || error.message.includes('creator_track_forbidden'), 'canonical guard denies another creator'); }
  equal(await scalar('select distribution as value from public.creator_tracks where id=$1', [published]), distribution, 'cross-owner attempt leaves the saved distribution unchanged');
  for (const invalid of [[], 'not an object', 4, { oversized: randomBytes(40000).toString('hex') }]) await deny(() => owner.query('update public.creator_tracks set distribution=$2::jsonb where id=$1', [published, owner.sql.json(invalid)]), { code: '23514' }, 'malformed or oversized distribution fails its database constraint');
  await guard(CR, 'DISTRIBUTION_ROLLBACK_DATA_PRESENT', 'distribution rollback refuses stored credits and splits');
  equal(await scalar('select distribution as value from public.creator_tracks where id=$1', [published]), distribution, 'refused rollback preserves distribution data');
  await owner.query('update public.creator_tracks set distribution=null where id=$1', [published]);
  await migration(CR); await migration(CR);
  equal(await contentDefinition(), baselineHelper, 'clean distribution rollback restores exact original content helper');
  equal(await scalar("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='creator_tracks' and column_name='distribution') as value"), false, 'clean rollback removes the empty column instead of changing reviewed content');
  await owner.query('update public.creator_tracks set title=title where id=$1', [published]);
  equal(await reviewState(published), beforeReview, 'next owner PATCH after rollback still satisfies reviewed digest');
  await migration(C);
  await owner.query('update public.creator_tracks set distribution=$2::jsonb where id=$1', [published, owner.sql.json(distribution)]);
  console.log('native distribution: actual owner PATCH, RLS, bounds, published preservation and guarded clean rollback');

  const priorClaims = JSON.stringify({ role: 'authenticated', native_proof: true });
  await db.query("select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [priorClaims]);
  // Inspect within the applying transaction, before COMMIT could mask a
  // leaked SET LOCAL. Both singular and JSON claim settings must be restored.
  await db.transaction(async tx => {
    await tx.exec(read(F));
    equal((await tx.query("select current_setting('request.jwt.claims') as claims,current_setting('request.jwt.claim.role') as role")).rows[0], { claims: priorClaims, role: 'authenticated' }, 'lyrics administrative backfill restores both caller claims before transaction ends');
  });
  await migration(F);
  equal(await reviewState(published), beforeReview, 'lyrics backfill and repeat apply preserve the exact published review and offers');
  equal((await jobRows(published)).rows, [], 'backfill does not invent work for unchanged existing releases');
  const fullHelper = await contentDefinition();
  for (const file of [C, CR]) await guard(file, 'MUSIC_CONTENT_BASELINE_CHANGED', 'earlier distribution files cannot overwrite the lyrics content contract');
  for (const role of ['anon', 'authenticated']) {
    for (const signature of ['music_track_content(public.creator_tracks)', 'music_lyrics_input_rev()', 'music_queue_lyrics_align()']) equal(await scalar("select has_function_privilege($1,$2,'EXECUTE') as value", [role, `public.${signature}`]), false, 'browser role cannot call private content or trigger functions');
  }
  // Canonical RLS can filter an UPDATE to zero rows instead of raising a
  // privilege error. Both outcomes must leave the inputs and job history exact.
  const anonymousWriteState = () => scalar(`select jsonb_build_object(
    'sheet',t.lyrics_sheet,'revision',t.lyrics_input_rev,
    'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]'::jsonb)
      from public.ops_agent_jobs j where j.job_type='lyrics_align'
      and j.target_type='creator_track' and j.target_id=t.id::text)) as value
    from public.creator_tracks t where t.id=$1`, [published]);
  const beforeAnonymousWrite = await anonymousWriteState();
  let anonymousWriteResult;
  try {
    anonymousWriteResult = await anon.query("update public.creator_tracks set lyrics_sheet='forbidden' where id=$1 returning id", [published]);
  } catch (error) {
    equal(error.code, '42501', 'anonymous sheet update may be refused only by a privilege denial');
  }
  if (anonymousWriteResult) equal(anonymousWriteResult.rows.length, 0, 'anonymous sheet update returns no writable row');
  equal(await anonymousWriteState(), beforeAnonymousWrite, 'anonymous update preserves the exact sheet, revision and complete job state');
  await deny(() => owner.query('update public.creator_tracks set lyrics_sheet=$2 where id=$1', [published, 'x'.repeat(40001)]), { code: '23514' }, 'lyric sheet length is bounded at the database');
  await owner.query('update public.creator_tracks set lyrics_sheet=$2 where id=$1', [published, 'Synthetic processing words.']);
  equal(await reviewState(published), beforeReview, 'sheet-only edit preserves already reviewed lyrics and publication');
  equal((await jobRows(published)).rows.length, 1, 'first changed sheet queues one existing-plane job');
  await owner.query('update public.creator_tracks set lyrics_sheet=$2 where id=$1', [published, 'New synthetic processing words.']);
  equal((await jobRows(published)).rows.length, 1, 'queued work covers a newer sheet without a duplicate job');
  const queued = (await jobRows(published)).rows[0];
  await service.query("update public.ops_agent_jobs set status='running',attempts=1 where id=$1", [queued.id]);
  await owner.query('update public.creator_tracks set lyrics_sheet=$2 where id=$1', [published, 'Third synthetic processing words.']);
  equal((await jobRows(published)).rows.map(row => row.status).sort(), ['queued', 'running'], 'running work does not cover a newer input revision');
  const storedRev = await scalar('select lyrics_input_rev as value from public.creator_tracks where id=$1', [published]);
  await owner.query("update public.creator_tracks set lyrics_input_rev='forged' where id=$1", [published]);
  equal(await scalar('select lyrics_input_rev as value from public.creator_tracks where id=$1', [published]), storedRev, 'derived input revision cannot be forged by an ordinary PATCH');
  equal((await service.query("update public.creator_tracks set lyrics=$3::jsonb where id=$1 and lyrics_input_rev=$2 and (lyrics is null or lyrics->>'reviewed' is null or lyrics->>'reviewed'='false') returning id", [published, storedRev, service.sql.json({ source: 'auto', reviewed: false })])).rows.length, 0, 'current-revision machine write still cannot replace owner-reviewed lyrics');
  equal(await reviewState(published), beforeReview, 'reviewed words and on-sale state survive all processing-input changes');

  const draft = await createTrack();
  equal((await jobRows(draft)).rows.length, 1, 'new master queues one job');
  const staleRev = await scalar('select lyrics_input_rev as value from public.creator_tracks where id=$1', [draft]);
  await owner.query("update public.creator_tracks set lyrics_sheet='Changed while listening' where id=$1", [draft]);
  equal((await service.query('update public.creator_tracks set lyrics=$3::jsonb where id=$1 and lyrics_input_rev=$2 returning id', [draft, staleRev, service.sql.json({ source: 'auto', reviewed: false })])).rows.length, 0, 'stale input revision fences the actual database write');
  const currentRev = await scalar('select lyrics_input_rev as value from public.creator_tracks where id=$1', [draft]);
  equal((await service.query('update public.creator_tracks set lyrics=$3::jsonb where id=$1 and lyrics_input_rev=$2 returning id', [draft, currentRev, service.sql.json({ source: 'auto', reviewed: false, untimed: ['Synthetic machine output'] })])).rows.length, 1, 'current revision can persist unreviewed output');
  const noMaster = await createTrack({ master: false });
  equal((await jobRows(noMaster)).rows, [], 'a release without a master does not enqueue listening');
  await guard(FR, 'LYRICS_ROLLBACK_ACTIVE_JOBS', 'lyrics rollback refuses active work instead of rewriting job history');
  const liveJobs = (await service.query("select id,status,input,output,attempts from public.ops_agent_jobs where job_type='lyrics_align' and target_id=any($1::text[]) order by id", [[published, draft, noMaster]])).rows;
  ok(liveJobs.some(row => row.status === 'running') && liveJobs.some(row => row.status === 'queued'), 'refused rollback leaves queued and running receipts intact');
  await service.query("update public.ops_agent_jobs set status='done',output='{\"synthetic_completed\":true}' where job_type='lyrics_align' and target_id=any($1::text[])", [[published, draft, noMaster]]);
  const jobsBeforeRollback = (await service.query("select to_jsonb(j) as row from public.ops_agent_jobs j where job_type='lyrics_align' and target_id=any($1::text[]) order by id", [[published, draft, noMaster]])).rows;
  const inputsBeforeRollback = (await service.query('select id,lyrics_sheet,lyrics_input_rev,lyrics from public.creator_tracks where id=any($1::uuid[]) order by id', [[published, draft, noMaster]])).rows;
  await migration(FR); await migration(FR);
  equal((await service.query('select id,lyrics_sheet,lyrics_input_rev,lyrics from public.creator_tracks where id=any($1::uuid[]) order by id', [[published, draft, noMaster]])).rows, inputsBeforeRollback, 'operational rollback preserves all creator words, revisions and lyrics');
  equal((await service.query("select to_jsonb(j) as row from public.ops_agent_jobs j where job_type='lyrics_align' and target_id=any($1::text[]) order by id", [[published, draft, noMaster]])).rows, jobsBeforeRollback, 'operational rollback preserves completed job history byte-for-byte');
  equal(await reviewState(published), beforeReview, 'rollback preserves the published reviewed release and active offers');
  equal(await contentDefinition(), fullHelper, 'rollback retains reviewed-content exclusions');
  await owner.query("update public.creator_tracks set lyrics_sheet='Words saved after stopping automatic work',lyrics_input_rev='forged-again' where id=$1", [published]);
  equal((await jobRows(published)).rows.length, 2, 'post-rollback sheet edit creates no automatic job');
  ok(await scalar("select lyrics_input_rev=md5(coalesce(master_path,'')||chr(10)||coalesce(lyrics_sheet,'')) as value from public.creator_tracks where id=$1", [published]), 'rollback retains revision integrity');
  equal(await reviewState(published), beforeReview, 'post-rollback owner PATCH still preserves publication');
  for (const file of [C, CR]) await guard(file, 'MUSIC_CONTENT_BASELINE_CHANGED', 'operational lyrics rollback does not allow an older helper overwrite');
  await migration(F); await migration(F);
  await owner.query("update public.creator_tracks set lyrics_sheet='Reapplied automatic work' where id=$1", [published]);
  equal((await jobRows(published)).rows.filter(row => row.status === 'queued').length, 1, 'reapply restores automatic enqueueing once');
  equal(await reviewState(published), beforeReview, 'reapply still preserves actual reviewed content');
  console.log('native lyrics: claims restored, published backfill stable, bounded inputs, queue deduplication, stale-write fencing and nondestructive rollback');
  console.log(JSON.stringify({ suite: 'music-release-native', checks, passed: true, full_reset: fullReset, engine: await scalar('select version() as value'), actual_music_guard: true, production_changes: false, audio_verified: false }));
} finally { for (const connection of clients) await connection.close(); await db.exec(`drop table if exists ${referenceTable}`); await db.close(); }
