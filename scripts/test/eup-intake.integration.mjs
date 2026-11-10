// E=Up private intake against the actual pending SQL and Worker handlers in isolated PGlite.
// Proves: idempotent apply; client-role denial; duplicate import = one snapshot revision; an amended
// bill text = a new version row; retries do not duplicate; source outage = stale/unavailable, never zero;
// unresolved geography is reviewed, not promoted; identity conflicts are reviewed, not merged;
// corrections are revision-checked and idempotent; and the public civic_* / action_policy_bills tables
// stay at zero rows after an admin import.
// Module policy (module 'intake', supabase/pending/eup_module_policy_v1.sql applied first and enabled by the
// harness): every write refuses while the module is draining (EUM02), disabled (EUM03) or not installed (EUM01),
// through the functions and through a direct table write; pause stays possible in every installed state and is
// shown to take the reduce-only path (the transaction carries the marker and the shared module lock); reads and
// exact replays answer in every state; a job is claimed under a lease and a policy revision, a stale revision
// refuses its write (EUM04), settlement is gated by the lease alone (EUI01 lease_lost, EUI02 run_not_running);
// records and row counts are identical across drain, disable and re-enable; and apply, rollback, re-apply
// leaves nothing behind. Serial PGlite: not a native lock-contention proof (that is
// scripts/test/eup-module-policy.native.mjs).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEupDatabase, OWNER, INTAKE_DATA_TABLES, INTAKE_UNGUARDED_TABLES, INTAKE_FUNCTIONS } from './support/eup-intake-database.mjs';
import { readModulePolicy, installModule, enableModule, drainModule, disableModule, MODULE_POLICY_LOCK_KEY, MODULE_REDUCE_MARKER } from './support/eup-module-policy-database.mjs';
import { intakeApply } from '../../workers/mccluster/src/eup/intake.js';
import { pilotRecords, CGA_SECOND_TEXT, CGA_AMENDMENT, CERTIFIED_RESULTS, SEC_RESTATED_FACT, BAD_GEOGRAPHY, BAD_COORDINATES, IDENTITY_CONFLICT } from '../../workers/mccluster/test/fixtures/eup/pilot-ct-bridgeport.mjs';

