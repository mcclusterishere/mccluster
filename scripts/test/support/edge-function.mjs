/* Runs a Supabase Edge Function's own index.ts offline, as collect-*.test.mjs
   does for an import-free function, for functions that import.

   The source is read from disk and run unmodified apart from its top-level
   `import` statements, which cannot be compiled outside a module. Each is
   satisfied the way the runtime would satisfy it:

     ./x.ts, ../_shared/x.ts   the real module, imported from where the
                               function would import it
     npm:…, jsr:…, https:…     the stand-in the test passes under that exact
                               specifier (a missing one throws, so a new
                               dependency cannot arrive unnoticed)

   Deno.env, Deno.serve, fetch and console are the test's. Nothing here reaches
   a network: an unexpected fetch should throw in the test's own fetch.

   The function body is compiled as strict code in THIS realm, with its
   imports, Deno, fetch and console as parameters, not in a separate vm
   context. The runtime has one realm, so `error instanceof Error` in the
   function must hold for an Error thrown by a module it imports; in a
   separate context it would not, and a test could pin an answer the deployed
   function never gives. */
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const ROOT = new URL('../../../', import.meta.url);
/* `import <clause> from '<spec>'` or `import '<spec>'`, at the start of a line. */
const IMPORT = /^[ \t]*import\b(?!\s*\()([^'";]*?)(['"])([^'"\n]+)\2[ \t]*;?/gm;
const NAME = '[A-Za-z_$][\\w$]*';

function namesIn(clause, specifier) {
  const text = clause.trim();
  if (!text) return []; // side-effect import
  if (!/\bfrom$/.test(text)) throw new Error(`unsupported import of ${specifier}: ${text}`);
  const body = text.replace(/\bfrom$/, '').trim();
  if (/^type\b/.test(body)) return []; // import type { … }: erased by the compiler
  const out = [];
  const namespace = new RegExp(`\\*\\s*as\\s+(${NAME})`).exec(body);
  if (namespace) out.push({ local: namespace[1], imported: '*' });
  const named = /\{([^}]*)\}/.exec(body);
  const before = body.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+\S+/, '').replace(/,/g, ' ').trim();
  if (before) {
    if (!new RegExp(`^${NAME}$`).test(before)) throw new Error(`unsupported import of ${specifier}: ${text}`);
    out.push({ local: before, imported: 'default' });
  }
  for (const part of named ? named[1].split(',') : []) {
    const item = part.trim();
    if (!item || /^type\b/.test(item)) continue;
    const m = new RegExp(`^(${NAME})(?:\\s+as\\s+(${NAME}))?$`).exec(item);
    if (!m) throw new Error(`unsupported import of ${specifier}: ${item}`);
    out.push({ local: m[2] || m[1], imported: m[1] });
  }
  return out;
}

/**
 * @param {string} file     repo-relative path of the function's index.ts
 * @param {object} options
 * @param {Record<string,string>} options.env      what Deno.env.get answers
 * @param {Record<string,object>} options.stubs    stand-ins for non-relative imports, by exact specifier
 * @param {(input:any, init?:any)=>Promise<Response>} options.fetch
 * @returns {Promise<{handler:(req:Request)=>Promise<Response>, logs:any[][], imports:string[]}>}
 */
