// The lyric machine on any node (owner, 2026-11-23: "the lyric machine shouldn't wait on OVH box ... Prioritize owned
// hardware"). Two halves, both pure enough to test:
//
//   node side  executeLyricsTask(): what a node's loopback executor does with one `lyrics.align` task: fetch the
//              master from the short-lived signed URL in the task (only from an allowed storage host, size-capped),
//              run the same pipeline Core runs (core/src/lyrics/pipeline.mjs: Demucs, faster-whisper, the sheet,
//              wav2vec2), and return the timed lyrics document. The node never holds a database or storage key.
//   Core side  offloadLyrics(): before the Core's own run, offer the work to a live owned node through the durable
//              compute queue, wait a bounded time, and return the node's validated document, or null to run locally.
//              A task a node already holds is never also run here: that is a retryable error, not a second run.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcribe as defaultTranscribe } from '../lyrics/pipeline.mjs';
import { validateLyrics } from '../lyrics/align.mjs';
import { parseTimedLyrics } from '../lyrics/import.mjs';

export const LYRICS_CAPABILITY = 'lyrics.align';
export const DEFAULT_AUDIO_HOSTS = ['zmnhbrjyhxzhkxmhkexs.supabase.co'];
const MAX_BYTES = 250 * 1024 * 1024;

function fail(message, code, status = 400, retryable = false) {
  return Object.assign(new Error(message), { code, status, retryable });
}

