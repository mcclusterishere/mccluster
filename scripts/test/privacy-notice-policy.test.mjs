/* The published Privacy Policy and the site-entry notice must make the same
   promises. Owner finding (2026-10-28): "The policy promises 'Not now', but
   the live entry dialog doesn't offer it." This pins every answer the notice
   offers, on the dialog, on the document-page bar and on the policy page,
   to the answers the policy names, and the behaviour the policy describes to
   the code that does it. Behaviour itself is exercised in
   scripts/test/account-identity-gate.test.mjs and scripts/smoke.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const live = read('js/live-content.js');
const policy = read('privacy.html');
const analytics = read('js/analytics.js');

const decode = (s) => s.replace(/'\s*\+\s*'/g, '').replace(/&amp;/g, '&').replace(/&rsquo;/g, '’').replace(/&ldquo;|&rdquo;/g, '"').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const fn = (name) => {
  const start = live.indexOf(`  function ${name}() {`);
  assert.ok(start >= 0, `${name}() is in js/live-content.js`);
  const end = live.indexOf('\n  }\n', start);
  return live.slice(start, end);
};
const buttons = (src) => [...src.matchAll(/<button type="button"[^>]*>([^<]+)<\/button>/g)].map((m) => decode(m[1])).sort();

const wall = fn('wall');
const banner = fn('banner');
const entryItem = (() => {
  const m = policy.match(/<li id="entry-notice">([\s\S]*?)<\/li>/);
  assert.ok(m, 'privacy.html#entry-notice describes the site-entry notice');
  return decode(m[1]);
})();
const promised = (() => {
  const m = entryItem.match(/offers two answers, ("[^"]+") and ("[^"]+")/);
  assert.ok(m, 'the policy names the answers the notice offers');
  return [m[1], m[2]].map((q) => q.slice(1, -1)).sort();
})();

test('the entry dialog offers exactly the answers the policy names', () => {
  assert.deepEqual(promised, ['I agree & continue', 'Not now']);
  assert.deepEqual(buttons(wall), promised, 'the entry dialog (the wall)');
  assert.deepEqual(buttons(banner), promised, 'the document-page bar');
});

test('"Not now" does what the policy says: lets you in, records only that you saw it, analytics stay off', () => {
  assert.match(entryItem, /answering "Not now", records only that you saw it: "Not now" lets you in, and McCluster's own analytics stay off until you agree/);
  /* the dialog's Not now: seen, the cover removed, no reload, no agreement */
  const notNow = wall.slice(wall.indexOf('function notNow()'), wall.indexOf('later.addEventListener("click", notNow)'));
  assert.ok(notNow.length > 0);
  assert.match(notNow, /writeSeen\(\);/);
  assert.match(notNow, /gate\.remove\(\);/);
  assert.match(notNow, /removeAttribute\("data-privacy-gate"\)/);
  assert.doesNotMatch(notNow, /writeAck|reload/);
  /* seen never counts as agreement where recording is decided */
  assert.match(live, /accepted: readAck,/);
  assert.match(analytics, /window\.MCC_PRIVACY\.accepted\(\)/);
  assert.doesNotMatch(analytics, /MCC_PRIVACY\.seen\(\)|mcc_privacy_seen/);
  /* the dialog says the same thing in its own words */
  assert.match(decode(wall), /McCluster’s own analytics stay off until you agree\. "Not now" lets you in and records only that you saw this notice\./);
  assert.match(decode(banner), /McCluster’s analytics stay off until you agree to the Privacy Policy; "Not now" records only that you saw this notice\./);
});

