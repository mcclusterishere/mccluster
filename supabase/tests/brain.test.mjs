/* The brain's pure half. Run with:
 *
 *     node --experimental-strip-types supabase/tests/brain.test.mjs
 *
 * These import the REAL module the edge function imports. Everything
 * tested here is a decision that either costs money or decides whether a
 * stranger reads a sentence the site never authorised, which is why it is
 * in a pure function in the first place.
 *
 * The one rule NOT tested here is supersede-not-overwrite: it lives in
 * SQL because it is a read-then-write under concurrency, and it is tested
 * against a real Postgres in memory_note_test.sql.
 */
import {
  ANSWER_SCHEMA, TRIAGE_SCHEMA, assignArm, buildGrounding, choosePattern,
  chunkDocument, costMicros, gate, handle, mayRunUnattended, pickModel,
  readScoreboard, safeFacts,
} from "../functions/inbox/brain.ts";
import assert from "node:assert/strict";

let passed = 0;
function ok(label, fn) {
  try { fn(); console.log("  ok    " + label); passed++; }
  catch (e) { console.error("  FAIL  " + label + "\n        " + e.message); process.exitCode = 1; }
}

console.log("\n-- the router --");

ok("an answer gets the good model, tagging gets the cheap one", () => {
  const a = pickModel("reply");
  const b = pickModel("route");
  assert.equal(a.ok && a.chain[0], "claude-opus-5");
  assert.equal(b.ok && b.chain[0], "claude-haiku-4-5");
});

ok("chains run strong to cheap, never the reverse", () => {
  const r = pickModel("reply");
  // a fallback exists because the first choice was unavailable; answering
  // with a weaker model beats not answering
  assert.deepEqual(r.chain, ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]);
});

ok("under budget, nothing is degraded", () => {
  const r = pickModel("reply", { spentMicros: 100_000, budgetMicros: 2_000_000 });
  assert.equal(r.ok, true);
  assert.equal(r.degraded, false);
  assert.equal(r.chain.length, 3);
});

ok("past three quarters of the budget it drops to the cheapest link", () => {
  const r = pickModel("reply", { spentMicros: 1_600_000, budgetMicros: 2_000_000 });
  assert.equal(r.ok, true);
  assert.equal(r.degraded, true);
  assert.deepEqual(r.chain, ["claude-haiku-4-5"]);
  assert.equal(r.effort, "low");
});

