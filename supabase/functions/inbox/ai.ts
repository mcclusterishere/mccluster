// AI — the half of the brain that has to talk to somebody.
//
// Everything here is a wrapper around one of three outside things:
// Anthropic (answers), Voyage (embeddings), and PostgREST (the knowledge
// base and the ledger). The decisions are all next door in brain.ts; what
// is left here is retries, chain-walking, and writing down what it cost.
//
// SECRETS — set in the function's environment, never in the repo:
//   ANTHROPIC_API_KEY   without it, every call here refuses and the flows
//                       carry on as they did before. The bot gets dumber,
//                       not broken.
//   VOYAGE_API_KEY      optional. Without it the knowledge base still
//                       works on keyword search alone; kb_search is built
//                       to take a null embedding and fall back to it.
//   AI_DAY_BUDGET_USD   default 2.00. Past it, replies hand off instead
//                       of spending.

// Type-only, so it is erased at build time and never fetched: the module
// itself is loaded lazily below.
import type Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import {
  ANSWER_SCHEMA, FACTS_SCHEMA, TRIAGE_SCHEMA, assignArm, buildGrounding, choosePattern,
  chunkDocument, costMicros, gate, handle, mayRunUnattended, pickModel, safeFacts,
  type Answer, type Arm, type Experiment, type Fact, type Gate, type Handling,
  type Pattern, type Persona, type Retrieved, type Task, type Triage, type Usage,
} from "./brain.ts";
import { invoke, requestApproval, toolsFor, type LiveTool, type Server } from "./mcp.ts";

/** PostgREST, injected. ai.ts never reads the service key itself — the one
 *  place that holds it stays the one place that holds it. */
export type Db = (path: string, init?: RequestInit) => Promise<any>;

const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const VOYAGE = Deno.env.get("VOYAGE_API_KEY") ?? "";
const EMBED_MODEL = Deno.env.get("EMBED_MODEL") ?? "voyage-4";
const EMBED_DIMS = 1024;   // must match kb_chunks.embedding vector(1024)
const DAY_BUDGET_MICROS = Math.round(
  (Number(Deno.env.get("AI_DAY_BUDGET_USD")) || 2) * 1e6,
);

export const aiEnabled = () => KEY.length > 0;
export const embedEnabled = () => VOYAGE.length > 0;

/** The SDK is imported on first use rather than at module load.
 *
 *  Two reasons, and the second is the one that bites. A deployment with no
 *  ANTHROPIC_API_KEY never pulls the package at all — the bot falls back
 *  to flow rules and costs nothing to start. And the auth tests drive this
 *  whole function under Node with a stubbed fetch; Node cannot resolve an
 *  `npm:` specifier, so a top-level import here would take the refusal
 *  tests down with it, which is exactly the sort of coverage you do not
 *  want to lose by accident. */
type SDK = typeof import("npm:@anthropic-ai/sdk@0.120.0");
let _sdk: SDK | null = null;
let _client: Anthropic | null = null;

async function sdk(): Promise<{ mod: SDK; client: Anthropic } | null> {
  if (!KEY) return null;
  if (!_sdk) _sdk = await import("npm:@anthropic-ai/sdk@0.120.0");
  if (!_client) _client = new _sdk.default({ apiKey: KEY });
  return { mod: _sdk, client: _client };
}

// ============================================================
// PRICES
// ============================================================

let priceCache: { at: number; rows: Map<string, { input_per_mtok: number; output_per_mtok: number }> } | null = null;

async function prices(db: Db) {
  // five minutes: long enough that a busy hour is one query, short enough
  // that changing a price in the table takes effect the same shift
  if (priceCache && Date.now() - priceCache.at < 5 * 60_000) return priceCache.rows;
  const rows = await db("ai_model_prices?select=model,input_per_mtok,output_per_mtok").catch(() => []);
  const m = new Map<string, { input_per_mtok: number; output_per_mtok: number }>();
  for (const r of rows ?? []) {
    m.set(r.model, { input_per_mtok: Number(r.input_per_mtok), output_per_mtok: Number(r.output_per_mtok) });
  }
  priceCache = { at: Date.now(), rows: m };
  return m;
}

