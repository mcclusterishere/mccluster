/* Hitman's Halo: a PRIVATE LOCAL PREVIEW for the owner. Loopback only, synthetic data only, production never touched.

   What is real:   the pages and scripts of this checkout (control.html, js/control-room/*, action-globe.html, js/halo/*)
                   and the Worker's own E=Up router (workers/mccluster/src/eup/router.js with modules.js, overview.js,
                   halo.js), run in this process.
   What is not:    everything those would reach. The policy store is an in-memory stand-in for the three policy RPCs
                   (it follows the applied SQL's documented answers; it is not the SQL). The session is a fixture
                   token. Every other API and Supabase call gets an empty synthetic answer. The feed answers under
                   /v1/world/layers/* are FIXTURES (scripts/e2e/fixtures/halo-feeds/*.json): fixture counts are not
                   live counts.
   How:            text files are served with the two production origins rewritten to this server, so the page never
                   sends the fixture token (or anything else) to api.mccluster.org or to Supabase.

   Run:   node scripts/e2e/halo-private-preview.mjs            (http://127.0.0.1:4173/__preview)
   Then open one of the links on that page. Each link picks who you are and what the backend looks like:
     as=owner|member|guest
     store=production   the policy store knows three units, not halo (what production is today)
           registered   the staged halo SQL applied, unit not installed
           disabled | enabled | draining
           down         the policy store does not answer
     halo=ok|down|absent   the /v1/eup/halo section answers, is unavailable (503), or is not deployed (404)
     feeds=ok|stale|denied|down|malformed|empty|filtered   what every Halo feed route answers (see FEED_MODES)
     webgl=on|off   off makes every canvas refuse a WebGL context in served pages (one injected line, preview only),
                    which is how the Cesium viewer fails to start: the no-map path
   Nothing here is a release step. It binds 127.0.0.1 and refuses any other host header. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleEup } from '../../workers/mccluster/src/eup/router.js';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PORT = Number(process.env.HALO_PREVIEW_PORT || 4173);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = `${ORIGIN}/__api`, SUPA = `${ORIGIN}/__supa`;
const OWNER = '11111111-1111-4111-8111-111111111111', MEMBER = '22222222-2222-4222-8222-222222222222', ORG = '11111111-1111-4111-8111-222222222222';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const TEXT = new Set(['.js', '.mjs', '.html', '.css', '.json']);
const FEED_IDS = ['weather', 'natural', 'military', 'vessels', 'quakes', 'fires', 'perimeters', 'cyclones', 'tides'];
export const FEED_MODES = ['ok', 'stale', 'denied', 'down', 'malformed', 'empty', 'filtered'];

/* the scenario, changed only by /__preview links */
const scene = { store: 'production', halo: 'ok', feeds: 'ok', webgl: 'on' };
const policy = { rows: {}, commands: [] };
function resetStore(mode) {
  policy.rows = {}; policy.commands = [];
  const at = '2026-11-23T12:00:00.000Z';
  if (mode === 'disabled') policy.rows.halo = { state: 'disabled', revision: 0, updated_at: at };
  if (mode === 'enabled') policy.rows.halo = { state: 'enabled', revision: 1, updated_at: at };
  if (mode === 'draining') policy.rows.halo = { state: 'draining', revision: 2, updated_at: at };
}
const knownUnits = () => (scene.store === 'production' ? ['environment', 'league', 'intake'] : ['environment', 'league', 'intake', 'halo']);

