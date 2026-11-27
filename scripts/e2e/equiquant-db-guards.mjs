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

  const { rows: [receipt] } = await db.query('select job_id from equiquant.research_result_receipts limit 1');
  assert.ok(receipt, 'a real Core completion must have captured a receipt');
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
      "update public.ops_agent_jobs set status='running',locked_by='fixture#lease' where id=$1", [receipt.job_id]
    );
    await assert.rejects(db.query(`
      update public.ops_agent_jobs set status='done',
        output=jsonb_set(output,'{result_json}',to_jsonb((output->>'result_json') || ' '))
      where id=$1`, [receipt.job_id]), error => error?.code === '22023');
  } finally {
    await db.exec('rollback');
  }
}