/** What the day has cost so far. An unknown model prices at zero rather
 *  than throwing: a missing price row must not stop the bot answering,
 *  it must show up as an obviously wrong number in the ledger. */
export async function spentTodayMicros(db: Db, orgId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = await db(`ai_calls?org_id=eq.${orgId}&at=gte.${since}&select=cost_micros`).catch(() => []);
  return (rows ?? []).reduce((n: number, r: { cost_micros: number }) => n + Number(r.cost_micros || 0), 0);
}

/** One tenant's daily ceiling.
 *
 *  From their own settings, falling back to the platform default. A
 *  single env var was right while there was one customer and becomes
 *  actively wrong with two: one of them would be spending the other's
 *  budget, and the one who ran out first would be whoever wrote in first
 *  that morning. */
export async function budgetMicros(db: Db, orgId: string): Promise<number> {
  const [o] = await db(`orgs?id=eq.${orgId}&select=settings&limit=1`).catch(() => []);
  const own = Number(o?.settings?.ai_day_budget_usd);
  if (Number.isFinite(own) && own >= 0) return Math.round(own * 1e6);
  return DAY_BUDGET_MICROS;
}

// ============================================================
// THE CALL
// ============================================================

export type CallResult<T> =
  | { ok: true; data: T; model: string; cost_micros: number; call_id: string | null; degraded: boolean }
  | { ok: false; reason: string };

/** Walk the chain until one model answers. Every attempt is recorded,
 *  successful or not — a chain that fell through to the cheap model is
 *  something you want to find out from the ledger, not from the tone of
 *  the replies. */
export async function callModel<T>(db: Db, opts: {
  orgId: string;
  task: Task;
  purpose: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  convId?: string | null;
  citations?: unknown[];
  only?: string;
  /** skip the budget check — for a staff member pressing a button */
  ignoreBudget?: boolean;
  /** which experiment and arm this call belongs to, if any */
  experiment?: string | null;
  arm?: string | null;
  /** the arm may pin a model or change the effort */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}): Promise<CallResult<T>> {
  const a = await sdk();
  if (!a) return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };

  const spent = opts.ignoreBudget ? 0 : await spentTodayMicros(db, opts.orgId);
  const routed = pickModel(opts.task, {
    spentMicros: spent,
    budgetMicros: opts.ignoreBudget ? 0 : await budgetMicros(db, opts.orgId),
    only: opts.only,
  });
  if (!routed.ok) return { ok: false, reason: routed.reason };

  const priceBook = await prices(db);
  let lastErr = "no model attempted";

  for (const model of routed.chain) {
    const t0 = Date.now();
    try {
      const res = await a.client.messages.create({
        model,
        max_tokens: routed.max_tokens,
        output_config: {
          effort: opts.effort ?? routed.effort,
          format: { type: "json_schema", schema: opts.schema },
        },
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: opts.user }],
      } as Anthropic.MessageCreateParamsNonStreaming);

      const price = priceBook.get(model) ?? { input_per_mtok: 0, output_per_mtok: 0 };
      const cost = costMicros(res.usage ?? {}, price);

      if (res.stop_reason === "refusal") {
        await record(db, { ...opts, model, usage: res.usage, cost, ms: Date.now() - t0, ok: false, error: "refusal" });
        return { ok: false, reason: "the model refused this one" };
      }

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text).join("");

      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        // json_schema is enforced server-side, so this is close to
        // impossible — but "close to" is why it is checked and not assumed
        await record(db, { ...opts, model, usage: res.usage, cost, ms: Date.now() - t0, ok: false, error: "unparseable json" });
        lastErr = "the model returned something that was not JSON";
        continue;
      }

      const id = await record(db, { ...opts, model, usage: res.usage, cost, ms: Date.now() - t0, ok: true });
      return { ok: true, data, model, cost_micros: cost, call_id: id, degraded: routed.degraded };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 400);
      lastErr = msg;
      await record(db, { ...opts, model, usage: {}, cost: 0, ms: Date.now() - t0, ok: false, error: msg });
      // a bad request is our bug and the next model will make it too;
      // only availability problems are worth walking the chain for
      if (e instanceof a.mod.default.BadRequestError) break;
      if (e instanceof a.mod.default.AuthenticationError) break;
    }
  }
  return { ok: false, reason: lastErr };
}

