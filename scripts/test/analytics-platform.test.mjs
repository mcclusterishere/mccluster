import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(p,'utf8');

test('customer pixel is one line and site scoped', async()=>{
  const sdk=await read('js/mc-analytics.js');
  const worker=await read('workers/mccluster/src/entry.js');
  assert.match(worker,/path === '\/a\.js'/);
  assert.ok(worker.includes("/^mca_[a-f0-9]{32}$/i"), 'loader must validate the public site-key shape');
  assert.match(worker,/https:\/\/mccluster\.org\/js\/mc-analytics\.js/);
  assert.match(sdk,/var ROOT = "mca:" \+ siteKey \+ ":"/);
  assert.match(sdk,/mca_consent|CONSENT_KEY/);
});

test('pixel does not fingerprint or capture form values', async()=>{
  const sdk=await read('js/mc-analytics.js');
  assert.doesNotMatch(sdk,/toDataURL|getImageData|OfflineAudioContext|onicecandidate|ja3|\bja4\b/i);
  assert.doesNotMatch(sdk,/\.value\b/);
  assert.doesNotMatch(sdk,/imei|macAddress|serialNumber/i);
  assert.match(sdk,/user_ref_sha256/);
  assert.match(sdk,/siteKey \+ ":" \+ String\(externalId\)/);
});

test('persistent visitor identity requires analytics consent', async()=>{
  const sdk=await read('js/mc-analytics.js');
  const collector=await read('supabase/functions/collect/index.ts');
  assert.match(sdk,/consentMode.*required/);
  assert.match(sdk,/consentState\(\) !== "granted"/);
  assert.match(collector,/consentState === "granted"/);
  assert.match(collector,/persistentAllowed/);
});

test('collector binds public site keys to verified request origins', async()=>{
  const collector=await read('supabase/functions/collect/index.ts');
  const worker=await read('workers/mccluster/src/entry.js');
  assert.match(collector,/analytics_sites\?public_key=eq/);
  assert.match(collector,/analytics_site_domains\?site_id=eq/);
  assert.match(collector,/verified_at=not\.is\.null/);
  assert.match(collector,/hostname=eq/);
  assert.match(collector,/site_id: site\.siteId/);
  assert.match(collector,/source_host: site\.host/);
  assert.match(worker,/put\('origin'/);
  assert.match(worker,/put\('referer'/);
});

test('dashboard provisions sites, DNS verification, and copyable pixel', async()=>{
  const js=await read('js/analytics-product.js');
  const html=await read('analytics.html');
  const router=await read('workers/mccluster/src/analytics/router.js');
  assert.match(js,/analytics_sites/);
  assert.match(js,/analytics_site_domains/);
  assert.match(js,/api\.mccluster\.org\/a\.js\?site=/);
  assert.match(js,/\/v1\/analytics\/domains\//);
  assert.match(router,/cloudflare-dns\.com\/dns-query/);
  assert.match(router,/_mccluster-analytics/);
  assert.match(html,/Your sites\. Your data\. Your pixel\./);
});