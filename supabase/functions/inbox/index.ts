// INBOX — the only thing allowed to write into a conversation.
//
// Same shape of trust as shake-order, for the same reason. The RLS on
// inbox_conversations and inbox_messages says "staff only", with no
// insert policy for anon at all, so a browser cannot write a message
// even if it wanted to. This function on the service role is the sole
// door, and everything below exists so that what goes through it is
// something the SITE decided rather than something a client sent.
//
// ---- WHAT IT REFUSES ---------------------------------------------------
//
//   an outbound message from a browser   the widget may only say what its
//                                        own visitor typed; `direction`
//                                        is set here, never accepted
//   a reply into somebody else's thread  the visitor key is the identity;
//                                        a conversation id from the client
//                                        is never trusted on its own
//   a send a channel cannot make         checked against inbox_channels
//                                        before anything leaves — see
//                                        sendRefusal() in flows.ts
//   a webhook without a valid signature  Meta signs every delivery; an
//                                        unsigned POST is dropped
//   a webhook replay                     external_id is unique per
//                                        conversation, so a redelivery
//                                        collides instead of double-posting
//
// ---- ACTIONS -----------------------------------------------------------
//
//   open     the widget's hello: resolve/create the site contact and thread
//   say      the visitor sends a message; flows run; replies come back
//   history  read one thread back, by visitor key
//   verify   Meta's webhook handshake (GET)
//   hook     Meta's webhook delivery (POST, signed)
//
// ---- DEPLOY ------------------------------------------------------------
//
//   supabase functions deploy inbox --no-verify-jwt
//
// JWT verification is off at the gateway because a visitor does not need
// an account to say hello, and because Meta's webhook cannot present one.
//
// SECRETS — set these, and never put them in the repo:
//   META_VERIFY_TOKEN   a string you invent; Meta echoes it back once
//   META_APP_SECRET     signs every delivery; without it, hooks are refused
//   IG_TOKEN            long-lived page token (only once app review passes)
//   ANTHROPIC_API_KEY   optional. Without it the bot is flow rules only —
//                       everything below still works, it just never
//                       answers anything nobody wrote a rule for.
//   VOYAGE_API_KEY      optional. Without it retrieval is keyword-only.
//   AI_DAY_BUDGET_USD   default 2.00. Past it, replies hand off.
//
//   TELEGRAM_TOKEN      from @BotFather. Free, no review, works today.
//   TELEGRAM_SECRET     the secret_token you passed to setWebhook; every
//                       delivery echoes it and an unmatched one is dropped
//   SLACK_BOT_TOKEN     xoxb-…, and SLACK_SIGNING_SECRET to verify posts
//   WA_TOKEN            WhatsApp Cloud; shares META_APP_SECRET for signing
//   BSKY_TOKEN          a session accessJwt (see the runbook — it expires)

import { decide, sendRefusal, type ChannelCaps, type Ctx, type Flow } from "./flows.ts";
import {
  parseMeta, parseSlack, parseTelegram, parseWhatsApp,
  parseBlueskyConvos, parseBlueskyNotifications,
  askFor, type Caps, type InEvent,
} from "./platforms.ts";
import {
  aiEnabled, answerQuestion, budgetMicros, indexDocument, recallFacts, remember,
  retrieve, spentTodayMicros, triage,
} from "./ai.ts";
import { invoke, refreshTools } from "./mcp.ts";
import { readScoreboard } from "./brain.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

/** PostgREST on the service role. Bypasses RLS, so every call here is a
 *  place where the check has to have already happened above it. */
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SRV,
      Authorization: `Bearer ${SRV}`,
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ============================================================
// THE SITE CHANNEL — the one that works today
// ============================================================

/** The visitor key is a random string the widget makes and keeps in
 *  localStorage. It is the whole identity for an anonymous visitor, so
 *  it has to look like one we issued: a client that sends a short or
 *  strange key is not given a thread. */
/** Work that must finish but that nobody is waiting for. On Supabase this
 *  keeps the isolate alive past the response; everywhere else it is a bare
 *  unawaited promise, which is what the webhook path already relies on. */
function background(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch(() => {}));
  else p.catch(() => {});
}

function badKey(k: unknown): boolean {
  return typeof k !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(k);
}

async function resolveSiteThread(orgId: string, visitorKey: string, page?: string) {
  const found = await db(
    `inbox_contacts?org_id=eq.${orgId}&channel=eq.site&external_id=eq.${encodeURIComponent(visitorKey)}&select=id`,
  );
  let contactId: string;
  if (found?.length) {
    contactId = found[0].id;
    await db(`inbox_contacts?id=eq.${contactId}`, {
      method: "PATCH",
      body: JSON.stringify({ last_seen: new Date().toISOString() }),
    });
  } else {
    const made = await db("inbox_contacts", {
      method: "POST",
      body: JSON.stringify({
        org_id: orgId,
        channel: "site",
        external_id: visitorKey,
        display_name: "Visitor",
        meta: page ? { first_page: String(page).slice(0, 200) } : {},
      }),
    });
    contactId = made[0].id;
  }

  const open = await db(
    `inbox_conversations?org_id=eq.${orgId}&contact_id=eq.${contactId}&status=eq.open&select=id,claimed_by,window_ends&order=last_at.desc&limit=1`,
  );
  if (open?.length) return { contactId, conv: open[0] };

  const conv = await db("inbox_conversations", {
    method: "POST",
    body: JSON.stringify({ org_id: orgId, contact_id: contactId, channel: "site", kind: "dm" }),
  });
  return { contactId, conv: conv[0] };
}

async function channelCaps(orgId: string, key: string): Promise<ChannelCaps | undefined> {
  const c = await capsFor(orgId, key);
  return c as ChannelCaps | undefined;
}

/** Run the flows and write whatever they decided. Returns the replies so
 *  the widget can paint them without a second round trip. */
async function runFlows(opts: {
  orgId: string;
  convId: string;
  contactId: string;
  channel: string;
  kind: "dm" | "comment";
  body: string;
  first: boolean;
  claimed: boolean;
  windowEnds: string | null;
}) {
  const flows: Flow[] = await db(
    `inbox_flows?org_id=eq.${opts.orgId}&enabled=eq.true&select=id,name,channel,enabled,ordinal,stop,trigger,conditions,actions&order=ordinal.asc`,
  );
  const tagRows = await db(`inbox_tags?contact_id=eq.${opts.contactId}&select=tag`);
  const ctx: Ctx = {
    body: opts.body,
    channel: opts.channel,
    kind: opts.kind,
    first: opts.first,
    tags: (tagRows ?? []).map((t: { tag: string }) => t.tag),
    claimed: opts.claimed,
  };

  const { actions, trace } = decide(flows ?? [], ctx);

  // the audit trail is written whether or not anything fired: "the bot
  // said nothing" is the answer to a support question just as often as
  // "the bot said the wrong thing"
  for (const t of trace) {
    if (t.flow_id === "-") continue;
    await db("inbox_flow_runs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ org_id: opts.orgId, flow_id: t.flow_id, conv_id: opts.convId, matched: t.matched, detail: { why: t.why, name: t.name } }),
    }).catch(() => {});
  }

  const caps = await channelCaps(opts.orgId, opts.channel);
  const replies: { body: string; at: string }[] = [];
  let spoke = false;

  for (const a of actions) {
    if (a.do === "tag") {
      await db("inbox_tags", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ contact_id: opts.contactId, tag: a.tag }),
      }).catch(() => {});
    } else if (a.do === "untag") {
      await db(`inbox_tags?contact_id=eq.${opts.contactId}&tag=eq.${encodeURIComponent(a.tag)}`, { method: "DELETE" }).catch(() => {});
    } else if (a.do === "handoff") {
      // the bot steps back and the thread waits for a person. It is NOT
      // closed: closing it would hide the very conversation that was
      // escalated because it needed attention.
      await db(`inbox_conversations?id=eq.${opts.convId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "open" }),
      }).catch(() => {});
      await db("inbox_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ org_id: opts.orgId, conv_id: opts.convId, direction: "out", author: "bot", body: "[handed to a person]", state: "delivered", meta: { system: true } }),
      }).catch(() => {});
    } else if (a.do === "close") {
      await db(`inbox_conversations?id=eq.${opts.convId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "closed" }),
      }).catch(() => {});
    } else if (a.do === "reply") {
      const refusal = sendRefusal(caps, opts.kind, opts.windowEnds);
      const row = await db("inbox_messages", {
        method: "POST",
        body: JSON.stringify({
          org_id: opts.orgId,
          conv_id: opts.convId,
          direction: "out",
          author: "bot",
          body: a.text,
          state: refusal ? "failed" : "sent",
          error: refusal,
        }),
      });
      // On 'site' the reply IS the response body, so a written row is a
      // delivered message. On a real channel this is where the adapter
      // would push it out, and until one exists the row stands as queued
      // work rather than a claim that anything was sent.
      if (!refusal) { replies.push({ body: a.text, at: row[0].at }); spoke = true; }
    }
  }

  // Nobody wrote a rule for this one. Ask the brain, and if the brain has
  // nothing solid either, the thread stays open for a person.
  if (!spoke && !opts.claimed) {
    const ai = await aiFallback({
      orgId: opts.orgId, convId: opts.convId, contactId: opts.contactId, channel: opts.channel,
      kind: opts.kind, body: opts.body, claimed: opts.claimed,
    });
    if (ai) {
      const refusal = sendRefusal(caps, opts.kind, opts.windowEnds);
      const row = await db("inbox_messages", {
        method: "POST",
        body: JSON.stringify({
          org_id: opts.orgId, conv_id: opts.convId, direction: "out", author: "bot", body: ai.text,
          state: refusal ? "failed" : "sent", error: refusal,
          meta: { source: "ai", call: ai.callId },
        }),
      });
      if (!refusal) replies.push({ body: ai.text, at: row[0].at });
    }
  }

  // What they told us outlives this reply, so it is written down whether
  // or not we had anything to say back. Not awaited: the visitor is
  // waiting on the reply, not on our note-taking.
  background(remember(db, {
    orgId: opts.orgId, contactId: opts.contactId, convId: opts.convId, text: opts.body,
  }));

  return replies;
}

