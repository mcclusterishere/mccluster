/* The flow engine tests. Run with:
 *
 *     node --experimental-strip-types supabase/tests/flows.test.mjs
 *
 * This imports the REAL module the edge function uses, not a copy. The
 * engine decides what the site says to a stranger under Matthew's name,
 * so the cases that matter are the ones where it should say NOTHING:
 * over a human, on a near-miss keyword, into a channel that cannot carry
 * the message. Those are the tests.
 */
import { decide, sendRefusal } from "../functions/inbox/flows.ts";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const flow = (o) => ({
  id: o.id ?? "f", name: o.name ?? "flow", channel: o.channel ?? null,
  enabled: o.enabled ?? true, ordinal: o.ordinal ?? 100, stop: o.stop ?? true,
  trigger: o.trigger, conditions: o.conditions ?? [], actions: o.actions ?? [],
});
const ctx = (o = {}) => ({
  body: o.body ?? "", channel: o.channel ?? "site", kind: o.kind ?? "dm",
  first: o.first ?? false, tags: o.tags ?? [], claimed: o.claimed ?? false,
});

const MUSIC = flow({
  id: "music", name: "music", ordinal: 20,
  trigger: { on: "message_in", match: "any", keywords: ["music", "album", "how much"] },
  actions: [{ do: "tag", tag: "music" }, { do: "reply", text: "the album" }],
});
const GREET = flow({
  id: "greet", name: "greet", ordinal: 10,
  trigger: { on: "message_in", match: "first" },
  actions: [{ do: "reply", text: "hello" }],
});

console.log("\nTRIGGERS");

t("a keyword fires its flow", () => {
  const d = decide([MUSIC], ctx({ body: "where is your music" }));
  assert.equal(d.actions.length, 2);
  assert.equal(d.actions[1].text, "the album");
});

t("a multi-word keyword matches as a phrase", () => {
  const d = decide([MUSIC], ctx({ body: "how much for a shoot" }));
  assert.equal(d.actions.length, 2);
});

/* The one that stops a bot embarrassing somebody. Substring matching
   would fire "music" inside "musician" and "cost" inside "Costa Rica". */
t("a keyword inside a longer word does NOT fire", () => {
  assert.equal(decide([MUSIC], ctx({ body: "I am a musicology student" })).actions.length, 0);
});

t("punctuation still counts as a boundary", () => {
  assert.equal(decide([MUSIC], ctx({ body: "got any music?" })).actions.length, 2);
});

t("first-message trigger fires only on the first", () => {
  assert.equal(decide([GREET], ctx({ first: true })).actions.length, 1);
  assert.equal(decide([GREET], ctx({ first: false })).actions.length, 0);
});

t("a comment trigger ignores a DM and vice versa", () => {
  const c = flow({ trigger: { on: "comment_in", match: "always" }, actions: [{ do: "reply", text: "x" }] });
  assert.equal(decide([c], ctx({ kind: "dm" })).actions.length, 0);
  assert.equal(decide([c], ctx({ kind: "comment" })).actions.length, 1);
});

t("match:all needs every keyword", () => {
  const f = flow({ trigger: { on: "message_in", match: "all", keywords: ["web", "price"] }, actions: [{ do: "reply", text: "x" }] });
  assert.equal(decide([f], ctx({ body: "web build" })).actions.length, 0);
  assert.equal(decide([f], ctx({ body: "web build price" })).actions.length, 1);
});

t("a regex trigger works", () => {
  const f = flow({ trigger: { on: "message_in", match: "regex", pattern: "^hi\\b" }, actions: [{ do: "reply", text: "x" }] });
  assert.equal(decide([f], ctx({ body: "hi there" })).actions.length, 1);
  assert.equal(decide([f], ctx({ body: "this is hidden" })).actions.length, 0);
});

/* A rule typed wrong in the database must not take the whole bot down.
   Every visitor after the bad row would otherwise get silence. */
t("a regex that does not compile is skipped, not thrown", () => {
  const bad = flow({ id: "bad", ordinal: 1, trigger: { on: "message_in", match: "regex", pattern: "([" }, actions: [{ do: "reply", text: "no" }] });
  const d = decide([bad, MUSIC], ctx({ body: "music please" }));
  assert.equal(d.actions[1].text, "the album");
});

t("a keyword trigger with no keywords never fires", () => {
  const f = flow({ trigger: { on: "message_in", match: "any", keywords: [] }, actions: [{ do: "reply", text: "x" }] });
  assert.equal(decide([f], ctx({ body: "anything" })).actions.length, 0);
});

console.log("\nORDER AND STOPPING");

t("lower ordinal runs first and stop:true ends it", () => {
  const d = decide([MUSIC, GREET], ctx({ body: "music", first: true }));
  assert.equal(d.actions.length, 1);
  assert.equal(d.actions[0].text, "hello");
});

t("stop:false lets the next flow also run", () => {
  const g = { ...GREET, stop: false };
  const d = decide([MUSIC, g], ctx({ body: "music", first: true }));
  assert.equal(d.actions.length, 3);
});

t("a disabled flow never runs", () => {
  assert.equal(decide([{ ...MUSIC, enabled: false }], ctx({ body: "music" })).actions.length, 0);
});