async function record(db: Db, o: {
  orgId: string;
  purpose: string; convId?: string | null; citations?: unknown[]; model: string;
  experiment?: string | null; arm?: string | null;
  usage: Usage | undefined;
  cost: number; ms: number; ok: boolean; error?: string;
}): Promise<string | null> {
  try {
    const row = await db("ai_calls", {
      method: "POST",
      body: JSON.stringify({
        org_id: o.orgId,
        conv_id: o.convId ?? null,
        purpose: o.purpose,
        model: o.model,
        input_tokens: o.usage?.input_tokens ?? 0,
        output_tokens: o.usage?.output_tokens ?? 0,
        cache_read_tokens: o.usage?.cache_read_input_tokens ?? 0,
        cache_write_tokens: o.usage?.cache_creation_input_tokens ?? 0,
        cost_micros: o.cost,
        experiment: o.experiment ?? null,
        arm: o.arm ?? null,
        latency_ms: o.ms,
        ok: o.ok,
        error: o.error ?? null,
        citations: o.citations ?? [],
      }),
    });
    return row?.[0]?.id ?? null;
  } catch {
    return null;               // the ledger failing must not fail the reply
  }
}

// ============================================================
// L2 — EMBEDDINGS AND RETRIEVAL
// ============================================================

/** Voyage, over raw HTTP: there is no official Deno SDK, and this is one
 *  POST. Returns null when there is no key, which every caller treats as
 *  "keyword search only" rather than as an error. */
export async function embed(
  db: Db, orgId: string, texts: string[], inputType: "query" | "document",
): Promise<number[][] | null> {
  if (!VOYAGE || !texts.length) return null;
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${VOYAGE}`, "content-type": "application/json" },
      body: JSON.stringify({
        input: texts,
        model: EMBED_MODEL,
        input_type: inputType,
        output_dimension: EMBED_DIMS,
      }),
    });
    if (!r.ok) throw new Error(`voyage ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const body = await r.json();
    const out: number[][] = (body.data ?? [])
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((d: { embedding: number[] }) => d.embedding);
    if (out.length !== texts.length || out.some((v) => v.length !== EMBED_DIMS)) {
      throw new Error(`voyage returned ${out.length} vectors of ${out[0]?.length} dims`);
    }
    const price = (await prices(db)).get(EMBED_MODEL);
    await record(db, {
      orgId, purpose: "embed", model: EMBED_MODEL, cost: price ? Math.round((body.usage?.total_tokens ?? 0) * price.input_per_mtok) : 0,
      usage: { input_tokens: body.usage?.total_tokens ?? 0 }, ms: Date.now() - t0, ok: true,
    });
    return out;
  } catch (e) {
    await record(db, {
      orgId, purpose: "embed", model: EMBED_MODEL, usage: {}, cost: 0,
      ms: Date.now() - t0, ok: false, error: String((e as Error)?.message ?? e).slice(0, 300),
    });
    return null;                 // degrade to keyword search, do not fail
  }
}

export type Hit = Retrieved & { chunk_id: string; score: number; fts_rank: number | null; vec_rank: number | null };

/** Hybrid retrieval. The vector half is optional on purpose: kb_search
 *  takes a null embedding and returns the keyword half alone, so the
 *  knowledge base is useful the moment documents are indexed, before any
 *  embedding key exists. */
export async function retrieve(db: Db, orgId: string, question: string, k = 6): Promise<Hit[]> {
  const vecs = await embed(db, orgId, [question], "query");
  const rows = await db("rpc/kb_search", {
    method: "POST",
    body: JSON.stringify({
      p_org: orgId,
      q: question,
      // pgvector's text input format is exactly a JSON array, so the
      // stringified vector casts straight across
      q_embedding: vecs ? JSON.stringify(vecs[0]) : null,
      match_count: k,
    }),
  }).catch(() => []);
  return (rows ?? []).map((r: Record<string, unknown>) => ({
    chunk_id: String(r.chunk_id),
    title: String(r.title ?? ""),
    url: (r.url as string) ?? null,
    body: String(r.body ?? ""),
    score: Number(r.score ?? 0),
    fts_rank: r.fts_rank === null ? null : Number(r.fts_rank),
    vec_rank: r.vec_rank === null ? null : Number(r.vec_rank),
  }));
}

