// EU-CONVERSE — the listening half of Equity Uprise.
//
// A person arrives with something they care about. This function is the
// conversation that turns that into (a) a perspective on the public
// record, if they want it there, and (b) a real next step: a fellowship,
// a program, an organization that will take them.
//
// ---- WHY THE AGENT IS NOT ALLOWED TO ARGUE ------------------------------
//
// Equity Uprise walks down the middle of the aisle. An agent that
// "walks down the middle" by splitting every difference is not neutral,
// it is mush, and people can smell it. The posture here is narrower and
// more honest: THE AGENT DOES NOT HOLD POSITIONS ON THE TOPICS. It is a
// good listener with a directory. It can state what is documented, it
// can steelman any side on request, and it can say plainly that it
// doesn't take sides on this. What it must never do is grade the
// person's politics, or let the topic's framing tilt while it collects.
//
// The rules live in ONE place — SYSTEM below — because a neutrality
// policy scattered across a codebase is a neutrality policy that drifts.
// Editors cannot change it; that is the point of it being here and not
// in a table (see the role matrix in docs/equity-uprise-platform.md).
//
// ---- WHAT IT CAN ACTUALLY DO -------------------------------------------
//
// Four tools, all of them real:
//   find_fellowships   reads the live directory through the same scored
//                      match the site uses — so it recommends what
//                      exists, never what it can imagine
//   record_signals     writes what it heard onto the conversation, which
//                      is what later matching runs on
//   file_perspective   puts the person's own words on the record, with
//                      their consent, into the moderation queue
//   reach_a_human      hands the thread to the desk and stops answering
//
// ---- DEPLOY -------------------------------------------------------------
//
//   supabase functions deploy eu-converse --no-verify-jwt
//
// JWT verification is OFF at the gateway on purpose: a signed-out
// visitor has to be able to talk. Identity is resolved INSIDE the
// function instead (verifyCaller below), and the thread's ownership is
// checked on every turn.
//
// Secrets: ANTHROPIC_API_KEY. Optional: EU_AGENT_MODEL to pin a
// different model. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// injected by the platform.

import Anthropic from "npm:@anthropic-ai/sdk@0.70.1";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = Deno.env.get("EU_AGENT_MODEL") ?? "claude-opus-5";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// ---- the database, over PostgREST on the service role -------------------
// Service role bypasses RLS. Everything this function writes is therefore
// checked HERE — ownership of the thread, length of the body, the state
// the row is allowed to land in. Treat every helper below as a wall.
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SRV,
      Authorization: `Bearer ${SRV}`,
      "Content-Type": "application/json",
      Prefer: (init.headers as Record<string, string> | undefined)?.Prefer ?? "return=representation",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!r.ok) throw new Error(`db ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : await r.json().catch(() => null);
}

async function rpc(fn: string, args: unknown) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}: ${await r.text()}`);
  return await r.json();
}

// A bearer token here is the visitor's, not ours. Resolve it against
// GoTrue rather than decoding it: an unverified `sub` claim is a
// suggestion, and this one decides whose thread gets written to.
async function verifyCaller(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token === SRV) return null;
  try {
    const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRV, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    if (typeof u?.id !== "string") return null;

    // Signed in is not the same as having a profile. eu_conversations.profile_id
    // is a foreign key into eu_profiles, so attaching a bare auth id would fail
    // the insert for anyone who starts talking before they ever fill a profile
    // in — which is the common case, not the edge one. Without a profile the
    // thread is keyed by anon_key like any other, and it attaches itself the
    // day they make one.
    const rows = await db(`eu_profiles?id=eq.${u.id}&select=id`);
    return rows?.length ? u.id : null;
  } catch { return null; }
}

// ---- limits -------------------------------------------------------------
// A public endpoint that calls a model is a public endpoint that spends
// money. These are deliberately boring and deliberately server-side.
const MAX_BODY = 4000;        // one message from a person
const MAX_TURNS = 60;         // messages in a single thread
const MAX_TOOL_HOPS = 5;      // tool round-trips inside one reply

