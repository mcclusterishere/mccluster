/* Canonical operator navigation contract:
   one admin shell, native Control views, compatibility redirects only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..','..');
const read=(p)=>readFile(join(ROOT,p),'utf8');
const fileOf=(href)=>String(href).split(/[?#]/)[0];

async function registry(){
  const src=await read('js/control-registry.js');
  const scope={window:{}};
  new Function('window',src)(scope.window);
  return scope.window.MCC_SURFACES;
}

test('the operator registry has one physical admin destination',async()=>{
  const R=await registry();
  assert.ok(R.all.length>=15,'Control must expose enough destinations to replace the old room directory');
  for(const s of R.all){
    assert.equal(fileOf(s.href),'control.html',s.label+' escaped the canonical Control shell');
    assert.equal(s.state,'live');
  }
});

test('Control owns native Work Create Analytics and System navigation',async()=>{
  const [html,js]=await Promise.all([read('control.html'),read('js/control-room-v2.js')]);
  for(const key of ['home','ai','work','create','analytics','system','apps']){
    assert.ok(html.includes('data-surface="'+key+'"'),key+' is missing from the desktop Control rail');
  }
  assert.match(js,/SURFACES = \["home", "ai", "work", "create", "analytics", "system", "apps"\]/);
  assert.match(js,/WORK_VIEWS = \["inbox", "pipeline", "people", "companies", "clients", "tasks", "orders", "bookings", "outreach", "operations"\]/);
  assert.match(js,/CREATE_VIEWS = \["projects", "library", "schedule", "channels", "music"\]/);
});

test('the old admin room iframe strategy is dead',async()=>{
  const [html,js]=await Promise.all([read('control.html'),read('js/control-room-v2.js')]);
  assert.doesNotMatch(js,/<iframe|renderEmbeddedTool|embeddedWork|embeddedCreate|control_embed=1/);
  assert.doesNotMatch(html,/control_embed=1/);
  assert.match(js,/window\.CR\.workTools\.render/);
  assert.match(js,/window\.CR\.musicOps\.render/);
  assert.match(js,/window\.CR\.analytics\.mount/);
  assert.match(js,/window\.CR\.socialCompose\.render/);
});

test('former owner rooms are compatibility URLs that return to Control',async()=>{
  const expected={
    'inbox.html':'#work:inbox',
    'crm.html':'#work:pipeline',
    'desk.html':'#work:outreach',
    'admin.html':'#work:operations',
    'management.html':'#create:channels',
    'music-admin.html':'#create:music',
    'vault.html':'#create:music',
    'lanes.html':'#create:music',
    'studio.html':'#create:projects',
    'insights.html':'#analytics'
  };
  for(const [page,target] of Object.entries(expected)){
    const html=await read(page);
    assert.match(html,/js\/control-compat\.js/,page+' no longer returns to Control');
    assert.ok(html.includes('data-control-target="'+target+'"'),page+' routes to the wrong Control view');
  }
  const compat=await read('js/control-compat.js');
  assert.match(compat,/location\.replace\("control\.html"\+target\)/);
  assert.doesNotMatch(compat,/control_embed|iframe|control-embed/);
});

test('customer dashboards remain usable but operators are routed into Control',async()=>{
  const analytics=await read('analytics.html');
  const consoleHtml=await read('console.html');
  for(const html of [analytics,consoleHtml]){
    assert.doesNotMatch(html,/js\/control-compat\.js/,'customer dashboard must not be unconditionally retired');
    assert.match(html,/js\/owner-control-redirect\.js/,'operators should not get a second admin desk');
  }
  assert.ok(analytics.includes('data-control-target="#analytics"'));
  assert.ok(consoleHtml.includes('data-control-target="#work:clients"'));
  const redirect=await read('js/owner-control-redirect.js');
  assert.match(redirect,/api\.mccluster\.org\/v1\/status/);
});

test('the old six-room office strip is deleted at the source',async()=>{
  const office=await read('js/office.js');
  assert.match(office,/MCCOffice = \{ isDesk: isDesk, open: open \}/);
  assert.doesNotMatch(office,/var ROOMS|Back Office.*Front Desk|insertBefore\(bar/);
});

test('mobile Control navigation stays five primary destinations',async()=>{
  const html=await read('control.html');
  const m=html.match(/<nav class="cr-bottom"[\s\S]*?<\/nav>/);
  assert.ok(m,'mobile Control navigation is missing');
  assert.equal((m[0].match(/data-surface=/g)||[]).length,5,'phone navigation must not become a room directory');
  for(const key of ['home','work','create','analytics','system']){
    assert.ok(m[0].includes('data-surface="'+key+'"'),key+' is missing from mobile Control');
  }
});

test('house-owner account entry opens Control, not the retired Studio door',async()=>{
  const html=await read('account.html');
  assert.match(html,/location\.replace\("control\.html#home"\)/);
  assert.doesNotMatch(html,/location\.replace\("studio\.html"\)/);
});

test('operator search resolves concepts to logical Control views',async()=>{
  const R=await registry();
  const cases=[
    ['leads','#work:pipeline'],
    ['unsubscribe','#work:outreach'],
    ['orders','#work:operations'],
    ['instagram','#create:channels'],
    ['isrc','#create:music'],
    ['distribution','#create:music'],
    ['forensics','#analytics'],
    ['traffic','#analytics']
  ];
  for(const [q,hash] of cases){
    const top=R.search(q)[0];
    assert.ok(top,'"'+q+'" found nothing');
    assert.ok(top.href.endsWith(hash),'"'+q+'" landed on '+top.href+' instead of '+hash);
  }
});

test('native modules are loaded before the Control shell starts',async()=>{
  const html=await read('control.html');
  const shellAt=html.indexOf('js/control-room-v2.js');
  for(const path of [
    'js/control-room/work-tools.js',
    'js/control-room/social-compose.js',
    'js/control-room/music-ops.js',
    'js/control-room/analytics.js'
  ]){
    const at=html.indexOf(path);
    assert.ok(at>=0&&at<shellAt,path+' must load before control-room-v2.js');
  }
  assert.match(html,/css\/control-admin\.css/);
  assert.match(html,/css\/control-analytics\.css/);
});