/** Put a document into the knowledge base: hash it, chunk it, embed the
 *  chunks, replace what was there.
 *
 *  Replace rather than diff, because the alternative is deciding whether
 *  chunk 4 of the new text "is" chunk 4 of the old, and getting that
 *  wrong leaves a stale answer in the index that nothing will ever
 *  correct. The content hash means an unchanged page costs nothing. */
export async function indexDocument(db: Db, orgId: string, doc: {
  kind: string; title: string; body: string; url?: string | null; source?: string;
}): Promise<{ indexed: boolean; chunks: number; embedded: boolean; reason?: string }> {
  const hash = await sha256(`${doc.title}\n${doc.body}`);
  const key = doc.url ? `url=eq.${encodeURIComponent(doc.url)}` : `title=eq.${encodeURIComponent(doc.title)}`;
  const existing = await db(`kb_documents?org_id=eq.${orgId}&kind=eq.${encodeURIComponent(doc.kind)}&${key}&select=id,content_hash`).catch(() => []);
  const prior = existing?.[0];

  if (prior && prior.content_hash === hash) {
    return { indexed: false, chunks: 0, embedded: false, reason: "unchanged" };
  }

  let docId: string;
  if (prior) {
    await db(`kb_documents?id=eq.${prior.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ title: doc.title, body: doc.body, content_hash: hash, updated_at: new Date().toISOString() }),
    });
    docId = prior.id;
    await db(`kb_chunks?document_id=eq.${docId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  } else {
    const row = await db("kb_documents", {
      method: "POST",
      body: JSON.stringify({
        org_id: orgId,
        kind: doc.kind, title: doc.title, body: doc.body, url: doc.url ?? null,
        source: doc.source ?? "site", content_hash: hash,
      }),
    });
    docId = row[0].id;
  }

  const chunks = chunkDocument(doc.title, doc.body);
  if (!chunks.length) return { indexed: true, chunks: 0, embedded: false, reason: "nothing to chunk" };

  // embed heading + body: the heading is what makes a bare answer
  // findable, and it is what the human asking would have said
  const vecs = await embed(db, orgId, chunks.map((c) => `${c.heading}\n\n${c.body}`), "document");

  await db("kb_chunks", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify(chunks.map((c, i) => ({
      document_id: docId,
      ordinal: c.ordinal,
      heading: c.heading,
      body: c.body,
      embedding: vecs ? JSON.stringify(vecs[i]) : null,
      embed_model: vecs ? EMBED_MODEL : null,
      tokens: Math.ceil((c.heading.length + c.body.length) / 4),
    }))),
  });

  return { indexed: true, chunks: chunks.length, embedded: !!vecs };
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================
// L3 — MEMORY
// ============================================================

export async function recallFacts(db: Db, contactId: string, limit = 12): Promise<Fact[]> {
  const rows = await db(
    `memory_facts?contact_id=eq.${contactId}&ended_at=is.null&select=id,key,value,confidence&order=last_seen.desc&limit=${limit}`,
  ).catch(() => []);
  return (rows ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), key: String(r.key), value: String(r.value), confidence: Number(r.confidence),
  }));
}

export async function recallShared(db: Db, orgId: string, limit = 20): Promise<{ key: string; value: string }[]> {
  const rows = await db(`memory_shared?org_id=eq.${orgId}&enabled=is.true&select=key,value&order=updated_at.desc&limit=${limit}`).catch(() => []);
  return rows ?? [];
}

/** Read a message for anything worth keeping, and write it down without
 *  destroying what it contradicts. Cheap model, low effort — this runs on
 *  every inbound message and is not where the money should go. */
