import assert from 'node:assert/strict';

// Exercise the canonical ontology trigger contract. Observe which queue changes
// reach its handler without installing the rest of the unrelated ontology graph.
export async function installOntologyFixture(db) {
  await db.exec(`
    create schema if not exists private;
    create table public.test_queue_mirror(operation text, job_type text);
    create function private.ops_ontology_sync_job() returns trigger language plpgsql as $$
    begin
      insert into public.test_queue_mirror values (tg_op,coalesce(new.job_type,old.job_type));
      return null;
    end $$;
    create trigger ops_ontology_sync_job_t after insert or update or delete on public.ops_agent_jobs
      for each row execute function private.ops_ontology_sync_job();
  `);
}

export async function assertOriginalOntologyTrigger(db) {
  const { rows } = await db.query(`
    select tgtype::int as events,tgenabled as enabled,tgqual is null as unconditional,
      tgfoid='private.ops_ontology_sync_job()'::regprocedure as original_handler
    from pg_trigger where tgrelid='public.ops_agent_jobs'::regclass
      and tgname in ('ops_ontology_sync_job_t','equiquant_mirror_other_deleted_jobs')
  `);
  // PostgreSQL's row/insert/delete/update mask for the original AFTER trigger.
  assert.deepEqual(rows, [{ events: 29, enabled: 'O', unconditional: true, original_handler: true }]);
}

// A queued request can survive a Node upgrade on the same machine. Model that
// historical queue row only. Every capability and execution receipt remains real.
async function assertRuntimeChange(db, org, receipt) {
  const { rows: [owner] } = await db.query(`
    select p.owner_id from equiquant.research_projects p join equiquant.research_replay_jobs r on r.project_id=p.id
    where r.job_id=$1`, [receipt.job_id]);
  const { rows: [runner] } = await db.query(`
    select attestation from equiquant.mosaic_runner_capabilities where worker_id=$1`,
    [receipt.snapshot.execution.worker_id]);
  const current = runner.attestation;
  const historicalVersion = current.node_version === '1.0.0' ? '2.0.0' : '1.0.0';
  const action = async (verb, projectId, data) => (await db.query(
    'select public.equiquant_action($1,$2,$3,$4,$5) as state',
    [owner.owner_id,org,verb,projectId,JSON.stringify(data)]
  )).rows[0].state;
  await db.exec('begin');
  try {
    const { project } = await action('create', null, { title: 'Runtime upgrade fixture' });
    const data = { scenario: 'pooled', target: current.target, capability_signature: current.signature };
    const first = (await action('replay', project.id, data)).runs[0].job_id;
    await db.query('update equiquant.research_replay_jobs set node_version=$2 where job_id=$1',[first,historicalVersion]);
    await db.query("update public.ops_agent_jobs set input=jsonb_set(input,'{node_version}',to_jsonb($2::text)) where id=$1",
      [first,historicalVersion]);
    const { runs } = await action('replay', project.id, data);
    assert.equal(runs.length,2,'a pending request for a different Node version cannot satisfy submission');
    const next = runs.find(run => run.job_id !== first);
    assert.equal(next.hardware_sha256,current.hardware_sha256);
    assert.equal(next.node_version,current.node_version);
    assert.equal((await action('replay',project.id,data)).runs.length,2,'same-runtime retry must reuse the job');
    const claim = id => db.query(
      "update public.ops_agent_jobs set status='running',attempts=1,locked_by=$2 where id=$1 returning input",
      [id,current.worker_id+'#runtime-fixture']);
    await db.exec('savepoint incompatible');
    await assert.rejects(claim(first),error => error?.code === 'PT409');
    await db.exec('rollback to savepoint incompatible');
    assert.deepEqual((await claim(next.job_id)).rows[0].input,{
      scenario:'pooled',target:current.target,hardware_sha256:current.hardware_sha256,node_version:current.node_version,
    });
  } finally {
    await db.exec('rollback');
  }
}

