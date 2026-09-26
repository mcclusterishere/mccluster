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

test('owner identity analytics is capability-gated and customer analytics never receives raw identity telemetry', async()=>{
  const [router,product,html]=await Promise.all([
    read('workers/mccluster/src/analytics/router.js'),
    read('js/analytics-product.js'),
    read('analytics.html')
  ]);
  assert.match(router,/\/v1\/analytics\/identity/);
  assert.match(router,/\/v1\/analytics\/forensics/);
  assert.match(router,/handleIdentityAnalytics/);
  assert.match(router,/handleForensics/);
  assert.match(router,/await requireHouseOps\(env, user\)/);
  assert.match(router,/minutes_after_last_track/);
  assert.match(router,/assisted_tracks/);
  assert.match(router,/\bip:\s*loc\?\.ip/);
  assert.match(product,/state\.selected\.id===FIRST_PARTY/);
  assert.match(product,/\/v1\/analytics\/identity/);
  assert.match(product,/\/v1\/analytics\/forensics/);
  assert.match(html,/id="anIdentityTab"[^>]*hidden/);
  assert.match(html,/source→song→account|Source → Track → Account|source → track → account/i);
});

test('relationship analytics uses flows instead of forcing every relationship into a bar chart', async()=>{
  const [insights,product,html]=await Promise.all([
    read('js/insights.js'),
    read('js/analytics-product.js'),
    read('analytics.html')
  ]);
  assert.match(insights,/function pathFlow\(/);
  assert.match(insights,/Page to next-page relationship flow/);
  assert.doesNotMatch(insights,/label:"Most common next-page paths"/);
  assert.match(product,/function relationGraph\(/);
  assert.match(product,/source to song to account relationship graph/i);
  assert.match(html,/\.rel-graph/);
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


test('business query parser refuses ambiguous time scope instead of returning all-time totals', ()=>{
  const snapshot={
    window:null,
    users:{total:26,created_in_window:null,confirmed_total:25,unconfirmed_total:1,confirmed_in_window:null,unconfirmed_in_window:null,percent_created_in_window:null,created_by_day:[]},
    mnet:{profiles:{total:27,created_in_window:null},posts:{total:0,created_in_window:null},follows:{total:0,created_in_window:null},reactions:{total:0,created_in_window:null}}
  };
  const answer=answerBusinessQuestion('How many new users this week?',snapshot);
  assert.equal(answer.understood,false);
  assert.match(answer.answer,/time-scoped question/);
});


test('business analytics covers platform traffic and music commerce without raw customer rows', async()=>{
  const router=await read('workers/mccluster/src/analytics/router.js');
  assert.match(router,/page_views:/);
  assert.match(router,/music:/);
  assert.match(router,/creator_tracks:/);
  assert.match(router,/platform_fee_cents/);
  assert.match(router,/status=eq\.paid|status: 'eq\.paid'/);
  assert.doesNotMatch(router,/customer_email.*return json/i, 'aggregate analytics must not emit customer email rows');
});

test('business query parser answers music, creator and platform questions', ()=>{
  const win=parseBusinessWindow('last 7 days',new Date('2026-09-20T04:00:00.000Z'));
  const snapshot={
    window:win,
    users:{total:26,created_in_window:20,confirmed_total:25,unconfirmed_total:1,confirmed_in_window:19,unconfirmed_in_window:1,active_in_window:18,percent_created_in_window:76.9,created_by_day:[]},
    platform:{events:{total:20000,in_window:4200},page_views:{total:1500,in_window:300},clicks:{total:3800,in_window:900},acquisitions:{total:2000,in_window:410}},
    mnet:{profiles:{total:27,created_in_window:20},posts:{total:3,created_in_window:2},follows:{total:4,created_in_window:4},reactions:{total:9,created_in_window:7}},
    music:{
      legacy_album_plays:{total:3097,in_window:200},
      inline_plays:{total:40,in_window:40},
      plays:{total:3137,in_window:240},
      preview_plays:{total:15,in_window:15},
      full_plays:{total:25,in_window:25},
      completions:{total:9,in_window:9},
      creators:{total:4,created_in_window:2},
      creator_tracks:{total:11,created_in_window:5},
      published_tracks:7,
      active_license_offers:3,
      paid_orders:{total:6,in_window:2},
      entitlements:{total:5,created_in_window:2},
      revenue:{gross_cents:12000,platform_fee_cents:1800,creator_net_cents:10200,gross_cents_in_window:4000,platform_fee_cents_in_window:600,creator_net_cents_in_window:3400}
    }
  };

  const music=answerBusinessQuestion('How many music plays were there in the last 7 days?',snapshot);
  assert.equal(music.metric,'music.plays.in_window');
  assert.equal(music.value,240);

  const creators=answerBusinessQuestion('How many creators joined in the last 7 days?',snapshot);
  assert.equal(creators.metric,'music.creators.created_in_window');
  assert.equal(creators.value,2);

  const revenue=answerBusinessQuestion('How much music revenue in the last 7 days?',snapshot);
  assert.equal(revenue.metric,'music.revenue.gross_cents_in_window');
  assert.equal(revenue.value,4000);
  assert.match(revenue.answer,/\$40\.00/);

  const views=answerBusinessQuestion('How many page views in the last 7 days?',snapshot);
  assert.equal(views.metric,'platform.page_views.in_window');
  assert.equal(views.value,300);
});


test('analytics dashboard supports all-time and custom date windows without a raw-row history cap', async()=>{
  const [board, product, html]=await Promise.all([
    read('js/analytics-board.js'),
    read('js/analytics-product.js'),
    read('analytics.html')
  ]);
  assert.match(board,/id: "all", label: "All time", mode: "all"/);
  assert.match(board,/id: "custom", label: "Custom", mode: "custom"/);
  assert.match(board,/data-custom-from/);
  assert.match(board,/data-custom-to/);
  assert.match(html,/bd-custom/);
  assert.match(product,/rpc\("analytics_daily"/);
  assert.match(product,/rpc\("analytics_totals"/);
  assert.match(product,/rpc\("analytics_top"/);
  assert.doesNotMatch(product,/limit=20000/,
    'historical reporting must not silently stop at the newest 20k raw events');
  assert.match(product,/order=at\.desc&limit=50/,
    'only the Recent Events diagnostic is allowed to use a small raw-row read');
});

test('analytics range totals use server-side distinct counts rather than summed daily visitors', async()=>{
  const board=await read('js/analytics-board.js');
  assert.match(board,/var totals = t\.totals \|\| \{\}/);
  assert.match(board,/totals\.visitors/);
  assert.match(board,/previous_totals/);
  assert.match(board,/Summing daily distincts\s+overcounts/);
});

test('content analytics is windowed and exposes deep track and media detail', async()=>{
  const [insights,html,migration]=await Promise.all([
    read('js/insights.js'),
    read('analytics.html'),
    read('supabase/migrations/20260925135938_analytics_windowed_content_detail.sql')
  ]);
  assert.match(insights,/rpc\("analytics_content",args\)/);
  assert.match(insights,/rpc\("analytics_content_events",args\)/);
  assert.match(insights,/\["acquisition", null, \["analytics_acquisition",args\]/);
  assert.match(insights,/\["paths", null, \["analytics_paths"/);
  assert.match(insights,/\["funnel", null, \["analytics_funnel"/);
  for(const field of ['track starts','repeat listener-track pairs','full plays','completions','shares','Media event mix','Track performance']){
    assert.ok(insights.includes(field), field+' must be visible in Content reporting');
  }
  assert.match(html,/full versus preview plays/);
  assert.match(migration,/create or replace function public\.analytics_content\(/i);
  assert.match(migration,/create or replace function public\.analytics_content_events\(/i);
  assert.match(migration,/music_full_play/);
  assert.match(migration,/music_preview_play/);
  assert.match(migration,/music_complete/);
  assert.match(migration,/track_share/);
  assert.match(migration,/security invoker/i);
  assert.match(migration,/revoke all on function public\.analytics_content.*from public, anon/i);
});

test('one selected analytics range drives audience and content panels', async()=>{
  const insights=await read('js/insights.js');
  assert.match(insights,/d\.addEventListener\("mcc:range"/);
  assert.match(insights,/RANGE=next/);
  assert.match(insights,/p_since:RANGE\.since/);
  assert.match(insights,/p_until:RANGE\.until/);
  assert.match(insights,/day=gte/);
  assert.match(insights,/day=lte/);
});


test('every reporting section has a real SVG chart surface', async()=>{
  const [html,board,insights]=await Promise.all([
    read('analytics.html'),
    read('js/analytics-board.js'),
    read('js/insights.js')
  ]);

  const boardAt=html.indexOf('js/analytics-board.js');
  const insightsAt=html.indexOf('js/insights.js');
  assert.ok(boardAt >= 0 && insightsAt >= 0 && boardAt < insightsAt,
    'shared chart renderer must load before insights binds to it');

  assert.match(board,/function barChart\(/);
  assert.match(board,/barChart: barChart/);

  assert.match(insights,/B\.lineChart\(rows\.slice\(\)\.reverse\(\)/,
    'Audience engagement must render a line chart');
  for(const label of [
    'People reaching each funnel stage',
    'Daily, weekly and monthly active people',
    'People by acquisition source',
    'Top tracks by starts',
    'Media events in the selected range'
  ]){
    assert.ok(insights.includes(label), label+' must render through the shared SVG chart helper');
  }

  assert.match(html,/data-sec="traffic"/);
  assert.match(html,/data-sec="audience"/);
  assert.match(html,/data-sec="content"/);
});