export async function remember(db: Db, opts: {
  orgId: string; contactId: string; convId?: string | null; text: string; messageId?: string | null;
}): Promise<{ ops: number }> {
  if (!aiEnabled() || opts.text.trim().length < 12) return { ops: 0 };

  const res = await callModel<{ facts: Fact[] }>(db, {
    orgId: opts.orgId,
    task: "extract",
    purpose: "extract",
    convId: opts.convId,
    system: [
      "Pull out only durable facts about the person writing — things still true next month.",
      "Keys are snake_case and stable: name, city, company, project, budget_range, timeline, prefers.",
      "Skip pleasantries, skip the question they are asking, skip anything about you.",
      "Never record a password, a card number, a government ID, or a date of birth.",
      "Nothing durable in the message means an empty list. An empty list is the common answer.",
    ].join("\n"),
    user: opts.text.slice(0, 4000),
    schema: FACTS_SCHEMA as unknown as Record<string, unknown>,
  });
  if (!res.ok) return { ops: 0 };

  const extracted = safeFacts(res.data.facts ?? []);
  let written = 0;

  // One RPC per fact. memory_note() does the read, the comparison and the
  // write under a row lock, so two messages arriving together cannot both
  // decide they are the replacement — which is exactly what happens when
  // somebody sends three lines in three seconds.
  for (const f of extracted) {
    const ok = await db("rpc/memory_note", {
      method: "POST",
      body: JSON.stringify({
        p_contact: opts.contactId,
        p_key: f.key,
        p_value: f.value,
        p_confidence: f.confidence ?? 0.6,
        p_source: opts.messageId ?? null,
      }),
    }).then(() => true).catch(() => false);
    if (ok) written++;
  }
  return { ops: written };
}

// ============================================================
// TRIAGE
// ============================================================

/** Read the message before paying to answer it.
 *
 *  On the cheap model at the lowest effort, because the question it
 *  answers — "is this a question, a compliment, a link farm or somebody
 *  being vile" — is not one that needs a big model. When it cannot run
 *  at all, handle() falls through to answering normally, which has its
 *  own gate: triage is a filter, never the only thing between a stranger
 *  and a reply. */
export async function triage(db: Db, opts: {
  orgId: string; text: string; convId?: string | null; kind: "dm" | "comment";
}): Promise<{ handling: Handling; triage: Triage | null; cost_micros: number }> {
  if (!aiEnabled()) {
    return { handling: handle(null, { kind: opts.kind }), triage: null, cost_micros: 0 };
  }
  const res = await callModel<Triage>(db, {
    orgId: opts.orgId,
    task: "route",
    purpose: "route",
    convId: opts.convId,
    system: [
      "Sort one inbound message into exactly one bucket. You are not replying to it.",
      "abuse covers threats, slurs and harassment — including when it is aimed at the business rather than a person.",
      "spam covers bulk promotion, SEO offers, crypto, and anything whose point is the link in it.",
      "lead means they want to hire, buy, book or get a quote. A question about price is a lead, not support.",
      "praise means kind words with nothing asked. If they say something kind AND ask something, it is support.",
      "Record an email address or a name ONLY if they wrote one. Never infer either.",
    ].join("\n"),
    user: opts.text.slice(0, 4000),
    schema: TRIAGE_SCHEMA as unknown as Record<string, unknown>,
  });

  if (!res.ok) {
    return { handling: handle(null, { kind: opts.kind }), triage: null, cost_micros: 0 };
  }
  return {
    handling: handle(res.data, { kind: opts.kind }),
    triage: res.data,
    cost_micros: res.cost_micros,
  };
}

// ============================================================
// TOOLS
//
// Only reached on an org that has some. Everywhere else this code does
// not run and the answer costs exactly what it did before.
// ============================================================

/** The live experiment for one dimension, and which arm this person is in.
 *
 *  One experiment per dimension at a time, deliberately. Two experiments
 *  both changing the voice would produce four voices and a scoreboard
 *  that cannot attribute any of them. */
export async function armFor(db: Db, orgId: string, dimension: "voice" | "model" | "effort", contactId: string | null):
    Promise<{ experiment: string; arm: Arm } | null> {
  if (!contactId) return null;
  const [row] = await db(
    `ai_experiments?org_id=eq.${orgId}&dimension=eq.${dimension}&enabled=is.true&ended_at=is.null&select=key,dimension,arms&order=started_at.desc&limit=1`,
  ).catch(() => []);
  if (!row) return null;
  const arm = assignArm(row as Experiment, contactId);
  return arm ? { experiment: row.key, arm } : null;
}

