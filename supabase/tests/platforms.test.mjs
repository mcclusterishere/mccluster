// Tests for the connector half: webhook parsing and send-endpoint choice.
//
// The payloads below are the shapes Meta documents for Instagram comments,
// Page feed comments and Messenger/IG direct messages. They are here because
// "we think the field is called this" is exactly the kind of thing that is
// wrong in production and fine in a unit test written from memory.
import { strict as assert } from "node:assert";

// Imported as TypeScript directly. Node 22 strips the types; an earlier
// version of this file stripped them with regular expressions and choked on a
// multi-line union, which is a good argument for not parsing a language with
// a regex when the runtime will do it properly.
const {
  parseMeta, parseTelegram, parseWhatsApp, parseSlack,
  parseBlueskyConvos, parseBlueskyNotifications,
  askFor, newFollowers,
} = await import("../functions/inbox/platforms.ts");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log("  ok  ", name); pass++; }
  catch (e) { console.log("  FAIL", name, "\n       ", e.message); fail++; }
};

/* ---------------- parsing ---------------- */

t("an Instagram comment becomes one comment event", () => {
  const ev = parseMeta({
    object: "instagram",
    entry: [{ id: "17841400000000000", time: 1755600000, changes: [{
      field: "comments",
      value: { id: "17900000000000000", text: "this track is unreal",
               from: { id: "9988", username: "someone" }, media: { id: "18000000000000000" } },
    }] }],
  });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].channel, "instagram");
  assert.equal(ev[0].kind, "comment");
  assert.equal(ev[0].body, "this track is unreal");
  assert.equal(ev[0].actor_id, "9988");
  assert.equal(ev[0].target_id, "17900000000000000");
  assert.equal(ev[0].parent_id, "18000000000000000");
});

t("a Page feed change that is a like is not a comment", () => {
  const ev = parseMeta({ object: "page", entry: [{ changes: [{
    field: "feed", value: { item: "like", verb: "add", post_id: "1_2" } }] }] });
  assert.equal(ev.length, 0);
});

t("a deleted comment is not ingested", () => {
  const ev = parseMeta({ object: "page", entry: [{ changes: [{
    field: "feed",
    value: { item: "comment", verb: "remove", comment_id: "1_2", message: "gone",
             from: { id: "5" } } }] }] });
  assert.equal(ev.length, 0);
});

t("a direct message becomes a dm event addressed to the sender", () => {
  const ev = parseMeta({ object: "instagram", entry: [{ messaging: [{
    sender: { id: "4242" }, recipient: { id: "17841400000000000" },
    timestamp: 1755600000000, message: { mid: "mid.abc", text: "yo" } }] }] });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "dm");
  assert.equal(ev[0].target_id, "4242");
  assert.equal(ev[0].external_id, "mid.abc");
});

t("our own echoed message is dropped, so the bot cannot answer itself", () => {
  const ev = parseMeta({ object: "instagram", entry: [{ messaging: [{
    sender: { id: "17841400000000000" }, timestamp: 1, message: { mid: "m", text: "hi", is_echo: true } }] }] });
  assert.equal(ev.length, 0);
});

t("a comment we posted ourselves is marked is_echo", () => {
  const ev = parseMeta({ object: "instagram", entry: [{ changes: [{
    field: "comments", value: { id: "c1", text: "thanks!", from: { id: "SELF" } } }] }] },
    ["SELF"]);
  assert.equal(ev[0].is_echo, true);
});

t("a payload full of things we do not understand throws nothing", () => {
  assert.deepEqual(parseMeta({}), []);
  assert.deepEqual(parseMeta({ object: "instagram" }), []);
  assert.deepEqual(parseMeta({ entry: [{ changes: [{ field: "story_insights", value: {} }] }] }), []);
  assert.deepEqual(parseMeta(null), []);
});

/* ---------------- send decisions ---------------- */

const caps = (o = {}) => ({
  key: "instagram", enabled: true, can_read_comments: true,
  can_reply_comments: true, can_send_dm: true, dm_window_hours: 24, ...o,
});

t("an Instagram comment reply posts to the comment's replies edge", () => {
  const a = askFor({ caps: caps(), as: "comment_reply", target_id: "c1", text: "appreciate you", since_inbound_hours: null });
  assert.equal(a.ok, true);
  assert.match(a.url, /\/c1\/replies$/);
  assert.equal(a.body.message, "appreciate you");
});

t("a private reply to a commenter needs no 24h window", () => {
  const a = askFor({ caps: caps(), as: "private_reply", target_id: "c1", text: "thanks for watching", since_inbound_hours: null });
  assert.equal(a.ok, true, a.refusal);
  assert.deepEqual(a.body.recipient, { comment_id: "c1" });
});

