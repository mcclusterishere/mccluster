// Equity Uprise shared-platform support-only fixture for existing Core device
// jobs. This local adapter does not own or activate building capabilities.
// A PostgREST subset over a disposable PGlite database, for the device-jobs
// staging harness only. It serves exactly the surface core/src/compute/store.mjs,
// jobs-store.mjs and supabase.mjs use: filtered GET/PATCH/POST on tables with
// Prefer return=representation, on_conflict with merge/ignore duplicates, and
// POST rpc/<function> with named arguments. It is a test fixture, never a
// backend: it binds loopback only, it holds the whole schema from the
// repository SQL and it dies with the run.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const IDENT = /^[a-z_][a-z0-9_]*$/;

export async function openPglite({ modulePath = process.env.PGLITE_MODULE_PATH } = {}) {
  if (!modulePath || !path.isAbsolute(modulePath)) {
    throw new Error('Set PGLITE_MODULE_PATH to the pinned PGlite dist/index.js (npm install --prefix <dir> --no-audit --no-fund @electric-sql/pglite@0.5.17)');
  }
  const { PGlite } = await import(pathToFileURL(modulePath));
  const { pgcrypto } = await import(pathToFileURL(path.join(path.dirname(modulePath), 'contrib/pgcrypto.js')));
  return new PGlite({ extensions: { pgcrypto } });
}