/** The tool list as the Messages API wants it.
 *
 *  The risk is put in the DESCRIPTION, not just enforced afterwards. A
 *  model that knows "this unlocks a door and a person has to say yes" asks
 *  properly instead of trying and being refused, which is one fewer round
 *  trip and a much better sentence for whoever is reading. */
function toolSpecs(tools: LiveTool[], kind: "dm" | "comment") {
  return tools.map((t) => ({
    name: t.name,
    description: [
      t.description ?? t.title ?? t.name,
      mayRunUnattended(t, { kind })
        ? ""
        : t.risk === "read"
          ? "(A person has to approve this one before it runs.)"
          : `(This CHANGES something. A person has to approve it before it runs; say what you want to do and why.)`,
    ].filter(Boolean).join(" "),
    input_schema: (t.input_schema ?? { type: "object", properties: {} }) as Record<string, unknown>,
  }));
}

export type ToolRun = {
  text: string;
  hops: number;
  cost_micros: number;
  model: string;
  used: { tool: string; ok: boolean }[];
  awaiting: { tool: string; approval_id: string }[];
};

/** The agent loop, kept short on purpose.
 *
 *  maxHops is a ceiling, not a target: this runs inside an edge function
 *  answering somebody who is waiting, and a model that wants six round
 *  trips to a building's machine has misunderstood the question. When the
 *  ceiling is reached it answers with what it has rather than stopping
 *  dead — an incomplete answer beats a spinner. */
