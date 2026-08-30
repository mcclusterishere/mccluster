// THE FLOW ENGINE — the chatfuel half, as a pure function.
//
// Pure on purpose: it takes a message and a list of rules and returns a
// list of actions. It touches no database and no network, so it can be
// tested exhaustively without a cluster, and so a bug here can never be
// a bug that half-sent something.
//
// A rule is: when TRIGGER, and every CONDITION holds, do ACTIONS.

export type Trigger = {
  on: "message_in" | "comment_in";
  /** how the keywords are compared. Default "any". */
  match?: "any" | "all" | "first" | "regex" | "always";
  keywords?: string[];
  pattern?: string;
};

export type Condition =
  | { has_tag: string }
  | { not_tag: string }
  | { channel: string | string[] }
  | { unclaimed: true };

export type Action =
  | { do: "reply"; text: string; delay_seconds?: number }
  | { do: "tag"; tag: string }
  | { do: "untag"; tag: string }
  | { do: "handoff" }
  | { do: "close" };

export type Flow = {
  id: string;
  name: string;
  channel: string | null;
  enabled: boolean;
  ordinal: number;
  stop: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
};

export type Ctx = {
  /** the inbound text, as the person typed it */
  body: string;
  channel: string;
  kind: "dm" | "comment";
  /** true when this is the first inbound message this conversation has seen */
  first: boolean;
  tags: string[];
  /** a human has taken this thread; the bot must not talk over them */
  claimed: boolean;
};

export type Decision = {
  actions: Action[];
  /** every flow considered, and why it did or did not fire */
  trace: { flow_id: string; name: string; matched: boolean; why: string }[];
};

/** Word-boundary containment. Deliberately not `includes`: "cost" inside
 *  "Costa Rica" is not somebody asking about price, and a bot that
 *  answers a question nobody asked is worse than one that stays quiet. */
function hasWord(hay: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  // a multi-word phrase ("how much") is matched as a phrase
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(hay);
}

function triggerFires(t: Trigger, c: Ctx): { ok: boolean; why: string } {
  const wantKind = t.on === "comment_in" ? "comment" : "dm";
  if (c.kind !== wantKind) return { ok: false, why: `kind ${c.kind} != ${wantKind}` };

  const mode = t.match ?? "any";
  const body = (c.body || "").toLowerCase();

  if (mode === "always") return { ok: true, why: "always" };
  if (mode === "first") {
    return c.first ? { ok: true, why: "first message" } : { ok: false, why: "not the first message" };
  }
  if (mode === "regex") {
    if (!t.pattern) return { ok: false, why: "regex trigger with no pattern" };
    let re: RegExp;
    try {
      re = new RegExp(t.pattern, "i");
    } catch {
      // a bad pattern must not take the whole engine down with it
      return { ok: false, why: "pattern does not compile" };
    }
    return re.test(body) ? { ok: true, why: "pattern matched" } : { ok: false, why: "pattern did not match" };
  }

  const words = t.keywords ?? [];
  if (!words.length) return { ok: false, why: "keyword trigger with no keywords" };
  const hits = words.filter((w) => hasWord(body, w));
  if (mode === "all") {
    return hits.length === words.length
      ? { ok: true, why: `all ${words.length} keywords` }
      : { ok: false, why: `only ${hits.length}/${words.length} keywords` };
  }
  return hits.length
    ? { ok: true, why: `keyword "${hits[0]}"` }
    : { ok: false, why: "no keyword" };
}

function conditionHolds(cond: Condition, c: Ctx): { ok: boolean; why: string } {
  if ("has_tag" in cond) {
    return c.tags.includes(cond.has_tag)
      ? { ok: true, why: "" } : { ok: false, why: `missing tag ${cond.has_tag}` };
  }
  if ("not_tag" in cond) {
    return c.tags.includes(cond.not_tag)
      ? { ok: false, why: `has tag ${cond.not_tag}` } : { ok: true, why: "" };
  }
  if ("channel" in cond) {
    const want = Array.isArray(cond.channel) ? cond.channel : [cond.channel];
    return want.includes(c.channel)
      ? { ok: true, why: "" } : { ok: false, why: `channel ${c.channel}` };
  }
  if ("unclaimed" in cond) {
    return c.claimed ? { ok: false, why: "a person has this thread" } : { ok: true, why: "" };
  }
  return { ok: false, why: "unknown condition" };
}

/**
 * Decide what the bot does about one inbound message.
 *
 * THE CLAIM RULE IS NOT A CONDITION, it is the first thing checked and it
 * is not overridable by a flow. Once a human has taken a conversation the
 * bot is silent in it, full stop. A rule that could opt out of that would
 * eventually be written, and then a customer mid-sentence with Matthew
 * gets interrupted by an autoresponder.
 */
export function decide(flows: Flow[], c: Ctx): Decision {
  const trace: Decision["trace"] = [];
  if (c.claimed) {
    return { actions: [], trace: [{ flow_id: "-", name: "claim guard", matched: false, why: "a person has this thread; the bot stays out" }] };
  }

  const out: Action[] = [];
  const ordered = flows
    .filter((f) => f.enabled)
    .filter((f) => f.channel === null || f.channel === c.channel)
    .sort((a, b) => a.ordinal - b.ordinal || a.name.localeCompare(b.name));

  for (const f of ordered) {
    const t = triggerFires(f.trigger, c);
    if (!t.ok) { trace.push({ flow_id: f.id, name: f.name, matched: false, why: t.why }); continue; }

    let blocked = "";
    for (const cond of f.conditions ?? []) {
      const r = conditionHolds(cond, c);
      if (!r.ok) { blocked = r.why; break; }
    }
    if (blocked) { trace.push({ flow_id: f.id, name: f.name, matched: false, why: blocked }); continue; }

    trace.push({ flow_id: f.id, name: f.name, matched: true, why: t.why });
    out.push(...(f.actions ?? []));
    if (f.stop) break;
  }
  return { actions: out, trace };
}

/**
 * What a channel is allowed to do, checked before anything is sent.
 *
 * This is not belt-and-braces. Instagram silently drops a message sent
 * outside its 24-hour window — the API returns success and the person
 * never sees it — so "we sent it" is not evidence it arrived. Refusing
 * here means the desk shows a real failure instead of a false success.
 */
export type ChannelCaps = {
  key: string;
  enabled: boolean;
  can_reply_comments: boolean;
  can_send_dm: boolean;
  dm_window_hours: number | null;
};

export function sendRefusal(
  caps: ChannelCaps | undefined,
  kind: "dm" | "comment",
  windowEnds: string | null,
  now = new Date(),
): string | null {
  if (!caps) return "unknown channel";
  if (!caps.enabled) return `the ${caps.key} channel is not switched on`;
  if (kind === "comment" && !caps.can_reply_comments) return `${caps.key} cannot reply to comments`;
  if (kind === "dm") {
    if (!caps.can_send_dm) return `${caps.key} has no way to send a direct message`;
    if (caps.dm_window_hours !== null && windowEnds) {
      if (new Date(windowEnds).getTime() <= now.getTime()) {
        return `the ${caps.dm_window_hours}h reply window on ${caps.key} has closed`;
      }
    }
  }
  return null;
}
