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
  assert.match(js,/CREATE_VIEWS = \["projects", "library", "schedule", "channels", "instagram", "music", "action-network", "song-test"\]/);
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
    if(page==='insights.html'){
      assert.doesNotMatch(html,/url=analytics\.html|location\.replace\("analytics\.html|href="analytics\.html/,'Insights carries a competing redirect away from Control');
      assert.match(html,/url=control\.html#analytics/);
      assert.match(html,/location\.replace\("control\.html#analytics"\)/);
    }
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



test('Analytics never degrades into an empty Control surface',async()=>{
  const js=await read('js/control-room-v2.js');
  assert.match(js,/Analytics unavailable/);
  assert.match(js,/Analytics failed to start/);
  assert.match(js,/var analyticsHost = \$\("crAnalyticsMount"\)/);
  assert.match(js,/try \{[\s\S]*window\.CR\.analytics\.mount\(analyticsHost\);[\s\S]*catch \(analyticsErr\)/);
});

test('native modules are loaded before the Control shell starts',async()=>{
  const html=await read('control.html');
  const shellAt=html.indexOf('js/control-room-v2.js');
  for(const path of [
    'js/control-room/work-tools.js',
    'js/control-room/work-records.js',
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


test('review regressions stay fixed in native Control tools',async()=>{
  const [social,music,css]=await Promise.all([
    read('js/control-room/social-compose.js'),
    read('js/control-room/music-ops.js'),
    read('css/control-analytics.css')
  ]);
  assert.match(social,/var rows=\[\],succeeded=false/);
  assert.match(social,/if\(succeeded\)S\.draft=""/);
  assert.match(music,/var ai=a\.ai&&typeof a\.ai==="object"\?a\.ai:\{\}/);
  assert.doesNotMatch(music,/a\.ai_json/);
  assert.match(css,/\.cra-axis\{fill:var\(--cr-faint\);font-size:20px\}/);
  assert.match(css,/@media \(min-width:54rem\)[\s\S]*\.cra-axis\{font-size:10px\}/);
  /* Reach vs repeat is drawn at the card's pixel width (a 720-wide drawing
     shrunk to a phone lost its numbers), so its text sizes are real sizes. */
  assert.match(css,/\.cra-reach__tick\{[^}]*font-size:11px/);
  assert.doesNotMatch(css,/\.cra-scatter__/);
});


test('Home public record reads the canonical SEO authority files and exposes operator links',async()=>{
  const js=await read('js/control-room-v2.js');
  assert.match(js,/function loadPublicRecord\(\)/);
  for(const path of [
    'data/seo/entity-graph.json',
    'data/seo/evidence-ledger.json',
    'data/seo/sitemap-pages.json'
  ]){
    assert.ok(js.includes(path),path+' is not wired into the public record source');
  }
  assert.match(js,/panel\("Public record", "canonical search authority", renderPublicRecord\(\), "cr-span-12"\)/);
  assert.match(js,/verification_status === "verified" && item\.publish === true/);
  for(const href of [
    'newsroom.html',
    'engineering/recruiter-role-map.html',
    'sitemap.xml',
    'https://search.google.com/search-console',
    'https://www.bing.com/webmasters/'
  ]){
    assert.ok(js.includes(href),href+' is missing from the Public record panel');
  }
});

test('Work records are created through the Worker, not the legacy CRM', async()=>{
  const [shell,mod,worker,entry,sql]=await Promise.all([
    read('js/control-room-v2.js'),
    read('js/control-room/work-records.js'),
    read('workers/mccluster/src/work.js'),
    read('workers/mccluster/src/entry.js'),
    read('supabase/migrations/20261005044012_control_work_records_v1.sql')
  ]);
  /* + New opens the native form; nothing points at crm.html to create. */
  assert.match(shell,/action === "new-work"\) \{[\s\S]*window\.CR\.work\.openForm\(state\.workView\)/);
  assert.doesNotMatch(shell,/Open the legacy CRM creator/);
  assert.doesNotMatch(shell,/There is no canonical write route for creating a lead/);
  for (const kind of ['companies','tasks','orders','bookings']) assert.match(shell,new RegExp('window\\.CR\\.work\\.section\\((?:"'+kind+'"|view === "orders")'), kind);
  /* the module writes only through /v1/work and never through PostgREST */
  assert.match(mod,/"\/v1\/work\/"\+kind/);
  assert.match(mod,/"\/v1\/work\/leads"/);
  assert.doesNotMatch(mod,/rest\/v1|supa\(/);
  assert.match(mod,/work_not_provisioned/);
  /* the Worker wires the prefix and the tables refuse the browser */
  assert.match(entry,/path\.startsWith\('\/v1\/work\/'\)/);
  assert.match(worker,/requireMembership/);
  assert.match(worker,/recordAudit/);
  assert.match(sql,/revoke all on public\.%I from anon, authenticated/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke insert, update, delete, truncate, references, trigger[\s\S]*public\.out_companies from anon, authenticated/);
  assert.match(sql,/revoke update on table public\.leads from authenticated/);
  assert.match(sql,/grant update \(status\) on table public\.leads to authenticated/);
});


test('Control can approve or reject proposed AI decisions', async()=>{
  const [control,edge,worker]=await Promise.all([
    read('js/control-room-v2.js'),
    read('supabase/functions/context-decision/index.ts'),
    read('workers/mccluster/src/ai/router.js')
  ]);
  assert.match(control,/data-action="decision-status"/);
  assert.match(control,/data-status="approved"/);
  assert.match(control,/data-status="rejected"/);
  assert.match(control,/\/v1\/ai\/decisions\/.*\/status/);
  assert.doesNotMatch(control,/No approve or reject route exists/);
  assert.match(worker,/decisionStatusMatch/);
  assert.match(worker,/callContextFunction\(request, env, 'context-decision', payload, 'PATCH'\)/);
  assert.match(edge,/\['POST', 'GET', 'PATCH'\]/);
  assert.match(edge,/where id = \$\{decisionId\}::uuid[\s\S]*and status = 'proposed'/);
  assert.match(edge,/approved_by = \$\{userId\}::uuid/);
  assert.match(edge,/approved_at = now\(\)/);
  assert.match(edge,/decision is no longer proposed or does not belong to this organization/);
});


test('System Resources owns the aggregate media allowance', async()=>{
  const [ui,entry,router,migration]=await Promise.all([
    read('js/control-room-v2.js'),
    read('workers/mccluster/src/entry.js'),
    read('workers/mccluster/src/media/router.js'),
    read('supabase/migrations/20261005063836_control_media_monthly_budget_v1.sql')
  ]);
  assert.match(ui,/\/v1\/media\/usage\?org_id=/);
  assert.match(ui,/\/v1\/media\/budget\?org_id=/);
  assert.match(ui,/data-action="save-media-budget"/);
  assert.match(ui,/Enforce monthly cap/);
  assert.match(entry,/path === '\/v1\/media\/budget'/);
  assert.match(router,/Organization owner access is required to manage the media allowance/);
  assert.match(router,/media_budget\.updated/);
  assert.match(migration,/create table if not exists public\.org_media_budgets/);
  assert.match(migration,/Organization monthly media allowance exceeded/);
});


test('Create Schedule exposes real publish retry and safe cancellation', async()=>{
  const [control,social]=await Promise.all([
    read('js/control-room-v2.js'),
    read('workers/mccluster/src/social/router.js')
  ]);
  assert.match(control,/data-action="retry-publish"/);
  assert.match(control,/data-action="cancel-publish"/);
  assert.match(control,/"\/v1\/social\/publish\/" \+ encodeURIComponent\(publishJobId\) \+ "\/" \+ publishAction/);
  assert.match(control,/publishAction = action === "retry-publish" \? "retry" : "cancel"/);
  assert.match(control,/canCancel = \["draft", "queued"\]/);
  assert.match(control,/canRetry = p\.state === "failed"/);
  assert.match(social,/retryPublishJob/);
  assert.match(social,/state=eq\.failed/);
  assert.match(social,/external_media_id=is\.null/);
  assert.match(social,/creation container \(error\|expired\)/);
  assert.match(social,/event: 'social_publish\.retried'/);
  assert.match(social,/event: to === 'queued' \? 'social_publish\.approved' : 'social_publish\.cancelled'/);
});


test('System Observability reads retained org-scoped request traces', async()=>{
  const [control,entry,obs,migration,http]=await Promise.all([
    read('js/control-room-v2.js'),
    read('workers/mccluster/src/entry.js'),
    read('workers/mccluster/src/lib/observability.js'),
    read('supabase/migrations/20261005071308_control_observability_events_v1.sql'),
    read('workers/mccluster/src/lib/http.js')
  ]);
  assert.match(control,/\/v1\/observability\/events\?org_id=/);
  assert.match(control,/x-mccluster-org-id/);
  assert.match(control,/x-mccluster-trace-id/);
  assert.match(control,/data-action="load-observability"/);
  assert.match(control,/inspect-observation/);
  assert.doesNotMatch(control,/McCluster has no log or trace pipeline/);
  assert.match(entry,/observeControlRequest/);
  assert.match(entry,/path === '\/v1\/observability\/events'/);
  assert.match(entry,/membership\.role !== 'owner'/);
  assert.match(obs,/verifiedActor/);
  assert.match(obs,/membership_unverified/);
  assert.doesNotMatch(obs,/request\.text\(|request\.json\(/);
  assert.match(migration,/force row level security/);
  assert.match(migration,/revoke all on table public\.control_observability_events from authenticated/);
  assert.match(http,/x-mccluster-org-id/);
  assert.match(http,/access-control-expose-headers.*x-mccluster-trace-id/);
});
