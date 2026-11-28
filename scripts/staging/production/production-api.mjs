#!/usr/bin/env node
// The production API of the isolated staging Core: the nine named
// core.production.* actions over loopback HTTP, for Creator Suite (and the
// proof script) to call. It runs the repository's own production service
// and stores (core/src/tools/production.mjs → service.mjs → store.mjs and
// core/src/compute/store.mjs) against the staging database through the
// PostgREST shim; serve.mjs starts it with this run's values only.
//
//   POST /v1/production/tools/<core.production.* name>   body: the tool's args
//   GET  /v1/production/jobs/<job id>                      core.production.job.get
//   POST /v1/production/jobs/<job id>/preview-ticket       a 10-minute ticket for the player
//   GET  /v1/production/jobs/<job id>/preview?ticket=…     the verified preview MP4 (Range)
//   GET  /health
//
// Every route except /health needs `Authorization: Bearer <owner token>`
// (the preview takes the ticket instead, so a <video> element can play it).
// The actor is the staging owner and org_id is always the staging org:
// neither comes from the caller. The preview is served only for a
// succeeded job, only from a production project root this node was given
// (PRODUCTION_MEDIA_ROOTS), and only when the file's sha256 is the one the
// worker reported. Loopback only; never production.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { callProductionTool, PRODUCTION_TOOLS } from '../../../core/src/tools/production.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PRODUCTION_API_PORT || 0);
const ORG = String(process.env.MCCLUSTER_ORG_ID || '');
const OWNER = String(process.env.PRODUCTION_OWNER_PROFILE_ID || '');
const TOKEN = String(process.env.PRODUCTION_OWNER_TOKEN || '');
const TICKET_KEY = crypto.randomBytes(32);
const MEDIA_ROOTS = JSON.parse(process.env.PRODUCTION_MEDIA_ROOTS || '[]').map((root) => fs.realpathSync(root));
const TOOL_NAMES = new Set(PRODUCTION_TOOLS.map((t) => t.name));
const BODY_LIMIT = 256 * 1024;
const verified = new Map();

if (!ORG || !OWNER || TOKEN.length < 32) { console.error(JSON.stringify({ event: 'production_api_config_error' })); process.exit(2); }

const actor = { user_id: OWNER, kind: 'owner', source: 'staging-production-api' };

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

function authorized(req) {
  const header = String(req.headers.authorization || '');
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return given.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN));
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) throw Object.assign(new Error('body too large'), { status: 413 }); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function ticketFor(jobId, ttlMs = 600_000) {
  const exp = Date.now() + ttlMs;
  const mac = crypto.createHmac('sha256', TICKET_KEY).update(`${jobId}.${exp}`).digest('base64url');
  return `${exp}.${mac}`;
}

function ticketOk(jobId, ticket) {
  const [exp, mac] = String(ticket || '').split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const want = crypto.createHmac('sha256', TICKET_KEY).update(`${jobId}.${exp}`).digest('base64url');
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}

function insideMediaRoots(file) {
  let real;
  try { real = fs.realpathSync(file); } catch { return null; }
  for (const root of MEDIA_ROOTS) {
    const rel = path.relative(root, real);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return real;
  }
  return null;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try { const buf = Buffer.allocUnsafe(1 << 20); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

async function previewFile(jobId) {
  const job = await callProductionTool('core.production.job.get', { org_id: ORG, job_id: jobId }, { actor, source: 'staging-production-api' });
  const preview = job?.job?.preview || job?.preview;
  if (!preview) return { error: 'no verified preview for this job', status: 404 };
  const real = insideMediaRoots(preview.path);
  if (!real) return { error: 'the preview is not under a production project root of this node', status: 403 };
  const key = `${real}:${preview.sha256}`;
  if (!verified.has(key)) {
    if (sha256(real) !== preview.sha256) return { error: 'the preview on disk is not the file the worker reported', status: 409 };
    verified.set(key, true);
  }
  return { file: real, bytes: fs.statSync(real).size };
}

function stream(req, res, file, bytes) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  const base = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : bytes - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : bytes - 1;
    start = Math.max(0, start); end = Math.min(bytes - 1, end);
    if (start > end) { res.writeHead(416, { 'content-range': `bytes */${bytes}` }); return res.end(); }
    res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${bytes}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'content-length': bytes });
  return fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'staging-production-api', org_id: ORG, tools: [...TOOL_NAMES] });
    const preview = url.pathname.match(/^\/v1\/production\/jobs\/([0-9a-f-]{36})\/preview$/i);
    if (req.method === 'GET' && preview) {
      if (!authorized(req) && !ticketOk(preview[1], url.searchParams.get('ticket'))) return send(res, 401, { error: 'owner token or preview ticket required' });
      const found = await previewFile(preview[1]);
      if (found.error) return send(res, found.status, { error: found.error });
      return stream(req, res, found.file, found.bytes);
    }
    if (!authorized(req)) return send(res, 401, { error: 'owner token required' });
    const ticket = url.pathname.match(/^\/v1\/production\/jobs\/([0-9a-f-]{36})\/preview-ticket$/i);
    if (req.method === 'POST' && ticket) {
      const found = await previewFile(ticket[1]);
      if (found.error) return send(res, found.status, { error: found.error });
      return send(res, 200, { url: `/v1/production/jobs/${ticket[1]}/preview?ticket=${encodeURIComponent(ticketFor(ticket[1]))}`, path: found.file, bytes: found.bytes, expires_in_s: 600 });
    }
    const jobRead = url.pathname.match(/^\/v1\/production\/jobs\/([0-9a-f-]{36})$/i);
    if (req.method === 'GET' && jobRead) return send(res, 200, await callProductionTool('core.production.job.get', { org_id: ORG, job_id: jobRead[1] }, { actor, source: 'staging-production-api' }));
    const tool = url.pathname.match(/^\/v1\/production\/tools\/(core\.production\.[a-z.]+)$/);
    if (req.method === 'POST' && tool) {
      if (!TOOL_NAMES.has(tool[1])) return send(res, 404, { error: `unknown tool ${tool[1]}` });
      if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'application/json required' });
      const args = await readBody(req);
      if (args.actor !== undefined) return send(res, 400, { error: 'actor comes from the staging owner, never from the arguments' });
      const client = String(req.headers['x-mccluster-client'] || 'unknown').replace(/[^A-Za-z0-9 ._/-]/g, '').slice(0, 60) || 'unknown';
      const result = await callProductionTool(tool[1], { ...args, org_id: ORG }, { actor, source: `staging:${client}` });
      return send(res, 200, result);
    }
    return send(res, 404, { error: 'not found' });
  } catch (error) {
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
    return send(res, status, { error: String(error.message).slice(0, 2000), code: error.code || null, errors: error.errors || undefined });
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: 'production_api_listening', url: `http://${HOST}:${server.address().port}` }));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