ok("past the budget it refuses, so an overrun becomes a handoff", () => {
  const r = pickModel("reply", { spentMicros: 2_000_000, budgetMicros: 2_000_000 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /budget/);
});

ok("no budget set means no budget enforced", () => {
  const r = pickModel("reply", { spentMicros: 999_000_000 });
  assert.equal(r.ok, true);
  assert.equal(r.degraded, false);
});

ok("a pinned model wins and skips the chain", () => {
  const r = pickModel("reply", { only: "claude-sonnet-5" });
  assert.deepEqual(r.ok && r.chain, ["claude-sonnet-5"]);
});

console.log("\n-- what it cost --");

ok("dollars per million tokens times tokens is micro-dollars exactly", () => {
  // 1M in + 1M out on opus-5 is $5 + $25 = $30 = 30,000,000 micros
  const c = costMicros({ input_tokens: 1_000_000, output_tokens: 1_000_000 },
                       { input_per_mtok: 5, output_per_mtok: 25 });
  assert.equal(c, 30_000_000);
});

ok("a cache read bills at a tenth of input", () => {
  const c = costMicros({ cache_read_input_tokens: 1_000_000 }, { input_per_mtok: 5, output_per_mtok: 25 });
  assert.equal(c, 500_000);
});

ok("a cache write bills at 1.25x input", () => {
  const c = costMicros({ cache_creation_input_tokens: 1_000_000 }, { input_per_mtok: 5, output_per_mtok: 25 });
  assert.equal(c, 6_250_000);
});

ok("nulls from the API are zero, not NaN", () => {
  const c = costMicros(
    { input_tokens: 1000, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    { input_per_mtok: 5, output_per_mtok: 25 });
  assert.equal(c, 5000);
});

ok("the result is always an integer", () => {
  const c = costMicros({ input_tokens: 7, output_tokens: 3 }, { input_per_mtok: 0.06, output_per_mtok: 0 });
  assert.equal(Number.isInteger(c), true);
});

console.log("\n-- cutting a document up --");

const DOC = [
  "We build websites for small businesses.",
  "",
  "## Pricing",
  "",
  "A five page site is 2,500 dollars. Anything bigger is quoted.",
  "",
  "## Timeline",
  "",
  "Two to three weeks from the day the copy lands.",
].join("\n");

ok("every chunk carries a heading", () => {
  const cs = chunkDocument("McCluster Sites", DOC);
  assert.ok(cs.length >= 3);
  assert.ok(cs.every((c) => c.heading.trim().length > 0));
});

ok("the heading names the document, not just the section", () => {
  const cs = chunkDocument("McCluster Sites", DOC);
  const pricing = cs.find((c) => c.body.includes("2,500"));
  // "Pricing" alone is unfindable; a passage has to say whose pricing
  assert.equal(pricing.heading, "McCluster Sites — Pricing");
});

ok("text before the first heading belongs to the title", () => {
  const cs = chunkDocument("McCluster Sites", DOC);
  assert.equal(cs[0].heading, "McCluster Sites");
  assert.match(cs[0].body, /small businesses/);
});

ok("ordinals are dense and start at zero", () => {
  const cs = chunkDocument("T", DOC);
  assert.deepEqual(cs.map((c) => c.ordinal), cs.map((_, i) => i));
});

ok("no chunk exceeds the size limit", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph number ${i}. `.repeat(6)).join("\n\n");
  const cs = chunkDocument("Long", long, { max: 500, overlap: 0 });
  assert.ok(cs.length > 1);
  assert.ok(cs.every((c) => c.body.length <= 500), "a chunk ran over");
});

ok("a single paragraph longer than a chunk is split, not dropped", () => {
  const wall = "x".repeat(1200);
  const cs = chunkDocument("Wall", wall, { max: 300, overlap: 0 });
  assert.equal(cs.map((c) => c.body).join("").length, 1200);
});

ok("chunks overlap, so a straddling sentence belongs to one of them", () => {
  const paras = Array.from({ length: 12 }, (_, i) => `Sentence ${i} says something worth finding later.`).join("\n\n");
  const cs = chunkDocument("Overlap", paras, { max: 200, overlap: 60 });
  assert.ok(cs.length > 2);
  // every chunk after the first starts with text that appeared in the one before
  for (let i = 1; i < cs.length; i++) {
    const head = cs[i].body.slice(0, 20);
    assert.ok(cs[i - 1].body.includes(head), `chunk ${i} does not overlap its predecessor`);
  }
});

ok("an empty document produces no chunks rather than one empty one", () => {
  assert.deepEqual(chunkDocument("Nothing", "   \n\n  "), []);
});

console.log("\n-- the prompt --");

const PASSAGES = [
  { title: "Sites", url: "https://example.org/sites", body: "A five page site is 2,500 dollars." },
  { title: "Album", url: null, body: "I AM HERE is out now." },
];

ok("passages are numbered from one, and the numbers are in the text", () => {
  const g = buildGrounding({
    question: "how much?", passages: PASSAGES, persona: { voice: "Be brief." },
  });
  assert.deepEqual(g.passages.map((p) => p.n), [1, 2]);
  assert.match(g.user, /\[1\] Sites/);
  assert.match(g.user, /\[2\] Album/);
});

ok("the same inputs build the same prefix, or caching silently dies", () => {
  const mk = () => buildGrounding({ question: "q", passages: PASSAGES, persona: { voice: "Be brief." } });
  assert.equal(mk().system, mk().system);
  assert.equal(mk().user, mk().user);
});

ok("nothing that changes per message is in the cacheable system block", () => {
  const g = buildGrounding({
    question: "how much for a site?", passages: PASSAGES, persona: { voice: "Be brief." },
    facts: [{ key: "city", value: "Boston" }],
  });
  assert.ok(!g.system.includes("how much"));
  assert.ok(!g.system.includes("Boston"));
  assert.ok(!g.system.includes("2,500"));
});

ok("a public comment is flagged as public in the system block", () => {
  const pub = buildGrounding({ question: "q", passages: [], persona: { voice: "v" }, kind: "comment" });
  const dm = buildGrounding({ question: "q", passages: [], persona: { voice: "v" }, kind: "dm" });
  assert.match(pub.system, /PUBLIC/);
  assert.match(dm.system, /private/);
});

ok("no passages is stated, not left blank", () => {
  const g = buildGrounding({ question: "q", passages: [], persona: { voice: "v" } });
  assert.match(g.user, /\(none matched\)/);
});

ok("operator rules are appended to the house rules, not instead of them", () => {
  const g = buildGrounding({
    question: "q", passages: [], persona: { voice: "v", rules: ["Never mention the weather."] },
  });
  assert.match(g.system, /Never mention the weather\./);
  assert.match(g.system, /Never invent a discount/);
});

ok("the answer schema forbids extra keys and requires a confidence", () => {
  assert.equal(ANSWER_SCHEMA.additionalProperties, false);
  assert.ok(ANSWER_SCHEMA.required.includes("confidence"));
  assert.ok(ANSWER_SCHEMA.required.includes("handoff"));
});

console.log("\n-- the gate --");

const GOOD = { answer: "A five page site is 2,500 dollars.", cites: [1], confidence: 0.9, handoff: false, tags: ["pricing"] };

ok("a grounded, confident answer goes out", () => {
  const g = gate(GOOD, { passageCount: 2, kind: "dm" });
  assert.equal(g.send, true);
  assert.equal(g.text, GOOD.answer);
  assert.deepEqual(g.tags, ["pricing"]);
});

ok("a citation to a passage that was never supplied is fatal", () => {
  // the tell for an answer built out of the model's own memory
  const g = gate({ ...GOOD, cites: [1, 4] }, { passageCount: 2, kind: "dm" });
  assert.equal(g.send, false);
  assert.match(g.reason, /do not exist: 4/);
});

ok("a zero or negative citation is fatal too", () => {
  assert.equal(gate({ ...GOOD, cites: [0] }, { passageCount: 2 }).send, false);
  assert.equal(gate({ ...GOOD, cites: [-1] }, { passageCount: 2 }).send, false);
});

ok("an unsourced claim with passages available is refused", () => {
  const g = gate({ ...GOOD, cites: [] }, { passageCount: 2, kind: "dm" });
  assert.equal(g.send, false);
  assert.match(g.reason, /without using any of the passages/);
});

ok("but an answer with nothing to cite is allowed to have no citations", () => {
  const g = gate({ ...GOOD, cites: [] }, { passageCount: 0, kind: "dm" });
  assert.equal(g.send, true);
});

ok("the model asking for a person is honoured", () => {
  const g = gate({ ...GOOD, handoff: true }, { passageCount: 2 });
  assert.equal(g.send, false);
  assert.equal(g.handoff, true);
});

ok("a public comment needs more confidence than a DM", () => {
  const shaky = { ...GOOD, confidence: 0.6 };
  assert.equal(gate(shaky, { passageCount: 2, kind: "dm" }).send, true);
  assert.equal(gate(shaky, { passageCount: 2, kind: "comment" }).send, false);
});

ok("a public comment is held to a shorter length", () => {
  const longish = { ...GOOD, answer: "y".repeat(500) };
  assert.equal(gate(longish, { passageCount: 2, kind: "dm" }).send, true);
  assert.equal(gate(longish, { passageCount: 2, kind: "comment" }).send, false);
});

ok("nothing usable is a handoff, not a crash", () => {
  assert.equal(gate(null, { passageCount: 1 }).send, false);
  assert.equal(gate({ answer: "   ", cites: [], confidence: 1, handoff: false }, { passageCount: 0 }).send, false);
});

ok("a missing confidence is treated as no confidence", () => {
  const g = gate({ answer: "sure", cites: [1], handoff: false }, { passageCount: 1 });
  assert.equal(g.send, false);
});

ok("tags are capped at three, lowercased and trimmed", () => {
  const g = gate({ ...GOOD, tags: ["  Pricing ", "SITES", "web", "extra", "more"] }, { passageCount: 2 });
  assert.deepEqual(g.tags, ["pricing", "sites", "web"]);
});

console.log("\n-- what is fit to remember --");

ok("an ordinary fact is kept", () => {
  assert.deepEqual(safeFacts([{ key: "City", value: " Boston ", confidence: 0.8 }]),
                   [{ key: "city", value: "Boston", confidence: 0.8 }]);
});

ok("a password, a card, an ID and a birthday are all dropped", () => {
  const out = safeFacts([
    { key: "password", value: "hunter2" },
    { key: "card_number", value: "4111 1111 1111 1111" },
    { key: "note", value: "my card is 4111111111111111" },
    { key: "ssn", value: "123-45-6789" },
    { key: "dob", value: "1990-01-01" },
    { key: "api_key", value: "sk-abc" },
  ]);
  assert.deepEqual(out, []);
});

ok("one value per key per message", () => {
  const out = safeFacts([
    { key: "city", value: "Boston", confidence: 0.9 },
    { key: "city", value: "Denver", confidence: 0.9 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, "Boston");
});

ok("empty, absurdly long, and malformed facts are dropped", () => {
  const out = safeFacts([
    { key: "", value: "x" },
    { key: "k", value: "  " },
    { key: "k2", value: "y".repeat(400) },
    null,
    { key: 5, value: "z" },
  ]);
  assert.deepEqual(out, []);
});

ok("confidence is clamped into 0..1 and defaulted", () => {
  const out = safeFacts([
    { key: "a", value: "1", confidence: 9 },
    { key: "b", value: "2", confidence: -3 },
    { key: "c", value: "3" },
  ]);
  assert.deepEqual(out.map((f) => f.confidence), [1, 0, 0.6]);
});

console.log("\n-- triage --");

const T = (kind, over = {}) => ({ kind, reason: "because", ...over });

ok("abuse is never answered and never closed", () => {
  // closed is hidden, and this is the thread you most want to see —
  // you may need to block, report, or delete a comment
  const h = handle(T("abuse"), { kind: "comment" });
  assert.equal(h.answer, false);
  assert.equal(h.handoff, true);
  assert.equal(h.close, false);
  assert.deepEqual(h.tags, ["abuse"]);
});

ok("spam is closed without a reply", () => {
  // answering a link farm confirms the address is live and costs a full
  // answer to do it
  const h = handle(T("spam"));
  assert.equal(h.answer, false);
  assert.equal(h.close, true);
  assert.equal(h.handoff, false);
});

ok("praise in public gets a reply; praise in a DM gets a person", () => {
  assert.equal(handle(T("praise"), { kind: "comment" }).answer, true);
  const dm = handle(T("praise"), { kind: "dm" });
  assert.equal(dm.answer, false);
  assert.equal(dm.handoff, true);
});

ok("a lead with an address becomes a lead row", () => {
  const h = handle(T("lead", { email: " Sam@Example.ORG ", name: " Sam " }));
  assert.equal(h.answer, true);
  assert.deepEqual(h.tags, ["lead"]);
  assert.deepEqual(h.lead, { email: "sam@example.org", name: "Sam" });
});

ok("a lead without an address is still answered, but no row is invented", () => {
  // a handle in the email column is worse than no row: somebody would try to use it
  for (const bad of [null, undefined, "", "someone", "@handle", "a@b"]) {
    const h = handle(T("lead", { email: bad }));
    assert.equal(h.answer, true);
    assert.equal(h.lead, null, String(bad));
  }
});

ok("a lead who gave an address but no name still gets a usable row", () => {
  const h = handle(T("lead", { email: "sam@example.org" }));
  assert.equal(h.lead.name, "(from the inbox)");
});

ok("support and anything unrecognised are answered normally", () => {
  assert.equal(handle(T("support")).answer, true);
  assert.equal(handle(T("other")).answer, true);
});

ok("triage failing falls through to answering, it does not silence the bot", () => {
  // the ordinary path has its own gate; triage is a filter, not the only
  // thing between a stranger and a reply
  assert.equal(handle(null).answer, true);
  assert.equal(handle({}).answer, true);
  assert.match(handle(null).why, /triage returned nothing/);
});

ok("the reason is carried through, and bounded", () => {
  assert.equal(handle(T("spam", { reason: "  bulk SEO offer  " })).why, "bulk SEO offer");
  assert.equal(handle(T("spam", { reason: "x".repeat(500) })).why.length, 200);
});

ok("the triage schema names every bucket and forbids extras", () => {
  assert.deepEqual(TRIAGE_SCHEMA.properties.kind.enum,
    ["support", "lead", "praise", "spam", "abuse", "other"]);
  assert.equal(TRIAGE_SCHEMA.additionalProperties, false);
});

console.log("\n-- how much machinery this question deserves --");

const plan = (over = {}) => choosePattern({ toolCount: 0, passageCount: 2, kind: "dm", ...over });

ok("an ordinary question gets one grounded call, and always will", () => {
  // this is the whole point: a deployment that also runs a building must
  // not make "how much is a website" expensive
  const p = plan();
  assert.equal(p.pattern, "grounded");
  assert.equal(p.maxHops, 0);
  assert.equal(p.verify, false);
});

ok("nothing matched means nothing to ground it in", () => {
  assert.equal(plan({ passageCount: 0 }).pattern, "single");
});

ok("an org with no tools has no tool rung at all", () => {
  // absent, not disabled. Connecting a building changes what one org can
  // do without changing what anybody else's questions cost.
  for (const passageCount of [0, 5]) {
    for (const kind of ["dm", "comment"]) {
      const p = plan({ toolCount: 0, passageCount, kind });
      assert.notEqual(p.pattern, "tools");
      assert.equal(p.maxHops, 0);
    }
  }
});

ok("an org with tools gets them, with a hop ceiling", () => {
  const dm = plan({ toolCount: 3 });
  assert.equal(dm.pattern, "tools");
  assert.ok(dm.maxHops > 0);
  // fewer hops in public, and a second pass over the answer
  const pub = plan({ toolCount: 3, kind: "comment" });
  assert.ok(pub.maxHops < dm.maxHops);
  assert.equal(pub.verify, true);
});

ok("a public comment and a money question buy a second pass", () => {
  assert.equal(plan({ kind: "comment" }).pattern, "verified");
  assert.equal(plan({ triage: "lead" }).pattern, "verified");
  assert.equal(plan({ triage: "support" }).pattern, "grounded");
});

ok("past three quarters of the budget, nothing above the cheapest is bought", () => {
  // an expensive answer to the last question of the day is an expensive
  // answer nobody gets
  const p = plan({ toolCount: 5, kind: "comment", triage: "lead",
                   spentMicros: 1_600_000, budgetMicros: 2_000_000 });
  assert.equal(p.pattern, "grounded");
  assert.equal(p.maxHops, 0);
  assert.equal(p.verify, false);
  assert.match(p.why, /budget/);
});

ok("every choice says why, in words a person can act on", () => {
  for (const over of [{}, { passageCount: 0 }, { toolCount: 2 }, { kind: "comment" }]) {
    assert.ok(plan(over).why.length > 10);
  }
});

console.log("\n-- what may run without asking --");

ok("only a read tool, only when marked automatic, only in private", () => {
  const read = { risk: "read", auto: true };
  assert.equal(mayRunUnattended(read, { kind: "dm" }), true);
  // a stranger under a post does not get to make the building do things
  assert.equal(mayRunUnattended(read, { kind: "comment" }), false);
});

ok("a tool that changes something never runs unattended, marked or not", () => {
  for (const risk of ["write", "act"]) {
    assert.equal(mayRunUnattended({ risk, auto: true }, { kind: "dm" }), false, risk);
  }
});

ok("a read tool nobody armed stays unarmed", () => {
  assert.equal(mayRunUnattended({ risk: "read", auto: false }, { kind: "dm" }), false);
});

console.log("\n-- splitting traffic --");

const EXP = { key: "voice-2026-08", dimension: "voice",
              arms: [{ name: "control", weight: 50 }, { name: "warmer", weight: 50 }] };
const person = (n) => `contact-${n}`;

ok("a person stays in one arm, message after message", () => {
  // the alternative is somebody getting the warm voice then the terse
  // one, which is not an experiment, it is a fault
  const first = assignArm(EXP, person(7));
  for (let i = 0; i < 50; i++) assert.equal(assignArm(EXP, person(7)).name, first.name);
});

ok("different people land in different arms", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(assignArm(EXP, person(i)).name);
  assert.equal(seen.size, 2);
});

ok("a fifty-fifty split is roughly fifty-fifty", () => {
  let warmer = 0;
  for (let i = 0; i < 4000; i++) if (assignArm(EXP, person(i)).name === "warmer") warmer++;
  assert.ok(warmer > 1700 && warmer < 2300, `got ${warmer} of 4000`);
});

ok("weights are honoured, not just counted", () => {
  const skew = { key: "k", dimension: "model",
                 arms: [{ name: "a", weight: 90 }, { name: "b", weight: 10 }] };
  let b = 0;
  for (let i = 0; i < 4000; i++) if (assignArm(skew, person(i)).name === "b") b++;
  assert.ok(b > 250 && b < 550, `got ${b} of 4000`);
});

ok("the same person in two experiments is not correlated across them", () => {
  // hashing on the contact alone would put everybody in "arm one" of
  // everything, and every experiment would agree with every other
  const a = { key: "one", dimension: "voice", arms: EXP.arms };
  const b = { key: "two", dimension: "voice", arms: EXP.arms };
  let same = 0;
  for (let i = 0; i < 500; i++) if (assignArm(a, person(i)).name === assignArm(b, person(i)).name) same++;
  assert.ok(same > 180 && same < 320, `agreed ${same} of 500`);
});

ok("an unusable experiment is no experiment, never an error", () => {
  assert.equal(assignArm(null, "c1"), null);
  assert.equal(assignArm({ key: "k", dimension: "voice", arms: [] }, "c1"), null);
  assert.equal(assignArm({ key: "k", dimension: "voice", arms: [{ name: "only", weight: 100 }] }, "c1"), null);
  // a zero-weight arm is a control that never runs, which is the shape of
  // every experiment that ever "proved" something
  assert.equal(assignArm({ key: "k", dimension: "voice",
    arms: [{ name: "a", weight: 100 }, { name: "b", weight: 0 }] }, "c1"), null);
});

console.log("\n-- reading the scoreboard honestly --");

ok("a handful of verdicts is told it is a handful", () => {
  const r = readScoreboard([
    { arm: "control", calls: 40, verdicts: 4, good: 4, bad: 0, avg_cost_micros: 40000 },
    { arm: "warmer", calls: 38, verdicts: 3, good: 0, bad: 3, avg_cost_micros: 41000 },
  ]);
  assert.equal(r.enough, false);
  assert.match(r.verdict, /Nothing here means anything yet/);
  assert.equal(r.best, undefined);
});

ok("one arm alone is not a comparison", () => {
  const r = readScoreboard([{ arm: "control", calls: 900, verdicts: 400, good: 380, bad: 20, avg_cost_micros: 4 }]);
  assert.equal(r.enough, false);
});

ok("a real gap on real numbers is called", () => {
  const r = readScoreboard([
    { arm: "control", calls: 200, verdicts: 60, good: 30, bad: 30, avg_cost_micros: 40000 },
    { arm: "warmer", calls: 200, verdicts: 60, good: 54, bad: 6, avg_cost_micros: 41000 },
  ]);
  assert.equal(r.enough, true);
  assert.equal(r.best, "warmer");
  assert.match(r.verdict, /40 points ahead/);
});

ok("a close result says so instead of picking a winner", () => {
  const r = readScoreboard([
    { arm: "control", calls: 200, verdicts: 80, good: 60, bad: 20, avg_cost_micros: 40000 },
    { arm: "warmer", calls: 200, verdicts: 80, good: 64, bad: 16, avg_cost_micros: 40000 },
  ]);
  assert.equal(r.enough, true);
  assert.equal(r.best, undefined);
  assert.match(r.verdict, /no arm is clearly ahead/);
});

ok("a winner that costs much more says that too", () => {
  const r = readScoreboard([
    { arm: "cheap", calls: 200, verdicts: 60, good: 24, bad: 36, avg_cost_micros: 3000 },
    { arm: "opus", calls: 200, verdicts: 60, good: 54, bad: 6, avg_cost_micros: 60000 },
  ]);
  assert.match(r.verdict, /costs noticeably more/);
});

console.log(`\n  ${passed} checks passed\n`);