async function runWithTools(db: Db, opts: {
  orgId: string; convId?: string | null; kind: "dm" | "comment";
  system: string; user: string; maxHops: number;
  tools: LiveTool[]; servers: Map<string, Server>;
}): Promise<ToolRun | { error: string }> {
  const a = await sdk();
  if (!a) return { error: "ANTHROPIC_API_KEY is not set" };

  const spent = await spentTodayMicros(db, opts.orgId);
  const routed = pickModel("reply", { spentMicros: spent, budgetMicros: await budgetMicros(db, opts.orgId) });
  if (!routed.ok) return { error: routed.reason };

  const priceBook = await prices(db);
  const model = routed.chain[0];
  const specs = toolSpecs(opts.tools, opts.kind);
  const byName = new Map(opts.tools.map((t) => [t.name, t]));

  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: opts.user }];
  const used: { tool: string; ok: boolean }[] = [];
  const awaiting: { tool: string; approval_id: string }[] = [];
  let cost = 0;
  let hops = 0;
  let text = "";

  for (; hops <= opts.maxHops; hops++) {
    const t0 = Date.now();
    let res;
    try {
      res = await a.client.messages.create({
        model,
        max_tokens: routed.max_tokens,
        output_config: { effort: routed.effort },
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        tools: specs as never,
        messages: messages as never,
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (e) {
      return { error: String((e as Error)?.message ?? e).slice(0, 300) };
    }

    const price = priceBook.get(model) ?? { input_per_mtok: 0, output_per_mtok: 0 };
    const legCost = costMicros(res.usage ?? {}, price);
    cost += legCost;
    await record(db, { orgId: opts.orgId, purpose: "tools", convId: opts.convId, model,
                       usage: res.usage, cost: legCost, ms: Date.now() - t0, ok: true });

    text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text")
                      .map((b) => b.text).join("").trim();

    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!calls.length) break;                       // it is done talking to machines

    // The ceiling: hand back what it has rather than start another leg.
    if (hops >= opts.maxHops) {
      text = text || "I got part of the way and ran out of steps. Let me get a person.";
      break;
    }

    messages.push({ role: "assistant", content: res.content });
    const results: unknown[] = [];

    for (const c of calls) {
      const tool = byName.get(c.name);
      if (!tool) {
        results.push({ type: "tool_result", tool_use_id: c.id, is_error: true,
                       content: `there is no tool called ${c.name} here` });
        continue;
      }
      const server = opts.servers.get(tool.server_id);
      if (!server) {
        results.push({ type: "tool_result", tool_use_id: c.id, is_error: true,
                       content: "that tool's server is not connected" });
        continue;
      }

      // THE GATE ON DOING THINGS. Not a prompt instruction — a check.
      if (!mayRunUnattended(tool, { kind: opts.kind })) {
        const ap = await requestApproval(db, {
          orgId: opts.orgId, serverId: server.id, convId: opts.convId,
          tool: tool.name, args: (c.input ?? {}) as Record<string, unknown>,
          reason: text || `the model asked to run ${tool.name}`,
        });
        if (ap) awaiting.push({ tool: tool.name, approval_id: ap.id });
        results.push({ type: "tool_result", tool_use_id: c.id,
                       content: ap
                         ? `Not run. A person has been asked to approve it. Tell them plainly what you were about to do and that somebody is looking.`
                         : `Not run, and the request could not be filed. Say a person will follow up.` });
        continue;
      }

      const r = await invoke(db, {
        orgId: opts.orgId, tool, server, args: (c.input ?? {}) as Record<string, unknown>,
        convId: opts.convId, authority: "auto",
      });
      used.push({ tool: tool.name, ok: r.ok });
      results.push({ type: "tool_result", tool_use_id: c.id, is_error: !r.ok, content: r.text });
    }
    messages.push({ role: "user", content: results });
  }

  return { text, hops, cost_micros: cost, model, used, awaiting };
}

// ============================================================
// THE ANSWER
// ============================================================

export type Answered = {
  gate: Gate;
  model?: string;
  cost_micros?: number;
  hits: Hit[];
  degraded?: boolean;
  /** which shape of answer this question earned, and why */
  pattern?: Pattern;
  pattern_why?: string;
  tools_used?: { tool: string; ok: boolean }[];
  /** things a person now has to say yes or no to */
  awaiting?: { tool: string; approval_id: string }[];
  /** the ai_calls row this answer came from, so a thumbs-down at the desk
   *  lands on the exact call rather than on the conversation */
  call_id?: string | null;
};

const DEFAULT_VOICE = [
  "You answer messages for McCluster — a small studio that builds websites, and the home of the record I AM HERE.",
  "Write like a person who knows the answer and has other things to do: warm, short, no exclamation marks, no corporate throat-clearing.",
  "Never say 'as an AI'. If you cannot help, say who can.",
].join("\n");

/** Answer a question from the knowledge base, or refuse to.
 *
 *  Retrieval first, then one grounded call, then the gate. If any of the
 *  three does not come back clean the caller gets a handoff, which is a
 *  real answer: somebody at the desk sees the thread. */
export async function answerQuestion(db: Db, opts: {
  orgId: string;
  question: string;
  convId?: string | null;
  contactId?: string | null;
  channel: string;
  kind: "dm" | "comment";
  history?: { role: "user" | "assistant"; text: string }[];
  persona?: Persona;
  /** what triage made of it, so the router can charge more for money */
  triage?: Triage["kind"];
}): Promise<Answered> {
  if (!aiEnabled()) {
    return { gate: { send: false, reason: "no model configured", handoff: true }, hits: [] };
  }

  const hits = await retrieve(db, opts.orgId, opts.question, opts.kind === "comment" ? 4 : 6);
  const [facts, shared, org] = await Promise.all([
    opts.contactId ? recallFacts(db, opts.contactId) : Promise.resolve([]),
    recallShared(db, opts.orgId),
    db(`orgs?id=eq.${opts.orgId}&select=name,settings&limit=1`).catch(() => []),
  ]);

  // The voice belongs to the customer, not to the deployment. An env var
  // can only ever hold one, which is fine for one tenant and is how every
  // tenant after that ends up sounding like the first one.
  const own = org?.[0]?.settings?.voice;
  const baseVoice = (typeof own === "string" && own.trim()) ? own : (Deno.env.get("BOT_VOICE") ?? DEFAULT_VOICE);

  // Experiments, one per dimension. An arm that names no value changes
  // nothing but is still recorded — which is exactly what a control is.
  const [voiceArm, modelArm, effortArm] = await Promise.all([
    armFor(db, opts.orgId, "voice", opts.contactId ?? null),
    armFor(db, opts.orgId, "model", opts.contactId ?? null),
    armFor(db, opts.orgId, "effort", opts.contactId ?? null),
  ]);

  const persona = opts.persona
    ?? { voice: voiceArm?.arm.value?.trim() || baseVoice };
  const g = buildGrounding({
    question: opts.question,
    passages: hits,
    persona,
    facts: facts.map((f) => ({ key: f.key, value: f.value })),
    shared,
    history: opts.history,
    channel: opts.channel,
    kind: opts.kind,
  });

  // ---- how much machinery does this question deserve ----------------
  const { tools, servers } = await toolsFor(db, opts.orgId).catch(() => ({ tools: [], servers: new Map() }));
  const plan = choosePattern({
    toolCount: tools.length,
    passageCount: hits.length,
    kind: opts.kind,
    triage: opts.triage,
    spentMicros: await spentTodayMicros(db, opts.orgId),
    budgetMicros: await budgetMicros(db, opts.orgId),
  });

  if (plan.pattern === "tools") {
    const run = await runWithTools(db, {
      orgId: opts.orgId, convId: opts.convId, kind: opts.kind,
      system: g.system, user: g.user, maxHops: plan.maxHops,
      tools, servers,
    });
    if ("error" in run) {
      return { gate: { send: false, reason: run.error, handoff: true }, hits, pattern: plan.pattern, pattern_why: plan.why };
    }
    const worked = run.used.some((u) => u.ok);
    const answer: Answer = {
      answer: run.text,
      cites: [],
      // A tool that answered is the strongest source there is — it is a
      // recorded call against the customer's own machine. A tool that
      // failed, or one waiting on a person, is not.
      confidence: worked ? 0.9 : run.awaiting.length ? 0.8 : 0.55,
      handoff: false,
    };
    return {
      gate: gate(answer, {
        passageCount: hits.length, kind: opts.kind,
        toolsUsed: run.used.length + run.awaiting.length,
      }),
      model: run.model,
      cost_micros: run.cost_micros,
      hits,
      pattern: plan.pattern,
      pattern_why: plan.why,
      tools_used: run.used,
      awaiting: run.awaiting,
    };
  }

  // Which experiment gets the credit for this call. Only one may, or the
  // scoreboards overlap and neither means anything.
  const live = voiceArm ?? modelArm ?? effortArm;

  const res = await callModel<Answer>(db, {
    orgId: opts.orgId,
    task: "reply",
    purpose: "answer",
    convId: opts.convId,
    system: g.system,
    user: g.user,
    schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    citations: hits.map((h) => ({ chunk_id: h.chunk_id, title: h.title, score: h.score })),
    only: modelArm?.arm.value || undefined,
    effort: (effortArm?.arm.value as "low" | "medium" | "high" | "xhigh" | "max") || undefined,
    experiment: live?.experiment ?? null,
    arm: live?.arm.name ?? null,
  });

  if (!res.ok) {
    return { gate: { send: false, reason: res.reason, handoff: true }, hits, pattern: plan.pattern, pattern_why: plan.why };
  }

  let g2 = gate(res.data, { passageCount: hits.length, kind: opts.kind });

  // A second pass, bought only where being wrong is expensive: a public
  // comment nobody can unsend, or a quote about money. It reads the same
  // passages and answers one question — does this answer actually follow
  // from them — and a no becomes a handoff rather than a rewrite. A model
  // arguing itself into a better answer is a model arguing.
  if (plan.verify && g2.send) {
    const check = await callModel<{ holds: boolean; why: string }>(db, {
      orgId: opts.orgId, task: "route", purpose: "verify", convId: opts.convId,
      system: [
        "You are checking one drafted reply against the passages it was drawn from.",
        "holds is true only if every factual claim in the reply — every number, date, name and promise — appears in the passages.",
        "A reply that is merely reasonable, or true in general, does not hold. It has to be IN there.",
      ].join("\n"),
      user: `# Passages\n${hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.body}`).join("\n\n")}\n\n# The reply\n${g2.text}`,
      schema: {
        type: "object",
        properties: { holds: { type: "boolean" }, why: { type: "string" } },
        required: ["holds", "why"], additionalProperties: false,
      },
    });
    if (check.ok && !check.data.holds) {
      g2 = { send: false, reason: `the check found it does not follow from the passages: ${check.data.why}`, handoff: true };
    }
  }

  return {
    gate: g2,
    model: res.model,
    cost_micros: res.cost_micros,
    degraded: res.degraded,
    call_id: res.call_id,
    hits,
    pattern: plan.pattern,
    pattern_why: plan.why,
  };
}