/* ---------- the policy store stand-in: the three RPCs modules.js calls, nothing else ---------- */
const pg = (code, message, status = 400) => Response.json({ code, message, details: null, hint: null }, { status });
const policyJson = (moduleId, row) => ({ schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId, state: row.state, revision: row.revision });
function storeRpc(name, a) {
  if (scene.store === 'down') return pg('XX000', 'synthetic outage', 500);
  const units = knownUnits();
  if (name === 'eup_module_control_read') {
    if (a.p_actor !== OWNER) return pg('42501', 'House owner required', 403);
    return Response.json({ installationId: 'mccluster', commands: policy.commands.slice(0, a.p_limit || 50), modules: units.map((id) => {
      const r = policy.rows[id], last = policy.commands.find((c) => c.module_id === id) || null;
      return { moduleId: id, installed: !!r, state: r ? r.state : null, revision: r ? r.revision : null, updated_at: r ? r.updated_at : null, updated_by: r ? OWNER : null, last_command: last && { seq: last.seq, command: last.command, requested_state: last.requested_state, expected_revision: last.expected_revision, reason: last.reason, actor: last.actor, created_at: last.created_at, idempotency_key: last.idempotency_key, receipt: last.receipt } };
    }) });
  }
  if (name !== 'eup_module_policy_install' && name !== 'eup_module_policy_command') return pg('PGRST202', 'not in this stand-in', 404);
  if (a.p_actor !== OWNER) return pg('42501', 'House owner required', 403);
  if (!units.includes(a.p_module)) return pg('22023', 'invalid_policy_command');
  const prior = policy.commands.find((c) => c.idempotency_key === a.p_key);
  if (prior) return Response.json(prior.receipt);
  const at = new Date().toISOString(), row = policy.rows[a.p_module];
  let receipt, before = null;
  if (name === 'eup_module_policy_install') {
    if (row) return pg('EUM07', 'module_already_installed');
    policy.rows[a.p_module] = { state: 'disabled', revision: 0, updated_at: at };
    receipt = { policy: policyJson(a.p_module, policy.rows[a.p_module]), changed: true, prior: null, recorded_at: at };
  } else {
    if (!row) return pg('EUM01', 'module_not_installed');
    if (row.revision !== a.p_expected_revision) return pg('40001', 'revision_conflict');
    if (row.state === 'enabled' && a.p_state === 'disabled') return pg('EUM05', 'drain_required');
    before = { state: row.state, revision: row.revision };
    const changed = row.state !== a.p_state;
    if (changed) { row.state = a.p_state; row.revision += 1; row.updated_at = at; }
    receipt = { policy: policyJson(a.p_module, row), changed, prior: before, recorded_at: at };
  }
  policy.commands.unshift({ seq: policy.commands.length + 1, module_id: a.p_module, command: name === 'eup_module_policy_install' ? 'install' : 'set_state', requested_state: name === 'eup_module_policy_install' ? 'disabled' : a.p_state, expected_revision: name === 'eup_module_policy_install' ? null : a.p_expected_revision, reason: a.p_reason, actor: OWNER, prior_state: before && before.state, prior_revision: before && before.revision, idempotency_key: a.p_key, receipt, created_at: at });
  return Response.json(receipt);
}
const storeFetch = async (url, options = {}) => {
  const name = String(url).split('/rpc/')[1];
  if (!name) return pg('PGRST202', 'not in this stand-in', 404);
  return storeRpc(name, options.body ? JSON.parse(options.body) : {});
};

/* ---------- who is asking: the fixture token's subject, nothing else ---------- */
function subjectOf(request) {
  const m = /^bearer\s+x\.([A-Za-z0-9+/=_-]+)\.y$/i.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')).sub || null; } catch { return null; }
}
async function requireHouseOwner(request) {
  const sub = subjectOf(request);
  if (!sub) throw Object.assign(new Error('Authentication required'), { status: 401 });
  if (sub !== OWNER) throw Object.assign(new Error('McCluster house owner access required'), { status: 403 });
  return { id: OWNER };
}

/* ---------- the feed fixtures ---------- */
async function feedAnswer(id) {
  const who = scene.feeds;
  if (who === 'denied') return Response.json({ ok: false, error: 'Owner only' }, { status: 403 });
  if (who === 'down') return Response.json({ ok: false, error: 'synthetic outage' }, { status: 503 });
  if (who === 'malformed') return Response.json({ ok: true, layer: id, fetched_at: 'yesterday', rows: 'not the documented envelope' });
  const body = JSON.parse(await readFile(join(ROOT, 'scripts/e2e/fixtures/halo-feeds', id + '.json'), 'utf8')).answer;
  /* so the preview reads as a recent answer: the envelope's three clocks are moved to just before now, each by a
     different amount (the rows keep the fixture's own times). In 'stale' the kept answer is three hours old. */
  const back = (s) => new Date(Date.now() - s * 1000).toISOString();
  body.fetched_at = back(who === 'stale' ? 10800 : 20);
  if (body.observed_at) body.observed_at = back(who === 'stale' ? 10890 : 110);
  if (body.last_message_at) body.last_message_at = back(who === 'stale' ? 10845 : 65);
  if (who === 'empty') { const key = Object.keys(body).find((k) => Array.isArray(body[k])); return Response.json({ ...body, count: 0, [key]: [] }); }
  if (who === 'stale') return Response.json({ ...body, stale: true, upstream_error: 'upstream_timeout' });
  if (who === 'filtered') { const key = Object.keys(body).find((k) => Array.isArray(body[k])); return Response.json({ ...body, [key]: body[key].map((r) => (Array.isArray(r) ? r.map((v, i) => (i < 4 && typeof v === 'number' ? 999 : v)) : { ...r, lon: 999, lat: 999, rings: [], id: 7 })) }); }
  return Response.json(body);
}