/** The flows had nothing to say. Ask the brain.
 *
 *  Order matters and it is deliberate: a written rule ALWAYS wins. The
 *  model is what happens when nobody anticipated the question, not a
 *  second opinion on the ones somebody did. That is the whole guardrail —
 *  anything you cannot afford it to get wrong, you write a flow for, and
 *  the model never sees it.
 *
 *  Returns the text to send, or null. Null is not a failure: it means the
 *  thread has been left open for a person, which for a question the site
 *  genuinely does not answer is the correct outcome.
 */
async function aiFallback(opts: {
  orgId: string;
  convId: string;
  contactId: string;
  channel: string;
  kind: "dm" | "comment";
  body: string;
  claimed: boolean;
}): Promise<{ text: string; tags: string[]; callId: string | null } | null> {
  if (!aiEnabled()) return null;
  // a person is already in this thread; the bot does not talk over them
  if (opts.claimed) return null;

  // ---- read it before paying to answer it ----------------------------
  const t = await triage(db, { orgId: opts.orgId, text: opts.body, convId: opts.convId, kind: opts.kind });
  const h = t.handling;

  for (const tag of h.tags) {
    await db("inbox_tags", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ contact_id: opts.contactId, tag }),
    }).catch(() => {});
  }

  // Somebody wanting to hire you, who left an address, belongs in the
  // pipeline — not only in a thread you might not read until Friday.
  if (h.lead) {
    await db("leads", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        name: h.lead.name, email: h.lead.email,
        want: opts.body.slice(0, 400), note: `via ${opts.channel} ${opts.kind}`,
        source: opts.channel,
      }),
    }).catch(() => {});
  }

  if (h.close || h.handoff || !h.answer) {
    await db(`inbox_conversations?id=eq.${opts.convId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify(h.close ? { status: "closed" } : { status: "open" }),
    }).catch(() => {});
    await db("inbox_flow_runs", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        org_id: opts.orgId, conv_id: opts.convId, matched: false,
        detail: { ai: h.close ? "closed" : "handoff", triage: t.triage?.kind ?? null, why: h.why },
      }),
    }).catch(() => {});
    return null;
  }

  // the last few turns, oldest first, so a follow-up like "and how much?"
  // is answerable at all
  const rows = await db(
    `inbox_messages?conv_id=eq.${opts.convId}&select=direction,body,at&order=at.desc&limit=7`,
  ).catch(() => []);
  const history = ((rows ?? []) as { direction: string; body: string }[])
    .reverse()
    .slice(0, -1)                       // the last one is the message we are answering
    .filter((m) => m.body && m.body !== "[handed to a person]")
    .map((m) => ({ role: (m.direction === "in" ? "user" : "assistant") as "user" | "assistant", text: m.body }));

  const res = await answerQuestion(db, {
    orgId: opts.orgId,
    triage: t.triage?.kind,
    question: opts.body,
    convId: opts.convId,
    contactId: opts.contactId,
    channel: opts.channel,
    kind: opts.kind,
    history,
  });

  if (!res.gate.send) {
    // Leave it where a human will see it, and say in the record WHY the
    // bot stood down. "The bot ignored me" and "the bot decided it did not
    // know" look identical from the outside and are not the same problem.
    await db(`inbox_conversations?id=eq.${opts.convId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "open" }),
    }).catch(() => {});
    await db("inbox_flow_runs", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        org_id: opts.orgId, conv_id: opts.convId, matched: false,
        detail: { ai: "handoff", reason: res.gate.reason, retrieved: res.hits.length },
      }),
    }).catch(() => {});
    return null;
  }

  const sent = res.gate;
  const cited = res.hits.filter((_, i) => sent.cites.includes(i + 1))
                        .map((h) => ({ chunk_id: h.chunk_id, title: h.title }));

  for (const t of sent.tags) {
    await db("inbox_tags", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ contact_id: opts.contactId, tag: t }),
    }).catch(() => {});
  }

  await db("inbox_flow_runs", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      org_id: opts.orgId, conv_id: opts.convId, matched: true,
      detail: {
        ai: "answered", model: res.model, cost_micros: res.cost_micros,
        degraded: res.degraded ?? false, confidence: sent.confidence, cites: cited,
        pattern: res.pattern ?? "grounded", pattern_why: res.pattern_why ?? null,
        tools: res.tools_used ?? [], awaiting: res.awaiting ?? [],
      },
    }),
  }).catch(() => {});

  return { text: sent.text, tags: sent.tags, callId: res.call_id ?? null };
}

// ============================================================
// META WEBHOOKS
// ============================================================

/** Meta signs every delivery with the app secret. An unsigned or
 *  wrongly-signed POST is not a webhook, it is a stranger, and it is
 *  dropped without touching the database. */
/** Is the caller staff?
 *
 *  The admin routes below send messages AS THE OWNER and spend money doing it
 *  on X, so "is this the owner" cannot be answered by the client claiming so.
 *  The caller's own JWT is verified against Supabase auth, and the resulting
 *  user id is looked up in inbox_staff — the same list the desk's RLS uses.
 *  Anonymous callers get nothing here; the site widget's routes are separate
 *  and cannot reach any of this. */
export type Caller = {
  profileId: string;
  /** every org they belong to, and what they may do in each */
  orgs: { id: string; slug: string; name: string; role: "owner" | "staff" | "viewer" }[];
};

/** Who is asking, and for whom do they work.
 *
 *  The token is verified against GoTrue rather than decoded here — a JWT
 *  this function has not checked the signature of is a claim, not an
 *  identity. The service key is refused explicitly: it is a key, not a
 *  person, and every route behind this can spend somebody's money. */
