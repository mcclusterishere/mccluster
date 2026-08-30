// THE CONNECTOR HALF — turning platform webhooks into events, and decisions
// into API calls.
//
// Pure on purpose, like flows.ts. Parsing a webhook and choosing an endpoint
// are decisions, and decisions belong somewhere they can be tested against
// real captured payloads without a network. index.ts does the talking.
//
// WHAT EACH PLATFORM ACTUALLY ALLOWS is not a config choice, it is a fact, and
// the facts are in docs/social-connections.md. This file encodes them so that
// a wrong flow cannot cause a wrong call: askFor() returns a refusal, not a
// request, when the platform does not permit the thing.

export type Channel =
  | "instagram" | "facebook" | "threads" | "x" | "site"
  | "telegram" | "whatsapp" | "slack" | "discord" | "bluesky";

export type InEvent = {
  channel: Channel;
  kind: "dm" | "comment";
  /** stable id of the person on that platform */
  actor_id: string;
  actor_name?: string;
  /** the thing being replied to: a comment id, or a conversation/thread id */
  target_id: string;
  /** the post the comment sits under, when there is one */
  parent_id?: string;
  body: string;
  /** platform's own id for this message, for idempotency */
  external_id: string;
  /** WHOSE account this arrived at: a Page id, an IG account id, a
   *  WhatsApp phone_number_id, a Slack team. One webhook URL serves every
   *  tenant on platforms that only allow one, so this is what says which
   *  customer the event belongs to. Absent where the platform does not
   *  say — there, the URL path carries it instead. */
  recipient_id?: string;
  at: string;
  /** true when the actor is us — our own replies echo back and must not loop */
  is_echo: boolean;
};

/* ------------------------------------------------------------------ *
 * PARSING
 * ------------------------------------------------------------------ */

/** Meta posts one shape for Instagram and another for a Facebook Page, both
 *  under `entry[]`. Returns every event we understand and silently drops the
 *  rest — an unknown field must never throw, because Meta retries a non-200
 *  and a parse bug would become a retry storm. */
export function parseMeta(payload: any, selfIds: string[] = []): InEvent[] {
  const out: InEvent[] = [];
  const isSelf = (id: string) => selfIds.includes(String(id));
  const object = String(payload?.object ?? "");
  const channel: InEvent["channel"] =
    object === "instagram" ? "instagram" : "facebook";

  for (const entry of payload?.entry ?? []) {
    // one delivery can carry entries for several Pages, and on a platform
    // that means several different customers in one POST
    const recipient = String(entry?.id ?? "");
    // ---- direct messages (both platforms use `messaging`) ----
    for (const m of entry?.messaging ?? []) {
      const text = m?.message?.text;
      if (typeof text !== "string" || !text.trim()) continue;
      if (m?.message?.is_echo) continue;               // our own, already logged
      const sender = String(m?.sender?.id ?? "");
      if (!sender) continue;
      out.push({
        channel, kind: "dm",
        actor_id: sender,
        target_id: sender,                              // you reply to the sender
        body: text,
        recipient_id: String(m?.recipient?.id ?? recipient) || undefined,
        external_id: String(m?.message?.mid ?? `${sender}:${m?.timestamp ?? ""}`),
        at: new Date(Number(m?.timestamp ?? Date.now())).toISOString(),
        is_echo: isSelf(sender),
      });
    }

    // ---- comments and mentions (`changes`) ----
    for (const ch of entry?.changes ?? []) {
      const field = String(ch?.field ?? "");
      const v = ch?.value ?? {};
      if (field !== "comments" && field !== "feed" && field !== "mentions") continue;
      // a Page `feed` change covers likes, shares and edits too
      if (field === "feed" && String(v?.item ?? "") !== "comment") continue;
      if (field === "feed" && String(v?.verb ?? "") === "remove") continue;
      const text = v?.text ?? v?.message;
      if (typeof text !== "string" || !text.trim()) continue;
      const cid = String(v?.comment_id ?? v?.id ?? "");
      if (!cid) continue;
      const actor = String(v?.from?.id ?? v?.sender_id ?? "");
      out.push({
        channel, kind: "comment",
        actor_id: actor || cid,
        actor_name: v?.from?.name ?? v?.from?.username,
        target_id: cid,
        parent_id: String(v?.post_id ?? v?.media?.id ?? v?.parent_id ?? "") || undefined,
        body: text,
        recipient_id: recipient || undefined,
        external_id: cid,
        at: v?.created_time
          ? new Date(Number(v.created_time) * 1000).toISOString()
          : new Date(Number(entry?.time ?? Date.now()) * 1000).toISOString(),
        is_echo: isSelf(actor),
      });
    }
  }
  return out;
}