t("a flow bound to another channel does not run here", () => {
  assert.equal(decide([{ ...MUSIC, channel: "instagram" }], ctx({ body: "music" })).actions.length, 0);
  assert.equal(decide([{ ...MUSIC, channel: "site" }], ctx({ body: "music" })).actions.length, 2);
});

console.log("\nCONDITIONS");

t("has_tag gates a flow", () => {
  const f = { ...MUSIC, conditions: [{ has_tag: "vip" }] };
  assert.equal(decide([f], ctx({ body: "music" })).actions.length, 0);
  assert.equal(decide([f], ctx({ body: "music", tags: ["vip"] })).actions.length, 2);
});

t("not_tag stops a repeat", () => {
  const f = { ...MUSIC, conditions: [{ not_tag: "music" }] };
  assert.equal(decide([f], ctx({ body: "music", tags: ["music"] })).actions.length, 0);
});

t("an unknown condition fails closed", () => {
  const f = { ...MUSIC, conditions: [{ wat: 1 }] };
  assert.equal(decide([f], ctx({ body: "music" })).actions.length, 0);
});

console.log("\nTHE CLAIM GUARD — the rule a flow may not override");

/* If a human is in the conversation, the bot is silent. Not "unless a
   flow says otherwise": there is no way to express otherwise, which is
   the point. Somebody mid-sentence with Matthew does not get an
   autoresponder on top of him. */
t("a claimed thread gets nothing, whatever the flows say", () => {
  const always = flow({ trigger: { on: "message_in", match: "always" }, actions: [{ do: "reply", text: "bot" }] });
  const d = decide([always, MUSIC, GREET], ctx({ body: "music", first: true, claimed: true }));
  assert.equal(d.actions.length, 0);
});

t("and the trace says why", () => {
  const d = decide([MUSIC], ctx({ body: "music", claimed: true }));
  assert.match(d.trace[0].why, /person has this thread/);
});

console.log("\nTHE TRACE");

t("every flow considered is traced, matched or not", () => {
  const d = decide([MUSIC, GREET], ctx({ body: "nothing here" }));
  assert.equal(d.trace.length, 2);
  assert.ok(d.trace.every((x) => x.matched === false));
});

t("the matching flow's trace says which keyword did it", () => {
  const d = decide([MUSIC], ctx({ body: "the album is good" }));
  assert.match(d.trace[0].why, /album/);
});

console.log("\nWHAT A CHANNEL MAY ACTUALLY SEND");

const caps = (o) => ({
  key: o.key ?? "site", enabled: o.enabled ?? true,
  can_reply_comments: o.can_reply_comments ?? false,
  can_send_dm: o.can_send_dm ?? false,
  dm_window_hours: o.dm_window_hours ?? null,
});

t("an unknown channel is refused", () => {
  assert.match(sendRefusal(undefined, "dm", null), /unknown channel/);
});

t("a channel that is off is refused", () => {
  assert.match(sendRefusal(caps({ enabled: false, can_send_dm: true }), "dm", null), /not switched on/);
});

/* Threads has no messaging product at all. This is a fact about the
   platform, not a setting, and the engine has to know it before it
   writes a message claiming to have sent one. */
t("Threads cannot send a DM, and says so", () => {
  assert.match(sendRefusal(caps({ key: "threads", can_reply_comments: true }), "dm", null), /no way to send a direct message/);
});

t("but Threads can reply to a comment", () => {
  assert.equal(sendRefusal(caps({ key: "threads", can_reply_comments: true }), "comment", null), null);
});

t("a channel that cannot reply to comments is refused", () => {
  assert.match(sendRefusal(caps({ key: "linkedin" }), "comment", null), /cannot reply to comments/);
});

console.log("\nINSTAGRAM'S 24-HOUR WINDOW");

const IG = caps({ key: "instagram", can_send_dm: true, can_reply_comments: true, dm_window_hours: 24 });
const NOW = new Date("2026-08-19T12:00:00Z");

/* Instagram returns success for a send made after the window and the
   person never sees it. "We sent it" is not evidence it arrived, so the
   refusal happens here and the desk shows a real failure. */
t("inside the window, a DM is allowed", () => {
  assert.equal(sendRefusal(IG, "dm", "2026-08-19T20:00:00Z", NOW), null);
});

t("past the window, it is refused with the reason", () => {
  assert.match(sendRefusal(IG, "dm", "2026-08-19T06:00:00Z", NOW), /24h reply window .* has closed/);
});

t("exactly at the boundary counts as closed", () => {
  assert.match(sendRefusal(IG, "dm", "2026-08-19T12:00:00Z", NOW), /closed/);
});

t("a channel with no window is not affected by a stale timestamp", () => {
  const x = caps({ key: "x", can_send_dm: true, dm_window_hours: null });
  assert.equal(sendRefusal(x, "dm", "2020-01-01T00:00:00Z", NOW), null);
});

t("a windowed channel with no known window is allowed through", () => {
  // unknown is not the same as expired; the platform gets the final say
  assert.equal(sendRefusal(IG, "dm", null, NOW), null);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
