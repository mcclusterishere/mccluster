/* WORLD NEWS PAIRING: headlines <-> items on the Halo map.

   Owner, 2026-11-03: "The headline about a satellite and other headlines about
   specific items, events or data that exists on the Hitman's Halo map should be
   considered as paired data and a lot of data needs pairing automatically.
   Can the box handle that too?"

   One job (job_type world_news_pairing, seeded every 15 minutes):
     1. read the Halo layers from Worker `mccluster` with a Core-signed GET
        (the Worker acts as the house owner for these read-only routes only);
     2. read the articles imported since the last finished job (cursor in that
        job's output), newest first, at most MAX_ARTICLES;
     3. pair them deterministically (../world/news-pairing.mjs): strong pairs
        are written as they are, weak ones go to the box's fast local model in
        batches of 12 for a yes/no, at most MODEL_CALLS calls a job;
     4. upsert into world_news_pairs (unique per article, layer, item; the
        first answer stands).

   Bounded: one job is a few seconds of matching plus at most MODEL_CALLS
   inferences (~70 s each on the box), at a priority below the PRIM3 news desk.
   A layer that does not answer is reported and skipped; when no layer answers
   the job fails and the cursor does not move. */
import { rest, resolveHouseOrgId } from '../supabase.mjs';
import { localAiChat } from '../compute/local-ai-client.mjs';
import { signCoreRequest } from '../broker-edge-auth.mjs';
import { DESK_MODEL } from './prim3-agent-news.mjs';
import {
  PAIR_LAYERS, CONFIRM_BATCH, CONFIRM_SCHEMA, CONFIRM_SYSTEM, STRONG,
  buildIndex, confirmPrompt, matchArticle, normText, normalizeLayer, pairRow, parseConfirmations,
} from '../world/news-pairing.mjs';

export const JOB_TYPE = 'world_news_pairing';
export const EXECUTOR = 'world_news_pairing:v1';
export const MAX_ARTICLES = 3000;
export const PAGE = 1000;
export const DEFAULT_MODEL_CALLS = 2;
export const MODEL_PRIORITY = -45; // below the PRIM3 news desk (-40)
export const PAIRING_MODEL = DESK_MODEL; // the box's fast model; the adapter falls back to the default
const FIRST_LOOKBACK_MS = 30 * 60_000;
const MAX_LOOKBACK_MS = 24 * 3_600_000;
const LAYER_TIMEOUT_MS = 25_000;
const UPSERT_CHUNK = 500;

export function edgeBase(env = process.env) {
  return String(env.MCCLUSTER_EDGE_URL || 'https://api.mccluster.org').replace(/\/+$/, '');
}

export function modelCalls(input, env = process.env) {
  const raw = input?.model_calls ?? env.WORLD_NEWS_PAIRING_MODEL_CALLS ?? DEFAULT_MODEL_CALLS;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.max(0, Math.min(8, n)) : DEFAULT_MODEL_CALLS;
}

/* One Halo layer through the Worker, signed as Core. Never throws: a layer
   that does not answer is a receipt, not a failed job. */
export async function fetchLayer(layer, { fetchImpl = globalThis.fetch, base = edgeBase(), secret = process.env.CORE_EDGE_SIGNING_KEY } = {}) {
  const path = `/v1/world/layers/${layer}`;
  if (!secret) return { layer, status: 'not_signed', entities: 0, body: null };
  try {
    const headers = { accept: 'application/json', ...signCoreRequest({ secret, method: 'GET', path, bodyBytes: Buffer.alloc(0) }) };
    const res = await fetchImpl(`${base}${path}`, { method: 'GET', headers, signal: AbortSignal.timeout(LAYER_TIMEOUT_MS) });
    if (!res.ok) return { layer, status: 'error', http_status: res.status, entities: 0, body: null };
    const body = await res.json();
    if (!body || typeof body !== 'object') return { layer, status: 'error', entities: 0, body: null };
    if (body.unavailable) return { layer, status: 'unavailable', reason: String(body.upstream_error || '').slice(0, 60) || null, entities: 0, body: null };
    return { layer, status: body.stale ? 'stale' : 'ok', fetched_at: body.fetched_at || null, entities: 0, body };
  } catch (error) {
    return { layer, status: 'error', reason: String(error?.name === 'TimeoutError' ? 'timeout' : error?.code || 'fetch_failed').slice(0, 60), entities: 0, body: null };
  }
}

async function lastCursor(query, orgId) {
  const { body = [] } = await query(`ops_agent_jobs?org_id=eq.${orgId}&job_type=eq.${JOB_TYPE}&status=eq.done&select=output&order=updated_at.desc&limit=1`);
  const cursor = body?.[0]?.output?.cursor;
  return cursor && Number.isFinite(Date.parse(cursor)) ? new Date(cursor).toISOString() : null;
}

async function readArticles(query, since) {
  const rows = [];
  for (let offset = 0; offset < MAX_ARTICLES; offset += PAGE) {
    const limit = Math.min(PAGE, MAX_ARTICLES - offset);
    const { body = [] } = await query(`media_news_articles?imported_at=gt.${encodeURIComponent(since)}&select=id,title,canonical_url,published_at,imported_at,headline_location_label,headline_latitude,headline_longitude,location_type,location_country_fips&order=imported_at.desc,id.desc&limit=${limit}&offset=${offset}`);
    const page = Array.isArray(body) ? body : [];
    rows.push(...page);
    if (page.length < limit) break;
  }
  return rows;
}