t("a normal DM outside the 24h window is refused, with the hours named", () => {
  const a = askFor({ caps: caps(), as: "dm", target_id: "u1", text: "hey", since_inbound_hours: 50 });
  assert.equal(a.ok, false);
  assert.match(a.refusal, /26h ago/);
});

t("a DM to someone who never messaged first is refused", () => {
  const a = askFor({ caps: caps(), as: "dm", target_id: "u1", text: "hey", since_inbound_hours: null });
  assert.equal(a.ok, false);
  assert.match(a.refusal, /never have/);
});

t("Threads refuses a DM as a fact, not a setting", () => {
  const a = askFor({ caps: caps({ key: "threads", can_send_dm: false, dm_window_hours: null }),
                     as: "dm", target_id: "u", text: "hi", since_inbound_hours: 1 });
  assert.equal(a.ok, false);
  assert.match(a.refusal, /not a permission you can be granted/);
});

t("LinkedIn refuses and says why a human must press send", () => {
  const a = askFor({ caps: caps({ key: "linkedin", can_send_dm: false, dm_window_hours: null }),
                     as: "dm", target_id: "u", text: "hi", since_inbound_hours: 1 });
  assert.equal(a.ok, false);
  assert.match(a.refusal, /press send/);
});

t("an X DM is allowed and flagged as costing money", () => {
  const a = askFor({ caps: caps({ key: "x", dm_window_hours: null }),
                     as: "dm", target_id: "u", text: "thanks for the follow", since_inbound_hours: null });
  assert.equal(a.ok, true, a.refusal);
  assert.equal(a.costs_money, true);
  assert.match(a.url, /dm_conversations\/with\/u\/messages$/);
});

t("a disabled channel refuses before anything else is considered", () => {
  const a = askFor({ caps: caps({ enabled: false }), as: "comment_reply", target_id: "c", text: "x", since_inbound_hours: 0 });
  assert.equal(a.ok, false);
  assert.match(a.refusal, /switched off/);
});

t("empty text is never sent", () => {
  const a = askFor({ caps: caps(), as: "comment_reply", target_id: "c", text: "   ", since_inbound_hours: 0 });
  assert.equal(a.ok, false);
});

/* ---------------- followers ---------------- */

t("new followers are the ones not in the previous snapshot", () => {
  assert.deepEqual(newFollowers(["a", "b"], ["b", "c", "d"]), ["c", "d"]);
  assert.deepEqual(newFollowers([], ["a"]), ["a"]);
  assert.deepEqual(newFollowers(["a"], ["a"]), []);
  assert.deepEqual(newFollowers(["a", "b"], ["a"]), []);   // unfollows are not events
});


/* ---------------- the channels that do not need Meta's permission ---------- */

const chan = (key, over = {}) => ({
  key, enabled: true, can_read_comments: true, can_reply_comments: true,
  can_send_dm: true, dm_window_hours: null, ...over,
});

t("a Telegram private chat is a DM, a group post is a comment", () => {
  const dm = parseTelegram({
    update_id: 1,
    message: { message_id: 7, date: 1755600000, text: "hey", chat: { id: 555, type: "private" },
               from: { id: 555, username: "someone", is_bot: false } },
  });
  assert.equal(dm.length, 1);
  assert.equal(dm[0].kind, "dm");
  assert.equal(dm[0].channel, "telegram");
  assert.equal(dm[0].target_id, "555");
  assert.equal(dm[0].actor_name, "someone");

  const grp = parseTelegram({
    update_id: 2,
    message: { message_id: 8, date: 1755600000, text: "hi all", chat: { id: -100, type: "supergroup" },
               from: { id: 777, first_name: "Ann", last_name: "Lee" } },
  });
  assert.equal(grp[0].kind, "comment");
  assert.equal(grp[0].actor_name, "Ann Lee");
});

t("Telegram: our own bot's messages are echoes and never answered", () => {
  const ev = parseTelegram({
    update_id: 3,
    message: { message_id: 9, date: 1755600000, text: "posted", chat: { id: 555, type: "private" },
               from: { id: 4242, is_bot: true } },
  });
  assert.equal(ev[0].is_echo, true);
});

t("Telegram: a caption counts, an empty update does not", () => {
  assert.equal(parseTelegram({ update_id: 4, message: { message_id: 1, chat: { id: 1, type: "private" },
    from: { id: 1 }, date: 1, caption: "look at this" } })[0].body, "look at this");
  assert.deepEqual(parseTelegram({ update_id: 5 }), []);
  assert.deepEqual(parseTelegram({ update_id: 6, message: { message_id: 1, chat: { id: 1, type: "private" }, date: 1 } }), []);
});

