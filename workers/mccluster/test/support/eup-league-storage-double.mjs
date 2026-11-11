// In-memory double of the storage service, for exactly the calls the League media path makes:
//
//   Worker, service key   POST   /storage/v1/object/upload/sign/<bucket>/<path>          sign one upload
//   browser, grant        PUT    /storage/v1/object/upload/sign/<bucket>/<path>?token=   store the file
//   Worker, service key   POST   /storage/v1/object/list/<bucket>                        { prefix, search, limit }
//   Worker, service key   GET    /storage/v1/object/authenticated/<bucket>/<path>        read the object (streamed)
//   Worker, service key   POST   /storage/v1/object/sign/<bucket>/<path>                 { expiresIn } → signed read
//   media element, token  GET    /storage/v1/object/sign/<bucket>/<path>?token=          play (Range supported)
//   Worker, service key   DELETE /storage/v1/object/<bucket>                             { prefixes: [exact names] }
//
// It is a MODEL written from the service's documented behaviour and from the calls this repository already makes
// (workers/mccluster/src/prim3/learning.js, live/store.js, music/router.js). It was NOT compared with real storage.
// What it models on purpose: a signed upload stores once (the token carries upsert, false unless the sign call sent
// x-upsert: true; signing for a path that already holds an object is refused the same way); the stored content
// type is the PUT's content-type header; every stored object gets a new id and eTag; a listing matches names that
// START with prefix + search and reports id, metadata.eTag, metadata.size and metadata.mimetype; deletion takes
// exact names and answers the rows it removed; tokens expire on the injected clock. Refusals use the service's JSON
// shape ({ statusCode, error, message }); their HTTP statuses are approximations and callers must only rely on ok.
//
// Use:
//   const storage = createLeagueStorageDouble({ origin: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, now });
//   const fetchImpl = (input, init) => (storage.handles(input) ? storage.fetch(input, init) : restOfThePlane(input, init));
//   await storage.put(grant, bytes)            what a browser does with the grant beginUpload returned
//   await storage.read(url, { range })         what a media element does with a signed read
//   storage.store(path, bytes, { contentType })  put an object there directly (a new id and eTag every time)
//   storage.object(path) / storage.remove(path) / storage.paths()   the live record (id, eTag, size, mimetype, bytes), delete, list
//   storage.tokens()                           every upload and read token minted so far
//   storage.intercept((call, init) => Response | 'hang' | undefined)   answer or stall a call; returns off()
//   storage.calls                              every call in order: method, route, service, redirect, signal, json, status
//   storage.chunking = 1                       bytes per chunk of a streamed read (a number, or a list that repeats)
//   asWorkerFetch(storage.fetch)               the same function behind the Worker runtime's fetch rules
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MEDIA } from '../../src/eup/league-contract.js';
import { assertWorkersRequestInit } from './workers-fetch-semantics.mjs';

const PREFIX = '/storage/v1/';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refuse = (status, code, error, message) => json({ statusCode: String(code), error, message }, status);
const lower = (headers) => Object.fromEntries([...new Headers(headers ?? {}).entries()].map(([name, value]) => [name.toLowerCase(), value]));
const toBytes = (value) => (value instanceof Uint8Array ? new Uint8Array(value) : typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value));

/* The Worker runtime's fetch: it refuses a foreign `this` ("Illegal invocation") and any RequestInit it does not
   implement (redirect: "error", mode, credentials, ...). Node's fetch accepts all of that, so a plain double would
   pass code that fails in production on its first call. */
export function asWorkerFetch(fetchLike) {
  return function workerFetch(input, init = {}) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
    assertWorkersRequestInit(init);
    return fetchLike(input, init);
  };
}