// Invoked as the disposable fixture's database owner after a real project review.
export async function assertResearchGuards(db, org) {
  assert.equal((await db.query(
    "select count(*)::int as n from public.test_queue_mirror where job_type='equiquant_mosaic_replay'"
  )).rows[0].n, 0);
  const ordinary = (await db.query(
    "insert into public.ops_agent_jobs(org_id,job_type) values ($1,'ordinary_fixture_job') returning id", [org]
  )).rows[0].id;
  await db.query("update public.ops_agent_jobs set status='done' where id=$1", [ordinary]);
  await db.query('delete from public.ops_agent_jobs where id=$1', [ordinary]);
  const mirrored = await db.query(`
    select operation,count(*)::int as n from public.test_queue_mirror
    where job_type='ordinary_fixture_job' group by operation order by operation
  `);
  assert.deepEqual(mirrored.rows, [
    { operation: 'DELETE', n: 1 }, { operation: 'INSERT', n: 1 }, { operation: 'UPDATE', n: 1 },
  ]);

  const { rows: [receipt] } = await db.query('select job_id,snapshot from equiquant.research_result_receipts limit 1');
  assert.ok(receipt, 'a real Core completion must have captured a receipt');
  await assertRuntimeChange(db, org, receipt);
  const { attestation, execution } = receipt.snapshot;
  const attest = value => db.query('select public.equiquant_attest_target($1)', [JSON.stringify(value)]);
  for (const changed of [
    { target: 'connected_inference' }, { backend: 'gpu' }, { precision: 'float32' },
    { spec_sha256: '0'.repeat(64) }, { code_sha256: '0'.repeat(64) },
    { observations_sha256: '0'.repeat(64) }, { model_hashes: {} },
  ]) {
    await assert.rejects(attest({ ...attestation, ...changed }), error => error?.code === 'PT400');
  }
  await assert.rejects(attest({ ...attestation, observed_at: '2000-01-01T00:00:00.000Z' }), error => error?.code === 'PT409');
  for (const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    try {
      await assert.rejects(attest(attestation), error => error?.code === '42501');
    } finally {
      await db.exec('reset role');
    }
  }
  assert.equal(execution.target, receipt.snapshot.target);
  assert.equal(execution.hardware_sha256, receipt.snapshot.hardware_sha256);
  assert.equal(execution.model_sha256, attestation.model_hashes[receipt.snapshot.scenario]);
  assert.ok(Number.isSafeInteger(execution.elapsed_ns) && execution.elapsed_ns > 0);

  await db.exec('begin');
  try {
    await db.query("update public.ops_agent_jobs set status='queued' where id=$1",[receipt.job_id]);
    await assert.rejects(db.query(
      "update public.ops_agent_jobs set status='running',locked_by='wrong-host#lease' where id=$1",[receipt.job_id]
    ), error => error?.code === 'PT409');
  } finally {
    await db.exec('rollback');
  }
  const isImmutable = error => error?.code === '55000';
  await assert.rejects(db.query(
    "update equiquant.research_result_receipts set result_json='changed' where job_id=$1", [receipt.job_id]
  ), isImmutable);
  await assert.rejects(db.query("update equiquant.research_release_credits set snapshot='{}'"), isImmutable);
  await assert.rejects(db.query("update equiquant.research_credit_evidence set statement='changed'"), isImmutable);

  // Change only the payload bytes for a genuinely completed job and reuse its
  // genuine envelope and digest labels. The SQL completion hook must rehash.
  await db.exec('begin');
  try {
    await db.query(
      "update public.ops_agent_jobs set status='running',locked_by=$2 where id=$1", [receipt.job_id, execution.worker_id+'#fixture']
    );
    await db.exec('savepoint wrong_version');
    await assert.rejects(db.query(`
      update public.ops_agent_jobs set status='done',input=input-'node_version' where id=$1
    `,[receipt.job_id]),error => error?.code === '22023');
    await db.exec('rollback to savepoint wrong_version');
    await assert.rejects(db.query(`
      update public.ops_agent_jobs set status='done',
        output=jsonb_set(output,'{result_json}',to_jsonb((output->>'result_json') || ' '))
      where id=$1`, [receipt.job_id]), error => error?.code === '22023');
  } finally {
    await db.exec('rollback');
  }
}
