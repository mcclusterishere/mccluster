// Tests for the social engine's authorization and publish safety.
//
// WHY THESE ARE MOSTLY STATIC CHECKS
// ----------------------------------
// The bug these exist to prevent was not a wrong value. It was an
// ABSENCE: getOrg selected the caller's role and no call site ever read
// it, so membership in any org was the whole check. Nothing failed.
// Every endpoint returned 200 to a viewer who should have got 403.
//
// You cannot catch that by asserting on outputs, because the outputs
// were all correct. You catch it by asserting that every route still
// passes through the check — which is a property of the source, so the
// test reads the source. It is unusual and it is the right shape for
// this failure.
//
// The Worker's dependencies are not installed in this repo and the
// module chain reaches the fal.ai SDK, so nothing here imports
// router.js. score.js was extracted precisely so the one piece of pure
// logic could be imported and tested normally.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "workers", "mccluster", "src");
const read = (p) => readFileSync(join(src, p), "utf8");

const socialRouter = read("social/router.js");
const mediaRouter = read("media/router.js");
const meta = read("social/meta.js");

const { scoreMetrics } = await import(
  join(src, "social", "score.js").replace(/^/, "file://")
);

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log("  ok  ", name); pass++; }
  catch (e) { console.log("  FAIL", name, "\n       ", e.message); fail++; }
};

/* ------------------------------------------------------------------ */
/* authorization: the check exists, on every route                     */
/* ------------------------------------------------------------------ */

t("no handler resolves an org without naming a capability", () => {
  // The regression guard. resolveOrg's 4th argument is the capability;
  // a call with three arguments is a route someone added and forgot.
  for (const [file, source] of [["social/router.js", socialRouter], ["media/router.js", mediaRouter]]) {
    const calls = source.match(/await resolveOrg\(.*?\);$/gm) || [];
    assert.ok(calls.length > 0, `${file}: no resolveOrg calls found at all`);
    for (const call of calls) {
      assert.match(
        call,
        /,\s*'[a-z]+\.[a-z]+'\s*\);$/,
        `${file}: this call names no capability -> ${call}`
      );
    }
  }
});

t("the unchecked getOrg is gone from both routers", () => {
  // It selected `role` and never used it. Its return shape is identical
  // to resolveOrg's, so reintroducing it would silently reopen the hole.
  for (const [file, source] of [["social/router.js", socialRouter], ["media/router.js", mediaRouter]]) {
    assert.ok(!/\bgetOrg\b/.test(source), `${file} still references getOrg`);
  }
});

