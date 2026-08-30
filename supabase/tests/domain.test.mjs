/* The domain search, against what people actually type.
 *
 *     node --experimental-strip-types supabase/tests/domain.test.mjs
 *
 * The cases that matter are not "does example.com parse". They are the
 * ones where a wrong answer costs money: a rate limit read as "yours",
 * a subdomain sold as a name, an ending we do not price offered with a
 * price on it.
 */
import {
  buyable, callerIp, candidates, clientKey, normalize, rank, rdapUrl, readRdap, verdictLine,
} from "../functions/domain-check/domain.ts";
import assert from "node:assert/strict";

let passed = 0, failed = 0;
const ok = async (label, fn) => {
  try { await fn(); console.log("  ok    " + label); passed++; }
  catch (e) { console.error("  FAIL  " + label + "\n        " + e.message); failed++; }
};

const LIST = [
  { tld: "com", sellable: true },
  { tld: "net", sellable: true },
  { tld: "org", sellable: true },
  { tld: "io", sellable: false },
  { tld: "church", sellable: false },
];

console.log("\n-- what counts as a name --");

await ok("a bare name is a bare name", () => {
  const p = normalize("shilohbaptist");
  assert.equal(p.ok, true);
  assert.equal(p.label, "shilohbaptist");
  assert.equal(p.tld, "");
});

await ok("a name with an ending keeps its ending", () => {
  const p = normalize("shilohbaptist.org");
  assert.deepEqual([p.ok, p.label, p.tld], [true, "shilohbaptist", "org"]);
});

await ok("what somebody pastes out of the address bar still works", () => {
  for (const s of [
    "https://Example.com/pricing?x=1",
    "http://www.example.com",
    "WWW.EXAMPLE.COM",
    "example.com.",
    "  example.com  ",
    "example.com/",
  ]) {
    const p = normalize(s);
    assert.deepEqual([p.ok, p.label, p.tld], [true, "example", "com"], s);
  }
});

await ok("an email address is read as its domain", () => {
  const p = normalize("pastor@shilohbaptist.org");
  assert.deepEqual([p.label, p.tld], ["shilohbaptist", "org"]);
});

await ok("a business name with spaces becomes the name they meant", () => {
  const p = normalize("Shiloh Baptist Church");
  assert.equal(p.ok, true);
  assert.equal(p.label, "shiloh-baptist-church");
  assert.equal(p.tld, "");
});

await ok("A SUBDOMAIN IS NOT FOR SALE — the registrable name is what gets checked", () => {
  /* Typing shiloh.baptist.church and being sold baptist.church is
     being sold somebody else's name. */
  const p = normalize("shiloh.baptist.church");
  assert.deepEqual([p.label, p.tld], ["baptist", "church"]);
  assert.deepEqual(candidates(p, LIST), ["baptist.church"]);
});

await ok("empty, whitespace and punctuation-only ask for a name", () => {
  for (const s of ["", "   ", null, undefined, ".", "...", "-", "--"]) {
    const p = normalize(s);
    assert.equal(p.ok, false, JSON.stringify(s));
    assert.match(p.reason, /name|character|hyphen/i);
  }
});

await ok("nothing that is not a hostname character survives", () => {
  for (const s of ["ex ample!.com", "ex$ample", "a<b>c", "back\\slash", "semi;colon"]) {
    const p = normalize(s);
    if (p.ok) assert.match(p.label, /^[a-z0-9-]+$/, s);
    else assert.equal(typeof p.reason, "string");
  }
});

await ok("a checked name can never carry a character a URL would have to escape", () => {
  const tries = [
    "ex ample!.com", "../../etc/passwd", "a\"b", "a'b", "a`b", "a|b",
    "%2e%2e", "javascript:alert(1)", "name?x=1", "name#frag", "a\tb",
  ];
  for (const s of tries) {
    const p = normalize(s);
    for (const n of candidates(p, LIST)) {
      assert.match(n, /^[a-z0-9-]+\.[a-z]{2,63}$/, s + " -> " + n);
      assert.equal(rdapUrl(n), "https://rdap.org/domain/" + n, "no escaping needed for " + n);
    }
  }
});

await ok("accents are answered honestly rather than mangled", () => {
  const p = normalize("café.com");
  assert.equal(p.ok, false);
  assert.match(p.reason, /Accents/);
  assert.deepEqual(candidates(p, LIST), []);
});

await ok("a label over 63 characters is refused with the reason", () => {
  const p = normalize("a".repeat(64) + ".com");
  assert.equal(p.ok, false);
  assert.match(p.reason, /63/);
});

await ok("63 characters exactly is fine", () => {
  assert.equal(normalize("a".repeat(63) + ".com").ok, true);
});

await ok("leading and trailing hyphens are trimmed, not refused", () => {
  assert.equal(normalize("-example-.com").label, "example");
});

await ok("the reserved third-and-fourth hyphen pair is refused, except punycode", () => {
  assert.equal(normalize("ab--cd.com").ok, false);
  assert.equal(normalize("xn--80ak6aa92e.com").ok, true);
});

console.log("\n-- which addresses get looked up --");

await ok("a bare name fans out across the endings we sell, and only those", () => {
  assert.deepEqual(
    candidates(normalize("shilohbaptist"), LIST),
    ["shilohbaptist.com", "shilohbaptist.net", "shilohbaptist.org"],
  );
});