export async function worldNewsPairing(job, {
  query = rest, chat = localAiChat, resolveOrg = resolveHouseOrgId, fetchImpl = globalThis.fetch,
  env = process.env, now = new Date(),
} = {}) {
  const orgId = await resolveOrg();
  if (job?.org_id !== orgId) throw new Error('World news pairing job outside Core authority');
  const started = Date.now();
  const nowMs = now.getTime();

  // 1. The map, as the house owner sees it.
  const secret = env.CORE_EDGE_SIGNING_KEY;
  if (!secret) throw new Error('World news pairing: CORE_EDGE_SIGNING_KEY is not set, so the Worker cannot be read');
  const base = edgeBase(env);
  const fetched = await Promise.all(PAIR_LAYERS.map((layer) => fetchLayer(layer, { fetchImpl, base, secret })));
  const entities = [];
  for (const receipt of fetched) {
    if (!receipt.body) continue;
    const list = normalizeLayer(receipt.layer, receipt.body, { now: nowMs });
    receipt.entities = list.length;
    entities.push(...list);
  }
  const layers = fetched.map(({ body: _body, ...receipt }) => receipt);
  if (!fetched.some((r) => r.body)) throw new Error(`World news pairing: no Halo layer answered (${layers.map((l) => `${l.layer}:${l.status}${l.http_status ? `/${l.http_status}` : ''}`).join(', ')})`);
  const index = buildIndex(entities);

  // 2. The news since the last finished run.
  const previous = await lastCursor(query, orgId);
  const floor = new Date(nowMs - MAX_LOOKBACK_MS).toISOString();
  const since = previous ? (previous < floor ? floor : previous) : new Date(nowMs - FIRST_LOOKBACK_MS).toISOString();
  const articles = await readArticles(query, since);
  const cursor = articles.length ? new Date(Math.max(...articles.map((a) => Date.parse(a.imported_at) || 0))).toISOString() : since;

  // 3. Deterministic pairing.
  const strong = [];
  const weak = [];
  for (const article of articles) {
    for (const candidate of matchArticle(article, index)) {
      candidate.title = article.title;
      candidate.place = article.headline_location_label || null;
      (candidate.band === 'strong' ? strong : weak).push(candidate);
    }
  }

  // Weak candidates: one question per (headline text, item); syndicated copies share the answer.
  const groups = new Map();
  for (const c of weak) {
    const key = `${normText(c.title)}|${c.layer}|${c.entity.key}`;
    if (!groups.has(key)) groups.set(key, { lead: c, members: [] });
    groups.get(key).members.push(c);
  }
  const queue = [...groups.values()].sort((a, b) => b.lead.score - a.lead.score || b.members.length - a.members.length);
  const calls = modelCalls(job?.input, env);
  const confirmed = [];
  const model = { calls: 0, asked: 0, confirmed: 0, rejected: 0, unanswered: 0, unreviewed: 0, error: null, wall_ms: 0, model: null };
  for (let i = 0; i < calls && i * CONFIRM_BATCH < queue.length; i += 1) {
    const slice = queue.slice(i * CONFIRM_BATCH, (i + 1) * CONFIRM_BATCH);
    const batch = slice.map((g) => g.lead);
    const t0 = Date.now();
    let response;
    try {
      response = await chat({
        messages: [{ role: 'system', content: CONFIRM_SYSTEM }, { role: 'user', content: confirmPrompt(batch) }],
        schema: CONFIRM_SCHEMA, model: PAIRING_MODEL, think: false, temperature: 0, numPredict: 64 * batch.length + 60, priority: MODEL_PRIORITY,
        metadata: { job_type: JOB_TYPE, job_id: job.id },
      });
    } catch (error) {
      model.error = String(error?.message || 'local model failed').slice(0, 200);
      break;
    }
    model.calls += 1;
    model.asked += batch.length;
    model.wall_ms += Date.now() - t0;
    model.model = String(response?.model || PAIRING_MODEL).slice(0, 120); // the column holds 120
    const answers = parseConfirmations(response?.message?.content, batch);
    slice.forEach((group, k) => {
      const answer = answers.get(k + 1);
      if (!answer) { model.unanswered += 1; return; }
      if (!answer.same) { model.rejected += 1; return; }
      model.confirmed += 1;
      for (const c of group.members) confirmed.push({ candidate: c, why: answer.why });
    });
  }
  model.unreviewed = Math.max(0, queue.length - model.asked);

  // 4. Write. ignore-duplicates: the first answer for (article, layer, item) stands.
  const rows = [
    ...strong.map((c) => pairRow(c, { jobId: job.id })),
    ...confirmed.map(({ candidate, why }) => pairRow(candidate, { method: 'model', score: Math.max(candidate.score, STRONG), reason: `${candidate.reason}; local model: ${why || 'same item'}`, model: model.model, jobId: job.id })),
  ];
  let inserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { body = [] } = await query('world_news_pairs?on_conflict=article_id,layer,entity_key&select=id', {
      method: 'POST',
      headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(rows.slice(i, i + UPSERT_CHUNK)),
    });
    inserted += Array.isArray(body) ? body.length : 0;
  }

  const byLayer = {};
  for (const row of rows) byLayer[row.layer] = (byLayer[row.layer] || 0) + 1;
  return {
    executor: EXECUTOR,
    cursor_from: since,
    cursor,
    articles_read: articles.length,
    articles_capped: articles.length >= MAX_ARTICLES,
    entities: entities.length,
    layers,
    strong: strong.length,
    weak: weak.length,
    weak_questions: queue.length,
    model,
    pairs_sent: rows.length,
    pairs_new: inserted,
    by_layer: byLayer,
    wall_ms: Date.now() - started,
  };
}
