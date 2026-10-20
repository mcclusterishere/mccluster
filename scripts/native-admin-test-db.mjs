// Disposable local PostgreSQL adapter for the existing SQL behavioral fixtures.
// Never accepts a remote host or the canonical database itself.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readdir } from 'node:fs/promises';
export async function migrationPath(suffix) {
  const found = [];
  for (const dir of ['supabase/pending','supabase/migrations']) {
    for (const file of await readdir(dir)) if (file.endsWith(`_${suffix}.sql`)) found.push(`${dir}/${file}`);
  }
  assert.equal(found.length,1,`exactly one migration for ${suffix}`);
  return found[0];
}
export async function nativeTestDb(label) {
  const url = new URL(process.env.NATIVE_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'native fixtures require a local disposable server');
  assert.equal(url.port,'54322','native fixtures require the isolated Supabase port');
  const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
  const options = {max:1, onnotice:()=>{}, connection:{application_name:`admin-evidence-${label}`,statement_timeout:20000}};
  const admin = postgres(url.href,options);
  const name=`admin_evidence_${label}_${process.pid}`;
  assert.match(name,/^[a-z0-9_]+$/);
  await admin.unsafe(`create database ${name}`);
  url.pathname=`/${name}`;
  const client=postgres(url.href,options);
  const wrap = conn => ({
    native:true,
    query:async (text,values=[])=>({rows:await conn.unsafe(text,values)}),
    exec:text=>conn.unsafe(text),
    transaction:fn=>conn.begin(tx=>fn(wrap(tx)))
  });
  const db=wrap(client);
  db.fork=()=>{const sql=postgres(url.href,options);return {...wrap(sql),close:()=>sql.end()};};
  db.close=async()=>{await client.end();await admin.unsafe(`drop database ${name}`);await admin.end();};
  return db;
}
export async function waitForBlocked(db, minimum=1) {
  const end=Date.now()+5000;
  while(Date.now()<end) {
    const {rows}=await db.query("select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'");
    if(rows[0].n>=minimum)return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error('concurrent operation never reached a real PostgreSQL lock wait');
}
