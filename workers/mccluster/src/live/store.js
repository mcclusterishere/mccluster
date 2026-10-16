/* LIVE MISSIONS: the database and the private recording bucket.

   Member actions run as the member (their bearer, so auth.uid() and the
   rules in supabase/pending/live_missions_v1.sql decide). Only what a member
   must never be able to forge runs with the service role: attaching the
   Stream input and the city cell, webhook observations, heartbeats (after
   the Worker has checked the run is the caller's), chunk receipts, the sweep.
   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are the Worker's existing secrets. */
import { fetchNoCrossHostRedirect } from '../lib/safe-fetch.js';

export const RECORDING_BUCKET = 'live-mission-recordings';

export class DbError extends Error {
  constructor(message, status, detail) { super(message); this.name = 'DbError'; this.status = status; this.detail = detail; }
}

export function makeSupabaseStore(env, { fetchImpl = null } = {}) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const host = base ? new URL(base).hostname : '';
  const go = (url, init) => fetchNoCrossHostRedirect(url, init, { fetchImpl, allowedHosts: [host] });
  async function parse(res) {
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      /* a rule refusing in SQL (raise exception) reaches the member as its sentence, 409 */
      const status = res.status === 400 && data && data.code === 'P0001' ? 409 : res.status >= 500 ? 502 : res.status;
      throw new DbError((data && (data.message || data.error)) || 'Database request failed', status, data);
    }
    return data;
  }
  const svc = (extra = {}) => ({ apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra });
  return {
    async userRpc(authorization, name, args = {}) {
      return parse(await go(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: key, authorization, 'content-type': 'application/json' }, body: JSON.stringify(args) }));
    },
    async serviceRpc(name, args = {}) {
      return parse(await go(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers: svc(), body: JSON.stringify(args) }));
    },
    async serviceGet(path) {
      return parse(await go(`${base}/rest/v1/${path}`, { headers: svc() }));
    },
    async servicePatch(path, body) {
      return parse(await go(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: svc({ prefer: 'return=minimal' }), body: JSON.stringify(body) }));
    },
    async userPatch(authorization, path, body) {
      return parse(await go(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { apikey: key, authorization, 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify(body) }));
    },
    async authUser(authorization) {
      if (!authorization || !/^bearer\s+\S+/i.test(authorization) || /^bearer\s+mcc_/i.test(authorization)) return null;
      const res = await go(`${base}/auth/v1/user`, { headers: { apikey: key, authorization } });
      if (!res.ok) return null;
      const u = await res.json().catch(() => null);
      return u && u.id ? u : null;
    },
    async storagePut(path, bytes, contentType) {
      const res = await go(`${base}/storage/v1/object/${RECORDING_BUCKET}/${path}`, {
        method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': contentType, 'x-upsert': 'false' }, body: bytes
      });
      if (!res.ok && res.status !== 409) throw new DbError(`Recording store answered ${res.status}`, 502);
      return true;
    },
    async storageGet(path) {
      const res = await go(`${base}/storage/v1/object/${RECORDING_BUCKET}/${path}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
      if (!res.ok) throw new DbError(`Recording store answered ${res.status}`, 502);
      return new Uint8Array(await res.arrayBuffer());
    },
    async storageDelete(paths) {
      if (!paths.length) return true;
      const res = await go(`${base}/storage/v1/object/${RECORDING_BUCKET}`, { method: 'DELETE', headers: svc(), body: JSON.stringify({ prefixes: paths }) });
      return res.ok;
    }
  };
}
