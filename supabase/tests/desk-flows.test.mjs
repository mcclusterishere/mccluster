/* THE LIVE FLOW SET, RUN AGAINST WHAT PEOPLE ACTUALLY SEND.
 *
 *     node --experimental-strip-types supabase/tests/desk-flows.test.mjs
 *
 * flows.test.mjs tests decide(). This tests the RULES — the rows that are
 * actually in inbox_flows on the live desk — because a correct engine
 * running a wrong rule set is still a bot that says the wrong thing to a
 * customer, and the rule set is the half that gets edited at midnight.
 *
 * The fixture below mirrors production. If you change a flow in the
 * database, change it here and watch what it does to these cases; if a
 * case flips, that is the review, and it happens before Instagram sees it.
 */
import { decide } from "../functions/inbox/flows.ts";
import assert from "node:assert/strict";

let passed = 0, failed = 0;
const ok = (label, fn) => {
  try { fn(); console.log("  ok    " + label); passed++; }
  catch (e) { console.error("  FAIL  " + label + "\n        " + e.message); failed++; }
};

/* production, as of the seeding in docs/social-desk-setup.md */
const FLOWS = [
  { id: "1", name: "Greet a first-time visitor", channel: "site", enabled: true, ordinal: 10, stop: true,
    trigger: { on: "message_in", match: "first" }, conditions: [],
    actions: [{ do: "reply", text: "Hey — this is Matthew's desk." },
              { do: "reply", text: "What are you here for?", delay_seconds: 2 }] },

  { id: "2", name: "Point at the music", channel: null, enabled: true, ordinal: 20, stop: true,
    trigger: { on: "message_in", match: "any",
               keywords: ["music", "song", "album", "listen", "mixtape", "prim3",
                          "the here album", "your album", "heal the 3"] },
    conditions: [], actions: [{ do: "tag", tag: "music" }, { do: "reply", text: "The whole catalogue…" }] },

  { id: "3", name: "Somebody wants a website", channel: null, enabled: true, ordinal: 30, stop: false,
    trigger: { on: "message_in", match: "any",
               keywords: ["website", "site", "web", "build", "design", "hosting", "domain"] },
    conditions: [], actions: [{ do: "tag", tag: "sites-lead" }] },

  { id: "4", name: "A money PROBLEM goes to a person", channel: null, enabled: true, ordinal: 40, stop: true,
    trigger: { on: "message_in", match: "any",
               keywords: ["refund", "chargeback", "charge back", "dispute", "cancel", "cancellation",
                          "unsubscribe", "invoice", "overcharged", "over charged", "double charged",
                          "charged twice", "charged me twice", "charged me", "billed twice", "billed me",
                          "took my money", "did not receive", "never received", "didnt receive",
                          "never got", "fraud", "scam"] },
    conditions: [], actions: [{ do: "tag", tag: "money" }, { do: "reply", text: "Let me get Matthew…" }, { do: "handoff" }] },

  { id: "5", name: "A money PROBLEM said in public", channel: null, enabled: true, ordinal: 41, stop: true,
    trigger: { on: "comment_in", match: "any",
               keywords: ["refund", "chargeback", "charge back", "dispute", "scam", "fraud",
                          "overcharged", "over charged", "double charged", "charged twice",
                          "charged me twice", "billed twice", "never received", "did not receive",
                          "never got", "took my money", "stole", "ripped off"] },
    conditions: [], actions: [{ do: "tag", tag: "money" }, { do: "reply", text: "Seeing this…" }, { do: "handoff" }] },
];

const ctx = (o) => ({ body: "", channel: "instagram", kind: "dm", first: false, tags: [], claimed: false, ...o });
const run = (o) => {
  const d = decide(FLOWS, ctx(o));
  return {
    replies: d.actions.filter((a) => a.do === "reply").length,
    tags: d.actions.filter((a) => a.do === "tag").map((a) => a.tag),
    handoff: d.actions.some((a) => a.do === "handoff"),
    /* WHAT THE MODEL GETS. index.ts only calls the model when no flow
       replied — so "did a flow speak" is the same question as "is this
       message automated by the knowledge base or by a canned line". */
    toModel: !d.actions.some((a) => a.do === "reply"),
  };
};

console.log("\n-- the question that pays the bills --");

/* This is the whole point of the change. Every one of these used to hit
   "Anything about money goes to a person", get a canned line and wait for
   a human. They are now answered from the ledger, with citations. */
for (const q of [
  "how much for a website",
  "whats the price",
  "how much do you charge",
  "what does it cost to get a site",
  "yo how much",
  "pricing?",
  "do you take a cut of my sales",
  "can I pay for the year up front",
]) {
  ok(`"${q}" reaches the model`, () => {
    const r = run({ body: q });
    assert.equal(r.toModel, true, JSON.stringify(r));
    assert.equal(r.handoff, false, JSON.stringify(r));
  });
}

