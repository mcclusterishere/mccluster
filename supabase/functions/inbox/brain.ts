// THE BRAIN — every part of it that has no network in it.
//
// The rule this file exists to enforce: the decisions that cost money, or
// that decide whether a stranger gets a wrong answer in public, are made
// by pure functions that can be tested exhaustively on a laptop. What is
// left in ai.ts is the part that genuinely must talk to somebody.
//
// So: which model to call, what it costs, how a document is cut up, what
// the model is told, and whether its answer is allowed to be sent — all
// here. The fetch is elsewhere.

// ============================================================
// L4 — THE MODEL ROUTER
//
// One model for everything is either too expensive for tagging or too
// weak for answering. The router picks per task, with a fallback chain
// for when the first choice is down, and a daily budget that turns an
// overrun into a handoff instead of a bill.
// ============================================================

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type Task =
  /** a customer-facing answer. The expensive one, deliberately. */
  | "reply"
  /** which bucket is this message in? high volume, cheap, easy to check */
  | "route"
  /** pull durable facts out of a message so the bot remembers them */
  | "extract"
  /** condense a long thread for a human picking it up */
  | "summarize"
  /** put a staff member's rough draft into the house voice */
  | "rewrite";

export type Plan = {
  /** first choice, then what to try if it errors */
  chain: string[];
  max_tokens: number;
  effort: Effort;
};

/** The routing table. Chains go strong -> cheap, never the other way: a
 *  fallback exists because the first model was UNAVAILABLE, and answering
 *  a customer with a weaker model beats not answering at all. */
