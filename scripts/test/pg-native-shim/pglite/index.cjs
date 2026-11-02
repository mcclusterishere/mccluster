'use strict';
// Native PostgreSQL stand-in for @electric-sql/pglite, for environments where the
// npm registry is unreachable but a disposable local PostgreSQL + psql exist.
//
// It implements exactly the surface the repository's SQL fixtures use:
//   new PGlite()            -> creates a uniquely named scratch database on localhost
//   db.exec(sql)            -> runs multi-statement SQL in the persistent session
//   db.query(sql, params)   -> runs one statement with $n parameters, returns {rows}
//   db.close()              -> quits psql and drops the scratch database
// Errors carry the SQLSTATE in `error.code` (PT409, 42501, P0002, 23505, ...).
//
// Session state (set role, set_config, open transactions) persists across calls,
// exactly like one PGlite connection. Every PGlite instance is its own psql process
// and its own database. Only localhost is ever used; an external PGHOST is refused.
//
// This is a test driver, not a database. Results it produces are "native PostgreSQL
// via scripts/test/pg-native-shim", and should be recorded as such — never as PGlite.
const {spawn, execFileSync} = require('node:child_process');
const crypto = require('node:crypto');

const HOST = process.env.PGHOST || '127.0.0.1';
const USER = process.env.PGUSER || 'postgres';
if (!['localhost', '127.0.0.1', '::1'].includes(HOST)) throw new Error('pg-native-shim: local disposable PostgreSQL only');
for (const k of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR']) if (process.env[k]) throw new Error('pg-native-shim: no opaque service target');

function psqlArgs(db) { return ['-h', HOST, '-U', USER, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=0', '-v', 'VERBOSITY=verbose', '-d', db]; }

class PGliteError extends Error {
  constructor(message, code) { super(message); this.name = 'PGliteError'; this.code = code; }
}

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  let s;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  let tag = '$p$';
  while (s.includes(tag)) tag = '$p' + crypto.randomBytes(2).toString('hex') + '$';
  return tag + s + tag;
}

function substitute(sql, params) {
  if (!params || !params.length) return sql;
  return sql.replace(/\$(\d+)(?!\d)/g, (m, n) => {
    const i = Number(n) - 1;
    if (i >= params.length) throw new Error('pg-native-shim: missing parameter ' + m);
    return literal(params[i]);
  });
}

function stripSemis(sql) { return sql.trim().replace(/;+\s*$/, ''); }

// PGlite is a fresh cluster per instance, so fixtures `create role anon` freely.
// Roles are cluster-global on a shared server, so make those statements idempotent
// (role attributes such as bypassrls are still applied on first creation).
function idempotentRoles(sql) {
  return sql.replace(/\bcreate\s+role\s+("?[a-z_][a-z0-9_]*"?)\s*((?:[a-z_]+\s*)*?);/gi,
    (m, name, attrs) => `do $__r$ begin if not exists (select 1 from pg_roles where rolname=${"'" + name.replace(/"/g, '') + "'"}) then create role ${name} ${attrs || ''}; end if; end $__r$;`);
}

function wrapForRows(sql) {
  const s = stripSemis(sql);
  const head = s.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/)*\s*/, '').slice(0, 12).toLowerCase();
  if (/^(select|with|table|values)\b/.test(head)) return 'select coalesce(json_agg(__r), \'[]\'::json) from (' + s + ') __r;';
  if (/\breturning\b/i.test(s)) return 'with __q as (' + s + ') select coalesce(json_agg(__r), \'[]\'::json) from __q __r;';
  return null;
}

class PGlite {
  constructor() {
    this.db = 'shim_' + crypto.randomBytes(6).toString('hex');
    execFileSync('createdb', ['-h', HOST, '-U', USER, this.db], {stdio: 'pipe'});
    this.proc = spawn('psql', psqlArgs(this.db), {stdio: ['pipe', 'pipe', 'pipe']});
    this.out = ''; this.err = '';
    this.proc.stdout.on('data', d => { this.out += d; this._pump(); });
    this.proc.stderr.on('data', d => { this.err += d; this._pump(); });
    this.queue = Promise.resolve();
    this.waiting = null;
    this.closed = false;
    this.waitReady = this._run('select 1;');
  }

