// A disposable PostgreSQL server for proofs that need real concurrent sessions (PGlite has exactly one).
// Local only, and only by consent: it refuses unless ALLOW_LOCAL_EUP_DB_TESTS=1. It never connects to any other
// database, and nothing it starts outlives the run.
//
//   PG_BIN     directory holding initdb, pg_ctl and postgres (PostgreSQL 16 or 17), for example
//              /usr/lib/postgresql/16/bin. Run as root, the server runs as the postgres user, so that user must be
//              able to read PG_BIN.
//   PG_MODULE  node-postgres (its package directory or its index.js). Without it the bare 'pg' module is used.
//
// The data directory is a new directory directly under /tmp. The server listens on 127.0.0.1 only, on a free
// port, with no Unix socket and trust authentication (it is reachable from this machine only, for the length of
// the run). stop() stops it and removes the directory; SIGINT, SIGTERM and process exit do the same.
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, chownSync, appendFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Exit 2 with the reason unless the caller opted in. */
export function refuseUnlessAllowed(name) {
  if (process.env.ALLOW_LOCAL_EUP_DB_TESTS === '1') return;
  console.error(`${name}: refused. It starts a disposable PostgreSQL server on this machine (127.0.0.1 only, removed afterwards). `
    + 'Run it with ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=<directory with initdb and pg_ctl> [PG_MODULE=<node-postgres>].');
  process.exit(2);
}

function loadPg() {
  const require = createRequire(import.meta.url);
  const mod = require(process.env.PG_MODULE || 'pg');
  return mod.Client ? mod : mod.default;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

/** Start the server. Resolves to { version, port, client(database), stop() }. */
export async function startNativePostgres() {
  const bin = process.env.PG_BIN;
  if (!bin || !existsSync(join(bin, 'initdb')) || !existsSync(join(bin, 'pg_ctl'))) {
    throw new Error('PG_BIN must name a directory holding initdb and pg_ctl (PostgreSQL 16 or 17)');
  }
  const { Client } = loadPg();
  /* initdb and postgres refuse to run as root */
  const ids = process.getuid && process.getuid() === 0
    ? { uid: Number(execFileSync('id', ['-u', 'postgres'], { encoding: 'utf8' })), gid: Number(execFileSync('id', ['-g', 'postgres'], { encoding: 'utf8' })) }
    : {};
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
  const dir = mkdtempSync('/tmp/eup-native-pg-');
  let running = false;
  const stop = () => {
    if (running) {
      running = false;
      spawnSync(join(bin, 'pg_ctl'), ['-D', dir, '-m', 'immediate', '-w', 'stop'], { ...ids, env, stdio: 'ignore' });
    }
    rmSync(dir, { recursive: true, force: true });
  };
  const onSignal = (signal) => { stop(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', stop);
  const run = (tool, args) => {
    const r = spawnSync(join(bin, tool), args, { ...ids, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${tool} failed (${r.status ?? r.signal}): ${(r.stderr || r.stdout || String(r.error || '')).trim().slice(0, 600)}`);
  };
  try {
    if (ids.uid !== undefined) chownSync(dir, ids.uid, ids.gid);
    run('initdb', ['-D', dir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C', '--no-instructions']);
    const port = await freePort();
    appendFileSync(join(dir, 'postgresql.conf'), [
      "listen_addresses = '127.0.0.1'", `port = ${port}`, "unix_socket_directories = ''",
      'max_connections = 40', 'fsync = off', 'synchronous_commit = off', 'full_page_writes = off', ''
    ].join('\n'));
    run('pg_ctl', ['-D', dir, '-l', join(dir, 'server.log'), '-w', '-t', '60', 'start']);
    running = true;
    const client = async (database = 'postgres') => {
      const c = new Client({ host: '127.0.0.1', port, user: 'postgres', database });
      await c.connect();
      return c;
    };
    const probe = await client();
    const version = (await probe.query("select current_setting('server_version') as v")).rows[0].v;
    await probe.end();
    return { version, port, client, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

/**
 * A fresh database shaped like the Supabase project where it matters to E=Up SQL: the three API roles, default
 * privileges that hand every new public table, function and sequence to them (so a file must revoke what it does
 * not mean to grant), an auth.users table, and the house org with its members. Returns an admin client on it.
 */
export async function supabaseShapedDatabase(server, name, { owners = [], members = [] } = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('database name');
  const admin0 = await server.client('postgres');
  await admin0.query(`do $r$ begin
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    exception when duplicate_object then null; end $r$`);
  await admin0.query(`create database ${name}`);
  await admin0.end();
  const admin = await server.client(name);
  const house = owners[0];
  await admin.query(`grant anon, authenticated, service_role to postgres;
    create extension if not exists pgcrypto;
    create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
    create table auth.users(id uuid primary key); grant select on auth.users to service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table public.orgs(id uuid primary key, slug text unique);
    create table public.org_members(org_id uuid, profile_id uuid, role text);`);
  for (const id of [...owners, ...members]) await admin.query('insert into auth.users values ($1) on conflict do nothing', [id]);
  if (house) {
    await admin.query("insert into public.orgs values ($1, 'mccluster')", [house]);
    for (const id of owners) await admin.query("insert into public.org_members values ($1, $2, 'owner')", [house, id]);
    for (const id of members) await admin.query("insert into public.org_members values ($1, $2, 'member')", [house, id]);
  }
  return admin;
}

/** Wait (bounded) until `check` holds. */
export async function until(check, label, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** What a backend is waiting on, read by an admin session: { type, event, blockers, waiting }. */
export async function blockedBy(admin, pid) {
  const row = (await admin.query(`select a.wait_event_type as type, a.wait_event as event, pg_blocking_pids(a.pid) as blockers,
      exists (select 1 from pg_locks l where l.pid = a.pid and not l.granted) as waiting
    from pg_stat_activity a where a.pid = $1`, [pid])).rows[0];
  return row || {};
}

/** Resolves once `waiter` is blocked on a lock held or awaited by `holder` (both clients carry .pid). */
export const waitsOn = (admin, waiter, holder, label) =>
  until(async () => { const b = await blockedBy(admin, waiter.pid); return b.type === 'Lock' && (b.blockers || []).includes(holder.pid); }, label);
