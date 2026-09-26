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


test('account creation requires legal first and last name, mailing address and privacy acknowledgement', async () => {
  const html = await readFile(join(ROOT, 'account.html'), 'utf8');
  for (const id of ['acCreateFirst','acCreateLast','acCreateAddr1','acCreateCity','acCreateRegion','acCreatePostal','acCreateCountry','acCreatePrivacy']) {
    assert.match(html, new RegExp('id="' + id + '"'), id + ' must exist');
  }
  assert.match(html, /MCC_NAME_INTEGRITY\.validate\(first, last\)/);
  assert.match(html, /privacy_policy_version:\s*"2026-09-26"/);
  assert.match(html, /shipping_address_line1/);
  assert.match(html, /complete mailing address are required/i);
});

test('site entry gate is versioned and analytics stays off before acknowledgement', async () => {
  const live = await readFile(join(ROOT, 'js/live-content.js'), 'utf8');
  const analytics = await readFile(join(ROOT, 'js/analytics.js'), 'utf8');
  assert.match(live, /var VERSION = "2026-09-26"/);
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