t("a WhatsApp text becomes a DM with the sender's profile name", () => {
  const ev = parseWhatsApp({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15551230000", phone_number_id: "PNID" },
      contacts: [{ profile: { name: "Sam" }, wa_id: "15559998888" }],
      messages: [{ from: "15559998888", id: "wamid.ABC", timestamp: "1755600000",
                   type: "text", text: { body: "are you open sunday?" } }],
    } }] }],
  });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].channel, "whatsapp");
  assert.equal(ev[0].kind, "dm");
  assert.equal(ev[0].actor_name, "Sam");
  assert.equal(ev[0].external_id, "wamid.ABC");
  assert.equal(ev[0].target_id, "15559998888");
});

t("a WhatsApp delivery receipt is not an inbound message", () => {
  // answering one of these would be answering ourselves
  const ev = parseWhatsApp({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      statuses: [{ id: "wamid.OUT", status: "delivered", recipient_id: "15559998888" }],
    } }] }],
  });
  assert.deepEqual(ev, []);
});

t("a WhatsApp button tap carries its title as the message", () => {
  const ev = parseWhatsApp({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      messages: [{ from: "1555", id: "wamid.B", timestamp: "1755600000", type: "interactive",
                   interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes please" } } }],
    } }] }],
  });
  assert.equal(ev[0].body, "Yes please");
});

t("a Slack DM is a dm and a channel message is a comment", () => {
  const dm = parseSlack({ type: "event_callback", event: {
    type: "message", channel: "D01", channel_type: "im", user: "U9", text: "hello", ts: "1755600000.0001" } });
  assert.equal(dm[0].kind, "dm");
  assert.equal(dm[0].target_id, "D01");

  const pub = parseSlack({ type: "event_callback", event: {
    type: "message", channel: "C01", channel_type: "channel", user: "U9", text: "hello", ts: "1755600000.0002" } });
  assert.equal(pub[0].kind, "comment");
});

t("Slack: our own bot's message is dropped before anything else", () => {
  // a bot that answers itself is an infinite loop with a rate limit as its brake
  assert.deepEqual(parseSlack({ type: "event_callback", event: {
    type: "message", channel: "C01", user: "U9", text: "hi", ts: "1.1", bot_id: "B1" } }), []);
  assert.deepEqual(parseSlack({ type: "event_callback", event: {
    type: "message", channel: "C01", user: "USELF", text: "hi", ts: "1.1" } }, ["USELF"]), []);
});

t("Slack: joins, edits and deletions are not somebody talking to us", () => {
  for (const subtype of ["channel_join", "message_changed", "message_deleted", "thread_broadcast"]) {
    assert.deepEqual(parseSlack({ type: "event_callback", event: {
      type: "message", subtype, channel: "C01", user: "U9", text: "x", ts: "1.1" } }), [], subtype);
  }
});

t("Slack: the url_verification handshake is not an event", () => {
  assert.deepEqual(parseSlack({ type: "url_verification", challenge: "abc" }), []);
});

t("Slack: a threaded reply keeps its thread", () => {
  const ev = parseSlack({ type: "event_callback", event: {
    type: "message", channel: "C01", user: "U9", text: "and one more thing",
    ts: "1755600100.0003", thread_ts: "1755600000.0002" } });
  assert.equal(ev[0].parent_id, "1755600000.0002");
});

t("a Bluesky convo becomes a DM, and our own last word does not", () => {
  const convos = { convos: [
    { id: "convo1", members: [{ did: "did:plc:me" }, { did: "did:plc:them", handle: "them.bsky.social" }],
      lastMessage: { id: "m1", text: "loved the record", sentAt: "2026-08-20T10:00:00Z", sender: { did: "did:plc:them" } } },
    { id: "convo2", members: [{ did: "did:plc:me" }, { did: "did:plc:other" }],
      lastMessage: { id: "m2", text: "thanks!", sentAt: "2026-08-20T11:00:00Z", sender: { did: "did:plc:me" } } },
  ] };
  const ev = parseBlueskyConvos(convos, "did:plc:me");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].target_id, "convo1");        // the convoId, not the did
  assert.equal(ev[0].actor_name, "them.bsky.social");
});

t("a Bluesky like is not a message; a reply and a mention are", () => {
  const notifs = { notifications: [
    { uri: "at://x/app.bsky.feed.like/1", reason: "like", author: { did: "did:plc:a" }, indexedAt: "2026-08-20T10:00:00Z" },
    { uri: "at://x/app.bsky.feed.post/2", reason: "reply", author: { did: "did:plc:a", handle: "a.bsky.social" },
      record: { text: "when's the tour?", reply: { root: { uri: "at://root" } } }, indexedAt: "2026-08-20T10:01:00Z" },
    { uri: "at://x/app.bsky.feed.post/3", reason: "mention", author: { did: "did:plc:b" },
      record: { text: "@you this is great" }, indexedAt: "2026-08-20T10:02:00Z" },
  ] };
  const ev = parseBlueskyNotifications(notifs, "did:plc:me");
  assert.equal(ev.length, 2);
  assert.equal(ev[0].body, "when's the tour?");
  assert.equal(ev[0].parent_id, "at://root");
});