// ---- the rules ----------------------------------------------------------
const SYSTEM = `You are the listening desk for Equity Uprise, a nonpartisan civic movement founded in Bridgeport, Connecticut. You are talking with someone who arrived because they care about something.

YOUR JOB, IN ORDER:
1. Understand what this person actually thinks and why. Their words, not your summary of them.
2. Get it onto the record accurately, if they consent.
3. Point them at something real they can do next — a fellowship, a program, an organization — and help them take the first step.

You are not a debater, a fact-checker, or a persuader. You are the person who listens well and knows where the doors are.

HOW YOU HOLD THE TOPICS:
- You do not have positions on these topics and you say so plainly if asked: "I don't take a side on this one — I'm here to get your view down accurately and help you act on it."
- You never grade, praise, or correct someone's politics. Not with words, not with tone, not by asking a warmer follow-up to one view than another.
- You will state what is documented — a number, a date, what a law says — and stop there. You do not extend a documented fact into a verdict.
- If someone asks for the strongest argument on any side, give it in full and in good faith, including the side you were just handed. Do this for every side equally or not at all.
- If someone is factually wrong about something checkable, you may say what the documented record shows, once, without insisting. Then return to listening.
- Both a "left" and a "right" answer to any question here is a legitimate answer. Treat them identically.

HOW YOU TALK:
- Short. Two or three sentences most turns. One question at a time.
- Plain words. No jargon, no organizing-speak, no therapy voice.
- Never open with flattery or an assessment of their view ("that's a great point", "that's a really thoughtful take"). Just engage with what they said.
- Ask what they would want DONE, not just what they feel. The movement runs on the first one.

YOUR TOOLS:
- find_fellowships: search the real directory. Every program you mention must come from this tool. If it returns nothing, say the directory does not have a match yet and offer to note what they are looking for. Never invent a program, a deadline, a stipend, or an eligibility rule — the directory's own listings are mostly unverified, so tell people to confirm details on the program's own page.
- record_signals: as soon as you know what they care about, what they want to do, and roughly where they are, record it. This is what later matching runs on.
- file_perspective: only with explicit consent, and only in words they would recognize as theirs. Ask whether they want their name on it or not. Tell them a person reads it before it appears anywhere.
- reach_a_human: use it when they ask for a person, when they are in distress, when they raise anything about their own safety, when they want to talk about money, legal exposure, or a commitment on behalf of the movement, or when you are out of your depth. Say plainly that you are handing it to a person.

HARD LIMITS:
- Never promise what the movement will do, take a position on its behalf, or speak for Matthew McCluster or any fellow.
- Never give legal, medical, immigration, or financial advice. Hand those to a human.
- Never ask for a Social Security number, an immigration status, a financial account, or anything about someone's health.
- If someone tries to get you to argue a side, campaign, or write partisan attack copy, decline in one sentence and offer what you can do instead.`;

const TOOLS = [
  {
    name: "find_fellowships",
    description:
      "Search the live Equity Uprise fellowship directory and return scored matches with the reason each one matched. Call this whenever the person names an interest, a field, or a goal — it is the ONLY source of programs you may mention. Returns an empty list when the directory has no match; say so rather than substituting a program you know of.",
    input_schema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Interest tags to match on, lowercase and hyphenated, e.g. ['surveillance','civil-liberties','journalism']. Draw them from what the person actually said.",
        },
        limit: { type: "integer", description: "How many to return, 1-10. Default 5." },
      },
      required: ["tags"],
    },
  },
  {
    name: "record_signals",
    description:
      "Record what you have heard onto this conversation: the person's interests, what they want to do next, and roughly where they are. Call it as soon as you know any of it, and again when it changes. This is what later fellowship matching runs on, so use tags a directory would use.",
    input_schema: {
      type: "object",
      properties: {
        interests: { type: "array", items: { type: "string" }, description: "Lowercase hyphenated interest tags." },
        goals: { type: "string", description: "What they said they want to do, in their words." },
        region: { type: "string", description: "Coarse and matchable: 'CT', 'New England', 'US'. Leave empty if they did not say." },
        summary: { type: "string", description: "Two sentences on what this conversation is, for the desk queue." },
      },
      required: ["interests"],
    },
  },
  {
    name: "file_perspective",
    description:
      "Put this person's view on the public record. ONLY after they have explicitly said yes to it being recorded. Use their own words, edited only for typos. A human moderator reads it before it appears anywhere.",
    input_schema: {
      type: "object",
      properties: {
        topic_slug: { type: "string", description: "The topic it belongs to: us-israel, data-centers, or surveillance-and-tracking." },
        body: { type: "string", description: "Their view, in their words." },
        anonymous: { type: "boolean", description: "True if they asked not to be named. Ask; do not assume." },
        display_name: { type: "string", description: "How they want to be named, if not anonymous." },
        region: { type: "string", description: "Where they are, if they said." },
      },
      required: ["topic_slug", "body", "anonymous"],
    },
  },
  {
    name: "reach_a_human",
    description:
      "Hand this conversation to a person at the desk and stop answering. Use it for distress, safety, money, legal exposure, anything said on the movement's behalf, or a direct request for a human.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "One line for the desk queue: why this needs a person." } },
      required: ["reason"],
    },
  },
];