const ROUTES: Record<Task, Plan> = {
  reply:     { chain: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"], max_tokens: 1200, effort: "medium" },
  route:     { chain: ["claude-haiku-4-5", "claude-sonnet-5"],                  max_tokens: 200,  effort: "low" },
  extract:   { chain: ["claude-haiku-4-5", "claude-sonnet-5"],                  max_tokens: 600,  effort: "low" },
  summarize: { chain: ["claude-haiku-4-5", "claude-sonnet-5"],                  max_tokens: 800,  effort: "low" },
  rewrite:   { chain: ["claude-sonnet-5", "claude-haiku-4-5"],                  max_tokens: 900,  effort: "medium" },
};

export type Routed =
  | { ok: true; task: Task; chain: string[]; max_tokens: number; effort: Effort; degraded: boolean }
  | { ok: false; reason: string };

/** Pick a model for a task, given what the day has already cost.
 *
 *  The budget is not a suggestion. Past the soft line the chain collapses
 *  to its cheapest link and the effort drops; past the hard line nothing
 *  is called at all and the caller is expected to hand off to a person.
 *  A bot that goes quiet is recoverable; a bot that quietly spends is not. */
export function pickModel(
  task: Task,
  opts: { spentMicros?: number; budgetMicros?: number; only?: string } = {},
): Routed {
  const plan = ROUTES[task];
  if (!plan) return { ok: false, reason: `unknown task ${task}` };

  const budget = opts.budgetMicros ?? 0;
  const spent = opts.spentMicros ?? 0;

  if (budget > 0 && spent >= budget) {
    return { ok: false, reason: `daily AI budget spent (${(spent / 1e6).toFixed(2)} of ${(budget / 1e6).toFixed(2)} USD)` };
  }

  // a pin, for when a human at the desk wants one specific model
  if (opts.only) {
    return { ok: true, task, chain: [opts.only], max_tokens: plan.max_tokens, effort: plan.effort, degraded: false };
  }

  const degraded = budget > 0 && spent >= budget * 0.75;
  if (!degraded) {
    return { ok: true, task, chain: [...plan.chain], max_tokens: plan.max_tokens, effort: plan.effort, degraded: false };
  }

  const cheapest = plan.chain[plan.chain.length - 1];
  return {
    ok: true,
    task,
    chain: [cheapest],
    max_tokens: Math.min(plan.max_tokens, 600),
    effort: "low",
    degraded: true,
  };
}

// ============================================================
// WHAT IT COST
//
// ai_calls.cost_micros is an integer number of millionths of a dollar,
// because floating-point money is an argument waiting to happen.
// ============================================================

/** Nullable, not just optional: the API returns an explicit null for the
 *  cache fields on a call that used no cache, and `number | undefined`
 *  quietly rejects it. */
export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export type Price = { input_per_mtok: number; output_per_mtok: number };

/** Dollars-per-million-tokens times tokens IS micro-dollars, exactly:
 *      tokens/1e6 * price   dollars
 *    = tokens * price       micro-dollars
 *  so no scaling constant appears here and none can be got wrong.
 *
 *  Cache reads bill at a tenth of the input rate and cache writes at
 *  1.25x; both are counted separately from input_tokens by the API, so
 *  they are added, not substituted. */
export function costMicros(usage: Usage, price: Price): number {
  const inp = usage.input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const micros =
    inp * price.input_per_mtok +
    out * price.output_per_mtok +
    cr * price.input_per_mtok * 0.1 +
    cw * price.input_per_mtok * 1.25;
  return Math.round(micros);
}

// ============================================================
// L2 — CUTTING A DOCUMENT INTO CHUNKS
//
// Retrieval returns chunks, so the chunk is the unit that either answers
// the question or doesn't. Two rules, both learned the hard way:
//
//   1. A chunk carries its heading. A passage that says "yes, usually
//      within two weeks" is useless without the question above it, and
//      the embedding of it is worse than useless.
//   2. Chunks overlap. A sentence that straddles a boundary otherwise
//      belongs to neither chunk and is findable from neither.
// ============================================================

export type Chunk = { ordinal: number; heading: string; body: string };

const CHUNK_CHARS = 1400;
const OVERLAP_CHARS = 200;

/** Split on markdown headings first, then on size, then on paragraph
 *  breaks within that — a heading is a boundary the author already drew,
 *  and it is always better than one we invent. */
export function chunkDocument(title: string, body: string, opts: { max?: number; overlap?: number } = {}): Chunk[] {
  const max = opts.max ?? CHUNK_CHARS;
  const overlap = Math.min(opts.overlap ?? OVERLAP_CHARS, Math.floor(max / 2));
  const out: Chunk[] = [];

  // sections: [heading, text]. Text before the first heading belongs to
  // the document's own title.
  const sections: { heading: string; text: string }[] = [];
  let heading = title.trim();
  let buf: string[] = [];
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) {
      if (buf.join("\n").trim()) sections.push({ heading, text: buf.join("\n").trim() });
      // the section heading is prefixed with the document title so that a
      // chunk found by "clients" still knows which page it came off
      heading = title.trim() ? `${title.trim()} — ${m[2]}` : m[2];
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.join("\n").trim()) sections.push({ heading, text: buf.join("\n").trim() });
  if (!sections.length) return out;

  for (const s of sections) {
    for (const piece of splitToSize(s.text, max, overlap)) {
      out.push({ ordinal: out.length, heading: s.heading, body: piece });
    }
  }
  return out;
}

/** Greedy pack by paragraph, hard-split anything that alone exceeds max,
 *  then hand the tail of each piece to the next one as overlap. */
function splitToSize(text: string, max: number, overlap: number): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const packed: string[] = [];
  let cur = "";

  const flush = () => { if (cur.trim()) packed.push(cur.trim()); cur = ""; };

  for (const p of paras) {
    if (p.length > max) {
      flush();
      // one paragraph longer than a whole chunk: cut it on sentence ends
      // if there are any, and mid-word only as a last resort
      let rest = p;
      while (rest.length > max) {
        const window = rest.slice(0, max);
        const cutAt = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
        const at = cutAt > max * 0.5 ? cutAt + 1 : max;
        packed.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) cur = rest;
      continue;
    }
    if (cur && cur.length + 2 + p.length > max) flush();
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  flush();

  if (overlap <= 0 || packed.length < 2) return packed;
  return packed.map((piece, i) => {
    if (i === 0) return piece;
    const prev = packed[i - 1];
    const tail = prev.slice(Math.max(0, prev.length - overlap));
    // start the overlap at a word boundary so the embedding is not fed
    // half a word
    const clean = tail.replace(/^\S*\s/, "");
    return `${clean}\n\n${piece}`.trim();
  });
}