const { db, rpc, service, handle, env, fetchImpl, count, apply, rollback, applyPolicy, rollbackPolicy, close } = await createEupDatabase();
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; };
const json = async (r) => ({ status: r.status, body: await r.json() });
// The SQLSTATE a call is refused with, or 'ok'.
const code = (promise) => promise.then(() => 'ok', (e) => e.code || `no code: ${e.message}`);
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const post = (path, body) => handle(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const command = (action, params) => rpc('eup_sources_command', { p_action: action, p_params: params, p_actor: OWNER });
const read = (action, params = {}) => rpc('eup_sources_read', { p_action: action, p_params: params });
const claim = (worker, extra = {}) => rpc('eup_import_run_claim', { p_worker: worker, p_source_id: 'sec_edgar', ...extra });
const finish = (run, status, lease, extra = {}) => rpc('eup_import_run_finish', { p_run_id: run, p_status: status, p_records: null, p_error: null, p_cursor: null, ...(lease === undefined ? {} : { p_lease: lease }), ...extra });
const release = (run, lease, reason = 'Test fixture: release.') => rpc('eup_import_run_release', { p_run_id: run, p_lease: lease, p_reason: reason });
// Count and content digest of every intake DATA table: equal fingerprints mean no record was added, changed or removed.
const fingerprint = async () => {
  const out = {};
  for (const t of INTAKE_DATA_TABLES) {
    const r = (await rows(`select count(*)::int as n, md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) as h from public.${t} x`))[0];
    out[t] = [r.n, r.h];
  }
  return out;
};
// One service-role transaction: run a sources command, then read what the transaction still carries: the
// reduce marker and the module's advisory lock (classid is the policy lock key; ShareLock is the shared mode).
const probe = (action) => service(async (tx) => {
  const r = (await tx.query('select public.eup_sources_command($1, $2, $3) as r', [action, { source_id: 'sec_edgar' }, OWNER])).rows[0].r;
  const marker = (await tx.query(`select current_setting('${MODULE_REDUCE_MARKER}', true) as m`)).rows[0].m;
  const locks = (await tx.query(`select mode, granted from pg_locks where locktype = 'advisory' and classid = ${MODULE_POLICY_LOCK_KEY}`)).rows.map((l) => [l.mode, l.granted]);
  return { paused: r.paused, marker: marker || null, locks };
});
const directWrite = (statement) => code(service((tx) => tx.query(statement)));
try {
  // 0. what the file created: the header, the backstop triggers, the grants under Supabase default privileges
  const forward = await readFile(new URL('../../supabase/pending/eup_intake_v1.sql', import.meta.url), 'utf8');
  ok(/^-- Apply after eup_module_policy_v1\.sql\./m.test(forward), "the header says 'Apply after eup_module_policy_v1.sql'");
  eq(await readModulePolicy(db, 'intake'), { schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: 'intake', state: 'enabled', revision: 1 }, 'the harness installed and enabled module intake');
  const triggers = await rows(`select c.relname as t, tg.tgname as name, tg.tgtype::int as type, encode(tg.tgargs, 'escape') as args
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
    where not tg.tgisinternal and c.relnamespace = 'public'::regnamespace and p.proname = 'eup_module_guard_trigger' order by 1`);
  eq(triggers.map((t) => t.t), [...INTAKE_DATA_TABLES].sort(), 'exactly the 23 intake data tables carry the module guard trigger');
  // tgtype 62 = BEFORE (2) + INSERT (4) + DELETE (8) + UPDATE (16) + TRUNCATE (32), statement level (ROW bit 1 clear)
  ok(triggers.every((t) => t.name === `${t.t}_module_policy` && t.type === 62 && t.args === 'intake\\000'), 'each is a BEFORE statement trigger on insert, update, delete and truncate for module intake');
  eq(triggers.filter((t) => INTAKE_UNGUARDED_TABLES.includes(t.t)).length, 0, 'eup_import_runs and eup_source_registry_state carry no module trigger');
  const tablePrivileges = await rows(`select r.rolname as role, c.relname as t,
      coalesce((select string_agg(p, ',' order by p) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege(r.rolname, c.oid, p)), '') as privileges
    from pg_class c cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any($1)`, [[...INTAKE_DATA_TABLES, ...INTAKE_UNGUARDED_TABLES]]);
  eq(tablePrivileges.length, 75, '25 intake tables, three API roles');
  ok(tablePrivileges.filter((p) => p.role !== 'service_role').every((p) => p.privileges === ''), 'anon and authenticated hold no privilege on any intake table, with Supabase default privileges on');
  ok(tablePrivileges.filter((p) => p.role === 'service_role').every((p) => p.privileges === 'INSERT,SELECT,UPDATE'), 'service_role holds exactly select, insert, update: no delete, no truncate');
  const rls = await rows(`select c.relname as t, c.relrowsecurity as on, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any($1)`, [[...INTAKE_DATA_TABLES, ...INTAKE_UNGUARDED_TABLES]]);
  ok(rls.length === 25 && rls.every((r) => r.on === true && r.policies === 0), 'row level security is on for all 25 intake tables and none has a client policy');
  const functions = await rows(`select p.oid::regprocedure::text as f, has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated, has_function_privilege('service_role', p.oid, 'EXECUTE') as service
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup\\_%' and p.proname not like 'eup\\_module\\_%' order by 1`);
  eq(functions.map((f) => f.f), [...INTAKE_FUNCTIONS], 'the intake functions, one signature each: no leftover overload of eup_intake_apply or eup_import_run_finish');
  ok(functions.every((f) => f.anon === false && f.authenticated === false && f.service === true), 'every intake function is executable by service_role only');
  eq((await rows(`select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S' and relname like 'eup\\_%' and relname not like 'eup\\_module\\_%'`))[0].n, 0, 'the intake file creates no sequence, so no sequence privilege exists to revoke');

  // 1. client roles cannot read or execute anything in the intake store
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select count(*) from public.eup_record_snapshots'), /permission denied/);
    await assert.rejects(db.query("select public.eup_civic_read('jurisdictions','{}'::jsonb)"), /permission denied/);
    await assert.rejects(db.query("select public.eup_intake_apply('x','jurisdiction','[]'::jsonb)"), /permission denied/);
    await db.exec('reset role'); n += 3;
  }

  // 2. load the Connecticut / Bridgeport pilot
  let applied = 0, reviewed = 0;
  for (const batch of pilotRecords()) { const r = await rpc('eup_intake_apply', { p_source_id: batch.source_id, p_kind: batch.kind, p_records: batch.records }); applied += r.applied; reviewed += r.reviewed; eq(r.duplicates, 0, `${batch.kind} first apply has no duplicates`); }
  ok(applied >= 30, `pilot applied ${applied} records`);
  eq(reviewed, 0, 'the pilot resolves cleanly');
  const snapshotsAfterLoad = await count('eup_record_snapshots');

  // 3. a duplicate import (same raw hashes) changes nothing: no new snapshot revision, no new rows
  for (const batch of pilotRecords()) { const r = await rpc('eup_intake_apply', { p_source_id: batch.source_id, p_kind: batch.kind, p_records: batch.records }); eq(r.applied, 0, `${batch.kind} re-import applies nothing`); }
  eq(await count('eup_record_snapshots'), snapshotsAfterLoad, 'duplicate import yields no new snapshot revision');
  eq((await db.query('select max(revision)::int as r from public.eup_record_snapshots')).rows[0].r, 1, 'every record is still at revision 1');

  // 4. public projections untouched
  for (const t of ['civic_jurisdictions', 'civic_offices', 'civic_office_terms', 'action_policy_bills']) eq(await count(t), 0, `${t} stays empty after an admin import`);

  // 5. nothing is readable until a source's rights are recorded as approved; then the pilot reads
  const unreviewed = await json(await handle('civic/jurisdictions'));
  eq([unreviewed.status, unreviewed.body.count, unreviewed.body.withheld.official_ct_offices > 0], [200, 0, true], 'unreviewed sources are withheld even when stored');
  for (const sid of ['official_ct_offices', 'official_ct_legislation', 'official_ct_elections', 'sec_edgar', 'gleif', 'usaspending'])
    await db.exec(`insert into public.eup_source_registry_state(source_id, access) values ('${sid}', 'approved') on conflict (source_id) do update set access = 'approved'`);
  const roots = await json(await handle('civic/jurisdictions'));
  eq(roots.status, 200); ok(roots.body.jurisdictions.some((j) => j.name === 'United States'), 'country root');
  const us = roots.body.jurisdictions.find((j) => j.name === 'United States');
  const ct = (await json(await handle(`civic/jurisdictions?parent=${us.id}`))).body.jurisdictions.find((j) => j.name === 'Connecticut');
  const children = (await json(await handle(`civic/jurisdictions?parent=${ct.id}`))).body.jurisdictions;
  ok(children.some((j) => j.name === 'Bridgeport' && j.relation === 'contains'), 'Bridgeport under Connecticut');
  const bpt = children.find((j) => j.name === 'Bridgeport');
  const bptChildren = (await json(await handle(`civic/jurisdictions?parent=${bpt.id}`))).body.jurisdictions;
  ok(bptChildren.some((j) => j.name === 'State House District 128' && j.relation === 'overlaps'), 'an overlapping district is not forced into the ward tree');
  const offices = (await json(await handle(`civic/offices?jurisdiction=${bpt.id}`))).body.offices;
  const mayor = offices.find((o) => o.title === 'Mayor');
  ok(mayor && mayor.provenance.source_id === 'official_ct_offices', 'office carries provenance');
  const terms = (await json(await handle(`civic/terms?office=${mayor.id}`))).body.terms;
  eq(terms.map((t) => t.status).sort(), ['current', 'former'], 'current and former terms');
  const d130 = (await json(await handle(`civic/offices?jurisdiction=${bptChildren.find((j) => j.name === 'Council District 130').id}`))).body.offices[0];
  eq(d130.vacant_seats, 1, 'a vacancy is a term with no person');
  const boundaries = (await json(await handle(`civic/boundaries?jurisdiction=${bpt.id}`))).body.boundaries;
  eq([boundaries[0].vintage, boundaries[0].geometry_ref], ['2025', null], 'boundary vintage listed, geometry not claimed');

  // 6. bills: two text versions after an amended text, an amendment, proposed not enacted; retry does not duplicate
  const cgaCt = (await db.query("select id from public.eup_civic_jurisdictions where source_id='official_ct_legislation' and external_id='ct-state'")).rows[0].id;
  const r1 = await rpc('eup_intake_apply', { p_source_id: 'official_ct_legislation', p_kind: 'bill', p_records: [CGA_SECOND_TEXT] });
  eq(r1.applied, 1);
  await rpc('eup_intake_apply', { p_source_id: 'official_ct_legislation', p_kind: 'bill_amendment', p_records: [CGA_AMENDMENT] });
  const r2 = await rpc('eup_intake_apply', { p_source_id: 'official_ct_legislation', p_kind: 'bill', p_records: [CGA_SECOND_TEXT] });
  eq(r2.duplicates, 1, 'retrying the amended text is a duplicate, not a third version');
  const bills = (await json(await handle(`civic/bills?jurisdiction=${cgaCt}&session=2026`))).body.bills;
  eq(bills[0].versions, 2, 'bill has two versions');
  const bill = (await json(await handle(`civic/bills/${bills[0].id}`))).body;
  eq(bill.law_status, 'proposed'); eq(bill.bill.versions.map((v) => v.version_label), ['Raised Bill', 'File Copy 1']);
  eq(bill.bill.amendments.length, 1); eq(bill.bill.committees.length, 1); eq(bill.bill.revision, 2, 'entity revision bumped, history kept');
  eq((await db.query("select count(*)::int as n from public.eup_record_snapshots where source_record_id='bill:bill:2026-HB90042'")).rows[0].n, 2, 'two snapshot revisions for the bill');

  // 7. elections: preliminary first, then certified; registration is not incumbency; term not started
  const elBpt = (await db.query("select id from public.eup_civic_jurisdictions where source_id='official_ct_elections' and external_id='ct-bridgeport'")).rows[0].id;
  let elections = (await json(await handle(`civic/elections?jurisdiction=${elBpt}`))).body.elections;
  eq([elections[0].certification, elections[0].term_started], ['preliminary', false]);
  await rpc('eup_intake_apply', { p_source_id: 'official_ct_elections', p_kind: 'election_result', p_records: CERTIFIED_RESULTS });
  elections = (await json(await handle(`civic/elections?jurisdiction=${elBpt}`))).body.elections;
  eq(elections[0].certification, 'certified');
  const winner = elections[0].candidacies.find((c) => c.person.display_name === 'Synthetic Officeholder A');
  eq(winner.results.map((r) => [r.stage, r.votes]), [['certified', 10004], ['preliminary', 10001]], 'both stages retained');
  eq(winner.registration_status, 'registered', 'a candidacy is a registration, not an office');

  // 8. companies: HQ vs registered office, exchange never a pin, restatement supersedes
  const search = (await json(await handle('companies/search?q=Synthetic%20Grid'))).body;
  eq(search.count, 1, 'SEC and GLEIF records resolved to one entity by CIK');
  eq(search.results[0].identifiers.map((i) => i.scheme).sort(), ['cik', 'lei', 'ticker']);
  await rpc('eup_intake_apply', { p_source_id: 'sec_edgar', p_kind: 'company_fact', p_records: [SEC_RESTATED_FACT] });
  const company = (await json(await handle(`companies/${search.results[0].id}`))).body.company;
  eq(company.locations.map((l) => [l.kind, l.pin !== null]).sort(), [['exchange', false], ['headquarters', true], ['registered_office', false]]);
  eq(company.headquarters_pin.precision, 'locality'); eq(company.quote, null);
  const restated = company.facts.find((f) => f.amended);
  ok(restated && restated.supersedes && restated.value === 118500000, 'the restatement supersedes and the original stays');
  eq(company.facts.length, 2); eq(company.awards[0].agency, 'Department of Energy (synthetic record)');

  // 9. wrong geography and implausible coordinates go to review, not into the store; identity conflicts too
  const bad = await rpc('eup_intake_apply', { p_source_id: 'official_ct_offices', p_kind: 'jurisdiction', p_records: BAD_GEOGRAPHY });
  eq([bad.applied, bad.reviewed], [0, 1]);
  eq((await db.query("select count(*)::int as n from public.eup_civic_jurisdictions where name='Orphan Ward'")).rows[0].n, 0, 'orphan ward not promoted');
  const geo = await rpc('eup_intake_apply', { p_source_id: 'gleif', p_kind: 'company_location', p_records: [BAD_COORDINATES] });
  eq(geo.reviewed, 1); eq((await db.query("select count(*)::int as n from public.eup_company_locations where kind='facility'")).rows[0].n, 0);
  const conflict = await rpc('eup_intake_apply', { p_source_id: 'gleif', p_kind: 'company', p_records: [IDENTITY_CONFLICT] });
  eq([conflict.applied, conflict.reviewed], [0, 1], 'a different legal name claiming an owned CIK is reviewed, not merged');
  eq((await db.query("select count(*)::int as n from public.eup_company_entities")).rows[0].n, 1);
  const review = (await json(await handle('sources/review'))).body;
  eq(review.items.map((i) => i.kind).sort(), ['geography', 'geography', 'identity']);

  // 10. corrections: revision check, idempotent replay, payload mismatch
  const item = review.items.find((i) => i.subject_table === 'eup_civic_jurisdictions');
  const body = (key, rev) => ({ method: 'POST', body: JSON.stringify({ idempotency_key: key, expected_revision: rev, correction: { parent_external_id: 'ct-bridgeport' } }) });
  eq((await json(await handle(`sources/review/${item.id}/correct`, body('correct-0001', 99)))).status, 409, 'stale revision refused');
  const c1 = await json(await handle(`sources/review/${item.id}/correct`, body('correct-0001', item.revision)));
  eq([c1.status, c1.body.status, c1.body.replayed], [200, 'resolved', false]);
  const c2 = await json(await handle(`sources/review/${item.id}/correct`, body('correct-0001', item.revision)));
  eq([c2.status, c2.body.replayed, c2.body.correction_id], [200, true, c1.body.correction_id], 'same key replays the same correction');
  const c3 = await json(await handle(`sources/review/${item.id}/correct`, { method: 'POST', body: JSON.stringify({ idempotency_key: 'correct-0001', expected_revision: item.revision, correction: { different: true } }) }));
  eq(c3.status, 409, 'same key with a different payload is refused');
  eq((await count('eup_corrections')), 1);

  // 11. sources: nothing configured, refresh refused before any run exists; pause/resume; approved+configured source queues one idempotent run
  const sources = (await json(await handle('sources'))).body;
  ok(sources.sources.every((s) => s.configured === false) && sources.ingestion_enabled === false, 'no source is configured');
  eq(sources.sources.find((s) => s.id === 'congress_gov').civic_registry, { enabled: false, last_checked_at: null }, 'existing civic registry row reflected, not duplicated');
  eq((await json(await handle('sources/sec_edgar/refresh', { method: 'POST', body: JSON.stringify({ idempotency_key: 'refresh-0001' }) }))).status, 503);
  eq((await json(await handle('sources/openfec/refresh', { method: 'POST', body: JSON.stringify({ idempotency_key: 'refresh-0001' }) }))).status, 403);
  eq(await count('eup_import_runs'), 0, 'refused refreshes queue nothing');
  await db.exec("update public.eup_source_registry_state set configured = true where source_id = 'sec_edgar'");
  const q1 = (await json(await handle('sources/sec_edgar/refresh', { method: 'POST', body: JSON.stringify({ idempotency_key: 'refresh-0001' }) }))).body;
  const q2 = (await json(await handle('sources/sec_edgar/refresh', { method: 'POST', body: JSON.stringify({ idempotency_key: 'refresh-0001' }) }))).body;
  eq([q1.created, q2.created, q1.run_id === q2.run_id, await count('eup_import_runs')], [true, false, true, 1], 'one run per key');
  eq((await json(await handle('sources/sec_edgar/pause', { method: 'POST' }))).body.paused, true);
  eq((await json(await handle('sources/sec_edgar/refresh', { method: 'POST', body: JSON.stringify({ idempotency_key: 'refresh-0002' }) }))).status, 503, 'paused source refuses');
  await handle('sources/sec_edgar/resume', { method: 'POST' });

  // 12. source outage: a failed run keeps the last success and record count visible as stale, never zero
  // (a run is settled by its lease holder only, so each run is claimed first; a queued run cannot be finished)
  eq(await code(rpc('eup_import_run_finish', { p_run_id: q1.run_id, p_status: 'completed', p_records: 7, p_error: null, p_cursor: { page: 1 } })), 'EUI02', 'a queued run cannot be finished: run_not_running');
  const held1 = await claim('fixture-runner');
  eq([held1.claimed, held1.run_id, held1.policy_revision], [true, q1.run_id, 1], 'the queued run is claimed under policy revision 1');
  await rpc('eup_import_run_finish', { p_run_id: q1.run_id, p_status: 'completed', p_records: 7, p_error: null, p_cursor: { page: 1 }, p_lease: held1.lease });
  await db.exec("update public.eup_source_registry_state set last_success_at = now() - interval '10 days' where source_id='sec_edgar'");
  const q3 = (await json(await handle('sources/sec_edgar/refresh', { method: 'POST', body: JSON.stringify({ idempotency_key: 'refresh-0003' }) }))).body;
  const held3 = await claim('fixture-runner');
  await rpc('eup_import_run_finish', { p_run_id: q3.run_id, p_status: 'failed', p_records: null, p_error: 'synthetic upstream 503', p_cursor: null, p_lease: held3.lease });
  const sec = (await json(await handle('sources/sec_edgar'))).body;
  eq([sec.source.availability, sec.source.records, sec.source.last_error], ['stale', 7, 'synthetic upstream 503'], 'outage shows stale with the old count, not zero');
  eq(sec.runs.length, 2);
  await db.exec("update public.eup_source_registry_state set rights_expires_at = now() - interval '1 day' where source_id='sec_edgar'");
  const withheld = (await json(await handle(`companies/${search.results[0].id}`)));
  eq(withheld.status, 403, 'an expired entitlement withholds the stored SEC entity');
  eq((await json(await handle('sources/sec_edgar/refresh', { method: 'POST', body: JSON.stringify({ idempotency_key: 'refresh-0004' }) }))).body.reason, 'rights_expired');

  // 13. snapshots are append-only; denied roles cannot run commands
  await assert.rejects(db.query("update public.eup_record_snapshots set payload='{}'::jsonb"), /append-only/); n += 1;
  eq((await handle('sources', { headers: { authorization: 'Bearer member' } })).status, 403);
  for (const t of ['civic_jurisdictions', 'civic_offices', 'civic_office_terms', 'action_policy_bills']) eq(await count(t), 0, `${t} still empty at the end`);

  // 14. jobs under an enabled module: claim, lease, policy revision, release, takeover of an expired lease
  eq(await claim('fixture-runner'), { claimed: false, policy_revision: 1 }, 'nothing queued: no claim, and the current policy revision');
  eq(await code(claim('bad worker')), '22023', 'a worker id outside [A-Za-z0-9._:-]{1,64} is refused');
  eq(await code(claim('fixture-runner', { p_lease_seconds: 5 })), '22023', 'a lease shorter than 30 seconds is refused');
  await db.exec("update public.eup_source_registry_state set rights_expires_at = null where source_id = 'sec_edgar'");
  const queuedIds = [];
  for (const key of ['refresh-job-000A', 'refresh-job-000B', 'refresh-job-000C']) queuedIds.push((await json(await post('sources/sec_edgar/refresh', { idempotency_key: key }))).body.run_id);
  eq(await read('run_counts'), { queued: 3, running: 0, running_expired: 0, lease_expires_at: null }, 'run counts: three queued');
  await db.exec("update public.eup_source_registry_state set rights_expires_at = now() - interval '1 day' where source_id = 'sec_edgar'");
  eq((await claim('fixture-runner')).claimed, false, 'a run of a source whose rights have expired is not claimed');
  await db.exec("update public.eup_source_registry_state set rights_expires_at = null, paused = true where source_id = 'sec_edgar'");
  eq((await claim('fixture-runner')).claimed, false, 'a run of a paused source is not claimed');
  await db.exec("update public.eup_source_registry_state set paused = false, configured = false where source_id = 'sec_edgar'");
  eq((await claim('fixture-runner')).claimed, false, 'a run of a source that is not configured is not claimed');
  await db.exec("update public.eup_source_registry_state set configured = true, access = 'held' where source_id = 'sec_edgar'");
  eq((await claim('fixture-runner')).claimed, false, 'a run of a source whose access is held is not claimed');
  await db.exec("update public.eup_source_registry_state set access = 'approved' where source_id = 'sec_edgar'");
  await db.exec("update public.eup_import_runs set backoff_until = now() + interval '1 hour' where status = 'queued'");
  eq((await claim('fixture-runner')).claimed, false, 'a queued run still inside its backoff is not claimed');
  await db.exec("update public.eup_import_runs set backoff_until = now() - interval '1 second' where status = 'queued'");
  eq(await rpc('eup_import_run_claim', { p_worker: 'fixture-runner', p_source_id: 'gleif' }), { claimed: false, policy_revision: 1 }, 'a claim for another source takes none of these runs');
  eq([await code(db.query("update public.eup_import_runs set status = 'running' where id = $1", [queuedIds[0]])),
    await code(db.query("update public.eup_import_runs set lease_token = 'fixture' where id = $1", [queuedIds[0]]))], ['23514', '23514'], 'the table itself refuses a running run without a lease and a queued run with one');
  eq(await read('run_counts').then((c) => [c.queued, c.running]), [3, 0], 'nothing was claimed by the refused attempts');
  const claims = [];
  for (const worker of ['fixture-runner-1', 'fixture-runner-2', 'fixture-runner-3']) claims.push(await claim(worker));
  eq(claims.map((c) => [c.claimed, c.policy_revision, c.reclaimed, c.source_id, c.attempt]), [1, 2, 3].map(() => [true, 1, false, 'sec_edgar', 0]), 'three claims, each bound to policy revision 1');
  eq(claims.map((c) => c.run_id), queuedIds, 'each claim took a different queued run, oldest first');
  ok(claims.every((c, i) => c.lease.startsWith(`fixture-runner-${i + 1}#`) && Date.parse(c.lease_expires_at) > Date.now()), 'each claim carries its own lease and an expiry in the future');
  ok(claims.every((c) => { const left = Date.parse(c.lease_expires_at) - Date.now(); return left > 240_000 && left <= 300_000; }), 'a claim that names no lease length holds the run for the default 300 seconds');
  eq(await rpc('eup_import_run_claim', { p_worker: 'fixture-runner-9' }), { claimed: false, policy_revision: 1 }, 'nothing is left to claim, for any source');
  const counts = await read('run_counts');
  eq([counts.queued, counts.running, counts.running_expired, typeof counts.lease_expires_at], [0, 3, 0, 'string'], 'run counts: three running');
  const listed = (await json(await handle('sources/sec_edgar'))).body.runs;
  ok(listed.length === 5 && listed.every((r) => !('lease_token' in r)), 'the runs read never returns a lease token');
  eq(listed.filter((r) => r.status === 'running').map((r) => r.policy_revision), [1, 1, 1], 'a running run shows the policy revision it was claimed under');
  eq((await rows('select lease_token from public.eup_import_runs where id = $1', [claims[0].run_id]))[0].lease_token, claims[0].lease, 'the lease is stored on the run');
  // the job's writes carry the revision of its claim
  const applyCall = (revision) => rpc('eup_intake_apply', { p_source_id: 'sec_edgar', p_kind: 'company_fact', p_records: [SEC_RESTATED_FACT], ...(revision === undefined ? {} : { p_policy_revision: revision }) });
  const DUPLICATE = { applied: 0, duplicates: 1, reviewed: 0 };
  eq(await code(applyCall(0)), 'EUM04', 'apply with a stale policy revision: module_policy_changed');
  eq(await applyCall(1), DUPLICATE, 'apply with the claim revision is admitted');
  eq(await intakeApply(env, { fetchImpl }, 'sec_edgar', 'company_fact', [SEC_RESTATED_FACT]), DUPLICATE, "the Worker's intakeApply (three named arguments, no revision) resolves to the one four-argument function");
  // settlement is gated by the lease
  const [jobA, jobB, jobC] = claims;
  const unknownRun = '99999999-9999-4999-8999-999999999999';
  eq([await code(release(unknownRun, jobA.lease)), await code(finish(unknownRun, 'completed', jobA.lease))], ['P0002', 'P0002'], 'an unknown run: run_not_found');
  eq([await code(release(jobA.run_id, jobB.lease)), await code(release(jobA.run_id, null))], ['EUI01', 'EUI01'], 'release with another lease or with none: lease_lost');
  eq([await code(finish(jobA.run_id, 'completed', jobB.lease)), await code(finish(jobA.run_id, 'completed'))], ['EUI01', 'EUI01'], 'finish with another lease or with none: lease_lost');
  eq(await code(finish(jobA.run_id, 'running', jobA.lease)), '22023', 'finish takes a final status only');
  eq(await release(jobA.run_id, jobA.lease, 'Test fixture: released by its holder.'), { run_id: jobA.run_id, status: 'queued', released: true }, 'release returns the run to queued');
  eq((await rows('select status, lease_token, lease_expires_at, policy_revision, started_at, error, attempt from public.eup_import_runs where id = $1', [jobA.run_id]))[0],
    { status: 'queued', lease_token: null, lease_expires_at: null, policy_revision: null, started_at: null, error: 'Test fixture: released by its holder.', attempt: 0 }, 'the released run is kept, queued, without a lease, with the reason');
  eq(await count('eup_import_runs'), 5, 'release deleted nothing');
  eq(await code(release(jobA.run_id, jobA.lease)), 'EUI02', 'a second release: run_not_running');
  eq(await code(finish(jobA.run_id, 'completed', jobA.lease)), 'EUI02', 'finish after the release: run_not_running');
  const jobA2 = await claim('fixture-runner-4');
  eq([jobA2.claimed, jobA2.run_id, jobA2.reclaimed, jobA2.lease === jobA.lease], [true, jobA.run_id, false, false], 'the released run is claimed again under a new lease');
  eq([await code(finish(jobA.run_id, 'completed', jobA.lease)), await code(release(jobA.run_id, jobA.lease))], ['EUI01', 'EUI01'], 'the lost lease can neither finish nor release the run');
  await db.query("update public.eup_import_runs set lease_expires_at = now() - interval '1 second' where id = $1", [jobA.run_id]);
  eq((await read('run_counts')).running_expired, 1, 'run counts: one running run has an expired lease');
  const jobA3 = await claim('fixture-runner-5');
  eq([jobA3.claimed, jobA3.run_id, jobA3.reclaimed, jobA3.attempt, jobA3.policy_revision], [true, jobA.run_id, true, 1, 1], 'an expired lease is taken over by the next claim and counted as an attempt');
  eq(await code(finish(jobA.run_id, 'completed', jobA2.lease)), 'EUI01', 'the holder whose lease expired and was taken over cannot finish: lease_lost');
  eq(await read('run_counts').then((c) => [c.queued, c.running, c.running_expired]), [0, 3, 0], 'run counts: three running again, none expired');

  // 15. draining: new work refuses (EUM02); pause and settlement stay possible; reads and exact replays answer
  const policy = (p) => [p.state, p.revision];
  const openItems = (await json(await handle('sources/review'))).body.items;
  eq(openItems.length, 2, 'two review items are still open');
  const correction = (key) => ({ review_item_id: openItems[0].id, expected_revision: openItems[0].revision, idempotency_key: key, correction: { note: 'Test fixture: correction.' } });
  const snapshotCall = (hash = 'h-direct') => service(async (tx) => (await tx.query("select public.eup_record_snapshot('sec_edgar', 'fixture:direct', $1, '{}'::jsonb, $2) as r", [hash, SEC_RESTATED_FACT.provenance])).rows[0].r);
  eq([(await snapshotCall()).created, (await snapshotCall()).created], [true, false], 'enabled: a direct snapshot is stored once; the same raw hash again is a duplicate that writes nothing');
  const insertReviewItem = "insert into public.eup_review_items(kind, subject_table, subject_key) values ('coverage', 'fixture', 'direct-write')";
  // Every way new intake work can start: four RPC writes, the two apply forms, a new snapshot, a duplicate snapshot
  // (it would write nothing, so no trigger fires: only the function's own guard can refuse it), a claim, and two
  // direct table writes.
  const newWork = async () => [
    await code(command('refresh', { source_id: 'sec_edgar', idempotency_key: 'refresh-job-000D' })),
    await code(command('resume', { source_id: 'sec_edgar' })),
    await code(command('correct', correction('correct-0002'))),
    await code(applyCall()), await code(applyCall(1)), await code(snapshotCall('h-new')), await code(snapshotCall()),
    await code(claim('fixture-runner-6')),
    await directWrite(insertReviewItem), await directWrite('update public.eup_corrections set correction = correction where false')
  ];
  const readsAnswer = async () => [(await handle('sources')).status, (await handle('sources/review')).status, (await handle('sources/sec_edgar')).status,
    (await handle('civic/jurisdictions')).status, (await handle('companies/search?q=Synthetic%20Grid')).status];
  const stored = async () => ({ data: await fingerprint(), runs: await count('eup_import_runs'), sources: await count('eup_source_registry_state') });
  const before = await stored();
  eq(policy(await drainModule(db, 'intake')), ['draining', 2], 'the owner drains module intake');
  eq(await newWork(), Array(10).fill('EUM02'), 'draining: refresh, resume, correct, apply, snapshot, claim and a direct table write are refused module_draining');
  const refreshDraining = await json(await post('sources/sec_edgar/refresh', { idempotency_key: 'refresh-job-000D' }));
  eq([refreshDraining.status, refreshDraining.body.reason], [503, 'module_draining'], 'the Worker answers a refused refresh 503 module_draining');
  const correctDraining = await json(await post(`sources/review/${openItems[0].id}/correct`, { idempotency_key: 'correct-0002', expected_revision: openItems[0].revision, correction: { note: 'Test fixture: correction.' } }));
  eq([correctDraining.status, correctDraining.body.reason], [503, 'module_draining'], 'the Worker answers a refused correction 503 module_draining');
  eq(await command('refresh', { source_id: 'sec_edgar', idempotency_key: 'refresh-job-000A' }), { run_id: jobA.run_id, status: 'running', created: false }, 'draining: an exact refresh replay still answers with the run it queued');
  const replayDraining = await json(await handle(`sources/review/${item.id}/correct`, body('correct-0001', item.revision)));
  eq([replayDraining.status, replayDraining.body.replayed, replayDraining.body.correction_id], [200, true, c1.body.correction_id], 'draining: an exact correction replay still answers');
  eq(await readsAnswer(), [200, 200, 200, 200, 200], 'draining: every read answers');
  eq(await probe('pause'), { paused: true, marker: 'intake', locks: [['ShareLock', true]] }, 'draining: pause is admitted on the reduce-only path, holding the shared module lock with the reduce marker set');
  eq((await json(await post('sources/sec_edgar/pause'))).status, 200, 'draining: the Worker pause route answers 200');
  eq(await release(jobB.run_id, jobB.lease, 'module_draining'), { run_id: jobB.run_id, status: 'queued', released: true }, 'draining: a holder releases its run back to queued');
  eq(await finish(jobC.run_id, 'completed', jobC.lease, { p_records: 9 }), { run_id: jobC.run_id, status: 'completed', attempt: 1, replayed: false }, 'draining: a holder finishes its run');
  eq(await finish(jobC.run_id, 'completed', jobC.lease, { p_records: 9 }), { run_id: jobC.run_id, status: 'completed', attempt: 1, replayed: true }, 'the same finish again replays the stored outcome');
  eq(await code(finish(jobC.run_id, 'failed', jobC.lease)), 'EUI02', 'a settled run cannot be finished differently');
  eq([await code(finish(jobC.run_id, 'completed', jobB.lease)), await code(finish(jobC.run_id, 'completed'))], ['EUI02', 'EUI02'], 'only the lease that settled a run can replay its finish');
  eq(await read('run_counts').then((c) => [c.queued, c.running, c.running_expired]), [1, 1, 0], 'draining: the counts show one run still running');
  eq(await stored(), before, 'draining: no record and no row count changed, no run was added');

  // 16. disabled: the same refusals with EUM03; pause and settlement still possible
  eq(policy(await disableModule(db, 'intake')), ['disabled', 3], 'the owner disables the drained module');
  eq(await newWork(), Array(10).fill('EUM03'), 'disabled: refresh, resume, correct, apply, snapshot, claim and a direct table write are refused module_disabled');
  eq([await code(claim('bad worker')), await code(rpc('eup_intake_apply', { p_source_id: 'sec_edgar', p_kind: 'company_fact', p_records: null }))], ['EUM03', 'EUM03'],
    'disabled: the guard is the first statement of claim and of apply, ahead of their argument checks');
  const resumeDisabled = await json(await post('sources/sec_edgar/resume'));
  eq([resumeDisabled.status, resumeDisabled.body.reason], [409, 'module_disabled'], 'the Worker answers a refused resume 409 module_disabled');
  eq(await probe('pause'), { paused: true, marker: 'intake', locks: [['ShareLock', true]] }, 'disabled: pause is admitted on the reduce-only path');
  eq(await code(db.query('truncate public.eup_corrections')), 'EUM03', 'disabled: a maintenance truncate of a data table is refused by the trigger');
  eq([await directWrite('truncate public.eup_corrections'), await directWrite('delete from public.eup_corrections')], ['42501', '42501'], 'service_role has no truncate or delete on a data table in any state');
  eq(await readsAnswer(), [200, 200, 200, 200, 200], 'disabled: every read answers');
  eq(await finish(jobA.run_id, 'failed', jobA3.lease, { p_error: 'Test fixture: stopped.' }), { run_id: jobA.run_id, status: 'failed', attempt: 2, replayed: false }, 'disabled: the lease holder still settles its run');
  eq(await read('run_counts').then((c) => [c.queued, c.running, c.running_expired]), [1, 0, 0], 'disabled: nothing is running, one run waits queued');
  eq(await stored(), before, 'disabled: no record and no row count changed');
  // the file is DDL only: running it again over a populated store, with the module disabled, changes no row
  const runsBefore = await rows('select * from public.eup_import_runs order by id');
  await apply();
  eq([await stored(), await rows('select * from public.eup_import_runs order by id')], [before, runsBefore], 'disabled: applying the file again over the populated store changes no record and no run');
  eq(await newWork(), Array(10).fill('EUM03'), 'and every refusal is still in place afterwards');

  // 17. re-enabled: the records are as they were, work bound to the old revision stays refused, new work lands
  eq(policy(await enableModule(db, 'intake')), ['enabled', 4], 'the owner enables the module again');
  eq(await stored(), before, 'records and row counts are identical across drain, disable and re-enable');
  eq(await code(applyCall(1)), 'EUM04', 're-enabled: a write bound to the revision of the old claim is refused module_policy_changed');
  eq(await applyCall(), DUPLICATE, 're-enabled: a write bound to no revision is admitted');
  eq((await claim('fixture-runner-7')).claimed, false, 'the source is still paused: nothing is claimed');
  eq(await probe('resume'), { paused: false, marker: null, locks: [['ShareLock', true]] }, 'resume takes the full guard: the shared module lock and no reduce marker');
  const jobB2 = await claim('fixture-runner-7');
  eq([jobB2.claimed, jobB2.run_id, jobB2.policy_revision, jobB2.reclaimed], [true, jobB.run_id, 4, false], 'the released run is claimed under the new policy revision');
  eq(await applyCall(4), DUPLICATE, 'its writes carry revision 4 and are admitted');
  const corrected = await command('correct', correction('correct-0002'));
  eq([corrected.status, corrected.replayed, await count('eup_corrections')], ['resolved', false, 2], 'the correction refused while draining and disabled is accepted now');
  eq([await directWrite(insertReviewItem), await count('eup_review_items')], ['ok', 4], 'the trigger admits a direct table write while the module is enabled');
  await db.query("update public.eup_import_runs set lease_expires_at = now() - interval '1 second' where id = $1", [jobB.run_id]);
  eq(await read('run_counts').then((c) => [c.queued, c.running, c.running_expired]), [0, 1, 1], 'its lease runs out before it settles and nobody takes the run over');
  eq(await finish(jobB.run_id, 'completed', jobB2.lease, { p_records: 11 }), { run_id: jobB.run_id, status: 'completed', attempt: 1, replayed: false }, 'an expired lease that was not taken over still settles its run');
  eq(await read('run_counts'), { queued: 0, running: 0, running_expired: 0, lease_expires_at: null }, 'run counts: nothing queued, nothing running');
  for (const t of ['civic_jurisdictions', 'civic_offices', 'civic_office_terms', 'action_policy_bills']) eq(await count(t), 0, `${t} is still empty after the policy cycle`);

  // 18. apply, rollback, re-apply; and a module that is not installed refuses everything (EUM01)
  const leftovers = async () => (await rows(`select
      (select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relname like 'eup\\_%' and relname not like 'eup\\_module\\_%') as relations,
      (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname like 'eup\\_%' and proname not like 'eup\\_module\\_%') as functions,
      (select count(*)::int from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where not tg.tgisinternal and c.relnamespace = 'public'::regnamespace and tg.tgname like '%\\_module\\_policy') as triggers`))[0];
  const NOTHING = { relations: 0, functions: 0, triggers: 0 };
  await rollback();
  eq(await leftovers(), NOTHING, 'the rollback leaves no intake table, index, function or trigger behind');
  eq(policy(await readModulePolicy(db, 'intake')), ['enabled', 4], 'the intake rollback leaves the module policy and its state alone');
  await rollback();
  eq(await leftovers(), NOTHING, 'the rollback is safe to run twice');
  await rollbackPolicy();
  await assert.rejects(apply(), /apply eup_module_policy_v1\.sql first/); n += 1;
  eq(await leftovers(), NOTHING, 'without the module policy the intake file refuses to run and creates nothing');
  await applyPolicy(); await apply(); await apply();
  const reapplied = await leftovers();
  eq([reapplied.functions, reapplied.triggers, reapplied.relations > 25], [INTAKE_FUNCTIONS.length, INTAKE_DATA_TABLES.length, true], 're-apply (twice) restores every function and trigger');
  eq(await code(readModulePolicy(db, 'intake')), 'EUM01', 'the fresh policy has no row for intake: the file seeds none');
  eq(await newWork(), Array(10).fill('EUM01'), 'not installed: refresh, resume, correct, apply, snapshot, claim and a direct table write are refused module_not_installed');
  eq(await code(command('pause', { source_id: 'sec_edgar' })), 'EUM01', 'not installed: even the reduce-only pause is refused');
  eq(await code(command('refresh', { source_id: 'sec_edgar' })), '22023', 'an invalid request is refused before any guard is reached');
  const resumeNotInstalled = await json(await post('sources/sec_edgar/resume'));
  eq([resumeNotInstalled.status, resumeNotInstalled.body.reason], [503, 'module_not_installed'], 'the Worker answers 503 module_not_installed');
  eq([await read('list'), await read('run_counts')], [[], { queued: 0, running: 0, running_expired: 0, lease_expires_at: null }], 'not installed: reads still answer, empty');
  eq(Object.values(await fingerprint()).reduce((sum, [rowCount]) => sum + rowCount, 0), 0, 'refused writes left every data table empty');
  eq(policy((await installModule(db, 'intake')).policy), ['disabled', 0], 'the owner installs the module: disabled, revision 0');
  eq(await code(applyCall()), 'EUM03', 'installed but not enabled: writes are still refused');
  eq(policy(await enableModule(db, 'intake')), ['enabled', 1], 'the owner enables it');
  const [firstBatch] = pilotRecords();
  const landed = await rpc('eup_intake_apply', { p_source_id: firstBatch.source_id, p_kind: firstBatch.kind, p_records: firstBatch.records, p_policy_revision: 1 });
  ok(landed.applied > 0 && await count('eup_record_snapshots') === landed.applied, `after install and enable the re-applied store takes writes (${landed.applied} records)`);
  console.log(`${n} E=Up intake assertions passed.`);
} finally {
  await close();
}
