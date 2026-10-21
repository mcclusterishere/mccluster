/* LIVE MISSIONS: the Cloudflare Stream calls, server side only.

   Secrets by name (never in the repo): CF_ACCOUNT_ID and a Stream-scoped
   CF_STREAM_TOKEN, the same two the existing Human Uprise live rooms use
   (platform-api.js). Every call goes through fetchNoCrossHostRedirect
   (lib/safe-fetch.js): redirect 'manual', so the bearer token never follows
   a redirect anywhere, and workerd never sees redirect: 'error'.

   What Stream does and does not do here (docs, read 2026-10-15/16):
   - A live input returns webRTC.url (WHIP publish; "This is a credential")
     and webRTCPlayback.url (WHEP play). Only the streamer ever receives the
     WHIP URL, once, at start; the WHEP URL only reaches signed-in members.
   - "WebRTC is not currently eligible for recording" and "Recording and live
     HLS playback are not yet supported" for WHIP inputs, so the input is
     made with recording off and the proof recording is the browser's own,
     uploaded in chunks during the run (recording.js) and assembled into a
     Stream video over tus with requiresignedurls.
   - Deleting the input kills the WHIP URL: it is the kill switch and the end
     of every run. */
import { fetchNoCrossHostRedirect } from '../lib/safe-fetch.js';

export const STREAM_API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 15000;

export function streamConfigured(env) {
  return Boolean(env && env.CF_ACCOUNT_ID && env.CF_STREAM_TOKEN);
}

export class StreamError extends Error {
  constructor(message, status = 502, detail = null) { super(message); this.name = 'StreamError'; this.status = status; this.detail = detail; }
}

export function makeStreamClient(env, { fetchImpl = null } = {}) {
  const base = `${STREAM_API}/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID || '')}/stream`;
  const auth = { authorization: `Bearer ${env.CF_STREAM_TOKEN || ''}` };
  async function call(method, path, { body, headers = {}, raw = false } = {}) {
    if (!streamConfigured(env)) throw new StreamError('Cloudflare Stream is not configured', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetchNoCrossHostRedirect(path.startsWith('https://') ? path : `${base}${path}`, {
        method, signal: controller.signal,
        headers: { ...auth, ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
      }, { fetchImpl, allowedHosts: ['api.cloudflare.com'] });
    } catch (e) {
      throw new StreamError(e && e.code === 'upstream_redirect' ? 'Cloudflare Stream redirected; refused' : 'Cloudflare Stream did not answer', 502);
    } finally { clearTimeout(timer); }
    return res;
  }
  async function json(method, path, body) {
    const res = await call(method, path, { body });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.success === false)) {
      const msg = data && Array.isArray(data.errors) && data.errors[0] && data.errors[0].message;
      throw new StreamError(msg || `Cloudflare Stream answered ${res.status}`, res.status === 404 ? 404 : 502);
    }
    return data ? data.result : null;
  }
  return {
    /* recording off: WHIP inputs cannot be recorded by Stream */
    async createLiveInput(name) {
      const r = await json('POST', '/live_inputs', { meta: { name: String(name).slice(0, 120) }, recording: { mode: 'off' } });
      const whip = r && r.webRTC && r.webRTC.url, whep = r && r.webRTCPlayback && r.webRTCPlayback.url;
      if (!r || !r.uid || !whip || !whep) {
        if (r && r.uid) await this.deleteLiveInput(r.uid).catch(() => {});
        throw new StreamError('Cloudflare did not return a WebRTC live input', 502);
      }
      return { uid: r.uid, whip_url: whip, whep_url: whep };
    },
    /* idempotent: a missing input is already deleted */
    async deleteLiveInput(uid) {
      if (!uid) return false;
      try { await json('DELETE', `/live_inputs/${encodeURIComponent(uid)}`); return true; }
      catch (e) { if (e.status === 404) return false; throw e; }
    },
    /* tus: create an upload of known length (docs: resumable uploads). */
    async tusCreate(length, { name, maxDurationSeconds = 6 * 3600 } = {}) {
      const b64 = (s) => btoa(unescape(encodeURIComponent(String(s))));
      const meta = [`name ${b64(name || 'live mission recording')}`, 'requiresignedurls', `maxDurationSeconds ${b64(maxDurationSeconds)}`].join(',');
      const res = await call('POST', '', {
        headers: { 'tus-resumable': '1.0.0', 'upload-length': String(length), 'upload-metadata': meta }
      });
      const location = res.headers.get('location');
      const uid = res.headers.get('stream-media-id');
      if (res.status !== 201 || !location) throw new StreamError(`Stream tus create answered ${res.status}`, 502);
      const url = new URL(location, STREAM_API);
      if (url.protocol !== 'https:') throw new StreamError('Stream tus location is not https', 502);
      return { url: url.toString(), uid };
    },
    async tusPatch(url, offset, bytes) {
      const host = new URL(url).hostname;
      const res = await fetchNoCrossHostRedirect(url, {
        method: 'PATCH',
        headers: { ...auth, 'tus-resumable': '1.0.0', 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' },
        body: bytes
      }, { fetchImpl, allowedHosts: [host] });
      if (res.status !== 204) throw new StreamError(`Stream tus patch answered ${res.status}`, 502);
      return Number(res.headers.get('upload-offset') || offset + bytes.byteLength);
    },
    async getVideo(uid) { return json('GET', `/${encodeURIComponent(uid)}`); },
    /* a short-lived signed token for the desk's review (low volume: the
       /token endpoint, per the signed-URL docs) */
    async videoToken(uid, expSeconds = 900) {
      const r = await json('POST', `/${encodeURIComponent(uid)}/token`, { exp: Math.floor(Date.now() / 1000) + expSeconds });
      if (!r || !r.token) throw new StreamError('Stream did not sign the recording', 502);
      return r.token;
    }
  };
}