test('"shown once for each version": either answer ends it, and the version is one value everywhere', () => {
  assert.match(entryItem, /is shown once for each version of this policy: once you have answered it either way/);
  assert.match(decode(wall), /Either answer is kept for this version of the policy, so it is not asked again/);
  const version = live.match(/var VERSION = "(\d{4}-\d{2}-\d{2})";/)[1];
  assert.equal(analytics.match(/var MCC_PRIVACY_REQUIRED_VERSION = "([^"]+)";/)[1], version);
  assert.match(policy, new RegExp(`the notice version stays ${version}`), 'the policy names the live notice version');
  assert.match(wall, /'<small>Privacy notice version ' \+ VERSION \+ '<\/small>'/);
});

test('"You can agree later on this page": the policy page carries the agree control the notice uses', () => {
  assert.match(entryItem, /You can agree later on this page\./);
  assert.match(decode(wall), /you can agree later on the Privacy Policy page/);
  const m = policy.match(/<button type="button" class="pv__agree" id="mccPrivacyAnswerAgree">([^<]+)<\/button>/);
  assert.ok(m, 'privacy.html has the agree control');
  assert.equal(decode(m[1]), 'I agree & continue');
  assert.match(policy, /id="mccPrivacyAnswerStatus" role="status"/);
  assert.match(live, /if \(page === "privacy\.html"\) \{[\s\S]*?getElementById\("mccPrivacyAnswerAgree"\)[\s\S]*?writeAck\(\);/);
});

test('"asks you to acknowledge … when you first enter; you can answer Not now": the policy no longer says entry needs agreement', () => {
  assert.match(decode(policy), /asks you to acknowledge this Privacy Policy when you first enter; you can answer "Not now" and enter without agreeing/);
  assert.doesNotMatch(decode(policy), /acknowledge this Privacy Policy before entering/);
});

test('"shared by McCluster\'s own sites under mccluster.org", "with the time, in this browser\'s own storage"', () => {
  assert.match(entryItem, /first-party cookie that McCluster's own sites under mccluster.org share, and, with the time, in this browser's own storage/);
  assert.match(live, /cookieDomain = host === "mccluster\.org" \|\| \/\\\.mccluster\\\.org\$\/\.test\(host\) \? "mccluster\.org" : ""/);
  assert.match(live, /\{ version: VERSION, accepted_at: new Date\(\)\.toISOString\(\) \}/);
  assert.match(live, /\{ version: VERSION, seen_at: new Date\(\)\.toISOString\(\) \}/);
});

test('"agree while signed in … recorded on your account too"', () => {
  assert.match(entryItem, /If you agree to the site-entry notice while signed in, that version and the time are recorded on your account too/);
  assert.match(live, /privacy_policy_version: VERSION, privacy_acknowledged_at: at/);
});

test('"notice, not a blank check": permissions and privacy signals are still honoured', () => {
  assert.match(decode(policy), /does not override browser or operating-system permissions, Global Privacy Control, Do Not Track/);
  assert.match(decode(wall), /This acknowledgement is not blanket consent\. Precise location and other protected device permissions still use their own browser or operating-system controls, and privacy signals remain honored\./);
  assert.match(analytics, /navigator\.globalPrivacyControl === true/);
  assert.match(analytics, /navigator\.doNotTrack === "1"/);
});

test('the dialog is mobile first and keyboard-complete', () => {
  assert.doesNotMatch(wall + banner, /@media \(max-width/, 'min-width queries only');
  assert.doesNotMatch(wall + banner, /(?<!minmax\(0,)\b1fr\b(?!\))/, 'minmax(0,1fr), never a bare 1fr');
  assert.match(wall, /min-height:48px;min-width:44px/);
  assert.match(banner, /min-height:44px;min-width:44px/);
  assert.match(wall, /font-size:max\(16px,1rem\)/);
  assert.match(wall, /overflow-y:auto/, 'a short phone can still scroll to every answer');
  assert.match(wall, /e\.key === "Escape"/);
  assert.match(wall, /e\.key !== "Tab"/);
  assert.match(wall, /aria-describedby", "mccPrivacyGateBody"/);
  assert.match(banner, /e\.key !== "Escape"/);
});