/* ---------------- sending on the new channels ---------------- */

t("Telegram's token goes in the path, and never through this module", () => {
  const a = askFor({ caps: chan("telegram"), as: "dm", target_id: "555", text: "hi", since_inbound_hours: 1 });
  assert.equal(a.ok, true);
  assert.equal(a.auth, "url");
  assert.match(a.url, /\{TOKEN\}/);              // a placeholder, not a secret
  assert.equal(a.body.chat_id, "555");
});

t("a Telegram group reply quotes the message it answers", () => {
  const a = askFor({ caps: chan("telegram"), as: "comment_reply", target_id: "-100:42", text: "hi", since_inbound_hours: 1 });
  assert.equal(a.ok, true);
  assert.equal(a.body.chat_id, "-100");
  assert.equal(a.body.reply_parameters.message_id, 42);
});

t("WhatsApp refuses to send until it knows which number it is", () => {
  const no = askFor({ caps: chan("whatsapp", { dm_window_hours: 24 }), as: "dm", target_id: "1555", text: "hi", since_inbound_hours: 1 });
  assert.equal(no.ok, false);
  assert.match(no.refusal, /phone_number_id/);

  const yes = askFor({ caps: chan("whatsapp", { dm_window_hours: 24, account_id: "PNID" }),
                       as: "dm", target_id: "1555", text: "hi", since_inbound_hours: 1 });
  assert.equal(yes.ok, true);
  assert.match(yes.url, /\/PNID\/messages$/);
  assert.equal(yes.body.messaging_product, "whatsapp");
});

t("WhatsApp outside the 24h window is refused, not quietly dropped", () => {
  const a = askFor({ caps: chan("whatsapp", { dm_window_hours: 24, account_id: "PNID" }),
                     as: "dm", target_id: "1555", text: "hi", since_inbound_hours: 30 });
  assert.equal(a.ok, false);
  assert.match(a.refusal, /window/);
});

t("WhatsApp has no comments, and says so rather than inventing an endpoint", () => {
  const a = askFor({ caps: chan("whatsapp"), as: "comment_reply", target_id: "x", text: "hi", since_inbound_hours: 1 });
  assert.equal(a.ok, false);
  assert.match(a.refusal, /no public comments/);
});

t("Slack posts to a channel, and into a thread when there is one", () => {
  const plain = askFor({ caps: chan("slack"), as: "dm", target_id: "D01", text: "hi", since_inbound_hours: 1 });
  assert.equal(plain.body.channel, "D01");
  assert.equal(plain.body.thread_ts, undefined);

  const threaded = askFor({ caps: chan("slack"), as: "comment_reply", target_id: "C01:1755600000.0002",
                            text: "hi", since_inbound_hours: 1 });
  assert.equal(threaded.body.channel, "C01");
  assert.equal(threaded.body.thread_ts, "1755600000.0002");
});

t("Bluesky sends through the chat proxy header, or the PDS answers 400", () => {
  const a = askFor({ caps: chan("bluesky"), as: "dm", target_id: "convo1", text: "hi", since_inbound_hours: 1 });
  assert.equal(a.ok, true);
  assert.equal(a.headers["atproto-proxy"], "did:web:api.bsky.chat#bsky_chat");
  assert.match(a.url, /chat\.bsky\.convo\.sendMessage$/);
  assert.equal(a.body.convoId, "convo1");
});

t("Discord refuses, and the refusal says why rather than blaming a setting", () => {
  const dm = askFor({ caps: chan("discord", { can_send_dm: false }), as: "dm", target_id: "1", text: "hi", since_inbound_hours: 1 });
  assert.equal(dm.ok, false);
  const c = askFor({ caps: chan("discord"), as: "comment_reply", target_id: "1", text: "hi", since_inbound_hours: 1 });
  assert.equal(c.ok, false);
  assert.match(c.refusal, /gateway/);
});

t("a private reply is a Meta mechanism and is refused elsewhere", () => {
  for (const k of ["telegram", "slack", "bluesky", "whatsapp"]) {
    const a = askFor({ caps: chan(k), as: "private_reply", target_id: "1", text: "hi", since_inbound_hours: 1 });
    assert.equal(a.ok, false, k);
  }
});

t("a switched-off channel refuses before anything else is considered", () => {
  for (const k of ["telegram", "slack", "bluesky", "whatsapp", "discord"]) {
    const a = askFor({ caps: chan(k, { enabled: false }), as: "dm", target_id: "1", text: "hi", since_inbound_hours: 1 });
    assert.equal(a.ok, false, k);
    assert.match(a.refusal, /switched off/);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
