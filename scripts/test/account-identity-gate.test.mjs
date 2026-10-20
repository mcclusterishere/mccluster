import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function checker() {
  const src = await readFile(join(ROOT, 'js/name-integrity.js'), 'utf8');
  const window = {};
  vm.runInNewContext(src, { window, Set, String, RegExp });
  return window.MCC_NAME_INTEGRITY;
}

test('name integrity accepts ordinary international name shapes', async () => {
  const c = await checker();
  for (const pair of [
    ['Matthew', 'McCluster'],
    ['Anne-Marie', "O'Neill"],
    ['José', 'García'],
    ['Jean', 'de la Cruz']
  ]) assert.equal(c.validate(pair[0], pair[1]).ok, true, pair.join(' '));
});

test('name integrity rejects obvious garbage without pretending to verify identity', async () => {
  const c = await checker();
  for (const pair of [
    ['dog', 'chicken feet'],
    ['test', 'user'],
    ['asdf', 'qwerty'],
    ['John123', 'Smith'],
    ['aaaaaa', 'bbbbbb']
  ]) assert.equal(c.validate(pair[0], pair[1]).ok, false, pair.join(' '));
});

test('account intake source names the screen as plausibility screening, not ID verification', async () => {
  const src = await readFile(join(ROOT, 'js/name-integrity.js'), 'utf8');
  assert.match(src, /NOT government-ID\s*verification/i);
});


/* ONE SIGN-UP (owner, 2026-10-20: "that 3-panel profile sign up thing … should be the new sign up thing"). The
   account page's own long create form is gone: Create account hands off to the World's sign-up (an email and a
   password, then the three pages). Its rules are kept there, asked once: a plausible legal first and last name, the
   whole mailing address, and the privacy acknowledgement recorded with the account. */
test('account creation requires legal first and last name, mailing address and privacy acknowledgement', async () => {
  const html = await readFile(join(ROOT, 'account.html'), 'utf8');
  const mnet = await readFile(join(ROOT, 'mnet.html'), 'utf8');
  const js = await readFile(join(ROOT, 'js/mnet.js'), 'utf8');
  for (const id of ['acCreateFirst','acCreateLast','acCreateAddr1','acCreateCity','acCreateRegion','acCreatePostal','acCreateCountry','acCreatePrivacy','acCreatePass']) {
    assert.doesNotMatch(html, new RegExp('id="' + id + '"'), id + ' belongs to the one sign-up, not a second form');
  }
  assert.match(html, /<a class="ac__btn" id="acCreateGo" href="mnet\.html\?join=1">Create account<\/a>/, 'Create account is the one sign-up');
  assert.match(html, /el\("acCreateGo"\)\.href = "mnet\.html\?join=1" \+ \(NEXT \? "&next=" \+ encodeURIComponent\(NEXT\) : ""\)/, 'and it carries where the person started');
  /* the rules, on the pages that ask for them */
  assert.match(mnet, /<script src="js\/name-integrity\.js\?v=__STAMP__"><\/script>/);
  assert.match(js, /named = MCC_NAME_INTEGRITY\.validate\(parts\.shift\(\) \|\| "", parts\.join\(" "\)\)/, 'page 2 screens the legal name');
  assert.match(js, /var missing = \["mnLegalName", "mnAddr1", "mnCity", "mnRegion", "mnPostal", "mnCountry"\]/, 'page 2 requires the whole address');
  assert.match(js, /Fill in your legal name and the whole address\./);
  assert.match(js, /var ack = window\.MCC_PRIVACY \? \{ privacy_policy_version: MCC_PRIVACY\.version, privacy_acknowledged_at: new Date\(\)\.toISOString\(\) \} : \{\};/, 'the acknowledgement is recorded with the account');
  assert.match(mnet, /<p class="mn__hint" id="mnCreatePrivacy" hidden>Creating an account means you agree to the <a href="privacy\.html">Privacy Policy<\/a>\.<\/p>/);
  assert.match(await readFile(join(ROOT, 'js/live-content.js'), 'utf8'), /var VERSION = "2026-10-19"/, 'the version the person agreed to on the way in');
});

test('site entry gate is versioned and analytics stays off before acknowledgement', async () => {
  const live = await readFile(join(ROOT, 'js/live-content.js'), 'utf8');
  const analytics = await readFile(join(ROOT, 'js/analytics.js'), 'utf8');
  assert.match(live, /var VERSION = "2026-10-19"/);
  assert.match(live, /I agree &amp; continue/);
  assert.match(live, /page === "privacy\.html"/, 'the policy itself must remain readable');
  assert.match(analytics, /if \(mccPrivacyAcknowledged\(\)\) \{/);
  assert.match(analytics, /window\.MCC_TRACK = function \(\) \{ return false; \}/);
});

test('precise location remains a separate browser permission instead of being hidden in the gate', async () => {
  const html = await readFile(join(ROOT, 'account.html'), 'utf8');
  const live = await readFile(join(ROOT, 'js/live-content.js'), 'utf8');
  assert.match(html, /id="fnLocation"/);
  assert.match(html, /MCC_LOCATION\.request\(\)/);
  assert.match(live, /not blanket consent/i);
  assert.match(live, /Precise location[^<]*protected device permissions/i);
});

test('privacy notice names unavailable hardware identifiers and the monthly swag purpose', async () => {
  const html = await readFile(join(ROOT, 'privacy.html'), 'utf8');
  assert.match(html, /No IMEI, hardware serial number or MAC address/i);
  assert.match(html, /Monthly McCluster swag eligibility and fulfillment/i);
  assert.match(html, /no purchase or payment is required/i);
});