async function callerFor(req: Request): Promise<Caller | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const jwt = auth.slice(7).trim();
  if (!jwt || jwt === SRV) return null;          // the service key is not a person
  try {
    const res = await fetch(`${SB}/auth/v1/user`, {
      headers: { authorization: `Bearer ${jwt}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
    });
    if (!res.ok) return null;
    const user = await res.json();
    const uid = user?.id;
    if (!uid) return null;

    const rows = await db(`org_members?profile_id=eq.${uid}&select=role,orgs(id,slug,name,enabled)`);
    const orgs = (rows ?? [])
      .filter((r: { orgs?: { enabled?: boolean } }) => r.orgs?.enabled !== false)
      .map((r: { role: string; orgs: { id: string; slug: string; name: string } }) => ({
        id: r.orgs.id, slug: r.orgs.slug, name: r.orgs.name,
        role: r.role as "owner" | "staff" | "viewer",
      }));
    if (!orgs.length) return null;
    return { profileId: String(uid), orgs };
  } catch {
    return null;
  }
}

/** Which of the caller's orgs this request is about.
 *
 *  Named explicitly when they belong to more than one, and defaulted only
 *  when there is exactly one it could be. Guessing on their behalf is how
 *  somebody sends a message from the wrong company. */
function orgFor(caller: Caller, want: unknown): Caller["orgs"][number] | null {
  const asked = typeof want === "string" ? want.trim() : "";
  if (!asked) return caller.orgs.length === 1 ? caller.orgs[0] : null;
  return caller.orgs.find((o) => o.slug === asked || o.id === asked) ?? null;
}

/* ==================================================================
 * INGESTION AND SENDING — the platform half
 * ================================================================== */

/** Ids that are US. A comment we posted, delivered back as a webhook, must
 *  never be treated as a stranger talking to us — that is how a bot ends up
 *  in a conversation with itself. */
/** Every id that is US, across every tenant.
 *
 *  Deliberately not scoped to one org. The echo check asks "did we send
 *  this", and answering it for the wrong tenant would let one customer's
 *  bot answer another customer's bot — two machines talking to each other
 *  under somebody's post, forever. */
async function selfIdsFor(orgId?: string): Promise<string[]> {
  const rows = await db("org_channels?select=self_ids,account_id"
    + (orgId ? `&org_id=eq.${orgId}` : ""));
  const out: string[] = [];
  for (const r of rows ?? []) {
    if (Array.isArray(r.self_ids)) out.push(...r.self_ids.map(String));
    if (r.account_id) out.push(String(r.account_id));
  }
  return out;
}

/** Which tenant a webhook belongs to.
 *
 *  Two ways, because the platforms differ. A path segment — /o/<slug>/…
 *  — is exact and is what every per-tenant webhook should use. Meta is
 *  the exception: one app posts every page's events to ONE url, so the
 *  tenant is whichever one owns the account that received it.
 *
 *  Returning null means the event is dropped. That is correct and it is
 *  the safe direction: an event we cannot attribute answered under the
 *  wrong customer's name is far worse than one that is missed. */
async function orgForSlug(slug: string): Promise<string | null> {
  if (!slug) return null;
  const [row] = await db(`orgs?slug=eq.${encodeURIComponent(slug)}&enabled=is.true&select=id&limit=1`).catch(() => []);
  return row?.id ?? null;
}

async function orgForAccount(channel: string, accountId: string): Promise<string | null> {
  if (!accountId) return null;
  const [byAccount] = await db(
    `org_channels?channel=eq.${encodeURIComponent(channel)}&account_id=eq.${encodeURIComponent(accountId)}&enabled=is.true&select=org_id&limit=1`,
  ).catch(() => []);
  if (byAccount?.org_id) return byAccount.org_id;
  // some accounts are only ever named in self_ids
  const [bySelf] = await db(
    `org_channels?channel=eq.${encodeURIComponent(channel)}&self_ids=cs.{${encodeURIComponent(accountId)}}&enabled=is.true&select=org_id&limit=1`,
  ).catch(() => []);
  return bySelf?.org_id ?? null;
}

/** The secret that says an inbound webhook really came from the platform.
 *
 *  Per tenant where one is configured, because on a platform the shared
 *  one is shared with every OTHER tenant — and a secret every customer
 *  knows is a secret that identifies none of them. Falls back to the
 *  platform-wide env var, which is correct while there is one customer
 *  and is exactly what stops being correct when there are two. */
async function webhookSecretFor(orgId: string | null, channel: string, fallbackEnv: string): Promise<string> {
  if (orgId) {
    const [c] = await db(
      `org_channels?org_id=eq.${orgId}&channel=eq.${encodeURIComponent(channel)}&select=webhook_secret_env&limit=1`,
    ).catch(() => []);
    if (c?.webhook_secret_env) return Deno.env.get(String(c.webhook_secret_env)) ?? "";
  }
  return Deno.env.get(fallbackEnv) ?? "";
}

/** The org slug in /inbox/o/<slug>/… , or "". */
function slugFromPath(pathname: string): string {
  const m = /\/o\/([a-z0-9][a-z0-9_-]{0,62})(?:\/|$)/i.exec(pathname);
  return m ? m[1] : "";
}

/** What this ORG can do on this channel.
 *
 *  Two rows, and both have to say yes. The catalogue says what the
 *  platform permits and carries a kill switch for when an integration is
 *  broken for everybody; the org row says whether this customer turned it
 *  on and as which account. A customer cannot enable something the
 *  platform cannot do, and one broken integration does not become every
 *  customer's problem. */
async function capsFor(orgId: string, channel: string): Promise<Caps | undefined> {
  const [c] = await db(`inbox_channels?key=eq.${encodeURIComponent(channel)}&select=key,enabled,can_read_comments,can_reply_comments,can_send_dm,dm_window_hours&limit=1`);
  if (!c) return undefined;
  const [oc] = await db(
    `org_channels?org_id=eq.${orgId}&channel=eq.${encodeURIComponent(channel)}&select=enabled,account_id&limit=1`,
  ).catch(() => []);
  return {
    ...c,
    enabled: !!c.enabled && !!oc?.enabled,
    account_id: oc?.account_id ?? null,
  } as Caps;
}

/** Find or make the contact and the conversation this event belongs to.
 *  A comment thread and a DM thread with the same person are different
 *  conversations: replying to a comment in a DM thread would send the reply
 *  to the wrong place. */
async function threadFor(orgId: string, e: InEvent) {
  const [existing] = await db(
    `inbox_contacts?org_id=eq.${orgId}&channel=eq.${encodeURIComponent(e.channel)}&external_id=eq.${encodeURIComponent(e.actor_id)}&select=id&limit=1`);
  let contactId: string;
  if (existing) {
    contactId = existing.id;
    await db(`inbox_contacts?id=eq.${contactId}`, {
      method: "PATCH", body: JSON.stringify({ last_seen: new Date().toISOString() }),
    }).catch(() => {});
  } else {
    const made = await db("inbox_contacts", {
      method: "POST",
      body: JSON.stringify({
        org_id: orgId, channel: e.channel, external_id: e.actor_id,
        display_name: e.actor_name ?? null, handle: e.actor_name ?? null,
      }),
    });
    contactId = made[0].id;
  }

  // A comment thread and a DM thread with the same person are DIFFERENT
  // conversations. subject_ref is the post a comment hangs under, so every
  // comment on one post shares a thread and a DM never joins it — replying to
  // a public comment inside a DM thread would send it to the wrong place.
  const subject = e.kind === "comment" ? (e.parent_id ?? e.target_id) : null;
  const q = `inbox_conversations?org_id=eq.${orgId}&contact_id=eq.${contactId}&channel=eq.${encodeURIComponent(e.channel)}`
    + `&kind=eq.${e.kind}&status=eq.open`
    + (subject ? `&subject_ref=eq.${encodeURIComponent(subject)}` : "&subject_ref=is.null")
    + "&select=id,claimed_by,window_ends&order=last_at.desc&limit=1";
  const [open] = await db(q);
  if (open) return { contactId, conv: open };

  const made = await db("inbox_conversations", {
    method: "POST",
    body: JSON.stringify({ org_id: orgId, contact_id: contactId, channel: e.channel, kind: e.kind, subject_ref: subject }),
  });
  return { contactId, conv: made[0] };
}

/** Hours since this person last sent US something, or null if never. The
 *  24h window is measured from their message, not ours. */
async function sinceInboundHours(conversationId: string): Promise<number | null> {
  const [m] = await db(`inbox_messages?conv_id=eq.${conversationId}&direction=eq.in&select=at&order=at.desc&limit=1`);
  if (!m?.at) return null;
  return (Date.now() - new Date(m.at).getTime()) / 3_600_000;
}

/** Queue one thing to say, then try to send it now.
 *
 *  It is queued FIRST and always, including when the platform refuses. A
 *  refusal is an outcome worth keeping next to the successes: it is the
 *  answer to "why did nobody get thanked". */
async function queueAndSend(opts: {
  orgId: string;
  conversationId: string | null;
  channel: string;
  as: "comment_reply" | "private_reply" | "dm";
  targetId: string;
  text: string;
  dedupeKey?: string;
  /** the ai_calls row behind this, when a model wrote it */
  callId?: string | null;
}): Promise<{ state: string; detail?: string }> {
  const caps = await capsFor(opts.orgId, opts.channel);
  if (!caps) return { state: "refused", detail: `no such channel: ${opts.channel}` };

  const since = opts.conversationId ? await sinceInboundHours(opts.conversationId) : null;
  const ask = askFor({ caps, as: opts.as, target_id: opts.targetId, text: opts.text, since_inbound_hours: since });

  const row: Record<string, unknown> = {
    org_id: opts.orgId,
    conv_id: opts.conversationId, channel: opts.channel, as_kind: opts.as,
    target_id: opts.targetId, body: opts.text, dedupe_key: opts.dedupeKey ?? null,
    costs_money: ask.ok ? !!ask.costs_money : false,
    state: ask.ok ? "queued" : "refused",
    refusal: ask.ok ? null : ask.refusal,
  };
  let queued: any;
  try {
    [queued] = await db("inbox_outbound", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row),
    });
  } catch (e) {
    // a dedupe collision is the guard working, not a failure
    return { state: "duplicate", detail: String(e) };
  }
  if (!ask.ok) return { state: "refused", detail: ask.refusal };

  const token = await tokenFor(opts.orgId, opts.channel);
  if (!token) {
    await db(`inbox_outbound?id=eq.${queued.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ state: "failed", last_error: "no token configured for this channel", attempts: 1 }),
    });
    return { state: "failed", detail: "no token" };
  }

  try {
    // Where the credential goes is the platform's choice, not ours.
    // Telegram puts it in the path; everyone else sends a bearer header.
    // Substituting it here is the only place the token and the URL meet.
    const auth = ask.auth ?? "bearer";
    const url = auth === "url" ? ask.url.replace("{TOKEN}", encodeURIComponent(token)) : ask.url;
    const res = await fetch(url, {
      method: ask.method,
      headers: {
        "content-type": "application/json",
        ...(auth === "bearer" ? { authorization: `Bearer ${token}` } : {}),
        ...(ask.headers ?? {}),
      },
      body: JSON.stringify(ask.body),
    });
    const text = await res.text();
    if (!res.ok) {
      // the response body can echo the request URL back, token and all
      const safe = token ? text.replaceAll(token, "[token]").slice(0, 500) : text.slice(0, 500);
      await db(`inbox_outbound?id=eq.${queued.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ state: "failed", attempts: 1, last_error: safe }),
      });
      await noteCredential(opts.orgId, opts.channel, safe.slice(0, 300));
      return { state: "failed", detail: safe.slice(0, 200) };
    }
    let externalId: string | null = null;
    try {
      const j = JSON.parse(text);
      // Slack answers 200 with {ok:false,error} — an HTTP success that is
      // not a success, and the one shape that would otherwise be recorded
      // as sent when nothing was
      if (j?.ok === false && j?.error) {
        await db(`inbox_outbound?id=eq.${queued.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ state: "failed", attempts: 1, last_error: String(j.error).slice(0, 500) }),
        });
        await noteCredential(opts.orgId, opts.channel, String(j.error).slice(0, 300));
        return { state: "failed", detail: String(j.error) };
      }
      externalId = j?.id
        ?? j?.message_id
        ?? j?.ts                                    // slack
        ?? j?.result?.message_id?.toString()        // telegram
        ?? j?.messages?.[0]?.id                     // whatsapp
        ?? j?.rev                                   // bluesky chat
        ?? null;
      if (externalId != null) externalId = String(externalId);
    } catch { /* not json */ }
    await db(`inbox_outbound?id=eq.${queued.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ state: "sent", attempts: 1, sent_at: new Date().toISOString(), external_id: externalId }),
    });
    await noteCredential(opts.orgId, opts.channel, null);
    if (opts.conversationId) {
      await db("inbox_messages", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          org_id: opts.orgId,
          conv_id: opts.conversationId, direction: "out", body: opts.text,
          author: "bot", external_id: externalId, state: "sent",
          meta: opts.callId ? { source: "ai", call: opts.callId } : {},
        }),
      }).catch(() => {});
    }
    return { state: "sent" };
  } catch (e) {
    await db(`inbox_outbound?id=eq.${queued.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ state: "failed", attempts: 1, last_error: String(e).slice(0, 500) }),
    });
    return { state: "failed", detail: String(e) };
  }
}