// ============================================================
// THE PROMPT
//
// Assembled deterministically. No timestamp, no uuid, no Set iteration
// order — anything varying in the prefix silently kills prompt caching,
// and the symptom is a bill rather than an error.
// ============================================================

export type Passage = { n: number; title: string; url: string | null; body: string };

export type Grounding = {
  system: string;
  user: string;
  passages: Passage[];
};

export type Retrieved = { title: string; url?: string | null; body: string };

export type Persona = {
  /** what the bot is, in the operator's words */
  voice: string;
  /** things it must never do, over and above the built-in rules */
  rules?: string[];
};

const HOUSE_RULES = [
  "Answer ONLY from the passages below and the notes about this person. They are the whole of what you know.",
  "If the passages do not answer the question, say so plainly and set handoff to true. Never guess at a price, a date, an availability, or a policy.",
  "Cite the passages you used by number in `cites`. Never cite a number that is not in the list.",
  "Never invent a discount, a promise, a deadline, or a partnership.",
  "Never repeat back or ask for a card number, a password, or a government ID.",
  "Two or three sentences unless the question genuinely needs more.",
];

/** Build the request. The system block is the stable prefix — persona and
 *  rules only — so it caches across every conversation; everything that
 *  changes with the message goes in the user turn. */
export function buildGrounding(opts: {
  question: string;
  passages: Retrieved[];
  persona: Persona;
  /** tier 3: what we remember about this person */
  facts?: { key: string; value: string }[];
  /** tier 4: what is true for everybody today (hours, current release) */
  shared?: { key: string; value: string }[];
  /** the last few turns, oldest first */
  history?: { role: "user" | "assistant"; text: string }[];
  channel?: string;
  kind?: "dm" | "comment";
}): Grounding {
  const passages: Passage[] = opts.passages.map((p, i) => ({
    n: i + 1,
    title: p.title,
    url: p.url ?? null,
    body: p.body,
  }));

  const system = [
    opts.persona.voice.trim(),
    "",
    ...HOUSE_RULES.map((r) => `- ${r}`),
    ...(opts.persona.rules ?? []).map((r) => `- ${r}`),
    "",
    opts.kind === "comment"
      ? "This is a PUBLIC comment. Anyone can read your reply. Keep it short and say nothing about this person you would not put on a billboard."
      : "This is a private message.",
  ].join("\n");

  const parts: string[] = [];

  if (opts.shared?.length) {
    parts.push("# True right now\n" + opts.shared.map((s) => `- ${s.key}: ${s.value}`).join("\n"));
  }
  if (opts.facts?.length) {
    parts.push("# About this person\n" + opts.facts.map((f) => `- ${f.key}: ${f.value}`).join("\n"));
  }

  parts.push(
    passages.length
      ? "# Passages\n" + passages.map((p) =>
          `[${p.n}] ${p.title}${p.url ? ` (${p.url})` : ""}\n${p.body}`).join("\n\n")
      : "# Passages\n(none matched)",
  );

  if (opts.history?.length) {
    parts.push("# Earlier in this conversation\n" + opts.history.map((h) =>
      `${h.role === "user" ? "Them" : "You"}: ${h.text}`).join("\n"));
  }

  parts.push(`# Their message\n${opts.question}`);

  return { system, user: parts.join("\n\n"), passages };
}

/** The shape the model must answer in. Enforced by the API, not by asking
 *  nicely and parsing whatever comes back. */
export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "What to say to them, in the house voice." },
    cites: {
      type: "array",
      items: { type: "integer" },
      description: "Passage numbers this answer rests on. Empty if it rests on none.",
    },
    confidence: { type: "number", description: "0 to 1: how sure you are this is right and complete." },
    handoff: { type: "boolean", description: "True if a person should take this over." },
    tags: { type: "array", items: { type: "string" }, description: "Up to three short topic tags." },
  },
  required: ["answer", "cites", "confidence", "handoff"],
  additionalProperties: false,
} as const;

export type Answer = {
  answer: string;
  cites: number[];
  confidence: number;
  handoff: boolean;
  tags?: string[];
};

