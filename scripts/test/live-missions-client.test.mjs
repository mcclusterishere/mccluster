/* Live missions, browser side: the "Live now" layer's coarse-pin contract,
   the tiny WHIP client, and static guards on the capture page
   (docs/control-plane/LIVE-MISSIONS.md). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
async function load(file, extra = {}) {
  const ctx = { URL, Promise, setTimeout, clearTimeout, setInterval, clearInterval, module: { exports: {} }, ...extra };
  ctx.globalThis = ctx;
  vm.runInNewContext(await read(file), ctx, { filename: file });
  return ctx.module.exports;
}

test('Live now layer: pins are city cells, re-snapped to 0.1 degree; no city or no point = no pin; runs only for members', async () => {
  const L = await load('js/world-live-now-layer.js');
  const out = L.toPins({
    members: true, total_live: 3,
    cells: [
      { city: 'Hartford', region: 'Connecticut', country: 'US', lat: 41.76371, lng: -72.68509, live_count: 2, missions: ['Help a person', 'Show up to a rally', 'x', 'y'] },
      { city: '', lat: 1, lng: 1, live_count: 1 },
      { city: 'Nowhere', lat: null, lng: 3, live_count: 1 },
      { city: 'Bad', lat: 120, lng: 3, live_count: 1 }
    ],
    runs: [{ id: 'r1', mission: 'Help a person', city: 'Hartford', lat: 41.8, lng: -72.7, live_since: '2026-10-17T15:00:00Z', whep_url: 'https://leak' }]
  });
  assert.equal(out.pins.length, 1);
  const p = out.pins[0];
  assert.deepEqual([p.lat, p.lng, p.precision, p.live_count], [41.8, -72.7, 'city', 2]);
  assert.equal(p.missions.length, 3);
  assert.equal(p.runs.length, 1);
  assert.deepEqual(Object.keys(p.runs[0]).sort(), ['id', 'live_since', 'mission'], 'a run carries no playback URL even if the API sent one');
  assert.equal(L.toPins({ cells: [{ city: 'A', lat: 1, lng: 1, live_count: 1 }] }).pins[0].runs.length, 0);
  assert.equal(L.toPins(null).pins.length, 0);
});

test('Live now layer: polls the contract endpoint, sends the member token only when given, treats 503 (switched off) as empty', async () => {
  const L = await load('js/world-live-now-layer.js');
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ cells: [{ city: 'Atlanta', lat: 33.749, lng: -84.388, live_count: 1 }], total_live: 1 }) }; };
  const layer = L.create({ fetchImpl, getToken: () => 'tok' });
  const st = await layer.refresh();
  assert.equal(seen[0].url, 'https://api.mccluster.org/v1/live/now');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
  assert.equal(st.pins[0].lat, 33.7);
  const off = L.create({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  assert.equal((await off.refresh()).pins.length, 0);
  const pub = L.create({ fetchImpl });
  await pub.refresh();
  assert.equal(seen[1].init.headers.authorization, undefined);
});

class FakePeer {
  constructor() { this.tx = []; this.connectionState = 'new'; this.iceGatheringState = 'complete'; this.closed = false; this.remote = null; }
  addTransceiver(t, o) { this.tx.push([t, o]); }
  addEventListener() {}
  removeEventListener() {}
  async createOffer() { return { type: 'offer', sdp: 'v=0 offer' }; }
  async setLocalDescription(o) { this.localDescription = o; }
  async setRemoteDescription(a) { this.remote = a; }
  close() { this.closed = true; }
}

test('WHIP client: sendonly tracks, SDP POSTed as application/sdp, 201 answer applied, Location resource DELETEd on close', async () => {
  const W = await load('js/whip-client.js');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') return { status: 201, headers: { get: (h) => (h === 'location' ? '/sess/abc' : null) }, text: async () => 'v=0 answer' };
    return { status: 200 };
  };
  const tracks = [{ kind: 'video' }, { kind: 'audio' }];
  const h = await W.publish({ getTracks: () => tracks }, 'https://customer-x.cloudflarestream.com/SECRET/webRTC/publish', { fetchImpl, RTCPeerConnection: FakePeer });
  assert.equal(h.pc.tx.length, 2);
  assert.ok(h.pc.tx.every(([, o]) => o.direction === 'sendonly'));
  assert.equal(calls[0].init.headers['content-type'], 'application/sdp');
  assert.equal(calls[0].init.body, 'v=0 offer');
  assert.equal(h.pc.remote.sdp, 'v=0 answer');
  assert.equal(h.resource, 'https://customer-x.cloudflarestream.com/sess/abc');
  await h.close();
  assert.equal(calls[1].init.method, 'DELETE');
  assert.equal(calls[1].url, 'https://customer-x.cloudflarestream.com/sess/abc');
  assert.ok(h.pc.closed);
  await assert.rejects(W.publish({ getTracks: () => tracks }, 'https://x.example/w', { fetchImpl: async () => ({ status: 403, headers: { get: () => null }, text: async () => '' }), RTCPeerConnection: FakePeer }), /refused the camera \(403\)/);
});

test('capture page: camera and microphone only; the WHIP URL is never stored; app bar present; mobile-first rules', async () => {
  const js = await read('js/live-mission-capture.js');
  const html = await read('live-mission.html');
  assert.ok(!/getDisplayMedia/.test(js), 'never asks for the screen');
  assert.ok(/getUserMedia\(\{ audio: true, video:/.test(js));
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(js), 'the WHIP URL and the run stay in memory');
  assert.ok(!/console\.(log|info)\([^)]*whip/i.test(js), 'the WHIP URL is never logged');
  assert.ok(html.includes('src="js/tabbar.js"'), 'the app bar never leaves');
  assert.ok(html.includes('name="robots" content="noindex"'));
  assert.ok(!/max-width\s*:\s*\d+px\)/.test(html.replace(/max-width:720px;margin/, '')), 'min-width media queries only');
  assert.ok(!/user-scalable=no|maximum-scale=1/.test(html));
  assert.ok(!/repeat\(\d+,\s*1fr\)|\s1fr[;)]/.test(html), 'minmax(0,1fr), never a bare 1fr');
  assert.ok(/font-size:max\(16px/.test(html), 'inputs at max(16px, …)');
  for (const k of ['edit_clip', 'repost_own_channels', 'clipper_share', 'paid_ads', 'face', 'voice', 'name_display', 'tag_handles', 'location_display', 'term', 'attribution']) {
    assert.ok(html.includes(`name="${k}"`), `publishing opt-in ${k} on the page`);
  }
  assert.ok(!/name="(edit_clip|repost_own_channels|clipper_share|paid_ads|tag_handles|attribution)"\s+checked/.test(html), 'every opt-in starts off');
});
