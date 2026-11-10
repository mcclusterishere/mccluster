/* Privacy notice and the published policy must agree on exactly two choices:
   agree and enter, or go back without agreeing. No silent dismissal. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const live = read('js/live-content.js'), policy = read('privacy.html'), analytics = read('js/analytics.js');
const decode = s => s.replace(/'\s*\+\s*'/g,'').replace(/&amp;/g,'&')
  .replace(/&rsquo;/g,'’').replace(/&ldquo;|&rdquo;/g,'"').replace(/<[^>]+>/g,'')
  .replace(/\s+/g,' ').trim();
const fn = name => {
  const start=live.indexOf('  function '+name+'() {');
  assert.ok(start>=0,name+' is implemented');
  const end=live.indexOf('\n  }\n',start);
  assert.ok(end>start,name+' closes');
  return live.slice(start,end);
};
const buttons = src => [...src.matchAll(/<button type="button"[^>]*>([^<]+)<\/button>/g)]
  .map(m=>decode(m[1])).sort();
const wall=fn('wall'), back=fn('returnToPrevious'), entry=decode(policy.match(/<li id="entry-notice">([\s\S]*?)<\/li>/)[1]);

test('site entry and policy expose exactly Agree & continue or Go back',()=>{
  assert.match(entry,/offers exactly two choices, "I agree & continue" and "Go back"/);
  assert.deepEqual(buttons(wall),['Go back','I agree & continue']);
  assert.doesNotMatch(wall,/mccPrivacyLater|mccPrivacyNoticeLater|>Not now</);
  assert.match(wall,/id="mccPrivacyAgree"/);
  assert.match(wall,/id="mccPrivacyBack"/);
  assert.match(wall,/href="\/privacy.html"/);
  assert.match(policy,/id="mccPrivacyAnswerAgree">I agree &amp; continue/);
  assert.match(policy,/id="mccPrivacyAnswerBack">Go back/);
});

test('Go back always navigates out rather than suppressing the gate',()=>{
  assert.match(back,/w\.history\.back\(\)/);
  assert.match(back,/d\.referrer/);
  assert.match(back,/location\.replace\("about:blank"\)/);
  assert.doesNotMatch(back,/writeAck|localStorage|sessionStorage|cookie/);
  assert.match(wall,/back\.addEventListener\("click", goBack\)/);
  assert.match(wall,/Escape[\s\S]*?goBack\(\);/);
  assert.match(wall,/function goBack\(\)[\s\S]*?returnToPrevious\(\)/);
  assert.doesNotMatch(wall,/gate\.remove\(\)|removeAttribute\("data-privacy-gate"\)/);
  assert.doesNotMatch(live,/function writeSeen\(|function readSeen\(|banner\(\);/);
  assert.match(live,/if \(shown \|\| readAck\(\)\) return;/);
  assert.match(live,/seen: readAck/,'legacy seen marker cannot grant access');
  assert.doesNotMatch(live,/dismiss: writeSeen/);
});

/* A3 and A4 (deep audit, 2026-11-09). The wall can now come down without a reload, so what may bring it down is
   pinned: one function, one caller, and that caller asks for a recorded agreement first. No answer on the wall, no
   timeout and no failed handoff reaches it. */
test('the wall comes down in place only for a recorded agreement, and every wait is behind it',()=>{
  const release=fn('release'), reconcile=fn('reconcile'), settle=fn('settle');
  assert.match(release,/removeAttribute\("data-privacy-gate"\)/);
  assert.doesNotMatch(release,/writeAck|store\(|setCookie|location\.|history\./,'entering this way writes nothing and navigates nowhere');
  assert.equal(live.split('release()').length-1,2,'one definition, one caller');
  assert.match(reconcile,/if \(!entered && !agreeing && readAck\(\)\) release\(\);/,'and that caller asks for agreement first');
  assert.doesNotMatch(wall,/release\(|reconcile\(|settle\(/,'no answer on the wall reaches it: Go back and Escape only leave');
  assert.doesNotMatch(back,/release\(|reconcile\(|settle\(|removeAttribute/);
  assert.match(settle,/if \(reconcile\(\) \|\| !held\) return;\s*held = false;\s*if \(ui\.show\) ui\.show\(\);/,'a wait that ends without agreement ends in the question');
  assert.match(live,/held = true;\s*present\(\);\s*wait = setTimeout\(settle, 10000\);/,'a carried sign-in waits behind the wall, and ten seconds without word of it is the limit');
  assert.doesNotMatch(live,/setTimeout\(present,/,'nothing waits in front of the wall');
  assert.match(wall,/if \(held \|\| leaving \|\| agreeing\) return;[\s\S]*?function goBack\(\) \{\s*if \(held \|\| leaving \|\| agreeing\) return;/,'an answer that is not on offer cannot be given');
  assert.match(wall,/recover = setTimeout\(function \(\) \{ stuck = true; again\(\); \}, 1500\);/,'Go back that went nowhere gives the answers back');
  assert.match(back,/if \(!stuck && w\.history && w\.history\.length > 1/,'and is not asked of history twice');
  assert.match(live,/w\.addEventListener\("pageshow", function \(e\) \{/,'a page the browser kept looks again when it is shown');
  assert.doesNotMatch(live.slice(0,live.indexOf('LIVE CONTENT')),/addEventListener\("(?:unload|beforeunload)"/,'and nothing here keeps a page out of the back/forward cache');
  assert.match(wall,/#mccPrivacyGate \[hidden\]\{display:none!important\}/,'a part of the dialog that is not offered is not displayed');
  assert.match(wall,/id="mccPrivacyGateWait" role="status" hidden>Checking your sign-in\. One moment\.</);
});

test('consent version and first-party analytics remain strict',()=>{
  const version=live.match(/var VERSION = "(\d{4}-\d{2}-\d{2})"/)[1];
  assert.equal(analytics.match(/var MCC_PRIVACY_REQUIRED_VERSION = "([^"]+)"/)[1],version);
  assert.match(policy,new RegExp('version remains '+version));
  assert.match(wall,/'<small>Privacy notice version ' \+ VERSION/);
  assert.match(analytics,/window\.MCC_PRIVACY\.accepted\(\)/);
  assert.doesNotMatch(analytics,/MCC_PRIVACY\.seen\(\)/);
  assert.match(live,/privacy_policy_version: VERSION, privacy_acknowledged_at: at/);
  assert.match(live,/cookieDomain = host === "mccluster.org"/);
  assert.match(live,/if \(page === "privacy.html"\)/);
  assert.match(live,/back\.addEventListener\("click", returnToPrevious\)/);
});

test('the wall stays accessible on phones and does not override device consent',()=>{
  assert.match(wall,/min-height:48px;min-width:44px/);
  assert.match(wall,/font-size:max\(16px,1rem\)/);
  assert.match(wall,/overflow-y:auto/);
  assert.match(wall,/e\.key !== "Tab"/);
  assert.match(wall,/aria-describedby", "mccPrivacyGateBody"/);
  assert.doesNotMatch(wall,/@media \(max-width/);
  assert.match(decode(wall),/This acknowledgement is not blanket consent/);
  assert.match(decode(policy),/does not override browser or operating-system permissions, Global Privacy Control, Do Not Track/);
  assert.match(analytics,/navigator\.globalPrivacyControl === true/);
  assert.match(analytics,/navigator\.doNotTrack === "1"/);
});