// ============================================================
// L5 — WHICH SHAPE OF ANSWER THIS QUESTION DESERVES
//
// The rule this whole section exists to enforce: complexity is EARNED,
// never available-therefore-used. "How much is a website" gets one cheap
// call and always will, on a deployment that also runs a building.
//
// So the ladder is climbed for a reason and the reason is recorded:
//
//   single    no passages matched and none were needed. One call.
//   grounded  passages matched. One call, with them. The common case.
//   tools     the org actually HAS live tools AND the question is about
//             something only a machine can currently answer. On an org
//             with no MCP server this rung does not exist — not disabled,
//             absent — which is why connecting a building changes what
//             the bot can do without changing what it costs anybody else.
//   verified  a second pass checks the answer against its sources before
//             it goes out. Bought only where being wrong is expensive:
//             money, a physical change, or a public comment the sender
//             cannot unsend.
//
// Every rung above `grounded` has a precondition that is a FACT about the
// org or the message, not a judgement about the wording. A judgement
// about the wording is another model call, which is the thing being
// avoided.
// ============================================================

export type Pattern = "single" | "grounded" | "tools" | "verified";

export type PlanChoice = {
  pattern: Pattern;
  /** how many tool round trips are allowed. 0 on every non-tool pattern. */
  maxHops: number;
  /** whether to spend a second call checking the first */
  verify: boolean;
  why: string;
};

export function choosePattern(ctx: {
  /** tools this org has switched on. Empty is the normal case. */
  toolCount: number;
  /** how many passages retrieval found */
  passageCount: number;
  kind: "dm" | "comment";
  triage?: TriageKind;
  /** micro-dollars spent today, and the ceiling */
  spentMicros?: number;
  budgetMicros?: number;
}): PlanChoice {
  const tight = !!ctx.budgetMicros && (ctx.spentMicros ?? 0) >= ctx.budgetMicros * 0.75;

  // Money is the first question, not the last. Past three quarters of the
  // day's budget nothing above the cheapest rung is bought, whatever the
  // message says — an expensive answer to the last question of the day is
  // an expensive answer nobody gets, because the budget ran out on it.
  if (tight) {
    return {
      pattern: ctx.passageCount > 0 ? "grounded" : "single",
      maxHops: 0, verify: false,
      why: "past three quarters of the day's budget; cheapest shape only",
    };
  }

  if (ctx.toolCount > 0) {
    // The model is given the tools and decides. It is NOT asked, in a
    // separate call, whether it would like some — that call costs as much
    // as the decision it informs.
    return {
      pattern: "tools",
      maxHops: ctx.kind === "comment" ? 2 : 4,
      // a tool that changed something, answered in public, is the
      // expensive kind of wrong
      verify: ctx.kind === "comment",
      why: `${ctx.toolCount} tool${ctx.toolCount === 1 ? "" : "s"} available to this org`,
    };
  }

  if (ctx.passageCount === 0) {
    return { pattern: "single", maxHops: 0, verify: false, why: "nothing matched to ground an answer in" };
  }

  // A public comment cannot be unsent, and a quote about money is the one
  // people screenshot. Those two, and nothing else, buy a second pass.
  const stakes = ctx.kind === "comment" || ctx.triage === "lead";
  return {
    pattern: stakes ? "verified" : "grounded",
    maxHops: 0,
    verify: stakes,
    why: stakes
      ? (ctx.kind === "comment" ? "public, and cannot be unsent" : "somebody asking to spend money")
      : "one grounded answer is the right size for this",
  };
}

/** May this tool run without asking a person?
 *
 *  Three conditions, all required, and the reason for each is that
 *  somebody would otherwise have to trust a sentence instead of a row:
 *
 *    the tool is marked read     no side effect, by the operator's own
 *                                classification
 *    the tool is marked auto     the operator said yes to it running
 *                                unattended, specifically
 *    it is not a public comment  a stranger under a post does not get to
 *                                make the building do things, even
 *                                read-only ones, even indirectly
 *
 *  Everything else becomes a request a person answers. */
export function mayRunUnattended(tool: { risk: string; auto: boolean }, ctx: { kind: "dm" | "comment" }): boolean {
  if (ctx.kind === "comment") return false;
  return tool.risk === "read" && tool.auto === true;
}

// ============================================================
// THE GATE
//
// The last thing between a generated sentence and a stranger reading it.
// ============================================================