export async function loadEdgeFunction(file, { env = {}, stubs = {}, fetch } = {}) {
  const url = new URL(file, ROOT);
  const source = await readFile(url, 'utf8');
  const bindings = {};
  const imports = [];
  const pending = [];
  const body = source.replace(IMPORT, (statement, clause, _quote, specifier) => {
    imports.push(specifier);
    pending.push({ specifier, names: namesIn(clause, specifier) });
    return statement.replace(/[^\n]/g, ' '); // keep line numbers for stack traces
  });
  for (const { specifier, names } of pending) {
    let mod;
    if (/^\.{1,2}\//.test(specifier)) mod = await import(new URL(specifier, url).href);
    else if (Object.hasOwn(stubs, specifier)) mod = stubs[specifier];
    else throw new Error(`${file} imports ${specifier}: pass a stand-in for it in stubs`);
    for (const { local, imported } of names) {
      if (imported === '*') { bindings[local] = mod; continue; }
      if (!mod || !(imported in mod)) throw new Error(`${specifier} has no export named ${imported} (imported by ${file})`);
      bindings[local] = mod[imported];
    }
  }

  let handler = null;
  const logs = [];
  const record = (level) => (...args) => { logs.push([level, ...args]); };
  const scope = {
    ...bindings,
    Deno: {
      env: { get: (name) => (Object.hasOwn(env, name) ? env[name] : undefined) },
      serve: (...args) => { handler = args.find((a) => typeof a === 'function') || null; },
    },
    fetch: (input, init) => {
      if (typeof fetch !== 'function') throw new Error(`unexpected egress from ${file}: ${String(input)}`);
      return fetch(input, init);
    },
    console: { log: record('log'), info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') },
  };
  const names = Object.keys(scope);
  /* module code is strict and may await at its top level; the wrapper adds no line, so stack traces keep the file's line numbers */
  const code = `"use strict"; return (async () => {${stripTypeScriptTypes(body, { mode: 'strip' })}\n})();`;
  await vm.compileFunction(code, names, { filename: file })(...names.map((name) => scope[name]));
  if (typeof handler !== 'function') throw new Error(`${file} did not register a handler with Deno.serve`);
  return { handler, logs, imports };
}

/* The part of Supabase Storage the functions under test talk to: signing.

   `objects` is { bucket: [object name, …] }. A request is routed the way the
   real service routes it, on the path a WHATWG fetch actually sends (dot
   segments already resolved by the URL parser), so a signature is issued for
   whatever bucket and object the request really reached:

     POST /storage/v1/object/sign/<bucket>/<object…>   one object, by URL
     POST /storage/v1/object/sign/<bucket>             many, body { expiresIn, paths }

   Every signing request is kept in `requests`, every signature issued in
   `signed`. Returns null for a URL that is not a signing request. A test may
   answer the many-object form itself with `answerBatch` (a value to send as
   JSON, or a whole Response). */
export function storageSigner(objects, { base = 'https://db.test', answerBatch = null } = {}) {
  const requests = [];
  const signed = [];
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const has = (bucket, name) => Array.isArray(objects[bucket]) && objects[bucket].includes(name);
  async function respond(input, init = {}) {
    const url = new URL(String(input), base);
    const m = /^\/storage\/v1\/object\/sign\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (!m) return null;
    const bucket = decodeURIComponent(m[1]);
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (m[2] !== undefined && m[2] !== '') {
      let name;
      try { name = decodeURIComponent(m[2]); } catch { name = null; }
      requests.push({ form: 'url', method, sent: String(input), pathname: url.pathname, search: url.search, bucket, name, body });
      if (method !== 'POST' || name === null || !has(bucket, name)) return json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400);
      signed.push({ bucket, name });
      return json({ signedURL: `/object/sign/${bucket}/${name}?token=test-token` });
    }
    requests.push({ form: 'body', method, sent: String(input), pathname: url.pathname, search: url.search, bucket, body });
    if (method !== 'POST' || !Array.isArray(body.paths)) return json({ statusCode: '400', error: 'invalid_request', message: 'paths required' }, 400);
    if (answerBatch) {
      const answer = answerBatch({ bucket, paths: body.paths });
      return answer instanceof Response ? answer : json(answer);
    }
    return json(body.paths.map((path) => {
      if (typeof path !== 'string' || !has(bucket, path)) return { error: 'Either the object does not exist or you do not have access to it', path, signedURL: null };
      signed.push({ bucket, name: path });
      return { error: null, path, signedURL: `/object/sign/${bucket}/${path}?token=test-token` };
    }));
  }
  return { respond, requests, signed };
}