/** Tokens live in function secrets. The row says which secret; it never holds
 *  one. A token in a database row is a token in every backup. */
/** The token for one org on one channel.
 *
 *  Two places it can live, never a third. An environment variable holds
 *  the house's own, and environment variables do not have rows — so every
 *  other tenant's lives in the Vault, which does. The row names which; it
 *  never holds the token, because a token in a table is a token in every
 *  backup. */
async function tokenFor(orgId: string, channel: string): Promise<string | null> {
  const [c] = await db(
    `org_channels?org_id=eq.${orgId}&channel=eq.${encodeURIComponent(channel)}&select=token_env,secret_id&limit=1`,
  ).catch(() => []);
  if (!c) return null;
  if (c.token_env) return Deno.env.get(String(c.token_env)) ?? null;
  if (c.secret_id) {
    // vault.decrypted_secrets is readable by the service role and nobody
    // else. If the extension is not installed this simply returns nothing,
    // which shows up as "no token configured" rather than as a crash.
    const [sec] = await db(
      `rpc/vault_secret`, { method: "POST", body: JSON.stringify({ p_id: c.secret_id }) },
    ).catch(() => []);
    return typeof sec === "string" ? sec : (sec?.secret ?? null);
  }
  return null;
}

/** Record whether the last real call worked, so a dead token is visible
 *  before the silence is. */
async function noteCredential(orgId: string, channel: string, error: string | null) {
  const patch = error
    ? { last_error: error, last_error_at: new Date().toISOString() }
    : { last_ok_at: new Date().toISOString(), last_error: null };
  await db(`org_channels?org_id=eq.${orgId}&channel=eq.${encodeURIComponent(channel)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
  }).catch(() => {});
}

/** THANK THE PEOPLE WHO FOLLOW YOU — where that is possible at all.
 *
 *  It is possible on X and nowhere else of the four, and not because the other
 *  three are unconfigured:
 *
 *    Instagram  has no follow event and does not expose the follower list,
 *               only a count. There is nothing to diff and nothing to notify.
 *    Threads    has no direct-message API.
 *    LinkedIn   requires a member to press send on an editable draft.
 *    Facebook   Pages have likes, not followers you may message unprompted.
 *
 *  So this polls X's follower list and diffs it against what we have seen.
 *  Polling is the only mechanism there is; there is no follow webhook to
 *  subscribe to. The first sweep on a fresh install would otherwise message
 *  every follower you already have, so it RECORDS them and greets nobody --
 *  the diff only means anything once there is a previous snapshot.
 */
type Follower = { id: string; handle?: string };

/** Everyone who follows us on a channel that will say.
 *
 *  Two of the four Meta platforms cannot answer this question at all —
 *  Instagram gives a count and no list — so the refusals here are facts,
 *  not settings, and they say which. */
async function fetchFollowers(orgId: string, channel: string, accountId: string | null):
    Promise<{ list: Follower[] } | { error: string }> {

  if (channel === "x") {
    const token = await tokenFor(orgId, channel);
    if (!token) return { error: "no X token configured" };
    if (!accountId) return { error: "inbox_credentials.account_id must hold the X user id to read followers" };
    const list: Follower[] = [];
    let next: string | undefined;
    for (let page = 0; page < 15; page++) {        // a ceiling, so a bad cursor cannot spin
      const u = new URL(`https://api.x.com/2/users/${accountId}/followers`);
      u.searchParams.set("max_results", "1000");
      if (next) u.searchParams.set("pagination_token", next);
      const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
      const text = await res.text();
      if (!res.ok) { await noteCredential(orgId, channel, text.slice(0, 300)); return { error: text.slice(0, 300) }; }
      const body = JSON.parse(text);
      for (const d of body?.data ?? []) list.push({ id: String(d.id), handle: d.username });
      next = body?.meta?.next_token;
      if (!next) break;
    }
    await noteCredential(orgId, channel, null);
    return { list };
  }

  if (channel === "bluesky") {
    const sess = await blueskyLogin(orgId);
    if (!sess) return { error: "BSKY_HANDLE is not set, or no app password is configured for this org" };
    const host = accountId || "https://bsky.social";
    const list: Follower[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 40; page++) {
      const u = new URL(`${host}/xrpc/app.bsky.graph.getFollowers`);
      u.searchParams.set("actor", sess.did);
      u.searchParams.set("limit", "100");
      if (cursor) u.searchParams.set("cursor", cursor);
      const res = await fetch(u, { headers: { authorization: `Bearer ${sess.jwt}` } });
      const text = await res.text();
      if (!res.ok) { await noteCredential(orgId, channel, text.slice(0, 300)); return { error: text.slice(0, 300) }; }
      const body = JSON.parse(text);
      for (const f of body?.followers ?? []) list.push({ id: String(f.did), handle: f.handle });
      cursor = body?.cursor;
      if (!cursor || !(body?.followers ?? []).length) break;
    }
    await noteCredential(orgId, channel, null);
    return { list };
  }

  if (channel === "instagram" || channel === "facebook") {
    return { error: `${channel} does not expose a follower list — only a count. There is nothing to diff, `
      + "and no follow event exists either. This is a platform fact, not a setting." };
  }
  if (channel === "telegram" || channel === "slack" || channel === "whatsapp") {
    return { error: `${channel} has no such thing as a follower. People message you or they do not.` };
  }
  return { error: `no follower list is wired for ${channel}` };
}

/** Where a message to this follower is addressed.
 *
 *  On X the follower id IS the address. On Bluesky a DM goes to a
 *  CONVERSATION, so one has to be opened first — and that is also the
 *  step that fails, per person, when somebody only accepts messages from
 *  people they follow. That failure is theirs to make and is recorded
 *  rather than retried. */