export type Gate =
  | { send: true; text: string; tags: string[]; cites: number[]; confidence: number }
  | { send: false; reason: string; handoff: true };

/** Decide whether an answer may go out.
 *
 *  A citation to a passage that was never supplied is the tell for an
 *  answer built out of the model's own memory rather than out of the
 *  site, and it is checkable for free — so it is checked, and it is fatal.
 *  Everything else here is a threshold a human can move. */
export function gate(a: Answer | null, opts: {
  passageCount: number;
  minConfidence?: number;
  /** a public comment gets a higher bar than a DM: it cannot be unsent */
  kind?: "dm" | "comment";
  maxChars?: number;
  /** tool calls that ran, or are waiting on a person. A tool result IS a
   *  source — a recorded one, in mcp_calls, which is a better source than
   *  a passage — so an answer resting on one is not unsourced. */
  toolsUsed?: number;
}): Gate {
  if (!a || typeof a.answer !== "string" || !a.answer.trim()) {
    return { send: false, reason: "the model returned nothing usable", handoff: true };
  }
  if (a.handoff === true) {
    return { send: false, reason: "the model asked for a person", handoff: true };
  }

  const cites = Array.isArray(a.cites) ? a.cites : [];
  const bad = cites.filter((n) => !Number.isInteger(n) || n < 1 || n > opts.passageCount);
  if (bad.length) {
    return { send: false, reason: `cited passages that do not exist: ${bad.join(", ")}`, handoff: true };
  }

  const floor = opts.minConfidence ?? (opts.kind === "comment" ? 0.7 : 0.55);
  if (!(typeof a.confidence === "number") || a.confidence < floor) {
    return { send: false, reason: `confidence ${a.confidence} below ${floor}`, handoff: true };
  }

  // An answer with no citations at all is only allowed when there was
  // nothing to cite AND it is a refusal — "I don't know, let me get
  // someone" needs no source. An unsourced claim does.
  if (!cites.length && opts.passageCount > 0 && !(opts.toolsUsed ?? 0)) {
    return { send: false, reason: "answered without using any of the passages", handoff: true };
  }

  const max = opts.maxChars ?? (opts.kind === "comment" ? 400 : 900);
  const text = a.answer.trim();
  if (text.length > max) {
    return { send: false, reason: `answer is ${text.length} chars, over the ${max} limit for a ${opts.kind ?? "dm"}`, handoff: true };
  }

  const tags = (a.tags ?? []).filter((t) => typeof t === "string" && t.trim())
    .map((t) => t.trim().toLowerCase().slice(0, 40)).slice(0, 3);

  return { send: true, text, tags, cites, confidence: a.confidence };
}

// ============================================================
// TRIAGE — reading the message before paying to answer it
//
// A cheap model looks first. Two things come out of that, and both
// matter more than the money:
//
//   the bot never argues with abuse.  A model asked to be helpful will
//   try to be helpful at somebody calling it names, in public, under
//   your own post. That is the failure mode worth spending a tenth of a
//   cent per message to avoid.
//
//   the bot never answers spam.       Engaging a link farm confirms the
//   address is live, and costs a full answer to do it.
//
// The saving is real too: on anything that is not a question, the
// expensive call never happens.
// ============================================================

export type TriageKind = "support" | "lead" | "praise" | "spam" | "abuse" | "other";

export type Triage = {
  kind: TriageKind;
  /** one short line, for the record — why this bucket */
  reason: string;
  /** an email address in the message, if the person volunteered one */
  email?: string | null;
  /** their name, if they gave it */
  name?: string | null;
};

export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["support", "lead", "praise", "spam", "abuse", "other"],
      description:
        "support: a genuine question. lead: wants to hire, buy or book. praise: kind words, nothing asked. " +
        "spam: bulk, promotional, or a link farm. abuse: threats, slurs, or harassment. other: none of these.",
    },
    reason: { type: "string", description: "One short line. Why this bucket." },
    email: { type: ["string", "null"], description: "An email address they volunteered, or null." },
    name: { type: ["string", "null"], description: "Their name if they gave it, or null." },
  },
  required: ["kind", "reason"],
  additionalProperties: false,
} as const;