  _pump() {
    const w = this.waiting; if (!w) return;
    const mo = this.out.indexOf(w.mark), me = this.err.indexOf(w.mark);
    if (mo < 0 || me < 0) return;
    const stdout = this.out.slice(0, mo); this.out = this.out.slice(mo + w.mark.length).replace(/^\n/, '');
    const stderr = this.err.slice(0, me); this.err = this.err.slice(me + w.mark.length).replace(/^\n/, '');
    this.waiting = null;
    w.resolve({stdout, stderr});
  }

  _run(sql) {
    return this.queue = this.queue.then(() => new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('pg-native-shim: closed'));
      const mark = '__PGSHIM_' + crypto.randomBytes(8).toString('hex') + '__';
      this.waiting = {mark, resolve};
      // Each command is terminated, then a marker is written to BOTH streams so the
      // caller can attribute every stdout row and stderr notice to this call.
      // A trailing newline+semicolon closes any statement left unterminated by the
      // caller (e.g. exec('set role x')); an empty statement is a no-op for psql.
      this.proc.stdin.write(sql + '\n;\n\\echo ' + mark + '\n\\warn ' + mark + '\n');
    }));
  }

  _errorFrom(stderr) {
    // psql verbose: "ERROR:  PT409: message" (SQLSTATE after ERROR:) then DETAIL/HINT/CONTEXT lines.
    const m = stderr.match(/^(?:psql:[^\n]*?)?ERROR:\s+([0-9A-Z]{5}):\s*([^\n]*)/m) || stderr.match(/^ERROR:\s*([^\n]*)/m);
    if (!m) return null;
    const code = m.length === 3 ? m[1] : undefined, message = m.length === 3 ? m[2] : m[1];
    const e = new PGliteError(message.trim(), code);
    const d = stderr.match(/^DETAIL:\s*([^\n]*)/m); if (d) e.detail = d[1];
    const h = stderr.match(/^HINT:\s*([^\n]*)/m); if (h) e.hint = h[1];
    return e;
  }

  async exec(sql) {
    await this.waitReady;
    const {stderr} = await this._run(idempotentRoles(sql));
    const e = this._errorFrom(stderr); if (e) throw e;
  }

  async query(sql, params) {
    await this.waitReady;
    const bound = idempotentRoles(substitute(sql, params));
    const wrapped = wrapForRows(bound);
    if (!wrapped) {
      const {stderr} = await this._run(stripSemis(bound) + ';');
      const e = this._errorFrom(stderr); if (e) throw e;
      return {rows: [], affectedRows: 0};
    }
    // \gdesc describes result columns without executing, so PGlite's typed rows
    // (Date for timestamp/date columns) can be reproduced from json_agg output.
    const desc = await this._run(stripSemis(bound) + '\n\\gdesc');
    const de = this._errorFrom(desc.stderr); if (de) throw de;
    const dateCols = new Set(desc.stdout.split('\n').filter(Boolean).map(l => l.split('|')).filter(([, t]) => /^(timestamp|date)/.test(t || '')).map(([n]) => n));
    const {stdout, stderr} = await this._run(wrapped);
    const e = this._errorFrom(stderr); if (e) throw e;
    const text = stdout.trim();
    const rows = text ? JSON.parse(text) : [];
    if (dateCols.size) for (const r of rows) for (const c of dateCols) if (typeof r[c] === 'string') r[c] = new Date(r[c]);
    return {rows, affectedRows: rows.length};
  }

  async close() {
    if (this.closed) return;
    try { await this.queue; } catch {}
    this.closed = true;
    this.proc.stdin.end('\\q\n');
    await new Promise(r => this.proc.once('exit', r));
    try { execFileSync('dropdb', ['-h', HOST, '-U', USER, '--if-exists', this.db], {stdio: 'pipe'}); } catch {}
  }
}

module.exports = {PGlite, PGliteError};