async function dmTargetFor(orgId: string, channel: string, f: Follower, accountId: string | null): Promise<string | null> {
  if (channel !== "bluesky") return f.id;
  const sess = await blueskyLogin(orgId);
  if (!sess) return null;
  const host = accountId || "https://bsky.social";
  const u = new URL(`${host}/xrpc/chat.bsky.convo.getConvoForMembers`);
  u.searchParams.set("members", f.id);
  const res = await fetch(u, {
    headers: { authorization: `Bearer ${sess.jwt}`, "atproto-proxy": "did:web:api.bsky.chat#bsky_chat" },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.convo?.id ? String(body.convo.id) : null;
}

/** Diff the follower list against the last snapshot and greet whoever is
 *  new. Works the same on every channel that can answer the question;
 *  everything channel-specific is in the two functions above. */
async function sweepFollowers(orgId: string, channel: string, opts: { dryRun?: boolean } = {}) {
  const [cred] = await db(`org_channels?org_id=eq.${orgId}&channel=eq.${encodeURIComponent(channel)}&select=account_id,follow_greeting,auto_greet&limit=1`);
  const caps = await capsFor(orgId, channel);
  if (!caps) return { error: `no such channel: ${channel}` };
  if (!caps.enabled) return { error: `the ${channel} channel is switched off` };

  const got = await fetchFollowers(orgId, channel, cred?.account_id ?? null);
  if ("error" in got) return { error: got.error };
  const current = got.list;

  const seen = await db(`inbox_followers?org_id=eq.${orgId}&channel=eq.${encodeURIComponent(channel)}&select=follower_id`);
  const had = new Set((seen ?? []).map((r: { follower_id: string }) => String(r.follower_id)));
  const fresh = current.filter((f) => !had.has(f.id));
  const firstEver = (seen?.length ?? 0) === 0;

  // record everyone, always — the snapshot is the point
  if (fresh.length) {
    await db("inbox_followers", {
      method: "POST", headers: { Prefer: "return=minimal,resolution=ignore-duplicates" },
      body: JSON.stringify(fresh.map((f) => ({
        org_id: orgId, channel, follower_id: f.id, handle: f.handle ?? null,
        // a first sweep has no previous snapshot, so nobody here is NEW —
        // marking them greeted stops the next sweep messaging your whole
        // existing following at once
        greeted_at: firstEver ? new Date().toISOString() : null,
      }))),
    });
  }

  if (firstEver) {
    return { recorded: fresh.length, greeted: 0,
             note: "first sweep: recorded your existing followers as the baseline and messaged nobody. The next sweep greets whoever is new." };
  }
  if (!cred?.follow_greeting?.trim()) {
    return { recorded: fresh.length, greeted: 0, note: "no follow_greeting is set for this channel, so nobody was messaged." };
  }

  // Costing money and being free are different situations and get
  // different defaults: on X every send is billed, so nothing goes until
  // a person turns auto_greet on. On Bluesky it is free.
  const billed = channel === "x";
  if (opts.dryRun) {
    return { recorded: fresh.length, would_greet: fresh.length, dry_run: true,
             note: billed ? `each send costs money on ${channel}. ${fresh.length} would be messaged.`
                          : `${fresh.length} would be messaged. Free on ${channel}.` };
  }
  if (billed && !cred.auto_greet) {
    return { recorded: fresh.length, greeted: 0,
             note: `${fresh.length} new followers recorded and NOT messaged: every ${channel} DM is billed, so auto_greet is off until you turn it on.` };
  }
  if (!cred.auto_greet) {
    return { recorded: fresh.length, greeted: 0,
             note: `${fresh.length} new followers recorded and NOT messaged: auto_greet is off for ${channel}.` };
  }

  let greeted = 0;
  const failures: string[] = [];
  for (const f of fresh) {
    const target = await dmTargetFor(orgId, channel, f, cred.account_id ?? null);
    if (!target) {
      failures.push(`${f.handle ?? f.id}: could not open a conversation — they may only accept messages from people they follow`);
      continue;
    }
    const r = await queueAndSend({
      orgId, conversationId: null, channel, as: "dm", targetId: target,
      text: cred.follow_greeting, dedupeKey: `follow:${channel}:${f.id}`,
    });
    if (r.state === "sent") {
      greeted++;
      await db(`inbox_followers?org_id=eq.${orgId}&channel=eq.${encodeURIComponent(channel)}&follower_id=eq.${f.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ greeted_at: new Date().toISOString() }),
      }).catch(() => {});
    } else if (r.state !== "duplicate") {
      failures.push(`${f.handle ?? f.id}: ${r.detail ?? r.state}`);
    }
  }
  return { recorded: fresh.length, greeted, failures: failures.slice(0, 10) };
}

// ============================================================
// BLUESKY — the one that has to be asked
//
// Nothing on Bluesky pushes. There are no webhooks, so there is nothing to
// verify and nothing to acknowledge fast; instead somebody has to ask, on
// a schedule, and the answer is turned into the same events every other
// channel produces.
//
// The credential is a HANDLE and an APP PASSWORD, not a token: an app
// password is exchanged for a session whose accessJwt expires in a couple
// of hours. Caching the session and re-creating it on 401 is the whole of
// the token management here.
// ============================================================

// Per ORG, keyed by org id. One shared session would sign every tenant's
// posts as whoever logged in first, which is the single worst bug this
// file could have.
const bskySessions = new Map<string, { jwt: string; did: string; at: number }>();

async function blueskyLogin(orgId: string, force = false): Promise<{ jwt: string; did: string } | null> {
  const handle = Deno.env.get("BSKY_HANDLE") ?? "";
  const pw = await tokenFor(orgId, "bluesky");
  if (!handle || !pw) return null;
  // an accessJwt lives about two hours; re-use it for one
  const held = bskySessions.get(orgId);
  if (!force && held && Date.now() - held.at < 3600_000) return held;
  const host = (await capsFor(orgId, "bluesky"))?.account_id || "https://bsky.social";
  const r = await fetch(`${host}/xrpc/com.atproto.server.createSession`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: pw }),
  });
  if (!r.ok) {
    await noteCredential(orgId, "bluesky", `createSession ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return null;
  }
  const j = await r.json();
  if (!j?.accessJwt || !j?.did) return null;
  const sess = { jwt: j.accessJwt, did: j.did, at: Date.now() };
  bskySessions.set(orgId, sess);
  return sess;
}

/** Ask Bluesky what has happened since last time.
 *
 *  Idempotency is external_id, exactly as it is for a webhook: polling the
 *  same conversation twice produces the same external_id and the second
 *  insert collides instead of becoming a second reply. That is what makes
 *  it safe to run this as often as you like. */
async function pollBluesky(orgId: string): Promise<{ found: number; error?: string }> {
  const caps = await capsFor(orgId, "bluesky");
  if (!caps?.enabled) return { found: 0, error: "bluesky is switched off" };
  const sess = await blueskyLogin(orgId);
  if (!sess) return { found: 0, error: "BSKY_HANDLE is not set, or no app password is configured for this org, or the login was refused" };
  const host = caps.account_id || "https://bsky.social";

  const get = async (path: string, chat = false) => {
    const r = await fetch(`${host}/xrpc/${path}`, {
      headers: {
        authorization: `Bearer ${sess.jwt}`,
        ...(chat ? { "atproto-proxy": "did:web:api.bsky.chat#bsky_chat" } : {}),
      },
    });
    if (r.status === 401) {                       // the session aged out mid-poll
      const fresh = await blueskyLogin(orgId, true);
      if (!fresh) return null;
      return get(path, chat);
    }
    if (!r.ok) return null;
    return r.json();
  };

  const events: InEvent[] = [];
  const convos = await get("chat.bsky.convo.listConvos?limit=30", true);
  if (convos) events.push(...parseBlueskyConvos(convos, sess.did));
  const notifs = await get("app.bsky.notification.listNotifications?limit=40");
  if (notifs) events.push(...parseBlueskyNotifications(notifs, sess.did));

  for (const e of events) await ingest(orgId, e).catch(() => {});
  await noteCredential(orgId, "bluesky", null);
  return { found: events.length };
}

/** One inbound event: record it, run the flows, send what they decided. */
async function ingest(orgId: string, e: InEvent) {
  if (e.is_echo) return;
  const caps = await capsFor(orgId, e.channel);
  if (!caps?.enabled) return;                 // arrived for a channel that is off

  const { contactId, conv } = await threadFor(orgId, e);

  // external_id is unique, so a redelivery collides here rather than becoming
  // a second message and a second reply.
  try {
    await db("inbox_messages", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        org_id: orgId, conv_id: conv.id, direction: "in", body: e.body,
        author: "contact", external_id: e.external_id, at: e.at, state: "delivered",
      }),
    });
  } catch {
    return;                                    // already seen this one
  }

  await db(`inbox_conversations?id=eq.${conv.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_at: new Date().toISOString() }),
  }).catch(() => {});

  const prior = await db(`inbox_messages?conv_id=eq.${conv.id}&direction=eq.in&select=id`);
  const first = (prior?.length ?? 0) <= 1;
  // tags belong to the PERSON, not the thread — someone who asked about the
  // music once is a music person in their next conversation too
  const tags = (await db(`inbox_tags?contact_id=eq.${contactId}&select=tag`))?.map((t: { tag: string }) => t.tag) ?? [];

  const flows = await db(`inbox_flows?org_id=eq.${orgId}&enabled=is.true&select=*&order=ordinal.asc`) as Flow[];
  const ctx: Ctx = { body: e.body, channel: e.channel, kind: e.kind, first, tags, claimed: !!conv.claimed_by };
  const decision = decide(flows ?? [], ctx);

  await db("inbox_flow_runs", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ org_id: orgId, conv_id: conv.id, matched: decision.actions.length > 0, detail: { trace: decision.trace } }),
  }).catch(() => {});

  let spoke = false;

  for (const a of decision.actions) {
    if (a.do === "tag") {
      await db("inbox_tags", { method: "POST", headers: { Prefer: "return=minimal,resolution=ignore-duplicates" },
        body: JSON.stringify({ contact_id: contactId, tag: a.tag }) }).catch(() => {});
    } else if (a.do === "untag") {
      await db(`inbox_tags?contact_id=eq.${contactId}&tag=eq.${encodeURIComponent(a.tag)}`, { method: "DELETE" }).catch(() => {});
    } else if (a.do === "handoff") {
      // there is no needs_human column; a thread waiting for a person is a
      // thread nobody has claimed, which the desk already sorts to the top
      await db(`inbox_conversations?id=eq.${conv.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "open", claimed_by: null }) }).catch(() => {});
    } else if (a.do === "close") {
      await db(`inbox_conversations?id=eq.${conv.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "closed" }) }).catch(() => {});
    } else if (a.do === "reply") {
      // A comment is answered in public where it was made; a DM as a DM.
      // Answering a public comment privately, or the reverse, is the kind of
      // mistake that is very visible.
      const as = e.kind === "comment" ? "comment_reply" : "dm";
      await queueAndSend({
        orgId, conversationId: conv.id, channel: e.channel, as, targetId: e.target_id,
        text: a.text, dedupeKey: `${e.external_id}:${as}:${a.text.slice(0, 40)}`,
      });
      spoke = true;
    }
  }

  // No rule fired. This is the case the flows cannot cover — somebody
  // asking something nobody thought to write down — and it is the whole
  // reason there is a model in here at all.
  if (!spoke && !conv.claimed_by) {
    const ai = await aiFallback({
      orgId, convId: conv.id, contactId, channel: e.channel, kind: e.kind,
      body: e.body, claimed: !!conv.claimed_by,
    });
    if (ai) {
      const as = e.kind === "comment" ? "comment_reply" : "dm";
      await queueAndSend({
        orgId, conversationId: conv.id, channel: e.channel, as, targetId: e.target_id,
        text: ai.text, dedupeKey: `${e.external_id}:${as}:ai`, callId: ai.callId,
      });
    }
  }

  await remember(db, { orgId, contactId, convId: conv.id, text: e.body });
}

/** Compare without leaking where the difference is. Length is compared
 *  first and separately: it is not secret, and a short-circuit on it is
 *  the only way to make the loop below well-defined. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Slack signs `v0:timestamp:body`, and the timestamp is part of what is
 *  signed precisely so it can be checked: a valid signature replayed an
 *  hour later is still a valid signature. Five minutes is Slack's own
 *  recommended window. */
async function slackSignatureOk(raw: string, headers: Headers, secret: string): Promise<boolean> {
  if (!secret) return false;                    // unconfigured = refuse, never allow
  const ts = headers.get("x-slack-request-timestamp") ?? "";
  const sig = headers.get("x-slack-signature") ?? "";
  if (!/^\d+$/.test(ts) || !sig.startsWith("v0=")) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  return timingSafeEqual(`v0=${await hmacHex(secret, `v0:${ts}:${raw}`)}`, sig);
}

async function metaSignatureOk(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return false;              // not configured = refuse, never allow
  if (!header?.startsWith("sha256=")) return false;
  return timingSafeEqual(await hmacHex(APP_SECRET, raw), header.slice(7));
}

/** Deliver a batch of events to whichever tenant each one belongs to.
 *
 *  Two ways to know, and they are tried in that order. A slug in the path
 *  is exact and is how a per-tenant webhook should be registered. Meta is
 *  the exception — one app, one URL, every customer's Pages — so there the
 *  account the event ARRIVED AT names the tenant, and a single delivery
 *  can legitimately carry entries for several of them.
 *
 *  An event that matches neither is DROPPED, and the drop is recorded.
 *  That is the safe direction: a missed message is a bad afternoon, and a
 *  message answered under the wrong customer's name is a different kind of
 *  problem entirely. */
async function routeAndIngest(events: InEvent[], pathname: string) {
  if (!events.length) return;
  const pinned = await orgForSlug(slugFromPath(pathname));
  for (const e of events) {
    const orgId = pinned ?? (e.recipient_id ? await orgForAccount(e.channel, e.recipient_id) : null);
    if (!orgId) {
      await db("inbox_flow_runs", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          matched: false,
          detail: { unattributed: true, channel: e.channel, recipient_id: e.recipient_id ?? null,
                    external_id: e.external_id },
        }),
      }).catch(() => {});
      continue;
    }
    await ingest(orgId, e).catch(async (err) => {
      await db("inbox_flow_runs", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ org_id: orgId, matched: false,
                               detail: { ingest_error: String(err), external_id: e.external_id } }),
      }).catch(() => {});
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  // ---- Meta's one-time handshake ------------------------------------
  if (req.method === "GET" && url.searchParams.get("hub.mode") === "subscribe") {
    const token = url.searchParams.get("hub.verify_token");
    if (!VERIFY || token !== VERIFY) return new Response("no", { status: 403, headers: cors });
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: cors });
  }

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const raw = await req.text();

  // ---- Meta's deliveries --------------------------------------------
  // Identified by the signature header rather than by a path, because
  // Meta posts to one URL and puts the object type in the body.
  const sig = req.headers.get("x-hub-signature-256");
  if (sig) {
    if (!(await metaSignatureOk(raw, sig))) {
      return new Response("bad signature", { status: 401, headers: cors });
    }
    // Acknowledge FAST and unconditionally. Meta retries anything that is
    // not a prompt 200, and a retry storm caused by our own slow handler is
    // worse than a late reply. So the work is started and NOT awaited: the
    // 200 goes back now and ingestion finishes on its own.
    let events: InEvent[] = [];
    try {
      const payload = JSON.parse(raw);
      const selfIds = await selfIdsFor();
      // Same signature, same envelope, different value schema — and
      // parseMeta would happily read a WhatsApp delivery as a Facebook one
      // and produce nothing, silently. The object type decides.
      events = String(payload?.object ?? "") === "whatsapp_business_account"
        ? parseWhatsApp(payload, selfIds)
        : parseMeta(payload, selfIds);
    } catch { /* a body we cannot parse is still acknowledged */ }

    // deliberately not awaited — see above
    background(routeAndIngest(events, url.pathname));
    return new Response("ok", { status: 200, headers: cors });
  }

  // ---- Telegram ------------------------------------------------------
  // No signature, a shared secret in a header. Constant-time compared, and
  // absent-secret means refuse: a webhook you cannot authenticate is a
  // webhook anybody can post to.
  if (url.pathname.includes("/telegram") || req.headers.has("x-telegram-bot-api-secret-token")) {
    // Telegram never says which bot an update is for, so the tenant is in
    // the path and nowhere else: register /inbox/o/<slug>/telegram.
    const orgId = await orgForSlug(slugFromPath(url.pathname));
    const want = await webhookSecretFor(orgId, "telegram", "TELEGRAM_SECRET");
    const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!want || !timingSafeEqual(want, got)) {
      return new Response("bad secret", { status: 401, headers: cors });
    }
    let events: InEvent[] = [];
    try {
      events = parseTelegram(JSON.parse(raw), await selfIdsFor(orgId ?? undefined));
    } catch { /* unparseable is still acknowledged; Telegram retries otherwise */ }
    background(routeAndIngest(events, url.pathname));
    return new Response("ok", { status: 200, headers: cors });
  }

  // ---- Slack ---------------------------------------------------------
  if (url.pathname.includes("/slack") || req.headers.has("x-slack-signature")) {
    const orgId = await orgForSlug(slugFromPath(url.pathname));
    const secret = await webhookSecretFor(orgId, "slack", "SLACK_SIGNING_SECRET");
    if (!(await slackSignatureOk(raw, req.headers, secret))) {
      return new Response("bad signature", { status: 401, headers: cors });
    }
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(raw); } catch { /* ignore */ }
    // the one-time handshake, which must echo the challenge and nothing else
    if (payload.type === "url_verification") {
      return new Response(String(payload.challenge ?? ""), { status: 200, headers: cors });
    }
    background(routeAndIngest(parseSlack(payload, await selfIdsFor(orgId ?? undefined)), url.pathname));
    return new Response("", { status: 200, headers: cors });
  }

  // ---- the site widget ----------------------------------------------
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const action = String(payload.action ?? "");
  const key = payload.visitor_key;

  // ---- WHAT THIS DEPLOYMENT CAN ACTUALLY DO ---------------------------
  //
  // Public, unauthenticated, and cheap on purpose: the site asks this
  // before it decides whether to lead with the conversation or with the
  // cards. A chat-first page in front of a function that cannot answer a
  // question is worse than the cards were.
  //
  // The signal is the ROUTE'S OWN EXISTENCE. An older deployment does not
  // have this branch and answers "unknown action" — which is a complete,
  // unambiguous "the brain is not here" with nothing to configure and
  // nothing to keep in sync. It cannot drift, because it is not a flag.
  //
  // It reports capability, never content: how many passages exist, not
  // what any of them say, and nothing at all about any customer.
  if (action === "health") {
    const org = await orgForSlug(String(payload.org ?? "") || "mccluster");
    const docs = org
      ? await db(`kb_documents?org_id=eq.${org}&enabled=is.true&select=id`).catch(() => [])
      : [];
    const documents = Array.isArray(docs) ? docs.length : 0;
    return json({
      ok: true,
      brain: true,                       // this build has the answering path
      ai: aiEnabled(),                   // an ANTHROPIC_API_KEY is present
      documents,                         // how many, never what they say
      answers: documents > 0 && aiEnabled(),
      at: new Date().toISOString(),
    });
  }

  // ---- the back office ------------------------------------------------
  // Everything here acts as the owner, so everything here is staff-only.
  if (action === "channels" || action === "set_channel" || action === "followers"
      || action === "outbound" || action === "send"
      || action === "kb_put" || action === "kb_list" || action === "kb_drop"
      || action === "kb_try" || action === "ai_spend" || action === "memory"
      || action === "shared_put" || action === "poll" || action === "eval"
      || action === "tools" || action === "set_tool" || action === "set_server"
      || action === "refresh_tools" || action === "approvals" || action === "decide"
      || action === "experiments" || action === "set_experiment") {
    const caller = await callerFor(req);
    if (!caller) return json({ error: "staff only" }, 403);
    const org = orgFor(caller, payload.org);
    if (!org) {
      return json({
        error: caller.orgs.length > 1
          ? "name which org this is for"
          : "staff only",
        orgs: caller.orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name, role: o.role })),
      }, 403);
    }
    const me = caller.profileId;
    // Reading is staff. Changing a credential, spending money, or
    // authorising a claim to be made in the org's name is the owner's.
    const OWNER_ONLY = ["set_channel", "send", "followers", "kb_put", "kb_drop", "shared_put", "poll",
                        "set_server", "set_tool", "set_experiment"];
    if (OWNER_ONLY.includes(action) && org.role !== "owner") {
      return json({ error: `${action} is the owner's to do, and you are ${org.role} here` }, 403);
    }

    if (action === "channels") {
      // The catalogue says what each platform CAN do; the org row says
      // whether this customer has turned it on and as whom. Two different
      // facts, and they were the same column until 0026.
      const cat = await db("inbox_channels?select=*&order=key.asc");
      const mine = await db(`org_channels?org_id=eq.${org.id}&select=*`);
      const byChannel = Object.fromEntries((mine ?? []).map((c: { channel: string }) => [c.channel, c]));
      return json({
        org: { id: org.id, slug: org.slug, name: org.name, role: org.role },
        channels: (cat ?? []).map((r: { key: string; enabled: boolean }) => {
          const oc = byChannel[r.key] ?? null;
          return {
            ...r,
            // the catalogue's own flag is a PLATFORM kill switch; what the
            // desk means by "on" is this customer's row
            platform_enabled: r.enabled,
            enabled: !!oc?.enabled && r.enabled,
            credential: oc
              ? { token_env: oc.token_env, secret_id: oc.secret_id ? "(vault)" : null,
                  account_id: oc.account_id, account_label: oc.account_label,
                  follow_greeting: oc.follow_greeting, auto_greet: oc.auto_greet,
                  last_ok_at: oc.last_ok_at, last_error: oc.last_error, last_error_at: oc.last_error_at }
              : null,
            // a token that is NAMED but not SET is the commonest reason for
            // silence, and it is invisible unless something says so
            token_present: oc?.secret_id ? true
              : oc?.token_env ? !!Deno.env.get(String(oc.token_env)) : false,
          };
        }),
      });
    }

    if (action === "set_channel") {
      const key = String(payload.channel ?? "");
      if (!key) return json({ error: "channel required" }, 400);
      // FIRST, before the channel is even looked up. A token arriving in
      // this request is already a token in a request log, and the answer
      // has to be the same whether or not the rest of the call was valid.
      for (const forbidden of ["token", "access_token", "secret", "password", "api_key"]) {
        if (forbidden in payload) {
          return json({ error: `never send a ${forbidden} here. Put it in the Vault or a function secret and name it with token_env.` }, 400);
        }
      }

      const [known] = await db(`inbox_channels?key=eq.${encodeURIComponent(key)}&select=key&limit=1`);
      if (!known) return json({ error: `no such channel: ${key}` }, 400);

      // Upsert this ORG's row. The catalogue is not touched: one customer
      // switching Instagram off must not switch it off for everybody, and
      // before 0026 it would have.
      const row: Record<string, unknown> = { org_id: org.id, channel: key, updated_at: new Date().toISOString() };
      if ("enabled" in payload) row.enabled = !!payload.enabled;
      if ("follow_greeting" in payload) row.follow_greeting = String(payload.follow_greeting ?? "").slice(0, 900) || null;
      if ("auto_greet" in payload) row.auto_greet = !!payload.auto_greet;
      if ("account_id" in payload) row.account_id = String(payload.account_id ?? "") || null;
      if ("account_label" in payload) row.account_label = String(payload.account_label ?? "") || null;
      if ("token_env" in payload) row.token_env = String(payload.token_env ?? "") || null;
      if ("self_ids" in payload && Array.isArray(payload.self_ids)) row.self_ids = payload.self_ids.map(String);
      await db("org_channels", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      });
      return json({ ok: true });
    }

    if (action === "followers") {
      const channel = String(payload.channel ?? "x");
      return json(await sweepFollowers(org.id, channel, { dryRun: !!payload.dry_run }));
    }

    if (action === "outbound") {
      const rows = await db(`inbox_outbound?org_id=eq.${org.id}&select=*&order=created_at.desc&limit=100`);
      return json({ outbound: rows ?? [] });
    }

    if (action === "send") {
      // a person, at the desk, saying one thing on purpose
      const channel = String(payload.channel ?? "");
      const as = String(payload.as ?? "dm");
      if (as !== "dm" && as !== "comment_reply" && as !== "private_reply") {
        return json({ error: "as must be dm, comment_reply or private_reply" }, 400);
      }
      const target = String(payload.target_id ?? "");
      const text = String(payload.text ?? "");
      if (!channel || !target || !text.trim()) return json({ error: "channel, target_id and text are required" }, 400);
      const r = await queueAndSend({
        orgId: org.id,
        conversationId: payload.conv_id ? String(payload.conv_id) : null,
        channel, as, targetId: target, text,
      });
      return json(r, r.state === "sent" ? 200 : 422);
    }

    // Was it any good? The only signal that is worth anything comes from
    // somebody who read the answer and knows what the right one was.
    if (action === "eval") {
      const callId = String(payload.call_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(callId)) return json({ error: "bad call id" }, 400);
      const [ownCall] = await db(`ai_calls?id=eq.${callId}&org_id=eq.${org.id}&select=id&limit=1`).catch(() => []);
      if (!ownCall) return json({ error: "no such call here" }, 404);
      const verdict = Number(payload.verdict);
      if (![-1, 0, 1].includes(verdict)) return json({ error: "verdict must be -1, 0 or 1" }, 400);
      const dimension = String(payload.dimension ?? "helpful");
      if (!["grounded", "helpful", "in_voice", "safe"].includes(dimension)) {
        return json({ error: "dimension must be grounded, helpful, in_voice or safe" }, 400);
      }
      await db("ai_evals", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          call_id: callId, dimension, verdict,
          note: payload.note ? String(payload.note).slice(0, 500) : null,
          by_staff: me,
        }),
      });
      return json({ ok: true });
    }

    // ---- experiments ------------------------------------------------
    // The scoreboard reads ai_calls next to ai_evals. What it will mostly
    // say, honestly, is "not enough verdicts yet" — which is the correct
    // answer to almost every A/B test anybody has ever run at this size.

    if (action === "experiments") {
      const rows = await db(`ai_experiments?org_id=eq.${org.id}&select=*&order=created_at.desc&limit=50`);
      const scores = await db(`ai_arm_scores?org_id=eq.${org.id}&select=*`).catch(() => []);
      const byExp: Record<string, unknown[]> = {};
      for (const s0 of scores ?? []) {
        (byExp[String((s0 as { experiment: string }).experiment)] ??= []).push(s0);
      }
      return json({
        ok: true,
        experiments: (rows ?? []).map((e: { key: string }) => {
          const arms = (byExp[e.key] ?? []) as Parameters<typeof readScoreboard>[0];
          return { ...e, scores: arms, reading: readScoreboard(arms) };
        }),
      });
    }

    if (action === "set_experiment") {
      const key = String(payload.key ?? "").trim();
      if (!key) return json({ error: "a key" }, 400);
      const row: Record<string, unknown> = { org_id: org.id, key };
      if ("note" in payload) row.note = String(payload.note ?? "") || null;
      if ("enabled" in payload) row.enabled = !!payload.enabled;
      if ("ended" in payload && payload.ended) row.ended_at = new Date().toISOString();
      if ("dimension" in payload) {
        const d = String(payload.dimension);
        if (!["voice", "model", "effort"].includes(d)) return json({ error: "dimension is voice, model or effort" }, 400);
        row.dimension = d;
      }
      if ("arms" in payload) {
        const arms = Array.isArray(payload.arms) ? payload.arms : [];
        // Refused here as well as by the constraint, because "two arms and
        // a positive weight each" deserves a sentence rather than a
        // constraint-violation string.
        if (arms.length < 2) return json({ error: "an experiment needs at least two arms" }, 400);
        for (const a of arms as { name?: unknown; weight?: unknown }[]) {
          if (typeof a?.name !== "string" || !a.name.trim()) return json({ error: "every arm needs a name" }, 400);
          if (!Number.isFinite(Number(a?.weight)) || Number(a.weight) <= 0) {
            return json({ error: `arm "${a.name}" needs a weight above zero — an arm that never runs is not a control` }, 400);
          }
        }
        row.arms = arms;
      }
      try {
        await db("ai_experiments", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(row),
        });
      } catch (e) {
        return json({ error: String(e).slice(0, 200) }, 400);
      }
      return json({ ok: true, key });
    }

    // ---- tools ------------------------------------------------------
    // What the org's own machines can do, and which of it the bot may
    // reach for. Every tool arrives switched OFF.

    if (action === "tools") {
      const servers = await db(`mcp_servers?org_id=eq.${org.id}&select=id,name,url,enabled,auth_kind,token_env,secret_id,tools_refreshed_at,last_ok_at,last_error,last_error_at&order=name.asc`);
      const tools = await db(`mcp_tools?org_id=eq.${org.id}&select=id,server_id,name,title,description,enabled,risk,auto,rejected,refreshed_at&order=name.asc`);
      return json({
        ok: true,
        servers: (servers ?? []).map((sv: Record<string, unknown>) => ({
          ...sv,
          secret_id: sv.secret_id ? "(vault)" : null,
          token_present: sv.secret_id ? true : sv.token_env ? !!Deno.env.get(String(sv.token_env)) : sv.auth_kind === "none",
        })),
        tools: tools ?? [],
      });
    }

    if (action === "set_server") {
      const row: Record<string, unknown> = { org_id: org.id };
      for (const f of ["name", "url", "auth_kind", "auth_header", "token_env"]) {
        if (f in payload) row[f] = String(payload[f] ?? "") || null;
      }
      if ("enabled" in payload) row.enabled = !!payload.enabled;
      if ("tools_ttl_s" in payload) row.tools_ttl_s = Math.max(30, Number(payload.tools_ttl_s) || 300);
      for (const forbidden of ["token", "secret", "password", "api_key"]) {
        if (forbidden in payload) return json({ error: `never send a ${forbidden} here` }, 400);
      }
      if (payload.id) {
        await db(`mcp_servers?id=eq.${String(payload.id)}&org_id=eq.${org.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row),
        });
        return json({ ok: true, id: payload.id });
      }
      if (!row.name || !row.url) return json({ error: "a name and a url" }, 400);
      const [made] = await db("mcp_servers", { method: "POST", body: JSON.stringify(row) });
      return json({ ok: true, id: made?.id });
    }

    // Turning a tool on is granting an ability. `auto` is the bigger one:
    // it says this may run with nobody watching, and the schema will only
    // accept it on a tool marked read.
    if (action === "set_tool") {
      const id = String(payload.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad tool id" }, 400);
      const row: Record<string, unknown> = {};
      if ("enabled" in payload) row.enabled = !!payload.enabled;
      if ("auto" in payload) row.auto = !!payload.auto;
      if ("risk" in payload) {
        const r = String(payload.risk);
        if (!["read", "write", "act"].includes(r)) return json({ error: "risk is read, write or act" }, 400);
        row.risk = r;
        // dropping to a riskier class disarms it; the check constraint
        // would refuse the pair anyway, and a 400 here is a worse answer
        // than doing the obviously-intended thing
        if (r !== "read") row.auto = false;
      }
      if (!Object.keys(row).length) return json({ error: "nothing to change" }, 400);
      try {
        await db(`mcp_tools?id=eq.${id}&org_id=eq.${org.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row),
        });
      } catch (e) {
        return json({ error: String(e).slice(0, 200) }, 400);
      }
      return json({ ok: true });
    }

    if (action === "refresh_tools") {
      const [sv] = await db(`mcp_servers?id=eq.${String(payload.server_id ?? "")}&org_id=eq.${org.id}&select=*&limit=1`).catch(() => []);
      if (!sv) return json({ error: "no such server here" }, 404);
      return json({ ok: true, ...(await refreshTools(db, sv)) });
    }

    if (action === "approvals") {
      const rows = await db(
        `mcp_approvals?org_id=eq.${org.id}&state=eq.pending&expires_at=gt.${new Date().toISOString()}&select=*&order=created_at.desc&limit=50`,
      );
      return json({ ok: true, approvals: rows ?? [] });
    }

    // Yes or no, and then it actually runs. Staff may decide — that is
    // what being at the desk is for — but mcp_decide is what makes two
    // people pressing approve produce one call rather than two.
    if (action === "decide") {
      const id = String(payload.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad approval id" }, 400);
      const approve = !!payload.approve;
      const [decided] = await db("rpc/mcp_decide", {
        method: "POST",
        body: JSON.stringify({ p_id: id, p_approve: approve, p_by: me }),
      }).then((r: unknown) => (Array.isArray(r) ? r : [r])).catch(() => [null]);

      if (!decided?.id) return json({ error: "that request was already answered, or it lapsed" }, 409);
      if (!approve) return json({ ok: true, state: "denied" });
      if (decided.org_id !== org.id) return json({ error: "not yours" }, 403);

      const [sv] = await db(`mcp_servers?id=eq.${decided.server_id}&org_id=eq.${org.id}&select=*&limit=1`).catch(() => []);
      const [tl] = await db(`mcp_tools?server_id=eq.${decided.server_id}&name=eq.${encodeURIComponent(decided.tool)}&select=*&limit=1`).catch(() => []);
      if (!sv || !tl) return json({ error: "that tool is no longer connected" }, 409);

      const r = await invoke(db, {
        orgId: org.id, tool: tl, server: sv, args: decided.arguments ?? {},
        convId: decided.conv_id, authority: "approved", approvedBy: me,
      });
      await db(`mcp_approvals?id=eq.${id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ state: "done" }),
      }).catch(() => {});
      return json({ ok: r.ok, state: "done", result: r.text });
    }

    // Bluesky has no webhook, so somebody has to ask. Run it from the desk
    // or from a cron; it is idempotent either way.
    if (action === "poll") {
      const which = String(payload.channel ?? "bluesky");
      if (which !== "bluesky") return json({ error: `${which} pushes its own events; there is nothing to poll` }, 400);
      return json({ ok: true, ...(await pollBluesky(org.id)) });
    }

    // ---- the knowledge base -----------------------------------------
    // What the bot is allowed to know. Anything not in here, it does not
    // say — so putting a page in here is the act of authorising it.

    if (action === "kb_put") {
      const title = String(payload.title ?? "").trim();
      const body = String(payload.body ?? "").trim();
      if (!title || !body) return json({ error: "title and body are required" }, 400);
      if (body.length > 200_000) return json({ error: "too long" }, 413);
      const r = await indexDocument(db, org.id, {
        kind: String(payload.kind ?? "page"),
        title,
        body,
        url: payload.url ? String(payload.url) : null,
        source: String(payload.source ?? "staff"),
      });
      return json({ ok: true, ...r });
    }

    if (action === "kb_list") {
      const rows = await db(
        `kb_documents?org_id=eq.${org.id}&select=id,kind,title,url,source,enabled,updated_at,content_hash&order=updated_at.desc&limit=200`,
      );
      // chunk counts in one pass rather than N queries
      const counts = await db(`kb_chunks?select=document_id,embedding&document_id=in.(${(rows ?? []).map((d: { id: string }) => d.id).join(",") || "00000000-0000-0000-0000-000000000000"})`) .then((cs: { document_id: string; embedding: unknown }[]) => {
        const m = new Map<string, { chunks: number; embedded: number }>();
        for (const c of cs ?? []) {
          const e = m.get(c.document_id) ?? { chunks: 0, embedded: 0 };
          e.chunks++; if (c.embedding) e.embedded++;
          m.set(c.document_id, e);
        }
        return m;
      }).catch(() => new Map());
      return json({
        ok: true,
        documents: (rows ?? []).map((d: { id: string }) => ({ ...d, ...(counts.get(d.id) ?? { chunks: 0, embedded: 0 }) })),
      });
    }

    if (action === "kb_drop") {
      const id = String(payload.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad id" }, 400);
      await db(`kb_documents?id=eq.${id}&org_id=eq.${org.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return json({ ok: true });
    }

    // Ask what the bot would find, without sending anything to anyone.
    // The single most useful thing when a reply comes out wrong: nine
    // times out of ten the retrieval is the bug, not the model.
    if (action === "kb_try") {
      const q = String(payload.q ?? "").trim();
      if (!q) return json({ error: "empty query" }, 400);
      const hits = await retrieve(db, org.id, q, Number(payload.k ?? 8));
      return json({
        ok: true,
        hits: hits.map((h) => ({
          title: h.title, url: h.url, score: h.score,
          fts_rank: h.fts_rank, vec_rank: h.vec_rank,
          body: h.body.slice(0, 400),
        })),
      });
    }

    if (action === "ai_spend") {
      const day = await db(`ai_spend_24h?org_id=eq.${org.id}&select=*`).catch(() => []);
      const recent = await db(
        `ai_calls?org_id=eq.${org.id}&select=purpose,model,cost_micros,latency_ms,ok,error,at&order=at.desc&limit=40`,
      ).catch(() => []);
      return json({
        ok: true,
        day: day?.[0] ?? { cost_micros: 0, calls: 0, failures: 0 },
        budget_micros: await budgetMicros(db, org.id),
        spent_micros: await spentTodayMicros(db, org.id),
        recent,
      });
    }

    if (action === "memory") {
      const id = String(payload.contact_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad contact id" }, 400);
      // The function runs on the service role, so RLS does not stop it
      // reading another org's contact. This does. Everything under a
      // contact — every private note they ever left — hangs off this one
      // check.
      const [own] = await db(`inbox_contacts?id=eq.${id}&org_id=eq.${org.id}&select=id&limit=1`).catch(() => []);
      if (!own) return json({ error: "no such contact here" }, 404);
      const live = await recallFacts(db, id, 100);
      const ended = await db(
        `memory_facts?contact_id=eq.${id}&ended_at=not.is.null&select=key,value,confidence,created_at,ended_at&order=ended_at.desc&limit=50`,
      ).catch(() => []);
      return json({ ok: true, facts: live, was: ended ?? [] });
    }

    // Tier 4: what is true for everybody today. Hours, current release,
    // "we are closed until the 8th". Typed by a person, no model involved.
    if (action === "shared_put") {
      const k = String(payload.key ?? "").trim().toLowerCase();
      const v = String(payload.value ?? "").trim();
      if (!k) return json({ error: "key is required" }, 400);
      if (!v) {
        await db(`memory_shared?org_id=eq.${org.id}&key=eq.${encodeURIComponent(k)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        return json({ ok: true, removed: k });
      }
      await db("memory_shared", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ org_id: org.id, kind: String(payload.kind ?? "fact"), key: k, value: v, updated_at: new Date().toISOString() }),
      });
      return json({ ok: true, key: k });
    }
  }

  if (action === "open" || action === "say" || action === "history") {
    if (badKey(key)) return json({ error: "bad visitor key" }, 400);
  }

  try {
    // WHOSE website is this chat on. Sent by the widget, or in the path.
    //
    // Client-supplied, and that is fine: the site channel is public by
    // design, so being able to name a tenant's inbox is no more than
    // being able to visit their website and type in the box on it. The
    // visitor key still decides which thread, and nothing here trusts the
    // client for anything else.
    const orgId = await orgForSlug(String(payload.org ?? "") || slugFromPath(url.pathname) || "mccluster");
    if (!orgId) return json({ error: "no such site" }, 404);

    const caps = await channelCaps(orgId, "site");
    if (!caps?.enabled) return json({ error: "the site chat is switched off" }, 503);

    if (action === "open") {
      const { conv } = await resolveSiteThread(orgId, key as string, payload.page as string | undefined);
      const msgs = await db(`inbox_messages?conv_id=eq.${conv.id}&select=direction,author,body,at&order=at.asc&limit=100`);
      return json({ ok: true, messages: (msgs ?? []).filter((m: { meta?: unknown; body: string }) => m.body !== "[handed to a person]") });
    }

    if (action === "history") {
      const { conv } = await resolveSiteThread(orgId, key as string);
      const msgs = await db(`inbox_messages?conv_id=eq.${conv.id}&select=direction,author,body,at&order=at.asc&limit=200`);
      return json({ ok: true, messages: (msgs ?? []).filter((m: { body: string }) => m.body !== "[handed to a person]") });
    }

    if (action === "say") {
      const body = String(payload.body ?? "").trim();
      if (!body) return json({ error: "empty" }, 400);
      if (body.length > 2000) return json({ error: "too long" }, 413);

      const { contactId, conv } = await resolveSiteThread(orgId, key as string, payload.page as string | undefined);

      const before = await db(`inbox_messages?conv_id=eq.${conv.id}&direction=eq.in&select=id&limit=1`);
      const first = !(before?.length);

      // direction is set HERE. The client says what the visitor typed; it
      // does not get to say who it came from.
      await db("inbox_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ org_id: orgId, conv_id: conv.id, direction: "in", author: "contact", body, state: "delivered" }),
      });

      const replies = await runFlows({
        orgId,
        convId: conv.id,
        contactId,
        channel: "site",
        kind: "dm",
        body,
        first,
        claimed: !!conv.claimed_by,
        windowEnds: conv.window_ends ?? null,
      });

      return json({ ok: true, replies });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("inbox", e);
    return json({ error: "server" }, 500);
  }
});