async function api(request, url) {
  const p = url.pathname.replace(/^\/__api/, '');
  if (p === '/v1/eup' || p.startsWith('/v1/eup/')) {
    if (p === '/v1/eup/halo' && subjectOf(request) === OWNER) {
      if (scene.halo === 'down') return Response.json({ ok: false, error: 'Unavailable', reason: 'unavailable' }, { status: 503 });
      if (scene.halo === 'absent') return Response.json({ ok: false, error: 'Unknown E=Up section', reason: 'unknown_section' }, { status: 404 });
    }
    const inner = new Request('https://api.mccluster.org' + p + url.search, { method: request.method, headers: request.headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer() });
    return handleEup(inner, { SUPABASE_URL: 'https://store.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' }, { requireHouseOwner, fetchImpl: storeFetch });
  }
  const sub = subjectOf(request);
  /* the shape js/action-globe.js requires before it will mount Halo (isOwner): the owner word comes only from here */
  if (p === '/v1/world/access') return Response.json({ ok: true, release: { version: 'globe-admin-preview/v1', admin_preview: sub === OWNER }, locked_layers: [], unlocked_layers: sub === OWNER ? [...FEED_IDS] : [] });
  const layer = /^\/v1\/world\/layers\/([a-z]+)$/.exec(p);
  if (layer && FEED_IDS.includes(layer[1])) {
    if (sub !== OWNER) return Response.json({ ok: false, error: 'Owner only' }, { status: sub ? 403 : 401 });
    return feedAnswer(layer[1]);
  }
  if (p.startsWith('/v1/world/halo/') || p.startsWith('/v1/intel/')) {
    if (sub !== OWNER) return Response.json({ ok: false, error: 'Owner only' }, { status: sub ? 403 : 401 });
    return Response.json({ ok: true, missions: [], people: [], evidence: [], items: [], counts: {}, generated_at: new Date().toISOString() });
  }
  if (p === '/v1/status') return Response.json({ ok: true, operator: { email: 'owner@fixture.invalid' }, database: { reachable: true } });
  if (p === '/v1/workspaces/me') return sub === OWNER
    ? Response.json({ ok: true, profile: { id: OWNER }, default_org_id: ORG, workspaces: [{ org_id: ORG, slug: 'mccluster', kind: 'studio', role: 'owner', enabled: true, name: 'McCluster' }] })
    : Response.json({ ok: true, profile: sub ? { id: sub } : null, default_org_id: null, workspaces: [] });
  if (p === '/v1/mnet/bootstrap') return Response.json({ identity: { mccluster_id: 'fixture' }, profile: { display_name: 'Fixture account', avatar_url: '' } });
  return Response.json({ ok: true, threads: [], apps: [], events: [], jobs: [], tools: [], decisions: [], leads: [], total: 0 });
}