export function audioHosts(env = process.env) {
  const list = String(env.MCCLUSTER_LYRICS_AUDIO_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_AUDIO_HOSTS;
}

/* the one place a node accepts a master from: https, an allowed storage host, the signed object path */
export function acceptedAudioUrl(value, hosts = audioHosts()) {
  let u;
  try { u = new URL(String(value || '')); } catch { throw fail('audio_url is not a URL', 'LYRICS_AUDIO_URL_INVALID'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw fail('audio_url must be plain https', 'LYRICS_AUDIO_URL_INVALID');
  if (!hosts.includes(u.hostname.toLowerCase())) throw fail(`audio_url host ${u.hostname} is not an allowed storage host`, 'LYRICS_AUDIO_HOST_REFUSED', 403);
  if (!/^\/storage\/v1\/object\/sign\//.test(u.pathname) || !u.searchParams.get('token')) throw fail('audio_url must be a signed storage URL', 'LYRICS_AUDIO_URL_INVALID');
  return u;
}

/* the same rule the Core's executor uses (lyrics-align.mjs isTimedText/sheetInput): TTML or LRC is imported timing */
function isTimedText(t) {
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<tt[\s>]/.test(t) || /^[ \t]*(\[[a-z]+:[^\]\n]*\][ \t]*)*\[\d+:\d{1,2}(?:[.:]\d+)?\]/im.test(t);
}
export function sheetFor(text) {
  const t = String(text || '').trim().slice(0, 40000);
  if (!t) return { sheetText: '', imported: null };
  if (isTimedText(t)) { const parsed = parseTimedLyrics(t); if (parsed.lines.length) return { sheetText: '', imported: parsed }; }
  return { sheetText: t, imported: null };
}

async function fetchMaster(url, to, { fetchImpl = fetch, maxBytes = MAX_BYTES } = {}) {
  const res = await fetchImpl(url, { redirect: 'error' });
  if (!res.ok) throw fail(`master download refused: ${res.status}`, 'LYRICS_AUDIO_FETCH', 502, res.status >= 500);
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > maxBytes) throw fail('master is larger than the lyric machine accepts', 'LYRICS_AUDIO_TOO_LARGE', 413);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw fail('master is larger than the lyric machine accepts', 'LYRICS_AUDIO_TOO_LARGE', 413);
  await writeFile(to, buf);
  return buf.length;
}

/** node side: one task in, one validated lyrics document out */
export async function executeLyricsTask(input = {}, deps = {}) {
  const url = acceptedAudioUrl(input.audio_url, deps.hosts || audioHosts(deps.env));
  const ext = (String(input.audio_ext || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.audio'])[0];
  const dir = await mkdtemp(join(tmpdir(), 'mcc-lyrics-node-'));
  try {
    const audio = join(dir, 'master' + ext);
    await fetchMaster(url.href, audio, deps);
    const { sheetText, imported } = sheetFor(input.sheet_text);
    const { doc } = await (deps.transcribe || defaultTranscribe)({ audio, sheetText, imported, title: String(input.title || '').slice(0, 300), workDir: join(dir, 'work') });
    const problems = validateLyrics(doc);
    if (problems.length) throw fail(`the lyric machine made an invalid file: ${problems[0]}`, 'LYRICS_INVALID', 500, true);
    return { doc };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* ---------------- Core side ---------------- */

export function lyricsFabricConfig(env = process.env) {
  const mode = String(env.MCCLUSTER_LYRICS_FABRIC || 'prefer').trim().toLowerCase();
  const exclude = new Set(String(env.MCCLUSTER_LYRICS_FABRIC_EXCLUDE_NODES ?? 'ovh-primary').split(',').map((s) => s.trim()).filter(Boolean));
  if (env.MCCLUSTER_NODE_NAME) exclude.add(String(env.MCCLUSTER_NODE_NAME).trim());
  const wait = Number(env.MCCLUSTER_LYRICS_FABRIC_WAIT_MS);
  return {
    mode: mode === 'off' ? 'off' : 'prefer',
    exclude,
    waitMs: Number.isFinite(wait) ? Math.max(60_000, Math.min(3_600_000, wait)) : 1_800_000,
    signSeconds: 3600
  };
}

/* a signed, short-lived read URL for the master; the node gets this, never a key */
export async function signMaster({ bucket, path, seconds = 3600 }, { env = process.env, fetchImpl = fetch, headers }) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) throw fail('SUPABASE_URL is not configured', 'LYRICS_SIGN_UNAVAILABLE', 503, true);
  const res = await fetchImpl(`${base}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${String(path).split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: seconds })
  });
  const body = await res.json().catch(() => ({}));
  const signed = body.signedURL || body.signedUrl;
  if (!res.ok || !signed) throw fail(`could not sign the master (${res.status})`, 'LYRICS_SIGN_FAILED', 502, true);
  return `${base}/storage/v1${signed.startsWith('/') ? signed : '/' + signed}`;
}

/**
 * Offer the lyric machine's work to a live owned node. Returns {doc, node_id, task_id} when a node did it,
 * null when the Core should run it itself (no live node, or the task was taken back while still queued, or the node
 * failed). Throws a retryable LYRICS_NODE_STILL_RUNNING when a node holds the task past the wait: never a second run.
 */
export async function offloadLyrics({ job, track, sheetText }, deps) {
  const config = deps.config || lyricsFabricConfig(deps.env);
  if (config.mode === 'off') return null;
  const orgId = job?.org_id;
  if (!orgId) return null;
  let live = [];
  try { live = await deps.live({ orgId }); } catch { return null; }
  const nodes = live.filter((item) => item.capability === LYRICS_CAPABILITY && !config.exclude.has(item.node_name));
  if (!nodes.length) return null;
  const audioUrl = await deps.sign({ bucket: track.master_bucket, path: track.master_path, seconds: config.signSeconds });
  const ext = (String(track.master_path).toLowerCase().match(/\.[a-z0-9]{1,5}$/) || [''])[0];
  const { task } = await deps.enqueue({
    orgId, capability: LYRICS_CAPABILITY, implementation: null,
    input: { audio_url: audioUrl, audio_ext: ext, sheet_text: String(sheetText || '').slice(0, 40000), title: String(track.title || '').slice(0, 300) },
    requirements: {}, priority: 10, maxAttempts: 2,
    metadata: { source: 'lyrics_align', track_id: track.id, job_id: job.id || null },
    idempotencyKey: `lyrics-align:${job.id || track.id}:${Number(job.attempts || 1)}`
  });
  if (!task?.id) return null;
  deps.log?.({ event: 'lyrics_offloaded', task_id: task.id, track_id: track.id, nodes: nodes.map((n) => n.node_name) });
  try {
    const { task: done } = await deps.wait({ orgId, taskId: task.id, deadlineMs: config.waitMs, pollMs: 5000 });
    const doc = done?.output?.doc;
    if (!doc || validateLyrics(doc).length) { deps.log?.({ event: 'lyrics_offload_invalid', task_id: task.id }); return null; }
    return { doc, task_id: task.id, node_id: done.locked_by_node_id || null };
  } catch (error) {
    // past the wait and not taken back while queued: a node may hold it, so this run must not also do it
    if (error.code === 'COMPUTE_TASK_TIMEOUT' && !error.canceled) {
      throw Object.assign(new Error(`a node is still running the lyric machine for "${track.title}"; this job retries later`), { code: 'LYRICS_NODE_STILL_RUNNING', retryable: true });
    }
    deps.log?.({ event: 'lyrics_offload_fell_back', task_id: task.id, code: error.code || null });
    return null;
  }
}