console.log("\n-- and the questions that must NOT be automated --");

for (const q of [
  "I need a refund",
  "you charged me twice",
  "I want to cancel",
  "this is fraud",
  "I never received my site",
  "dispute this charge",
]) {
  ok(`"${q}" goes to a person, on Instagram`, () => {
    const r = run({ body: q });
    assert.equal(r.handoff, true, JSON.stringify(r));
    assert.equal(r.toModel, false, JSON.stringify(r));
    /* includes, not equals: "I never received my site" is a lead AND a
       billing complaint, and it should carry both tags. What matters is
       that it reaches a person, not that it carries exactly one label. */
    assert.ok(r.tags.includes("money"), JSON.stringify(r));
  });
}

ok("the past tense is covered — this is how people actually say it", () => {
  for (const q of ["you charged me twice", "i got billed twice", "yall took my money",
                   "I never got my site", "over charged me"]) {
    assert.equal(run({ body: q }).handoff, true, q);
  }
});

ok("but \"what do you charge\" is still a price question", () => {
  for (const q of ["what do you charge", "how much do you charge for a site"]) {
    const r = run({ body: q });
    assert.equal(r.handoff, false, q);
    assert.equal(r.toModel, true, q);
  }
});

ok("a money problem said in a PUBLIC comment also goes to a person", () => {
  const r = run({ body: "this guy took my money, scam", kind: "comment" });
  assert.equal(r.handoff, true, JSON.stringify(r));
});

ok("...and the DM rule does not fire on comments, nor the comment rule on DMs", () => {
  /* the two rules are separate on purpose: triggerFires compares kind,
     so one rule cannot cover both, and a silent gap is how "I got charged
     twice" under a post ends up answered by a model */
  const onlyDm = decide(FLOWS.filter((f) => f.id === "4"), ctx({ body: "refund", kind: "comment" }));
  const onlyCm = decide(FLOWS.filter((f) => f.id === "5"), ctx({ body: "refund", kind: "dm" }));
  assert.equal(onlyDm.actions.length, 0);
  assert.equal(onlyCm.actions.length, 0);
});

console.log("\n-- the words people say that are not about the album --");

/* "here" was a music keyword behind stop:true, because the album is
   called HERE. It is also how half of Instagram opens a conversation. */
for (const q of ["you here?", "is anyone here", "im here", "hello anybody here"]) {
  ok(`"${q}" is not answered with a link to the catalogue`, () => {
    const r = run({ body: q });
    assert.equal(r.tags.includes("music"), false, JSON.stringify(r));
    assert.equal(r.toModel, true, JSON.stringify(r));
  });
}

for (const q of ["can you track my order", "I want to record my business"]) {
  ok(`"${q}" is not read as a music question`, () => {
    assert.equal(run({ body: q }).tags.includes("music"), false);
  });
}

ok("somebody actually asking about the music still gets the music", () => {
  for (const q of ["where can I hear your music", "whats the album called", "I want to listen"]) {
    const r = run({ body: q });
    assert.deepEqual(r.tags, ["music"], q);
    assert.equal(r.replies, 1, q);
  }
});

console.log("\n-- a lead is tagged without being intercepted --");

ok("\"I need a website\" is tagged AND still reaches the model", () => {
  const r = run({ body: "I need a website for my church" });
  assert.deepEqual(r.tags, ["sites-lead"]);
  assert.equal(r.toModel, true, JSON.stringify(r));
  assert.equal(r.handoff, false);
});

ok("a lead asking a money PROBLEM is still tagged, and still handed off", () => {
  /* flow 3 does not stop, so flow 4 still gets its turn — which is the
     reason flow 3 was made non-stopping rather than deleted */
  const r = run({ body: "I want to cancel the hosting on my website" });
  assert.deepEqual(r.tags, ["sites-lead", "money"]);
  assert.equal(r.handoff, true);
});

console.log("\n-- the greeting stays where it belongs --");

ok("the widget greets a first-timer", () => {
  const r = run({ body: "hi", channel: "site", first: true });
  assert.equal(r.replies, 2);
});

ok("INSTAGRAM DOES NOT GREET — the first message there is the question", () => {
  const r = run({ body: "how much for a site", channel: "instagram", first: true });
  assert.equal(r.replies, 0, JSON.stringify(r));
  assert.equal(r.toModel, true, JSON.stringify(r));
});

ok("a thread a person has claimed is left alone entirely", () => {
  const r = run({ body: "I need a refund", claimed: true });
  assert.equal(r.handoff, false);
  assert.deepEqual(r.tags, []);
});

console.log("\n" + (failed ? "FAILED " + failed + " of " : "PASSED all ") + (passed + failed) + "\n");
process.exit(failed ? 1 : 0);