function previewPage() {
  const link = (label, q) => `<li><a href="/__preview/go?${q}">${label}</a></li>`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hitman's Halo private preview</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:0 auto;padding:1rem;overflow-wrap:anywhere}li{margin:.4rem 0}code{font-size:.9em}</style>
<h1>Hitman's Halo: private local preview</h1>
<p><strong>Synthetic data. Loopback only.</strong> The pages and the Worker's E=Up router are the checkout's own; the policy store, the session and every feed answer are fixtures. Nothing here reads or changes production, and fixture counts are not live counts.</p>
<h2>Admin: where the owner finds Halo</h2><ul>
${link('Owner, production as it is today (store has no halo unit): Admin › Modules', 'as=owner&store=production&to=control.html%23system:eup')}
${link('Owner: the direct Control entry', 'as=owner&store=production&to=control.html%23system:halo')}
${link('Owner, staged SQL applied, unit not installed (Install is offered)', 'as=owner&store=registered&to=control.html%23system:eup')}
${link('Owner, unit installed and disabled', 'as=owner&store=disabled&to=control.html%23system:eup')}
${link('Owner, unit enabled', 'as=owner&store=enabled&to=control.html%23system:eup')}
${link('Owner, policy store down', 'as=owner&store=down&to=control.html%23system:eup')}
${link('Owner, Halo module section unavailable (503)', 'as=owner&store=production&halo=down&to=control.html%23system:halo')}
${link('Owner, older Worker without the section (404)', 'as=owner&store=production&halo=absent&to=control.html%23system:eup')}
${link('Member (not the owner): refused', 'as=member&to=control.html%23system:halo')}
${link('Guest (signed out)', 'as=guest&to=control.html%23system:halo')}
</ul><h2>Halo feeds (fixtures)</h2><ul>
${FEED_MODES.map((m) => link('Owner, Halo with every feed ' + m, 'as=owner&feeds=' + m + '&to=action-globe.html%3Fexplore%3D1%26halo%3Dintel')).join('\n')}
${FEED_MODES.map((m) => link('Owner, NO MAP (WebGL refused), every feed ' + m, 'as=owner&webgl=off&feeds=' + m + '&to=action-globe.html%3Fexplore%3D1%26halo%3Dintel')).join('\n')}
${link('Guest on the Halo link: the plain public globe, no Halo', 'as=guest&to=action-globe.html%3Fexplore%3D1%26halo%3D1')}
${link('Member on the Halo link: no Halo', 'as=member&to=action-globe.html%3Fexplore%3D1%26halo%3D1')}
</ul><p>Scenario now: <code>${JSON.stringify(scene)}</code></p>`;
}
function goPage(q) {
  const as = q.get('as') || 'guest', to = q.get('to') || 'control.html';
  if (!/^[A-Za-z0-9_./-]+\.html([?#][A-Za-z0-9_=&:%.-]*)?$/.test(to)) return null;
  const sub = as === 'owner' ? OWNER : as === 'member' ? MEMBER : null;
  return `<!doctype html><meta charset="utf-8"><title>Preview</title><script>
try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
${sub ? `var exp = Math.floor(Date.now() / 1000) + 3600;
localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp: exp, sub: ${JSON.stringify(sub)}, email: 'fixture@fixture.invalid' })).replace(/=+$/, '') + '.y', refresh_token: 'fixture-only', expires_at: exp, user: { id: ${JSON.stringify(sub)}, email: 'fixture@fixture.invalid' } }));` : ''}
location.replace(${JSON.stringify('/' + to)});
</script>`;
}

async function staticFile(url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.replace(/^\//, ''));
  const file = resolve(ROOT, rel);
  if (!file.startsWith(ROOT + sep) || /(^|[\\/])\.(git|claude|env)/.test(rel) || rel === 'sw.js') return new Response('', { status: 404 });
  try {
    const ext = extname(file), bytes = await readFile(file);
    if (!TEXT.has(ext)) return new Response(bytes, { headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' } });
    let text = bytes.toString('utf8').split('https://api.mccluster.org').join(API).split('https://zmnhbrjyhxzhkxmhkexs.supabase.co').join(SUPA);
    /* PREVIEW ONLY: refuse WebGL so the viewer cannot start. Nothing like this exists in the shipped page. */
    if (ext === '.html' && scene.webgl === 'off') text = text.replace(/<head([^>]*)>/i, (m) => m + '<script>(function(){var g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t){return /webgl/i.test(String(t))?null:g.apply(this,arguments)};})();</script>');
    return new Response(text, { headers: { 'content-type': (TYPES[ext] || 'text/plain') + '; charset=utf-8', 'cache-control': 'no-store' } });
  } catch { return new Response('', { status: 404 }); }
}

async function route(request) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (url.pathname === '/__preview') return new Response(previewPage(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  if (url.pathname === '/__preview/go') {
    for (const k of ['store', 'halo', 'feeds']) if (url.searchParams.get(k)) scene[k] = url.searchParams.get(k);
    scene.webgl = url.searchParams.get('webgl') === 'off' ? 'off' : 'on';
    if (url.searchParams.get('store')) resetStore(scene.store);
    const html = goPage(url.searchParams);
    return html ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }) : new Response('bad target', { status: 400 });
  }
  if (url.pathname.startsWith('/__api/')) return api(request, url);
  if (url.pathname.startsWith('/__supa/')) return url.pathname === '/__supa/auth/v1/user' && subjectOf(request) ? Response.json({ id: subjectOf(request), email: 'fixture@fixture.invalid' }) : Response.json([]);
  return staticFile(url);
}

export function start(port = PORT) {
  const server = createServer(async (req, res) => {
    try {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(421).end(); return; }
      const chunks = []; for await (const c of req) chunks.push(c);
      const request = new Request(ORIGIN + req.url, { method: req.method, headers: req.headers, body: chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined });
      const response = await route(request);
      const headers = Object.fromEntries(response.headers); delete headers['strict-transport-security']; delete headers['access-control-allow-origin'];
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500, { 'content-type': 'text/plain' }).end('preview error: ' + (error && error.message)); }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { start(); console.log(`Hitman's Halo private preview (synthetic, loopback only): ${ORIGIN}/__preview`); }
