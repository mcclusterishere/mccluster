/* ============================================================
   SUPABASE — durable truth, administered.

   The Worker already holds a service-role key and uses it for data.
   This file is the other half: the management API, which is how the
   project itself is inspected and changed — advisories, migrations,
   edge functions, logs, SQL.

   The split that matters here is read versus write SQL. `supabase.sql.read`
   is an `infra.read` action, so a model can run it unattended; therefore
   it has to be genuinely read-only, and it is enforced here rather than
   by asking politely in a prompt. `supabase.sql.apply` is `infra.mutate`
   and cannot run without an approval bound to the exact statement hash.
   ============================================================ */

import { clampInt, notConfigured, opsError, providerFetch, text } from '../lib.js';

const API = 'https://api.supabase.com/v1';

export function configured(env) {
  return Boolean(env.SUPABASE_MANAGEMENT_TOKEN && projectRef(env));
}

export function projectRef(env) {
  return text(env.MCCLUSTER_SUPABASE_PROJECT_REF, 40) || 'zmnhbrjyhxzhkxmhkexs';
}

function headers(env) {
  if (!configured(env)) {
    throw notConfigured('Supabase management', ['SUPABASE_MANAGEMENT_TOKEN']);
  }
  return {
    authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`,
    'content-type': 'application/json'
  };
}

async function call(env, path, init = {}) {
  const { body } = await providerFetch('Supabase', `${API}${path}`, {
    ...init,
    headers: { ...headers(env), ...(init.headers || {}) }
  });
  return body;
}

export async function projectState(env) {
  const ref = projectRef(env);
  const project = await call(env, `/projects/${ref}`);
  return {
    project_ref: ref,
    name: project?.name || null,
    region: project?.region || null,
    status: project?.status || null,
    created_at: project?.created_at || null,
    database: project?.database ? { host: project.database.host, version: project.database.version } : null
  };
}

export async function advisors(env, params) {
  const ref = projectRef(env);
  const type = ['security', 'performance'].includes(text(params?.type, 20)) ? params.type : 'security';
  const body = await call(env, `/projects/${ref}/advisors/${type}`);
  const lints = Array.isArray(body?.lints) ? body.lints : [];
  return {
    project_ref: ref,
    type,
    counts: lints.reduce((acc, lint) => {
      const level = String(lint.level || 'INFO').toLowerCase();
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {}),
    lints: lints.slice(0, 100).map((lint) => ({
      name: lint.name, level: lint.level, categories: lint.categories,
      title: text(lint.title, 200), detail: text(lint.detail, 600)
    }))
  };
}

export async function listMigrations(env, params) {
  const ref = projectRef(env);
  const limit = clampInt(params?.limit, 25, 1, 200);
  const body = await call(env, `/projects/${ref}/database/migrations`);
  const rows = Array.isArray(body) ? body : [];
  return {
    project_ref: ref,
    applied: rows.length,
    latest: rows.length ? rows[rows.length - 1]?.version || null : null,
    migrations: rows.slice(-limit).reverse().map((m) => ({ version: m.version, name: m.name || null }))
  };
}

export async function listFunctions(env) {
  const ref = projectRef(env);
  const body = await call(env, `/projects/${ref}/functions`);
  return {
    project_ref: ref,
    functions: (Array.isArray(body) ? body : []).map((fn) => ({
      slug: fn.slug, name: fn.name, status: fn.status, version: fn.version,
      verify_jwt: fn.verify_jwt, updated_at: fn.updated_at
    }))
  };
}

export async function queryLogs(env, params) {
  const ref = projectRef(env);
  const limit = clampInt(params?.limit, 50, 1, 200);
  const service = text(params?.service, 40) || 'postgres';
  const sources = {
    postgres: 'postgres_logs',
    api: 'edge_logs',
    edge: 'edge_logs',
    auth: 'auth_logs',
    functions: 'function_edge_logs',
    storage: 'storage_logs'
  };
  const source = sources[service];
  if (!source) {
    throw opsError('service must be one of postgres, api, auth, functions, storage', 400, {
      code: 'invalid_parameter', parameter: 'service', allowed: Object.keys(sources)
    });
  }
  const sql = `select id, timestamp, event_message from ${source} order by timestamp desc limit ${limit}`;
  const body = await call(env, `/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`);
  const rows = Array.isArray(body?.result) ? body.result : Array.isArray(body) ? body : [];
  return {
    project_ref: ref, service, source,
    entries: rows.slice(0, limit).map((row) => ({
      timestamp: row.timestamp || null,
      message: text(row.event_message, 1000)
    }))
  };
}

/* ---- the read-only guard ----------------------------------

   A statement is allowed through `supabase.sql.read` only if every
   statement in it starts with a reading verb and nothing in it looks
   like a write, a privilege change or a function call that could
   smuggle one. This is deliberately a whitelist with a blacklist
   behind it: new Postgres syntax should fail closed, not sneak past.

   Anything this rejects is not forbidden — it is simply
   `supabase.sql.apply`, which is what an approval is for. */

const READ_VERBS = /^(select|with|explain|show|table|values)\b/i;
const WRITE_MARKERS = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|comment\s+on|reindex|vacuum|copy|call|do|set\s+role|set\s+session\s+authorization|security\s+definer|pg_read_file|pg_read_binary_file|lo_import|lo_export|dblink|pg_sleep)\b/i;
const CTE_WRITE = /\b(insert|update|delete)\b/i;

export function assertReadOnlySql(sql) {
  const statement = text(sql, 20_000);
  if (!statement) throw opsError('sql is required', 400, { code: 'missing_parameter', parameter: 'sql' });

  /* Strip comments before judging, so `--` and block comments cannot
     hide a second statement from the checks below. */
  const stripped = statement
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();

  if (!stripped) throw opsError('sql is empty once comments are removed', 400, { code: 'empty_sql' });

  const parts = stripped.split(';').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    throw opsError('supabase.sql.read runs exactly one statement', 400, {
      code: 'multiple_statements', statements: parts.length
    });
  }
  const body = parts[0];
  if (!READ_VERBS.test(body)) {
    throw opsError('supabase.sql.read accepts select, with, explain, show, table or values', 400, {
      code: 'not_a_read', hint: 'Writing SQL is supabase.sql.apply, which requires an approval.'
    });
  }
  if (WRITE_MARKERS.test(body) || (/^with\b/i.test(body) && CTE_WRITE.test(body))) {
    throw opsError('That statement can write, so it is not a read', 403, {
      code: 'write_in_read_path', hint: 'Use supabase.sql.apply with an approval.'
    });
  }
  return body;
}

async function runSql(env, sql) {
  const ref = projectRef(env);
  const body = await call(env, `/projects/${ref}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: sql })
  });
  return Array.isArray(body) ? body : body ? [body] : [];
}

export async function readSql(env, params) {
  const sql = assertReadOnlySql(params?.sql);
  /* Belt and braces: the guard decides what may be sent, and the
     transaction wrapper makes the database itself refuse a write that
     somehow got past it. */
  const rows = await runSql(env, `set local statement_timeout = '15s'; set transaction read only; ${sql}`);
  return { project_ref: projectRef(env), statement: sql.slice(0, 2000), row_count: rows.length, rows: rows.slice(0, 200) };
}

export async function applySql(env, params) {
  const sql = text(params?.sql, 200_000);
  if (!sql) throw opsError('sql is required', 400, { code: 'missing_parameter', parameter: 'sql' });
  const name = text(params?.name, 120);
  const ref = projectRef(env);
  if (name) {
    const body = await call(env, `/projects/${ref}/database/migrations`, {
      method: 'POST',
      body: JSON.stringify({ query: sql, name })
    });
    return { project_ref: ref, applied_as: 'migration', name, result: body ?? null };
  }
  const rows = await runSql(env, sql);
  return { project_ref: ref, applied_as: 'statement', row_count: rows.length, rows: rows.slice(0, 50) };
}
