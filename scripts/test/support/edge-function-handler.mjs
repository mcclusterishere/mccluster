// A Supabase Edge Function as it is written, run under Node for a test.
//
// The function's index.ts is read, its TypeScript types stripped (node:module), and its import lines
// replaced: npm:stripe and npm:@supabase/supabase-js by the fakes the test passes, the edge-runtime type
// import dropped, and every relative import (../_shared/*.ts, ./price.ts) by the REAL module, which Node
// loads with its own type stripping. Nothing inside the handler is rewritten unless the test names an
// edit (a retired function's switch, flipped to read the code it keeps), so what a test drives is the
// source that would be deployed. The same approach as ./music-direct-access-handler.mjs, for any function.
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

export const FUNCTIONS_DIR = new URL('../../../supabase/functions/', import.meta.url);
const IMPORT_LINE = /^import\s[\s\S]*?;[ \t]*$/gm;

function parseImport(statement) {
  let m;
  if ((m = /^import\s+["']([^"']+)["']\s*;/.exec(statement))) return { from: m[1], bindings: [] };
  if ((m = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']\s*;/.exec(statement))) {
    return { from: m[2], bindings: [{ imported: 'default', local: m[1] }] };
  }
  if ((m = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']\s*;/.exec(statement))) {
    const bindings = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [imported, local] = s.split(/\s+as\s+/);
      return { imported: imported.trim(), local: (local || imported).trim() };
    });
    return { from: m[2], bindings };
  }
  throw new Error(`the harness cannot read this import: ${statement}`);
}

/**
 * Load supabase/functions/<name>/index.ts. `env` is an object (unset names read as undefined, as in
 * Deno) or a function of the name; `Stripe` and `createClient` stand in for the npm imports; `fetch` is
 * every network call the function makes (none is allowed unless the test answers it); `edit` may change
 * the source text before it runs and must say what it changed. Returns the handler Deno.serve was given,
 * the relative modules it imports (as loaded), and everything it logged.
 */
export async function loadEdgeFunction(name, { env = {}, Stripe, createClient, fetch, edit } = {}) {
  const file = new URL(`${name}/index.ts`, FUNCTIONS_DIR);
  let source = await readFile(file, 'utf8');
  if (edit) {
    const edited = edit(source);
    if (edited === source) throw new Error(`the edit to ${name} changed nothing`);
    source = edited;
  }
  const stripped = stripTypeScriptTypes(source, { mode: 'strip' });
  const scope = {};
  const modules = {};
  for (const statement of stripped.match(IMPORT_LINE) || []) {
    const { from, bindings } = parseImport(statement);
    if (from.startsWith('jsr:@supabase/functions-js/')) continue; // the edge runtime's types, nothing at run time
    let mod;
    if (from.startsWith('npm:stripe@')) mod = { default: Stripe };
    else if (from.startsWith('npm:@supabase/supabase-js@')) mod = { createClient };
    else if (from.startsWith('./') || from.startsWith('../')) mod = modules[from] = await import(new URL(from, file).href);
    else throw new Error(`${name} imports ${from}, which this harness does not provide`);
    for (const { imported, local } of bindings) {
      if (mod[imported] === undefined) throw new Error(`${name}: ${from} gives no ${imported} (pass a fake for it)`);
      scope[local] = mod[imported];
    }
  }
  const body = stripped.replace(IMPORT_LINE, '');
  if (/^\s*import\s/m.test(body)) throw new Error(`an import of ${name} was not replaced`);
  const read = typeof env === 'function' ? env : (k) => (Object.prototype.hasOwnProperty.call(env, k) ? env[k] : undefined);
  let handler = null;
  const logged = [];
  const offline = async (url) => { throw new Error(`${name} made a network call nobody answered: ${url}`); };
  vm.runInNewContext(body, {
    ...scope,
    Deno: { env: { get: read }, serve: (f) => { handler = f; } },
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, AbortSignal, setTimeout, clearTimeout,
    crypto: webcrypto,
    fetch: fetch || offline,
    console: { error: (...a) => logged.push(a), warn: (...a) => logged.push(a), log() {} }
  }, { filename: `supabase/functions/${name}/index.ts` });
  if (typeof handler !== 'function') throw new Error(`${name} did not register a handler with Deno.serve`);
  return { handler, modules, logged };
}

/** A Stripe client that records every call and answers like Stripe's test mode, with nothing real in it. */
export function fakeStripe(calls) {
  return class Stripe {
    constructor() {
      const record = (method) => async (params, opts) => { calls.push({ method, params, opts }); return answers[method](params); };
      const answers = {
        'checkout.sessions.create': () => ({ id: 'cs_test_fixture', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture' }),
        'checkout.sessions.expire': () => ({}),
        'accounts.create': () => ({ id: 'acct_fixture', charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: {} }),
        'accounts.retrieve': (id) => ({ id, charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: {} }),
        'accountLinks.create': () => ({ url: 'https://connect.stripe.com/setup/e/acct_fixture/fixture' }),
        'customers.create': () => ({ id: 'cus_fixture' })
      };
      this.checkout = { sessions: { create: record('checkout.sessions.create'), expire: record('checkout.sessions.expire') } };
      this.accounts = { create: record('accounts.create'), retrieve: record('accounts.retrieve') };
      this.accountLinks = { create: record('accountLinks.create') };
      this.customers = { create: record('customers.create') };
    }
  };
}

/** A supabase-js client over fixed rows: from(table) filters by eq() and answers maybeSingle(), insert() and upsert(). */
export function fakeSupabase({ users = {}, tables = {} }, writes = []) {
  function builder(table) {
    let rows = (tables[table] || []).slice();
    const self = {
      select() { return self; },
      limit() { return self; },
      eq(column, value) { rows = rows.filter((r) => r[column] === value); return self; },
      async maybeSingle() { return { data: rows[0] || null, error: null }; },
      insert(row) { writes.push({ table, op: 'insert', row }); return Promise.resolve({ data: null, error: null }); },
      upsert(row, opts) { writes.push({ table, op: 'upsert', row, opts }); return Promise.resolve({ data: null, error: null }); }
    };
    return self;
  }
  return {
    auth: {
      async getUser(token) {
        const user = users[token] || null;
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid token' } };
      }
    },
    from: builder
  };
}

/** A JSON Response the way PostgREST and GoTrue answer. */
export function jsonResponse(body, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
