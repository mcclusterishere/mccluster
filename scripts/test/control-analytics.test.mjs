import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(p,'utf8');

test('Control Analytics uses the canonical analytics data plane',async()=>{
  const js=await read('js/control-room/analytics.js');
  for(const rpc of [
    'analytics_daily','analytics_totals','analytics_top','analytics_engagement_site',
    'analytics_funnel_site','analytics_acquisition','analytics_paths','analytics_content','analytics_content_events'
  ]){
    assert.ok(js.includes('rpc("'+rpc+'"'),rpc+' is not wired into Control Analytics');
  }
  assert.match(js,/\/v1\/analytics\/business\?since=/);
  assert.match(js,/\/v1\/analytics\/identity\?since=/);
  assert.match(js,/\/v1\/analytics\/forensics\?since=/);
  assert.doesNotMatch(js,/analytics\.html|iframe/);
});

test('one range controls all analytics panels and stale requests cannot repaint',async()=>{
  const js=await read('js/control-room/analytics.js');
  for(const id of ['24h','7d','30d','90d','all','custom']) assert.ok(js.includes('"'+id+'"'),id+' range is absent');
  assert.match(js,/S\.rangeId=b\.getAttribute\("data-cra-range"\)/);
  assert.match(js,/var q=\+\+S\.seq/);
  assert.match(js,/if\(q!==S\.seq\)return/);
  assert.match(js,/p_since:r\.since,p_until:r\.until/);
  assert.match(js,/S\.loading=true;S\.error=null;S\.errors=\{\};paint\(\)/,
    'range selection must repaint immediately before the network read completes');
});

test('Analytics uses distinct visual forms for distinct questions',async()=>{
  const js=await read('js/control-room/analytics.js');
  for(const fn of ['line','donut','rank','funnel','scatter','flow']){
    assert.match(js,new RegExp('function '+fn+'\\('),fn+' visual is missing');
  }
  assert.match(js,/Traffic trend/);
  assert.match(js,/Geography/);
  assert.match(js,/Conversion funnel/);
  assert.match(js,/Reach vs repeat/);
  assert.match(js,/Source → track → account/);
});

test('Control Analytics is mobile-first',async()=>{
  const css=await read('css/control-analytics.css');
  assert.match(css,/@media \(min-width:36rem\)/);
  assert.match(css,/@media \(min-width:54rem\)/);
  assert.doesNotMatch(css,/@media\s*\(max-width:/);
  assert.match(css,/font-size:max\(16px,1rem\)/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/overflow-x:auto/);
});

test('owner identity and forensics endpoints are owner-only and exact-window aware',async()=>{
  const router=await read('workers/mccluster/src/analytics/router.js');
  assert.match(router,/path === '\/v1\/analytics\/identity'/);
  assert.match(router,/path === '\/v1\/analytics\/forensics'/);
  assert.match(router,/async function handleIdentityAnalytics/);
  assert.match(router,/async function handleForensics/);
  const idStart=router.indexOf('async function handleIdentityAnalytics');
  const fStart=router.indexOf('async function handleForensics');
  const cleanStart=router.indexOf('function cleanTxt',fStart);
  assert.match(router.slice(idStart,fStart),/await requireHouseOwner\(env, user\)/);
  assert.match(router.slice(fStart,cleanStart),/await requireHouseOwner\(env, user\)/);
  assert.match(router,/membership\?\.role !== 'owner'/);
  assert.match(router,/url\.searchParams\.get\('since'\)/);
  assert.match(router,/url\.searchParams\.get\('until'\)/);
  assert.match(router,/minutes_after_last_track/);
  assert.match(router,/assisted_tracks/);
});

test('business snapshot supports explicit selected-window bounds',async()=>{
  const router=await read('workers/mccluster/src/analytics/router.js');
  assert.match(router,/rawSince = url\.searchParams\.get\('since'\)/);
  assert.match(router,/rawUntil = url\.searchParams\.get\('until'\)/);
  assert.match(router,/at >= sinceMs && at < untilMs/);
  assert.match(router,/if \(untilIso\) q\.append\(timeColumn/);
});


test('identity bridge reconstruction keeps recent rows and bounds the attribution interval',async()=>{
  const router=await read('workers/mccluster/src/analytics/router.js');
  assert.match(router,/const bridgeSince = new Date\(since\.getTime\(\) - 7 \* 86400000\)/);
  assert.match(router,/const bridgeUntil = new Date\(until\.getTime\(\) \+ 7 \* 86400000\)/);
  assert.match(router,/device_id=not\.is\.null.*at=gte\./s);
  assert.match(router,/order=at\.desc/);
});

test('Audience analytics stays scoped to the selected property',async()=>{
  const js=await read('js/control-room/analytics.js');
  assert.match(js,/rpc\("analytics_engagement_site",\{p_since:r\.since,p_until:r\.until,p_site:site,p_tz:tz\(\)\}\)/);
  assert.match(js,/rpc\("analytics_funnel_site",\{p_since:r\.since,p_until:r\.until,p_site:site,p_tz:tz\(\)\}\)/);
  assert.doesNotMatch(js,/v_engagement_daily/);
  const sql=await read('supabase/migrations/20260926235000_control_analytics_site_scoped_audience.sql');
  assert.match(sql,/e\.site_id is not distinct from p_site/);
  assert.match(sql,/where p_site is null/);
});
