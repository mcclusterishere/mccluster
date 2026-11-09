// E=Up private intake against the actual pending SQL and Worker handlers in isolated PGlite.
// Proves: idempotent apply; client-role denial; duplicate import = one snapshot revision; an amended
// bill text = a new version row; retries do not duplicate; source outage = stale/unavailable, never zero;
// unresolved geography is reviewed, not promoted; identity conflicts are reviewed, not merged;
// corrections are revision-checked and idempotent; and the public civic_* / action_policy_bills tables
// stay at zero rows after an admin import. Serial PGlite: not a native lock-contention proof.
import assert from 'node:assert/strict';
import { createEupDatabase, OWNER } from './support/eup-intake-database.mjs';
import { pilotRecords, CGA_SECOND_TEXT, CGA_AMENDMENT, CERTIFIED_RESULTS, SEC_RESTATED_FACT, BAD_GEOGRAPHY, BAD_COORDINATES, IDENTITY_CONFLICT } from '../../workers/mccluster/test/fixtures/eup/pilot-ct-bridgeport.mjs';

const { db, rpc, handle, count, close } = await createEupDatabase();
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; };
const json = async (r) => ({ status: r.status, body: await r.json() });
try {
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
  await rpc('eup_import_run_finish', { p_run_id: q1.run_id, p_status: 'completed', p_records: 7, p_error: null, p_cursor: { page: 1 } });
  await db.exec("update public.eup_source_registry_state set last_success_at = now() - interval '10 days' where source_id='sec_edgar'");
  const q3 = (await json(await handle('sources/sec_edgar/refresh', { method: 'POST', body: JSON.stringify({ idempotency_key: 'refresh-0003' }) }))).body;
  await rpc('eup_import_run_finish', { p_run_id: q3.run_id, p_status: 'failed', p_records: null, p_error: 'synthetic upstream 503', p_cursor: null });
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
  console.log(`${n} E=Up intake assertions passed.`);
} finally {
  await close();
}
