import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBusinessWindow, answerBusinessQuestion } from '../../workers/mccluster/src/analytics/router.js';

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

test('operator business analytics is capability-gated and never exposes raw auth rows', async()=>{
  const router=await read('workers/mccluster/src/analytics/router.js');
  assert.match(router,/\/v1\/analytics\/business/);
  assert.match(router,/\/v1\/analytics\/ask/);
  assert.match(router,/requireCapability\(env, membership, 'ops\.use'\)/);
  assert.match(router,/auth\/v1\/admin\/users/);
  assert.doesNotMatch(router,/select=.*email/i, 'business analytics must return aggregate counts, not user email rows');
});

test('business query parser understands rolling user-growth questions', ()=>{
  const now=new Date('2026-09-20T04:00:00.000Z');
  const win=parseBusinessWindow('How many users joined in the last 5 days?', now);
  assert.equal(win.amount,5);
  assert.equal(win.unit,'day');
  assert.equal(win.since,'2026-09-15T04:00:00.000Z');

  const snapshot={
    generated_at:now.toISOString(),
    window:win,
    users:{
      total:26,
      created_in_window:20,
      confirmed_total:25,
      unconfirmed_total:1,
      confirmed_in_window:19,
      unconfirmed_in_window:1,
      percent_created_in_window:76.9,
      created_by_day:[{day:'2026-09-18',count:1},{day:'2026-09-19',count:19}]
    },
    mnet:{
      profiles:{total:27,created_in_window:20},
      posts:{total:3,created_in_window:2},
      follows:{total:4,created_in_window:4},
      reactions:{total:9,created_in_window:7}
    }
  };
  const answer=answerBusinessQuestion('How many of these users are from the last 5 days?',snapshot);
  assert.equal(answer.understood,true);
  assert.equal(answer.metric,'users.created_in_window');
  assert.equal(answer.value,20);
  assert.match(answer.answer,/76\.9% of 26 total users/);
});

test('business query parser returns daily signup breakdown without guessing', ()=>{
  const win=parseBusinessWindow('last 2 weeks',new Date('2026-09-20T04:00:00.000Z'));
  const snapshot={
    window:win,
    users:{total:30,created_in_window:3,confirmed_total:30,unconfirmed_total:0,confirmed_in_window:3,unconfirmed_in_window:0,percent_created_in_window:10,created_by_day:[{day:'2026-09-18',count:1},{day:'2026-09-19',count:2}]},
    mnet:{profiles:{total:30,created_in_window:3},posts:{total:0,created_in_window:0},follows:{total:0,created_in_window:0},reactions:{total:0,created_in_window:0}}
  };
  const answer=answerBusinessQuestion('Show new users by day for the last 2 weeks',snapshot);
  assert.equal(answer.metric,'users.created_by_day');
  assert.deepEqual(answer.value,snapshot.users.created_by_day);
});