export type Handling = {
  /** ask the expensive model for a real answer */
  answer: boolean;
  /** leave the thread for a person, and say nothing */
  handoff: boolean;
  /** close it; nobody needs to see this again */
  close: boolean;
  /** tags to put on the PERSON, not the thread */
  tags: string[];
  /** a lead worth writing down, when they left a way to be reached */
  lead: { email: string; name: string } | null;
  why: string;
};

const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

/** What to do about a triaged message.
 *
 *  Pure, and separate from the model call, because the interesting part
 *  is not "what kind of message is this" — it is what silence costs in
 *  each case. Answering abuse is worse than ignoring a question. */
export function handle(t: Triage | null, opts: { kind: "dm" | "comment" } = { kind: "dm" }): Handling {
  const none = { answer: false, handoff: false, close: false, tags: [] as string[], lead: null };

  // Triage failing is not a reason to stay silent — it is a reason to
  // fall through to the ordinary path, which has its own gate.
  if (!t || typeof t.kind !== "string") {
    return { ...none, answer: true, why: "triage returned nothing usable; answering normally" };
  }

  const why = (t.reason || "").trim().slice(0, 200);

  if (t.kind === "abuse") {
    // NOT closed. A closed thread is a hidden thread, and this is the one
    // you most want to see — you may need to block, report, or delete a
    // comment, and none of that happens if it is filed away.
    return { ...none, handoff: true, tags: ["abuse"], why: why || "abusive" };
  }

  if (t.kind === "spam") {
    return { ...none, close: true, tags: ["spam"], why: why || "spam" };
  }

  if (t.kind === "praise") {
    // Kind words on a public comment get a short thank-you; in a DM they
    // get a person, because a bot thanking you for a compliment and then
    // going quiet reads worse than nothing at all.
    return opts.kind === "comment"
      ? { ...none, answer: true, tags: ["praise"], why: why || "kind words" }
      : { ...none, handoff: true, tags: ["praise"], why: why || "kind words, worth a real reply" };
  }

  if (t.kind === "lead") {
    const email = (t.email ?? "").trim().toLowerCase();
    return {
      answer: true,
      handoff: false,
      close: false,
      tags: ["lead"],
      // A lead row needs a way to reach them. Inventing one — a handle in
      // the email column — would put a bad address in the pipeline, which
      // is worse than no row: somebody would try to use it.
      lead: EMAIL.test(email) ? { email, name: (t.name ?? "").trim().slice(0, 120) || "(from the inbox)" } : null,
      why: why || "wants to hire",
    };
  }

  return { ...none, answer: true, tags: [], why: why || t.kind };
}

// ============================================================
// L0 — A/B, AND BEING HONEST ABOUT IT
//
// Assignment is to the PERSON, not the message. Somebody who gets the
// warm voice in one reply and the terse one in the next has not been in
// an experiment; they have been in a fault.
//
// So the arm is a hash of (experiment, contact): no table, no lookup,
// no state, and the same answer after a restart, a redeploy, or this
// file being rewritten. The one property that matters is that it does
// not change — not that it is cryptographic. FNV-1a is plenty.
// ============================================================

export type Arm = { name: string; weight: number; value?: string };
export type Experiment = { key: string; dimension: "voice" | "model" | "effort"; arms: Arm[] };

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // the FNV prime, by shifts, because Math.imul on the constant
    // overflows differently in different runtimes and the whole point
    // of this function is that it does not
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Which arm this person is in. Null when the experiment is unusable,
 *  which is treated everywhere as "no experiment" rather than as an
 *  error: a malformed experiment must degrade to the ordinary behaviour,
 *  never to no reply. */
export function assignArm(exp: Experiment | null, contactId: string): Arm | null {
  if (!exp || !Array.isArray(exp.arms) || exp.arms.length < 2) return null;

  const arms = exp.arms.filter((a) => a && typeof a.name === "string" && Number(a.weight) > 0);
  if (arms.length < 2) return null;

  const total = arms.reduce((n, a) => n + Math.floor(Number(a.weight)), 0);
  if (total <= 0) return null;

  // 1e6 buckets rather than `total` directly: with weights of 1 and 2 a
  // modulo of 3 lands on a hash's low bits, and low bits of a cheap hash
  // are the least uniform part of it
  let point = (fnv1a(`${exp.key}:${contactId}`) % 1_000_000) / 1_000_000 * total;
  for (const a of arms) {
    point -= Math.floor(Number(a.weight));
    if (point < 0) return a;
  }
  return arms[arms.length - 1];
}