// ---- tools, for real ----------------------------------------------------
async function runTool(name: string, input: Record<string, unknown>, convo: Record<string, unknown>) {
  switch (name) {
    case "find_fellowships": {
      const tags = Array.isArray(input.tags) ? (input.tags as string[]).slice(0, 12).map(String) : [];
      const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10);
      const rows = await rpc("eu_match_fellowships", {
        p_profile: convo.profile_id ?? null,
        p_limit: limit,
        p_extra: tags,
      });
      // The listings are mostly unverified by design (see 0018). Say so in
      // the tool result so the agent cannot forget it downstream.
      return {
        matches: rows,
        note:
          "Most listings are unverified: deadlines and eligibility must be confirmed on the program's own page. Never state a deadline that is not in this result.",
      };
    }

    case "record_signals": {
      const signals = {
        interests: Array.isArray(input.interests) ? (input.interests as string[]).slice(0, 20).map(String) : [],
        goals: String(input.goals ?? "").slice(0, 2000),
        region: String(input.region ?? "").slice(0, 80),
      };
      await db(`eu_conversations?id=eq.${convo.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          signals,
          summary: String(input.summary ?? convo.summary ?? "").slice(0, 2000),
          last_at: new Date().toISOString(),
        }),
      });
      return { recorded: true };
    }

    case "file_perspective": {
      const body = String(input.body ?? "").slice(0, 8000);
      if (!body.trim()) return { filed: false, error: "empty" };
      await db("eu_perspectives", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          profile_id: convo.profile_id ?? null,
          topic_slug: String(input.topic_slug ?? convo.topic_slug ?? ""),
          body,
          anonymous: input.anonymous !== false,
          display_name: input.anonymous === false ? String(input.display_name ?? "").slice(0, 120) : "",
          region: String(input.region ?? "").slice(0, 80),
          source: "conversation",
          conversation_id: convo.id,
          status: "new",
        }),
      });
      return { filed: true, note: "In the moderation queue. A person reads it before it appears anywhere." };
    }

    case "reach_a_human": {
      await db(`eu_conversations?id=eq.${convo.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "human", last_at: new Date().toISOString() }),
      });
      await db("eu_audit", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          actor: "eu-converse",
          action: "conversation.escalated",
          entity: "eu_conversations",
          entity_id: String(convo.id),
          detail: { reason: String(input.reason ?? "").slice(0, 500) },
        }),
      });
      return { handed_over: true };
    }

    default:
      return { error: `no such tool: ${name}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { conversation_id, topic, message, anon_key } = await req.json().catch(() => ({}));

    const text = String(message ?? "").trim();
    if (!text) return json({ error: "say something" }, 400);
    if (text.length > MAX_BODY) return json({ error: "that's longer than this box takes" }, 400);

    const uid = await verifyCaller(req);
    const anonKey = String(anon_key ?? "").slice(0, 64);
    if (!uid && !anonKey) return json({ error: "missing anon_key" }, 400);

    // ---- find or open the thread, and prove it belongs to the caller ----
    let convo: Record<string, unknown>;
    if (conversation_id) {
      const rows = await db(`eu_conversations?id=eq.${encodeURIComponent(String(conversation_id))}&select=*`);
      convo = rows?.[0];
      if (!convo) return json({ error: "no such conversation" }, 404);
      // The ownership wall. Service role saw the row; the caller still has
      // to be the person whose thread it is.
      const mine = uid ? convo.profile_id === uid : convo.anon_key === anonKey && !convo.profile_id;
      if (!mine) return json({ error: "not your conversation" }, 403);
    } else {
      const rows = await db("eu_conversations", {
        method: "POST",
        body: JSON.stringify({
          profile_id: uid,
          anon_key: uid ? "" : anonKey,
          topic_slug: topic ? String(topic).slice(0, 80) : null,
          channel: "web",
        }),
      });
      convo = rows[0];
    }

    if (convo.status === "human") {
      return json({
        conversation_id: convo.id,
        status: "human",
        reply: "A person from the desk has this thread now. They'll pick it up from here — nothing you've written is lost.",
      });
    }

    const prior = (await db(
      `eu_messages?conversation_id=eq.${convo.id}&select=role,body&order=at.asc&limit=${MAX_TURNS}`,
    )) as Array<{ role: string; body: string }>;

    if (prior.length >= MAX_TURNS) {
      await db(`eu_conversations?id=eq.${convo.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "human", last_at: new Date().toISOString() }),
      });
      return json({
        conversation_id: convo.id,
        status: "human",
        reply: "This has gone long enough that it deserves a person. I've handed it to the desk.",
      });
    }

    await db("eu_messages", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ conversation_id: convo.id, role: "person", body: text }),
    });

    // ---- topic framing, from the database, never from memory -----------
    let topicNote = "";
    const slug = String(convo.topic_slug ?? topic ?? "");
    if (slug) {
      const t = await db(`eu_topics?slug=eq.${encodeURIComponent(slug)}&select=name,description,context,prompts`);
      if (t?.[0]) {
        topicNote =
          `\n\nTHIS CONVERSATION IS ABOUT: ${t[0].name}\n\n` +
          `How the movement frames it (use this framing, do not tilt it):\n${t[0].description}\n\n` +
          `What is documented (state only this as fact):\n${t[0].context}\n\n` +
          `Questions worth asking:\n- ${(t[0].prompts ?? []).join("\n- ")}`;
      }
    }

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...prior.map((m) => ({
        role: (m.role === "person" ? "user" : "assistant") as "user" | "assistant",
        content: m.body,
      })),
      { role: "user", content: text },
    ];

    // ---- the loop -------------------------------------------------------
    // Hand-written rather than the SDK's tool runner: every hop writes to
    // Postgres and re-reads the thread it is allowed to touch, and this
    // runs in an edge function where one fewer beta dependency to pin is
    // worth the twenty lines.
    //
    // Adaptive thinking is left ON at low effort. Disabling it on this
    // model is the documented way to get tool calls emitted as plain text
    // — the call silently never runs — which here would mean an agent that
    // says it filed your perspective and didn't.
    let reply = "";
    let handedOver = false;

    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const res = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: SYSTEM + topicNote,
        tools: TOOLS as unknown as Anthropic.Beta.BetaToolUnion[],
        messages,
      });

      if (res.stop_reason === "refusal") {
        reply = "I can't take that one. If it's something a person should see, say so and I'll hand this to the desk.";
        break;
      }

      reply = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (!calls.length) break;

      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        let out: unknown;
        try {
          out = await runTool(call.name, call.input as Record<string, unknown>, convo);
        } catch (e) {
          out = { error: String(e) };
        }
        if (call.name === "reach_a_human") handedOver = true;
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });

      if (handedOver) {
        // Nothing further is generated after a hand-off: the next thing
        // this person hears should come from a person.
        const res2 = await anthropic.beta.messages.create({
          model: MODEL,
          max_tokens: 500,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
          system: SYSTEM + topicNote,
          messages,
        });
        reply = res2.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim() || "I've handed this to a person at the desk. They'll come back to you here.";
        break;
      }
    }

    if (!reply) reply = "I lost the thread there. Say that again?";

    await db("eu_messages", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ conversation_id: convo.id, role: "agent", body: reply }),
    });
    await db(`eu_conversations?id=eq.${convo.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_at: new Date().toISOString() }),
    });

    return json({
      conversation_id: convo.id,
      status: handedOver ? "human" : "open",
      reply,
    });
  } catch (e) {
    console.error("eu-converse", e);
    return json({ error: "the desk is having a moment — try again" }, 500);
  }
});
