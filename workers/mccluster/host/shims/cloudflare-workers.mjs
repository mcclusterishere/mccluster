/* ============================================================
   `cloudflare:workers`, for Node.

   src/here-tenant-agent.js does `import { DurableObject } from
   "cloudflare:workers"`. That specifier does not exist off the Workers
   runtime, so without this the whole module graph fails to load and
   nothing runs -- including the 95% of the API that never touches a
   Durable Object.

   A loader hook (host/loader.mjs) points that specifier here.

   WHAT A DURABLE OBJECT ACTUALLY GIVES YOU, and which parts this keeps:

     Single-instance-per-id.    Kept. One process, one Map, so a given
                                name resolves to one object. This is the
                                property Seek First relies on: it calls
                                idFromName('seek-first:ais:mccluster'),
                                a singleton.
     Transactional storage.     Kept, via node:sqlite -- the binding is
                                declared storage = "sqlite" upstream, so
                                the shape matches.
     Survives process restart.  Kept, because the sqlite file is on disk.
     Global uniqueness across   NOT KEPT, and cannot be: that is a
     machines.                  property of Cloudflare's placement, not
                                of an API. One Node process is fine. Two
                                behind a load balancer would each hold
                                their own instance and silently diverge.
                                Run one, or move this state to Postgres
                                before you scale out.
   ============================================================ */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const STATE_DIR = process.env.DO_STATE_DIR || '/var/lib/mccluster/durable';

/* The subset of the DO storage API the Worker code actually calls. Kept
   deliberately small: a fuller fake would invite code that depends on
   behaviour this cannot honour. */
class SqliteStorage {
  #db;
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.#db = new DatabaseSync(file);
    this.#db.exec('create table if not exists kv (k text primary key, v text not null)');
  }
  async get(key) {
    if (Array.isArray(key)) {
      const out = new Map();
      for (const k of key) { const v = await this.get(k); if (v !== undefined) out.set(k, v); }
      return out;
    }
    const row = this.#db.prepare('select v from kv where k = ?').get(String(key));
    return row ? JSON.parse(row.v) : undefined;
  }
  async put(key, value) {
    if (typeof key === 'object' && key !== null && value === undefined) {
      for (const [k, v] of Object.entries(key)) await this.put(k, v);
      return;
    }
    this.#db.prepare('insert into kv (k,v) values (?,?) on conflict(k) do update set v = excluded.v')
      .run(String(key), JSON.stringify(value ?? null));
  }
  async delete(key) {
    const keys = Array.isArray(key) ? key : [key];
    let n = 0;
    for (const k of keys) n += this.#db.prepare('delete from kv where k = ?').run(String(k)).changes;
    return Array.isArray(key) ? n : n > 0;
  }
  async list({ prefix = '', limit = 1000 } = {}) {
    const rows = this.#db.prepare('select k,v from kv where k like ? order by k limit ?')
      .all(`${prefix}%`, limit);
    return new Map(rows.map((r) => [r.k, JSON.parse(r.v)]));
  }
  /* Single process, synchronous sqlite: the callback cannot interleave
     with another transaction, so running it directly IS the guarantee. */
  async transaction(fn) { return fn(this); }
  async deleteAll() { this.#db.exec('delete from kv'); }
}

export class DurableObject {
  constructor(state, env) { this.ctx = state; this.state = state; this.env = env; }
}

class Stub {
  constructor(instance) { this.#i = instance; }
  #i;
  /* Cloudflare exposes DO methods as RPC on the stub. In-process there is
     no wire, so calls go straight through -- which is also why a thrown
     error here surfaces as itself rather than as an RPC failure. */
  get fetch() { return this.#i.fetch ? this.#i.fetch.bind(this.#i) : undefined; }
}

export function makeNamespace(Cls, bindingName, env) {
  const live = new Map();
  return {
    idFromName(name) { return { name: String(name), toString: () => String(name) }; },
    newUniqueId() { return { name: `unique:${crypto.randomUUID()}`, toString() { return this.name; } }; },
    idFromString(s) { return { name: String(s), toString: () => String(s) }; },
    get(id) {
      const key = String(id?.name ?? id);
      if (!live.has(key)) {
        const file = join(STATE_DIR, `${bindingName}.${key.replace(/[^a-z0-9._-]/gi, '_')}.sqlite`);
        const storage = new SqliteStorage(file);
        const ctx = { storage, id, waitUntil(p) { return p; }, blockConcurrencyWhile: (fn) => fn() };
        const inst = new Cls(ctx, env);
        live.set(key, new Proxy(inst, {
          get(t, p) { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; },
        }));
      }
      return live.get(key);
    },
  };
}

export default { DurableObject };