/** How much to believe a scoreboard.
 *
 *  Not a p-value. A p-value on eleven messages is a way of dressing up
 *  eleven messages, and the honest answer at this size is a sentence
 *  rather than a number. */
export function readScoreboard(rows: {
  arm: string; calls: number; verdicts: number; good: number; bad: number; avg_cost_micros: number;
}[]): { verdict: string; enough: boolean; best?: string } {
  const scored = (rows ?? []).filter((r) => r.verdicts > 0);
  const judged = scored.reduce((n, r) => n + r.verdicts, 0);

  if (rows.length < 2) return { verdict: "only one arm has run so far.", enough: false };
  if (judged < 30) {
    return {
      verdict: `${judged} verdict${judged === 1 ? "" : "s"} so far. Nothing here means anything yet — `
             + "mark answers good or wrong as you read them and come back.",
      enough: false,
    };
  }

  const rate = (r: { good: number; verdicts: number }) => r.good / Math.max(1, r.verdicts);
  const best = [...scored].sort((a, b) => rate(b) - rate(a))[0];
  const worst = [...scored].sort((a, b) => rate(a) - rate(b))[0];
  const gap = rate(best) - rate(worst);

  if (gap < 0.15) {
    return { verdict: `no arm is clearly ahead (${Math.round(gap * 100)} points apart). Either would do.`, enough: true };
  }
  return {
    verdict: `"${best.arm}" is ${Math.round(gap * 100)} points ahead on ${judged} verdicts`
           + (best.avg_cost_micros > worst.avg_cost_micros * 1.5
              ? ", and costs noticeably more per answer." : "."),
    enough: true,
    best: best.arm,
  };
}

// ============================================================
// L3 — WHAT IS FIT TO REMEMBER
//
// A fact that changed is two facts: the old one, ended, and the new one.
// Overwriting throws away the only evidence that the person changed their
// mind, which is exactly the thing you want when they say you got it
// wrong.
// ============================================================

export type Fact = { id?: string; key: string; value: string; confidence?: number };

// The supersede rule itself lives in the memory_note() SQL function, not
// here. It has to: deciding "is this a new value for a key somebody
// already has" is a read followed by a write, and between those two a
// second message from the same person can arrive. Only the database can
// hold that still. Writing the rule a second time in TypeScript would
// give it somewhere to drift to, so it is not written here at all — see
// supabase/migrations/0024_memory_note.sql, tested in
// supabase/tests/memory_note_test.sql.
//
// What IS here is the part that has nothing to do with concurrency:
// deciding which extracted facts are fit to be written down at all.

export const FACTS_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "snake_case, stable across conversations: name, city, project, budget_range, timeline" },
          value: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["key", "value", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
} as const;

/** Facts a bot has no business keeping. Extraction is a model deciding
 *  what is worth remembering, and a model will happily remember a card
 *  number if somebody types one. */
const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

const FORBIDDEN_KEY = /pass(word|code)|card|cvv|ssn|social_security|routing|account_number|token|secret|api_key|dob|birth_?date/i;
const LOOKS_LIKE_CARD = /\b(?:\d[ -]?){13,19}\b/;

export function safeFacts(facts: Fact[]): Fact[] {
  const out: Fact[] = [];
  const seen = new Set<string>();
  for (const f of facts ?? []) {
    if (!f || typeof f.key !== "string" || typeof f.value !== "string") continue;
    const key = f.key.trim().toLowerCase();
    const value = f.value.trim();
    if (!key || !value || value.length > 300) continue;
    if (FORBIDDEN_KEY.test(key) || FORBIDDEN_KEY.test(value)) continue;
    if (LOOKS_LIKE_CARD.test(value)) continue;
    // one value per key per message: a model that says the city is both
    // Boston and Denver in one breath has told us nothing, and writing
    // both would be two round trips to end at whichever came last
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, value, confidence: clamp01(f.confidence ?? 0.6) });
  }
  return out;
}