// The compute schema exactly as the repository holds it, plus the pending
// files this slice depends on (named explicitly so the proof says which).
export async function loadComputeSchema(db, root, { pending = ['compute_job_attestations_v1', 'compute_job_attestations_device_facts_v1'] } = {}) {
  await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when duplicate_object then null; end $$;
    create schema if not exists extensions; create extension if not exists pgcrypto;
    create table if not exists public.orgs(id uuid primary key, slug text unique, enabled boolean not null default true);`);
  const files = [
    'supabase/replay_migrations/20260912071000_compute_node_protocol.sql',
    'supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql',
    'supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql',
    'supabase/migrations/20261020210718_compute_lease_authority_v2.sql'
  ];
  for (const name of pending) files.push(`supabase/pending/${name}.sql`);
  const loaded = [];
  for (const file of files) {
    await db.exec(fs.readFileSync(path.join(root, file), 'utf8'));
    loaded.push(file);
  }
  return loaded;
}

async function columnTypes(db, table) {
  const { rows } = await db.query('select column_name, data_type, udt_name from information_schema.columns where table_schema = $1 and table_name = $2', ['public', table]);
  if (!rows.length) return null;
  return new Map(rows.map((row) => [row.column_name, row.udt_name]));
}

function castFor(udt) {
  if (udt === 'jsonb' || udt === 'json') return '::jsonb';
  if (udt === 'uuid') return '::uuid';
  if (udt === 'timestamptz') return '::timestamptz';
  if (udt === 'int4') return '::integer';
  if (udt === 'int8') return '::bigint';
  if (udt === 'bool') return '::boolean';
  if (udt === 'numeric') return '::numeric';
  return '::text';
}

function paramValue(udt, value, native = false) {
  if (value === null || value === undefined) return null;
  // postgres.js applies PostgreSQL's inferred parameter serializer itself.
  // JSON-stringifying here would store a JSON string instead of the object or
  // array, and stringifying booleans would change the driver's true/false value.
  if (native) return value;
  if (udt === 'jsonb' || udt === 'json') return JSON.stringify(value);
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function pgError(error) {
  const code = error?.code || null;
  if (code === '42P01') return { status: 404, body: { code: 'PGRST205', message: error.message, details: null, hint: null } };
  if (code === '42883') return { status: 404, body: { code: 'PGRST202', message: `Could not find the function ${error.message}`, details: null, hint: null } };
  if (code === '23505') return { status: 409, body: { code, message: error.message, details: error.detail || null, hint: null } };
  return { status: 400, body: { code, message: error.message, details: error.detail || null, hint: error.hint || null } };
}

// PostgREST filter grammar subset: col=op.value with eq/neq/gt/gte/lt/lte/is,
// in.(a,b), not.in.(a,b), not.is.null.
function buildWhere(params, types, values) {
  const clauses = [];
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    /* a json text path, col->>key (PostgREST's), compared as text with eq only */
    const jsonPath = /^([a-z_][a-z0-9_]*)->>([a-z_][a-z0-9_]*)$/.exec(key);
    if (jsonPath) {
      if (!types.has(jsonPath[1]) || !/^json/.test(types.get(jsonPath[1]))) throw Object.assign(new Error(`unknown column ${key}`), { code: '42703' });
      if (!raw.startsWith('eq.')) throw Object.assign(new Error(`unsupported json filter ${raw}`), { code: 'PGRST100' });
      values.push(raw.slice(3));
      clauses.push(`"${jsonPath[1]}"->>'${jsonPath[2]}' = $${values.length}`);
      continue;
    }
    if (!IDENT.test(key) || !types.has(key)) throw Object.assign(new Error(`unknown column ${key}`), { code: '42703' });
    const cast = castFor(types.get(key));
    let negate = false;
    let spec = raw;
    if (spec.startsWith('not.')) { negate = true; spec = spec.slice(4); }
    const dot = spec.indexOf('.');
    const op = spec.slice(0, dot);
    const value = spec.slice(dot + 1);
    const col = `"${key}"`;
    let clause;
    if (op === 'in') {
      const list = value.replace(/^\(/, '').replace(/\)$/, '').split(',').map((s) => s.trim()).filter(Boolean);
      const holes = list.map((item) => { values.push(item); return `$${values.length}${cast}`; });
      clause = `${col} in (${holes.join(',')})`;
    } else if (op === 'is') {
      clause = value === 'null' ? `${col} is null` : `${col} is ${value === 'true' ? 'true' : 'false'}`;
    } else {
      const map = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      if (!map[op]) throw Object.assign(new Error(`unsupported operator ${op}`), { code: 'PGRST100' });
      values.push(value);
      clause = `${col} ${map[op]} $${values.length}${cast}`;
    }
    clauses.push(negate ? `not (${clause})` : clause);
  }
  return clauses.length ? ` where ${clauses.join(' and ')}` : '';
}

function buildSelect(params, types) {
  const select = params.get('select') || '*';
  if (select === '*') return '*';
  return select.split(',').map((s) => s.trim()).filter(Boolean).map((col) => {
    if (!IDENT.test(col) || !types.has(col)) throw Object.assign(new Error(`unknown column ${col}`), { code: '42703' });
    return `"${col}"`;
  }).join(', ');
}

function buildOrder(params, types) {
  const order = params.get('order');
  if (!order) return '';
  return ' order by ' + order.split(',').map((part) => {
    const [col, dir = 'asc'] = part.split('.');
    if (!IDENT.test(col) || !types.has(col)) throw Object.assign(new Error(`unknown column ${col}`), { code: '42703' });
    return `"${col}" ${dir.toLowerCase() === 'desc' ? 'desc' : 'asc'}`;
  }).join(', ');
}

function readPrefer(req) {
  const prefer = String(req.headers.prefer || '');
  return {
    representation: /return=representation/.test(prefer),
    resolution: prefer.match(/resolution=([a-z-]+)/)?.[1] || null
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

export async function startPostgrestShim({ db, apiKey, host = '127.0.0.1', port = 0, log = () => {} }) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://127.0.0.1');
    // PostgREST renders timestamptz as 2026-11-23T02:25:10.123456+00:00, never
    // with a Z: a signature rebuilt from a re-rendered timestamp must fail here
    // the way it would in production.
    const render = (value) => JSON.stringify(value, function (key, v) {
      const original = this[key]; // Date.toJSON runs before the replacer.
      return original instanceof Date ? original.toISOString().replace('Z', '000+00:00') : v;
    });
    const reply = (status, body) => {
      const payload = body === undefined ? '' : render(body);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
      res.end(payload);
      requests.push({ method: req.method, path: url.pathname, status, ms: Date.now() - started });
    };
    try {
      const presented = req.headers.apikey || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!presented || presented !== apiKey) return reply(401, { code: 'PGRST301', message: 'No suitable key or wrong key type' });
      const match = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_][a-z0-9_]*)$/);
      if (!match) return reply(404, { code: 'PGRST125', message: 'Invalid path' });
      const [, isRpc, name] = match;
      const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : null;

      if (isRpc) {
        const args = body && typeof body === 'object' ? body : {};
        const keys = Object.keys(args);
        if (!keys.every((k) => IDENT.test(k))) return reply(400, { code: 'PGRST100', message: 'bad argument name' });
        // Resolve the overload by exact argument-name set so an unknown
        // parameter answers PGRST202 like PostgREST does.
        const { rows: fns } = await db.query(
          `select p.oid::text as oid, p.proargnames as names, p.pronargdefaults as defaults, p.pronargs as nargs,
                  (select array_agg(format_type(t, null) order by ord) from unnest(p.proargtypes) with ordinality as a(t, ord)) as types
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name]);
        const candidate = fns.find((fn) => {
          const names = fn.names || [];
          const required = names.slice(0, fn.nargs - fn.defaults);
          return keys.every((k) => names.includes(k)) && required.every((k) => keys.includes(k));
        });
        if (!candidate) return reply(404, { code: 'PGRST202', message: `Could not find the function public.${name}(${keys.join(', ')}) in the schema cache`, details: null, hint: null });
        const values = [];
        const named = keys.map((k) => {
          const idx = candidate.names.indexOf(k);
          const type = candidate.types[idx];
          const value = args[k];
          values.push(value === null || value === undefined ? null : db.native ? value : (typeof value === 'object' && !Array.isArray(value)) || type === 'jsonb' ? JSON.stringify(value) : Array.isArray(value) ? `{${value.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(',')}}` : String(value));
          return `${k} => $${values.length}::${type}`;
        });
        const { rows } = await db.query(`select public.${name}(${named.join(', ')}) as result`, values);
        return reply(200, rows[0]?.result ?? null);
      }

      const types = await columnTypes(db, name);
      if (!types) return reply(404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache`, details: null, hint: null });
      const prefer = readPrefer(req);

      if (req.method === 'GET') {
        const values = [];
        const sql = `select ${buildSelect(url.searchParams, types)} from public."${name}"${buildWhere(url.searchParams, types, values)}${buildOrder(url.searchParams, types)}` +
          (url.searchParams.get('limit') ? ` limit ${Math.max(0, Number(url.searchParams.get('limit')) || 0)}` : '') +
          (url.searchParams.get('offset') ? ` offset ${Math.max(0, Number(url.searchParams.get('offset')) || 0)}` : '');
        const { rows } = await db.query(sql, values);
        return reply(200, rows);
      }

      if (req.method === 'PATCH') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { code: 'PGRST102', message: 'PATCH body must be an object' });
        const values = [];
        const sets = Object.entries(body).map(([col, value]) => {
          if (!IDENT.test(col) || !types.has(col)) throw Object.assign(new Error(`unknown column ${col}`), { code: '42703' });
          values.push(paramValue(types.get(col), value, db.native));
          return `"${col}" = $${values.length}${castFor(types.get(col))}`;
        });
        const where = buildWhere(url.searchParams, types, values);
        const { rows } = await db.query(`update public."${name}" set ${sets.join(', ')}${where} returning *`, values);
        return prefer.representation ? reply(200, rows) : reply(204);
      }

      if (req.method === 'POST') {
        const records = Array.isArray(body) ? body : [body];
        if (!records.length || records.some((r) => !r || typeof r !== 'object')) return reply(400, { code: 'PGRST102', message: 'POST body must be an object or array of objects' });
        const cols = [...new Set(records.flatMap((r) => Object.keys(r)))];
        for (const col of cols) if (!IDENT.test(col) || !types.has(col)) return reply(400, { code: '42703', message: `unknown column ${col}` });
        const values = [];
        const tuples = records.map((record) => `(${cols.map((col) => { values.push(paramValue(types.get(col), record[col] ?? null, db.native)); return `$${values.length}${castFor(types.get(col))}`; }).join(', ')})`);
        let conflict = '';
        const onConflict = url.searchParams.get('on_conflict');
        if (onConflict) {
          const keyCols = onConflict.split(',').map((s) => s.trim());
          if (!keyCols.every((c) => IDENT.test(c) && types.has(c))) return reply(400, { code: '42703', message: 'bad on_conflict column' });
          if (prefer.resolution === 'merge-duplicates') {
            const updates = cols.filter((c) => !keyCols.includes(c)).map((c) => `"${c}" = excluded."${c}"`);
            conflict = ` on conflict (${keyCols.map((c) => `"${c}"`).join(', ')}) do update set ${updates.join(', ')}`;
          } else {
            conflict = ` on conflict (${keyCols.map((c) => `"${c}"`).join(', ')}) do nothing`;
          }
        }
        const { rows } = await db.query(`insert into public."${name}" (${cols.map((c) => `"${c}"`).join(', ')}) values ${tuples.join(', ')}${conflict} returning *`, values);
        return prefer.representation ? reply(201, rows) : reply(201);
      }
      return reply(405, { code: 'PGRST105', message: 'Method not allowed' });
    } catch (error) {
      const mapped = pgError(error);
      log({ event: 'postgrest_shim_error', path: url.pathname, code: mapped.body.code, message: error.message });
      return reply(mapped.status, mapped.body);
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  return {
    url: `http://${address.address}:${address.port}`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); })
  };
}