export function createLeagueStorageDouble({ origin = 'https://fixture.invalid', serviceKey = 'fixture-only', now = Date.now, bucket = MEDIA.bucket, fileSizeLimit = MEDIA.hard_max_bytes } = {}) {
  const objects = new Map(); // name → { id, bytes, size, mimetype, eTag, created_at, updated_at }
  const grants = new Map(); // token → { kind: 'upload' | 'read', name, upsert, expires }
  const calls = [];
  const hooks = [];
  const api = { origin, bucket, calls, chunking: 65536 };
  const stamp = () => new Date(now()).toISOString();
  const mint = (grant) => { const token = `tok_${randomBytes(24).toString('base64url')}`; grants.set(token, grant); return token; };

  function store(name, bytes, { contentType = 'application/octet-stream' } = {}) {
    const body = toBytes(bytes);
    const at = stamp();
    const record = { id: randomUUID(), bytes: body, size: body.byteLength, mimetype: contentType, eTag: `"${createHash('md5').update(body).digest('hex')}"`, created_at: at, updated_at: at };
    objects.set(name, record);
    return record;
  }
  const listRow = (name, o) => ({ name, id: o.id, updated_at: o.updated_at, created_at: o.created_at, last_accessed_at: o.created_at,
    metadata: { eTag: o.eTag, size: o.size, mimetype: o.mimetype, cacheControl: 'max-age=3600', lastModified: o.updated_at, contentLength: o.size, httpStatusCode: 200 } });

  /* A streamed body that hands out one chunk per read, so a call record shows how much the reader really took. */
  function streamOf(bytes, seen) {
    const sizes = Array.isArray(api.chunking) ? api.chunking : [api.chunking];
    let offset = 0;
    let turn = 0;
    return new ReadableStream({
      pull(controller) {
        if (offset >= bytes.byteLength) { seen.ended = true; controller.close(); return; }
        const end = Math.min(bytes.byteLength, offset + Math.max(1, sizes[turn % sizes.length]));
        controller.enqueue(bytes.slice(offset, end));
        seen.chunks += 1; seen.bytes += end - offset; offset = end; turn += 1;
      },
      cancel() { seen.cancelled = true; }
    }, { highWaterMark: 0 });
  }
  function serve(record, call, range = null) {
    const headers = { 'content-type': record.mimetype, etag: record.eTag, 'accept-ranges': 'bytes', 'cache-control': 'no-cache', 'last-modified': new Date(record.updated_at).toUTCString() };
    call.stream = { chunks: 0, bytes: 0, ended: false, cancelled: false };
    const match = /^bytes=(\d+)-(\d*)$/.exec(range || '');
    if (!match) return new Response(streamOf(record.bytes, call.stream), { status: 200, headers: { ...headers, 'content-length': String(record.bytes.byteLength) } });
    const first = Number(match[1]);
    const last = match[2] === '' ? record.bytes.byteLength - 1 : Math.min(Number(match[2]), record.bytes.byteLength - 1);
    if (first > last) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${record.bytes.byteLength}` } });
    return new Response(streamOf(record.bytes.subarray(first, last + 1), call.stream), { status: 206, headers: { ...headers, 'content-length': String(last - first + 1), 'content-range': `bytes ${first}-${last}/${record.bytes.byteLength}` } });
  }
  const hang = (signal) => new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const tokenFor = (url, kind, name) => {
    const grant = grants.get(url.searchParams.get('token') || '');
    if (!grant || grant.kind !== kind || grant.name !== name) return { refusal: refuse(400, 400, 'InvalidSignature', 'Invalid signature') };
    if (now() >= grant.expires) return { refusal: refuse(400, 400, 'InvalidJWT', '"exp" claim timestamp check failed') };
    return { grant };
  };

  async function route(call, url, init, request) {
    const { method, service } = call;
    const parts = call.route.split('/');
    const denied = () => refuse(403, 403, 'Unauthorized', 'Invalid Compact JWS');
    const named = (from) => (parts[from] === bucket ? parts.slice(from + 1).join('/') : null);
    if (parts[0] !== 'object') return refuse(404, 404, 'not_found', 'Route not found');

    if (parts[1] === 'upload' && parts[2] === 'sign') {
      const name = named(3);
      if (!name) return refuse(404, 404, 'Bucket not found', 'Bucket not found');
      if (method === 'POST') {
        if (!service) return denied();
        const upsert = call.headers['x-upsert'] === 'true';
        if (objects.has(name) && !upsert) return refuse(409, 409, 'Duplicate', 'The resource already exists');
        const token = mint({ kind: 'upload', name, upsert, expires: now() + MEDIA.upload_grant_seconds * 1000 });
        return json({ url: `/object/upload/sign/${bucket}/${name}?token=${token}`, token });
      }
      if (method === 'PUT') {
        const { grant, refusal } = tokenFor(url, 'upload', name);
        if (refusal) return refusal;
        const bytes = new Uint8Array(request ? await request.arrayBuffer() : await new Response(init.body ?? null).arrayBuffer());
        call.bytes = bytes.byteLength;
        if (objects.has(name) && !grant.upsert) return refuse(409, 409, 'Duplicate', 'The resource already exists');
        if (bytes.byteLength > fileSizeLimit) return refuse(413, 413, 'Payload too large', 'The object exceeded the maximum allowed size');
        const record = store(name, bytes, { contentType: call.headers['content-type'] || 'application/octet-stream' });
        return json({ Key: `${bucket}/${name}`, Id: record.id });
      }
    }
    if (parts[1] === 'list' && method === 'POST' && parts.length === 3) {
      if (!service) return denied();
      if (parts[2] !== bucket) return refuse(404, 404, 'Bucket not found', 'Bucket not found');
      const body = call.json && typeof call.json === 'object' ? call.json : {};
      const folder = typeof body.prefix === 'string' && body.prefix !== '' ? (body.prefix.endsWith('/') ? body.prefix : `${body.prefix}/`) : '';
      const want = `${folder}${typeof body.search === 'string' ? body.search : ''}`.toLowerCase();
      const level = folder.split('/').length;
      const folders = new Set();
      const files = [];
      for (const [name, record] of objects) {
        if (!name.toLowerCase().startsWith(want)) continue;
        const tokens = name.split('/');
        if (tokens.length === level) files.push(listRow(tokens[level - 1], record));
        else if (tokens.length > level) folders.add(tokens[level - 1]);
      }
      const rows = [...[...folders].sort().map((name) => ({ name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null })),
        ...files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))];
      const offset = Number.isInteger(body.offset) ? body.offset : 0;
      return json(rows.slice(offset, offset + (Number.isInteger(body.limit) ? body.limit : 100)));
    }
    if (parts[1] === 'authenticated' && method === 'GET') {
      if (!service) return denied();
      const record = objects.get(named(2) ?? '');
      return record ? serve(record, call, call.headers.range) : refuse(404, 404, 'not_found', 'Object not found');
    }
    if (parts[1] === 'sign') {
      const name = named(2);
      if (!name) return refuse(404, 404, 'Bucket not found', 'Bucket not found');
      if (method === 'POST') {
        if (!service) return denied();
        const seconds = call.json?.expiresIn;
        if (!Number.isInteger(seconds) || seconds < 1) return refuse(400, 400, 'Bad Request', 'body must have required property expiresIn');
        if (!objects.has(name)) return refuse(404, 404, 'not_found', 'Object not found');
        return json({ signedURL: `/object/sign/${bucket}/${name}?token=${mint({ kind: 'read', name, upsert: false, expires: now() + seconds * 1000 })}` });
      }
      if (method === 'GET') {
        const { refusal } = tokenFor(url, 'read', name);
        if (refusal) return refusal;
        const record = objects.get(name);
        return record ? serve(record, call, call.headers.range) : refuse(404, 404, 'not_found', 'Object not found');
      }
    }
    if (parts[1] === bucket && parts.length === 2 && method === 'DELETE') {
      if (!service) return denied();
      const names = Array.isArray(call.json?.prefixes) ? call.json.prefixes : null;
      if (!names) return refuse(400, 400, 'Bad Request', 'body must have required property prefixes');
      const removed = [];
      for (const name of names) {
        const record = objects.get(name);
        if (!record) continue;
        objects.delete(name);
        removed.push({ bucket_id: bucket, ...listRow(name, record) });
      }
      return json(removed);
    }
    return refuse(404, 404, 'not_found', 'Route not found');
  }

  api.handles = (input) => {
    try { const url = new URL(input instanceof Request ? input.url : String(input)); return url.origin === origin && url.pathname.startsWith(PREFIX); } catch { return false; }
  };
  api.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    if (url.origin !== origin || !url.pathname.startsWith(PREFIX)) throw new TypeError('league storage double: not a storage URL');
    const headers = lower(init.headers ?? request?.headers);
    const call = { n: calls.length + 1, method: String(init.method ?? request?.method ?? 'GET').toUpperCase(), route: url.pathname.slice(PREFIX.length), url: url.href, headers,
      service: headers.apikey === serviceKey && headers.authorization === `Bearer ${serviceKey}`, redirect: init.redirect, signal: init.signal instanceof AbortSignal, json: undefined, status: null, stream: null };
    if (typeof init.body === 'string' && /json/.test(headers['content-type'] || '')) { try { call.json = JSON.parse(init.body); } catch { call.json = undefined; } }
    calls.push(call);
    for (const hook of [...hooks]) {
      const out = await hook(call, init);
      if (out === 'hang') { call.status = 'hang'; return hang(init.signal); }
      if (out instanceof Response) { call.status = out.status; return out; }
    }
    const response = await route(call, url, init, request);
    call.status = response.status;
    return response;
  };
  api.intercept = (hook) => { hooks.push(hook); return () => { const at = hooks.indexOf(hook); if (at >= 0) hooks.splice(at, 1); }; };
  api.store = store;
  api.remove = (name) => objects.delete(name);
  api.object = (name) => objects.get(name) ?? null;
  api.paths = () => [...objects.keys()].sort();
  api.tokens = () => [...grants.keys()];
  api.put = (grant, body, { headers = {} } = {}) => api.fetch(grant.url, { method: grant.method, headers: { ...grant.headers, ...headers }, body });
  api.read = (url, { range } = {}) => api.fetch(url, { method: 'GET', headers: range ? { range } : {} });
  return api;
}