/** Telegram. The one channel on this list that costs nothing, has no
 *  review process, no 24-hour window and no rate that matters. If you want
 *  a bot that works this afternoon, it is this one.
 *
 *  Authenticity is a header, not a signature: setWebhook takes a
 *  secret_token and Telegram echoes it in X-Telegram-Bot-Api-Secret-Token
 *  on every delivery. index.ts checks it. */
export function parseTelegram(payload: any, selfIds: string[] = []): InEvent[] {
  const out: InEvent[] = [];
  const isSelf = (id: string) => selfIds.includes(String(id));
  // one update per POST, but the shape is a list of possible keys
  for (const key of ["message", "edited_message", "channel_post"]) {
    const m = payload?.[key];
    const text = m?.text ?? m?.caption;
    if (typeof text !== "string" || !text.trim()) continue;
    const chat = String(m?.chat?.id ?? "");
    const from = String(m?.from?.id ?? chat);
    if (!chat) continue;
    // A private chat is a DM. A group or channel post is public, and is
    // treated as a comment so the shorter, more careful reply rules apply.
    const type = String(m?.chat?.type ?? "private");
    out.push({
      channel: "telegram",
      kind: type === "private" ? "dm" : "comment",
      actor_id: from,
      actor_name: m?.from?.username ?? ([m?.from?.first_name, m?.from?.last_name].filter(Boolean).join(" ") || undefined),
      target_id: chat,                            // you reply to the chat, not the person
      parent_id: type === "private" ? undefined : chat,
      body: text,
      external_id: `tg:${chat}:${m?.message_id ?? payload?.update_id}`,
      at: new Date(Number(m?.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      is_echo: !!m?.from?.is_bot || isSelf(from),
    });
  }
  return out;
}

/** WhatsApp Cloud API. Meta's `entry[].changes[]` shape again, but a
 *  different field and a different value schema — and, unlike Messenger,
 *  the id you reply TO is the person's phone number in `wa_id`, while the
 *  number you send FROM is a phone_number_id that lives in the URL.
 *
 *  `statuses[]` deliveries are receipts for messages WE sent. They are not
 *  inbound messages and answering one would be answering ourselves. */
export function parseWhatsApp(payload: any, selfIds: string[] = []): InEvent[] {
  const out: InEvent[] = [];
  const isSelf = (id: string) => selfIds.includes(String(id));
  for (const entry of payload?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      if (String(ch?.field ?? "") !== "messages") continue;
      const v = ch?.value ?? {};
      // the number the message arrived AT, which is ours, not theirs
      const recipient = String(v?.metadata?.phone_number_id ?? "");
      const names = new Map<string, string>();
      for (const c of v?.contacts ?? []) {
        if (c?.wa_id) names.set(String(c.wa_id), String(c?.profile?.name ?? ""));
      }
      for (const m of v?.messages ?? []) {
        // text, and the text inside an interactive reply; everything else
        // (media, location, order) is acknowledged and not answered
        const text = m?.text?.body
          ?? m?.button?.text
          ?? m?.interactive?.button_reply?.title
          ?? m?.interactive?.list_reply?.title;
        if (typeof text !== "string" || !text.trim()) continue;
        const from = String(m?.from ?? "");
        if (!from) continue;
        out.push({
          channel: "whatsapp", kind: "dm",
          actor_id: from,
          actor_name: names.get(from) || undefined,
          target_id: from,
          body: text,
          recipient_id: recipient || undefined,
          external_id: String(m?.id ?? `wa:${from}:${m?.timestamp ?? ""}`),
          at: new Date(Number(m?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
          is_echo: isSelf(from),
        });
      }
    }
  }
  return out;
}

/** Slack Events API. Two things arrive here that are not messages and both
 *  must be handled before anything else: the one-time url_verification
 *  challenge, and our own bot's messages echoing back.
 *
 *  The echo check is not optional. A Slack bot that answers its own
 *  messages is an infinite loop with a rate limit as its only brake. */
export function parseSlack(payload: any, selfIds: string[] = []): InEvent[] {
  const out: InEvent[] = [];
  if (String(payload?.type ?? "") !== "event_callback") return out;
  const e = payload?.event ?? {};
  const type = String(e?.type ?? "");
  if (type !== "message" && type !== "app_mention") return out;
  // joins, leaves, edits, deletions and thread broadcasts all arrive as
  // `message` with a subtype; none of them is somebody talking to us
  if (e?.subtype) return out;
  if (e?.bot_id) return out;
  const text = e?.text;
  if (typeof text !== "string" || !text.trim()) return out;
  const user = String(e?.user ?? "");
  if (!user || selfIds.includes(user)) return out;

  const channelId = String(e?.channel ?? "");
  const isIm = String(e?.channel_type ?? "") === "im";
  out.push({
    channel: "slack",
    kind: isIm ? "dm" : "comment",
    actor_id: user,
    target_id: channelId,
    // a threaded reply belongs with its thread; a top-level message starts one
    parent_id: e?.thread_ts ? String(e.thread_ts) : (isIm ? undefined : channelId),
    body: text,
    // the workspace, which is what a Slack app is installed into and so
    // what identifies the customer
    recipient_id: String(payload?.team_id ?? payload?.authorizations?.[0]?.team_id ?? "") || undefined,
    external_id: `slack:${channelId}:${e?.ts ?? ""}`,
    at: e?.ts ? new Date(Number(String(e.ts).split(".")[0]) * 1000).toISOString() : new Date().toISOString(),
    is_echo: false,
  });
  return out;
}

/** Bluesky has no webhooks. Nothing pushes; you ask.
 *
 *  So this is not a webhook parser — it turns the answer to
 *  chat.bsky.convo.listConvos into the same events every other channel
 *  produces, and index.ts calls it on a schedule. Same for notifications,
 *  which is where replies and mentions live. */
export function parseBlueskyConvos(convos: any, selfDid: string): InEvent[] {
  const out: InEvent[] = [];
  for (const c of convos?.convos ?? []) {
    const m = c?.lastMessage;
    if (!m || typeof m?.text !== "string" || !m.text.trim()) continue;
    const sender = String(m?.sender?.did ?? "");
    if (!sender || sender === selfDid) continue;         // our own last word
    const other = (c?.members ?? []).find((x: any) => String(x?.did) !== selfDid);
    out.push({
      channel: "bluesky", kind: "dm",
      actor_id: sender,
      actor_name: other?.handle ?? undefined,
      target_id: String(c?.id ?? ""),                    // convoId, not a did
      body: m.text,
      external_id: `bsky:${m?.id ?? `${c?.id}:${m?.sentAt}`}`,
      at: m?.sentAt ?? new Date().toISOString(),
      is_echo: false,
    });
  }
  return out;
}

export function parseBlueskyNotifications(notifs: any, selfDid: string): InEvent[] {
  const out: InEvent[] = [];
  for (const n of notifs?.notifications ?? []) {
    const reason = String(n?.reason ?? "");
    if (reason !== "reply" && reason !== "mention" && reason !== "quote") continue;
    const text = n?.record?.text;
    if (typeof text !== "string" || !text.trim()) continue;
    const did = String(n?.author?.did ?? "");
    if (!did || did === selfDid) continue;
    out.push({
      channel: "bluesky", kind: "comment",
      actor_id: did,
      actor_name: n?.author?.handle ?? undefined,
      // the at:// uri of the post being replied to IS the reply target
      target_id: String(n?.uri ?? ""),
      parent_id: String(n?.record?.reply?.root?.uri ?? n?.uri ?? "") || undefined,
      body: text,
      external_id: `bsky:${n?.uri ?? ""}`,
      at: n?.indexedAt ?? new Date().toISOString(),
      is_echo: false,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * SENDING
 * ------------------------------------------------------------------ */

export type Caps = {
  key: string;
  enabled: boolean;
  /** Whatever identifies the account on that platform and is NOT a secret:
   *  a WhatsApp phone_number_id, a Bluesky PDS host. Tokens never come
   *  through here. */
  account_id?: string | null;
  can_read_comments: boolean;
  can_reply_comments: boolean;
  can_send_dm: boolean;
  dm_window_hours: number | null;
};

export type SendAsk =
  | {
      ok: true;
      method: "POST";
      /** May contain the literal `{TOKEN}`. It is substituted by the caller,
       *  which is the only place a secret exists — this file is pure and
       *  never holds one, so it cannot leak one into a log or a test. */
      url: string;
      body: Record<string, unknown>;
      /** where the credential goes. "bearer" is the default. */
      auth?: "bearer" | "url" | "none";
      /** extra headers the platform demands (Bluesky's service proxy) */
      headers?: Record<string, string>;
      costs_money?: boolean;
    }
  | { ok: false; refusal: string };

const GRAPH = "https://graph.facebook.com/v21.0";

/** What call, if any, sends `text` on this channel in this way.
 *
 *  Every refusal here is a platform fact, not a setting. A channel that is
 *  merely switched off says so differently from one that cannot do the thing
 *  at all, because those need different actions from a human: one is a toggle,
 *  the other is impossible and no amount of configuring will change it. */
export function askFor(opts: {
  caps: Caps;
  as: "comment_reply" | "private_reply" | "dm";
  target_id: string;
  text: string;
  /** hours since the person last messaged us; null when they never have */
  since_inbound_hours: number | null;
}): SendAsk {
  const { caps, as, target_id, text } = opts;

  if (!caps.enabled) {
    return { ok: false, refusal: `${caps.key} is switched off. Turn the channel on once its access is approved.` };
  }
  if (!text.trim()) return { ok: false, refusal: "nothing to send" };

  if (as === "comment_reply") {
    if (!caps.can_reply_comments) {
      return { ok: false, refusal: `${caps.key} cannot reply to comments through the API.` };
    }
    if (caps.key === "instagram" || caps.key === "facebook") {
      return { ok: true, method: "POST", url: `${GRAPH}/${target_id}/replies`, body: { message: text } };
    }
    if (caps.key === "threads") {
      return { ok: true, method: "POST", url: `https://graph.threads.net/v1.0/me/threads`,
               body: { media_type: "TEXT", text, reply_to_id: target_id } };
    }
    if (caps.key === "telegram") {
      // a group reply is a message into the same chat, quoting the message
      const [chat, mid] = splitTelegramTarget(target_id);
      return { ok: true, auth: "url", method: "POST",
               url: `https://api.telegram.org/bot{TOKEN}/sendMessage`,
               body: { chat_id: chat, text, ...(mid ? { reply_parameters: { message_id: Number(mid) } } : {}) } };
    }
    if (caps.key === "slack") {
      const [channel, ts] = splitSlackTarget(target_id);
      return { ok: true, method: "POST", url: "https://slack.com/api/chat.postMessage",
               body: { channel, text, ...(ts ? { thread_ts: ts } : {}) } };
    }
    if (caps.key === "bluesky") {
      // A reply is a new record in your own repo pointing at the parent, so
      // it needs the parent's cid as well as its uri. The caller resolves
      // that; without it there is nothing valid to post.
      return { ok: false, refusal: "bluesky replies are posted through createRecord and need the parent's cid — use blueskyReply()" };
    }
    if (caps.key === "discord") {
      return { ok: false, refusal: "Discord message content requires a gateway websocket, which an edge function cannot hold open. Discord can post, but it cannot listen here." };
    }
    if (caps.key === "whatsapp") {
      return { ok: false, refusal: "WhatsApp has no public comments. Everything on it is a direct message." };
    }
    return { ok: false, refusal: `no comment-reply endpoint is wired for ${caps.key}` };
  }

  if (as === "private_reply") {
    // The DM-to-a-commenter that Meta does allow: one per comment, inside 7
    // days, and it does NOT need the 24h window a normal DM needs. This is the
    // closest thing to "thank the people who engage" that actually exists.
    if (caps.key !== "instagram" && caps.key !== "facebook") {
      return { ok: false, refusal: `a private reply to a public comment is a Meta-specific mechanism. On ${caps.key}, message the person normally instead.` };
    }
    if (!caps.can_send_dm) {
      return { ok: false, refusal: `${caps.key} direct messaging is not available on this account.` };
    }
    return { ok: true, method: "POST", url: `${GRAPH}/me/messages`,
             body: { recipient: { comment_id: target_id }, message: { text } } };
  }

  // as === "dm"
  if (!caps.can_send_dm) {
    if (caps.key === "threads") {
      return { ok: false, refusal: "Threads has no direct-message API at all. This is not a permission you can be granted." };
    }
    if (caps.key === "linkedin") {
      return { ok: false, refusal: "LinkedIn messaging is partner-only and requires a member to press send on an editable draft. Automated sending is the thing the rule forbids." };
    }
    return { ok: false, refusal: `${caps.key} cannot send direct messages.` };
  }
  if (caps.dm_window_hours != null) {
    const h = opts.since_inbound_hours;
    if (h == null) {
      return { ok: false, refusal: `${caps.key} only allows a message inside ${caps.dm_window_hours}h of the person messaging you first, and they never have.` };
    }
    if (h > caps.dm_window_hours) {
      return { ok: false, refusal: `the ${caps.dm_window_hours}h window on ${caps.key} closed ${Math.floor(h - caps.dm_window_hours)}h ago.` };
    }
  }
  if (caps.key === "x") {
    return { ok: true, method: "POST", costs_money: true,
             url: `https://api.x.com/2/dm_conversations/with/${target_id}/messages`,
             body: { text } };
  }
  if (caps.key === "telegram") {
    const [chat] = splitTelegramTarget(target_id);
    return { ok: true, auth: "url", method: "POST",
             url: `https://api.telegram.org/bot{TOKEN}/sendMessage`,
             body: { chat_id: chat, text } };
  }
  if (caps.key === "whatsapp") {
    // The phone_number_id is OURS, not theirs, and it goes in the path. It
    // is not a secret — it identifies the sending number — so it travels in
    // the caps rather than in the token.
    if (!caps.account_id) {
      return { ok: false, refusal: "WhatsApp needs the sending number's phone_number_id set on the channel before it can send anything." };
    }
    return { ok: true, method: "POST", url: `${GRAPH}/${caps.account_id}/messages`,
             body: { messaging_product: "whatsapp", recipient_type: "individual", to: target_id,
                     type: "text", text: { preview_url: false, body: text } } };
  }
  if (caps.key === "slack") {
    const [channel] = splitSlackTarget(target_id);
    return { ok: true, method: "POST", url: "https://slack.com/api/chat.postMessage",
             body: { channel, text } };
  }
  if (caps.key === "bluesky") {
    // Sent to your own PDS and proxied to the central chat service. The
    // proxy header is not optional: without it the PDS has no idea which
    // service the lexicon belongs to and answers 400.
    return { ok: true, method: "POST",
             url: `${caps.account_id || "https://bsky.social"}/xrpc/chat.bsky.convo.sendMessage`,
             headers: { "atproto-proxy": "did:web:api.bsky.chat#bsky_chat" },
             body: { convoId: target_id, message: { text } } };
  }
  if (caps.key === "discord") {
    return { ok: false, refusal: "Discord DMs require opening a channel with the user first and a gateway connection to hear the reply. Not wired." };
  }
  return { ok: true, method: "POST", url: `${GRAPH}/me/messages`,
           body: { recipient: { id: target_id }, message: { text } } };
}

/** Telegram targets are `chat` or `chat:message_id`. A group reply needs
 *  both; a DM needs only the first. */
function splitTelegramTarget(t: string): [string, string | null] {
  const i = t.lastIndexOf(":");
  return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, null];
}

/** Slack targets are `channel` or `channel:thread_ts`. A ts contains a dot
 *  and never a colon, so the split is unambiguous. */
function splitSlackTarget(t: string): [string, string | null] {
  const i = t.indexOf(":");
  return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, null];
}

/** New followers, by diffing two snapshots. X is the only one of the four that
 *  exposes a follower LIST; Instagram exposes a count and nothing else, so a
 *  thank-you on follow is not buildable there however the flows are written. */
export function newFollowers(previous: string[], current: string[]): string[] {
  const had = new Set(previous);
  return current.filter((id) => !had.has(id));
}