t("every social route reaches a handler that authorizes", () => {
  // Pull the handler name out of each route line, then check that
  // handler's body calls resolveOrg. Catches a route wired to a function
  // that skips the check entirely.
  const routes = [...socialRouter.matchAll(/return (\w+)\(request, env, user/g)].map((m) => m[1]);
  assert.ok(routes.length >= 10, `expected the full route table, found ${routes.length}`);
  for (const handler of new Set(routes)) {
    const body = socialRouter.slice(socialRouter.indexOf(`async function ${handler}(`));
    const end = body.indexOf("\nasync function ", 1);
    assert.match(
      end === -1 ? body : body.slice(0, end),
      /resolveOrg\(/,
      `${handler} is routed but never calls resolveOrg`
    );
  }
});

t("write actions are not gated on a read capability", () => {
  // social.read on a mutating route would be the same bug wearing a
  // capability's clothes.
  for (const verb of ["createAccount", "createCampaign", "queuePublish", "registerPost", "ingestMetrics", "createAutomation"]) {
    const at = socialRouter.indexOf(`async function ${verb}(`);
    assert.ok(at > -1, `${verb} not found`);
    const body = socialRouter.slice(at, at + 600);
    assert.ok(
      !/'social\.read'/.test(body),
      `${verb} mutates state but is gated on social.read`
    );
  }
});

t("connecting an account needs its own high-risk capability", () => {
  // Attaching a credential decides which account everything afterwards
  // speaks as. It is strictly more dangerous than posting once.
  const at = socialRouter.indexOf("async function createAccount(");
  assert.match(socialRouter.slice(at, at + 400), /'social\.connect'/);
});

t("the grant table fails closed when it cannot be read", () => {
  for (const [file, source] of [["social/router.js", socialRouter], ["media/router.js", mediaRouter]]) {
    const at = source.indexOf("async function loadGrants(");
    assert.ok(at > -1, `${file}: loadGrants missing`);
    assert.match(
      source.slice(at, at + 500),
      /throw Object\.assign/,
      `${file}: an unreadable grant table must stop the call, not allow it`
    );
  }
});

/* ------------------------------------------------------------------ */
/* credentials: credential_ref selects a secret, so constrain it       */
/* ------------------------------------------------------------------ */

t("credential_ref shape rejects unrelated secrets", () => {
  const shape = /^SOCIAL_[A-Z0-9_]{1,64}$/;
  for (const good of ["SOCIAL_IG_PRIMARY", "SOCIAL_ESMER_1", "SOCIAL_A"]) {
    assert.ok(shape.test(good), `${good} should be allowed`);
  }
  for (const bad of [
    "STRIPE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "META_APP_SECRET",
    "social_ig_primary",      // lower case
    "SOCIAL-IG",              // hyphen
    "SOCIAL_",                // prefix alone, no name
    "XSOCIAL_IG",             // prefix not at the start
    "SOCIAL_IG PRIMARY"       // space
  ]) {
    assert.ok(!shape.test(bad), `${bad} must NOT be selectable`);
  }
});

t("credential_ref is validated where it is written and where it is read", () => {
  // Belt and braces on purpose: a row that predates the CHECK
  // constraint, or one written by a future path that forgets, still
  // cannot select an unrelated binding at resolution time.
  assert.match(socialRouter, /credential_ref: validCredentialRef\(/, "write site does not validate");
  const at = meta.indexOf("function tokenFor(");
  assert.match(meta.slice(at, at + 300), /CREDENTIAL_REF_SHAPE\.test/, "read site does not validate");
});

/* ------------------------------------------------------------------ */
/* publishing: claim before you call Meta                              */
/* ------------------------------------------------------------------ */

t("a job is claimed before anything reaches Meta", () => {
  const at = meta.indexOf("export async function processInstagramPublishQueue(");
  const body = meta.slice(at);
  const claim = body.indexOf("claimJob(");
  const process = body.indexOf("processPublishJob(");
  assert.ok(claim > -1, "no claim step in the queue processor");
  assert.ok(claim < process, "processPublishJob runs before the job is claimed");
});

t("the claim is a compare-and-swap on lease_until, not a plain write", () => {
  const at = meta.indexOf("async function claimJob(");
  const body = meta.slice(at, at + 900);
  // Without the or=(...) predicate the PATCH always succeeds and every
  // concurrent run believes it owns the job.
  assert.match(body, /or=\(lease_until\.is\.null,lease_until\.lt\./, "claim has no expiry predicate");
  assert.match(body, /return=representation/, "claim cannot tell whether it won without the row back");
  assert.match(body, /claimed\?\.\[0\] \|\| null/, "claim does not treat zero rows as 'someone else owns it'");
});

t("the lease is released between publish phases", () => {
  // Publishing is two-phase and the second phase is a later run. Holding
  // the lease across both would delay every post by the lease window.
  const at = meta.indexOf("export async function processInstagramPublishQueue(");
  const body = meta.slice(at);
  assert.match(body, /outcome\?\.state !== 'published'/, "no per-phase release");
  assert.match(body, /lease_until: null/, "lease is never cleared");
});

t("a retryable failure hands the job straight back", () => {
  const at = meta.indexOf("export async function processInstagramPublishQueue(");
  const body = meta.slice(at);
  assert.match(
    body,
    /lease_until: terminal \? null : new Date\(\)\.toISOString\(\)/,
    "a failed-but-retryable job should not wait out the whole lease"
  );
});

/* ------------------------------------------------------------------ */
/* scoring                                                             */
/* ------------------------------------------------------------------ */

t("an empty post scores zero rather than NaN", () => {
  const { score, components } = scoreMetrics({});
  assert.equal(score, 0);
  for (const [k, v] of Object.entries(components)) {
    assert.ok(Number.isFinite(v), `${k} is not finite`);
  }
});

t("every component stays inside 0..100 under absurd input", () => {
  const { score, components } = scoreMetrics({
    views: 1, reach: 1, likes: 1e9, comments: 1e9, shares: 1e9,
    saves: 1e9, follows: 1e9, dms: 1e9, leads: 1e9, retention_3s: 99
  });
  for (const [k, v] of Object.entries(components)) {
    assert.ok(v >= 0 && v <= 100, `${k} escaped its bounds: ${v}`);
  }
  assert.ok(score >= 0 && score <= 100, `score escaped its bounds: ${score}`);
});

t("negative and non-numeric metrics cannot drag a score down", () => {
  // Metrics can be submitted through an authenticated endpoint. A
  // negative value must not become negative score.
  const { score } = scoreMetrics({ views: -5, likes: "banana", leads: -100, retention_3s: -1 });
  assert.ok(score >= 0, `score went negative: ${score}`);
  assert.ok(Number.isFinite(score), "score is not finite");
});

t("a share counts for more than a like", () => {
  const liked = scoreMetrics({ views: 1000, likes: 10 });
  const shared = scoreMetrics({ views: 1000, shares: 10 });
  assert.ok(
    shared.components.engagement > liked.components.engagement,
    "shares should outweigh likes — they cost the viewer something"
  );
});

t("the weights still sum to one", () => {
  // A perfect post on every axis must score exactly 100. If someone
  // retunes a weight and forgets the others, this catches it.
  const perfect = scoreMetrics({
    views: 1e6, reach: 1, likes: 1e6, comments: 1e6, shares: 1e6,
    saves: 1e6, follows: 1e6, dms: 1e6, leads: 1e6, retention_3s: 1
  });
  assert.equal(perfect.components.retention, 100);
  assert.ok(Math.abs(perfect.score - 100) < 0.001, `perfect post scored ${perfect.score}, expected 100`);
});

t("provider-synced posts cannot reach the top of the leaderboard", () => {
  // Documents a known limitation rather than asserting a behaviour we
  // want. The Instagram sync writes follows/dms/leads as 0 and
  // retention as null, so 45% of the score is unreachable on synced
  // data. If someone fixes ingestion, this test fails and should be
  // deleted — that is the point of it.
  const asSynced = scoreMetrics({
    views: 1e9, reach: 1e9, likes: 1e9, comments: 1e9, shares: 1e9, saves: 1e9,
    follows: 0, dms: 0, leads: 0, retention_3s: null
  });
  assert.ok(
    asSynced.score <= 55.001,
    `synced posts can now exceed 55 (${asSynced.score}) — ingestion may have been fixed; update docs and delete this test`
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