await ok("a named ending is the only thing checked", () => {
  assert.deepEqual(candidates(normalize("shilohbaptist.org"), LIST), ["shilohbaptist.org"]);
  assert.deepEqual(candidates(normalize("shilohbaptist.io"), LIST), ["shilohbaptist.io"]);
});

await ok("an ending nobody listed is not fetched at all", () => {
  assert.deepEqual(candidates(normalize("example.zzzz"), LIST), []);
});

await ok("the fan-out is capped whatever the list grows to", () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ tld: "t" + i, sellable: true }));
  assert.equal(candidates(normalize("x"), big).length, 4);
  assert.equal(candidates(normalize("x"), big, 2).length, 2);
});

await ok("a name that did not parse is never looked up", () => {
  assert.deepEqual(candidates(normalize(""), LIST), []);
  assert.deepEqual(candidates(normalize("café"), LIST), []);
});

console.log("\n-- reading the registry --");

await ok("404 is free, 200 is taken", () => {
  assert.equal(readRdap(404), "available");
  assert.equal(readRdap(200, { objectClassName: "domain", ldhName: "GOOGLE.COM" }), "taken");
});

await ok("A RATE LIMIT IS NOT AN AVAILABLE DOMAIN", () => {
  /* The bug this whole file exists to prevent. */
  for (const s of [0, 400, 403, 429, 500, 502, 503, 504]) {
    assert.equal(readRdap(s), "unknown", "status " + s);
  }
});

await ok("a 200 carrying an errorCode is read as the error it is", () => {
  assert.equal(readRdap(200, { errorCode: 404, title: "Not found" }), "available");
  assert.equal(readRdap(200, { errorCode: 429, title: "Too many" }), "unknown");
  assert.equal(readRdap(200, { errorCode: 500 }), "unknown");
});

await ok("an unparseable body at 200 is still a registered name", () => {
  assert.equal(readRdap(200, null), "taken");
});

console.log("\n-- what the card may say --");

const c = (o) => ({ name: "x.com", tld: "com", available: null, sellable: false, price: null, note: null, ...o });

await ok("buyable needs free AND sellable AND a price — all three", () => {
  assert.equal(buyable(c({ available: true, sellable: true, price: 33 })), true);
  assert.equal(buyable(c({ available: false, sellable: true, price: 33 })), false);
  assert.equal(buyable(c({ available: null, sellable: true, price: 33 })), false);
  assert.equal(buyable(c({ available: true, sellable: false, price: 33 })), false);
  assert.equal(buyable(c({ available: true, sellable: true, price: null })), false);
  assert.equal(buyable(c({ available: true, sellable: true, price: 0 })), false);
});

await ok("an ending we do not price prints its own sentence, never a number", () => {
  const io = c({ tld: "io", available: true, sellable: false, note: "Available. .io costs more." });
  assert.equal(buyable(io), false);
  assert.equal(verdictLine(io), "Available. .io costs more.");
});

await ok("an unknown never reads as yours", () => {
  assert.match(verdictLine(c({ available: null })), /Couldn't check/);
  assert.equal(verdictLine(c({ available: false })), "Taken.");
  assert.equal(verdictLine(c({ available: true, sellable: true, price: 33 })), "Available.");
});

await ok("the answer somebody can act on sorts to the top", () => {
  const rows = [
    c({ name: "a.com", available: false, sellable: true, price: 33 }),
    c({ name: "b.com", available: null, sellable: true, price: 33 }),
    c({ name: "c.io", available: true, sellable: false }),
    c({ name: "d.net", available: true, sellable: true, price: 33 }),
  ];
  rows.sort(rank);
  assert.deepEqual(rows.map((r) => r.name), ["d.net", "c.io", "b.com", "a.com"]);
});

await ok("ties keep the order the list gave", () => {
  const rows = ["com", "net", "org"].map((t) =>
    c({ name: "x." + t, tld: t, available: true, sellable: true, price: 33 }));
  rows.sort(rank);
  assert.deepEqual(rows.map((r) => r.tld), ["com", "net", "org"]);
});

console.log("\n-- the throttle --");

await ok("the caller is the first entry of the forwarded list, not the proxies", () => {
  const h = (o) => ({ get: (k) => o[k] ?? null });
  assert.equal(callerIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })), "203.0.113.7");
  assert.equal(callerIp(h({ "x-forwarded-for": "  203.0.113.7  " })), "203.0.113.7");
  assert.equal(callerIp(h({ "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(callerIp(h({})), "unknown");
  assert.equal(callerIp(h({ "x-forwarded-for": "" })), "unknown");
});

await ok("the same address buckets together and a different one does not", async () => {
  const a = await clientKey("203.0.113.7", "salt");
  const b = await clientKey("203.0.113.7", "salt");
  const d = await clientKey("203.0.113.8", "salt");
  assert.equal(a, b);
  assert.notEqual(a, d);
  assert.match(a, /^[0-9a-f]{32}$/);
});

await ok("the same address under a different salt is a different bucket", async () => {
  assert.notEqual(await clientKey("203.0.113.7", "one"), await clientKey("203.0.113.7", "two"));
});

await ok("the key is a hash, not the address wearing a hat", async () => {
  const k = await clientKey("203.0.113.7", "salt");
  assert.equal(k.includes("203"), false);
  assert.equal(k.includes("113"), false);
});

console.log("\n" + (failed ? "FAILED " + failed + " of " : "PASSED all ") + (passed + failed) + "\n");
process.exit(failed ? 1 : 0);
