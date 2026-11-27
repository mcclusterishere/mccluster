/* Port-free acceptance rehearsal. Loads the shipping Worker and Core runner, and
   runs the pending schema in disposable PostgreSQL (WASM). Only GoTrue, the
   PostgREST transport, and unrelated account chrome are substituted. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installOntologyFixture, assertOriginalOntologyTrigger, assertResearchGuards } from './equiquant-db-guards.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFile(join(root, path), 'utf8');
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH) : '@electric-sql/pglite');
const require = createRequire(process.env.PLAYWRIGHT_DIR
  ? join(process.env.PLAYWRIGHT_DIR, 'qa.cjs') : import.meta.url);
const { chromium } = require('playwright');
registerHooks({
  resolve(specifier, context, next) {
    const fixtures = {
      'cloudflare:workers': 'export class DurableObject {}',
      '../.wrangler/build-provenance.mjs': 'export const build = {dirty:true};'
    };
    return Object.hasOwn(fixtures, specifier)
      ? { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(fixtures[specifier]) }
      : next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.html')) return {
      shortCircuit: true, format: 'module',
      source: 'export default ' + JSON.stringify(readFileSync(new URL(url), 'utf8'))
    };
    return next(url, context);
  }
});
const { default: worker } = await import('../../workers/mccluster/src/entry-platform.js');
const db = new PGlite();
const env = { SUPABASE_URL: 'https://isolated.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  EQUIQUANT_ENABLED: 'true' };
Object.assign(process.env, env, { SUPABASE_SECRET_KEY: '', MCCLUSTER_SMS_NOTIFY: 'false', MCCLUSTER_CORE_ID: 'isolated-equiquant' });
// This is the isolated runner process on the selected computer. A remote target
// is eligible only after its own runtime supplies a fresh capability.
process.env.MCCLUSTER_EQUIQUANT_TARGET = 'prime';
const target = 'prime';
const org = randomUUID();
const sessions = new Map();
const apiOrigin = 'https://api.mccluster.org', siteOrigin = 'https://mccluster.org';
const doi = '10.1594/PANGAEA.958449', commit = '523112ddbcd2b9dfcc16891437f83a5781d045fb';
const observations = '6539910bd6218f85f8a2bd436ca73f544e722f2d207e8c6c3098d371c37f4c63';
const pins = {
  pooled: ['1ff244cbd378d568008aacb022beeddb4ddd3f56b1f1f8efdfdd7ddc56bfeddf', 0.3340546369],
  group_levels: ['2c92416ed00303e53775306edfb97e3fd3ff725ff580e8cdc34015401b27b782', 0.2529111721],
  group_slopes: ['b0fe5ad9536b8681eae1eb1f1aadcb4df8d4e020abd6d0bd99bfbe631d9f9fa6', 0.2556166798]
};
function identity(name) {
  const id = randomUUID(), email = name + '@research.invalid';
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = 'test.' + Buffer.from(JSON.stringify({sub:id, email, exp})).toString('base64url') + '.fixture';
  const session = { access_token:jwt, expires_at:exp, refresh_token:'fixture', user:{id,email} };
  sessions.set(jwt, session);
  return session;
}
const owner = identity('owner'), member = identity('member'), outsider = identity('outsider'), unverified = identity('unconfirmed');

async function seed() {
  const ontology = await read('supabase/migrations/20260919053445_operational_ontology_v1.sql');
  const queue = ontology.match(/create table if not exists public\.ops_agent_jobs \([\s\S]*?\n\);/i)[0];
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    create table orgs(id uuid primary key, slug text unique, name text, kind text, enabled boolean);
    create table org_members(org_id uuid, profile_id uuid, role text, added_at timestamptz default now(), primary key(org_id,profile_id));
    create table ops_objectives(id uuid primary key);
    ${queue}
    grant usage on schema auth to service_role;
    grant select on auth.users,orgs,org_members to service_role;
    grant all on ops_agent_jobs to service_role;`);
  await db.query("insert into orgs values ($1,'mccluster','Research workspace','studio',true)",[org]);
  for (const [s, role] of [[owner,'owner'],[member,'viewer'],[outsider,'viewer'],[unverified,'viewer']]) {
    await db.query('insert into auth.users values ($1, $2)',[s.user.id,s === unverified ? null : new Date()]);
    await db.query('insert into org_members(org_id,profile_id,role) values ($1,$2,$3)',[org,s.user.id,role]);
  }
  await installOntologyFixture(db);
  const up = await read('supabase/pending/equiquant_v1.sql');
  await db.exec(up);
  await db.exec(await read('supabase/pending/equiquant_v1.rollback.sql'));
  await assertOriginalOntologyTrigger(db);
  await db.exec(up);
  for (const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    await assert.rejects(db.query("select equiquant_action($1,$2,'list',null,'{}')",[owner.user.id,org]), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
}
const ident = key => { assert.match(key,/^[a-z_]+$/); return '"' + key + '"'; };
const one = async (sql, params=[]) => (await db.query(sql,params)).rows[0];
const bearer = hdr => (new Headers(hdr)).get('authorization')?.replace(/^Bearer /i,'');
const telemetry = [];
let distortNextState;
let observedCapability;
async function isolatedFetch(target, init={}) {
  const url = new URL(target), path = url.pathname.replace('/rest/v1/', '');
  assert.equal(url.origin, env.SUPABASE_URL, 'Unexpected network destination');
  const body = init.body ? JSON.parse(init.body) : {};
  assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_SERVICE_ROLE_KEY);
  if (path === '/auth/v1/user') {
    const user = sessions.get(bearer(init.headers))?.user;
    return Response.json(user || {}, {status:user ? 200 : 401});
  }
  assert.equal(bearer(init.headers),env.SUPABASE_SERVICE_ROLE_KEY);
  if (path === 'control_observability_events' && init.method === 'POST') {
    telemetry.push(body);
    return Response.json([]);
  }
  if (path === 'org_members') {
    const id = url.searchParams.get('profile_id')?.slice(3);
    const result = await db.query('select m.role,m.added_at,to_jsonb(o) as orgs from org_members m join orgs o on o.id=m.org_id where m.profile_id=$1',[id]);
    return Response.json(result.rows);
  }
  if (path === 'orgs') {
    assert.equal(url.searchParams.get('slug'),'eq.mccluster');
    return Response.json((await db.query("select id,enabled from orgs where slug='mccluster'")).rows);
  }
  if (path === 'rpc/equiquant_attest_target') {
    const row = await one('select public.equiquant_attest_target($1) as result',[JSON.stringify(body.p_attestation)]);
    observedCapability = body.p_attestation;
    return Response.json(row.result);
  }
  if (path === 'rpc/equiquant_action') {
    try {
      const row = await one('select equiquant_action($1,$2,$3,$4,$5) as result',[
        body.p_actor,body.p_org,body.p_action,body.p_project,JSON.stringify(body.p_data)
      ]);
      if (distortNextState && body.p_action==='state') {
        const distort = distortNextState;
        distortNextState = undefined;
        distort(row.result);
      }
      return Response.json(row.result);
    } catch (err) {
      if (!err.code) throw err;
      const status = /^PT\d{3}$/.test(err.code) ? Number(err.code.slice(2)) :
        ({'42501':403,'23505':409}[err.code] || 400);
      return Response.json({code:err.code,message:err.message},{status});
    }
  }
  assert.equal(path,'ops_agent_jobs','Unexpected isolated database route');
  if (url.searchParams.get('status') === 'eq.queued') {
    assert.equal(url.searchParams.get('job_type'),'eq.equiquant_mosaic_replay');
    assert.equal(url.searchParams.get('input->>target'),'eq.prime');
    assert.equal(url.searchParams.get('input->>hardware_sha256'),'eq.'+observedCapability.hardware_sha256);
    assert.equal(url.searchParams.get('input->>node_version'),'eq.'+process.versions.node);
  }
  const args = [], filters = [];
  const bind = val => '$' + args.push(val);
  for (const [field, expression] of url.searchParams) {
    if (['select','order','limit'].includes(field)) continue;
    const dot = expression.indexOf('.'), op = {eq:'=',lt:'<',lte:'<='}[expression.slice(0,dot)];
    assert.ok(op);
    const queueInputField = /^input->>(target|hardware_sha256|node_version)$/.exec(field);
    const column = queueInputField ? "input->>'"+queueInputField[1]+"'" : ident(field);
    filters.push(column + op + bind(expression.slice(dot+1)));
  }
  const where = filters.length ? ' where '+filters.join(' and ') : '';
  let sql;
  if (init.method === 'PATCH') {
    const changes = Object.entries(body).map(([k,v]) => ident(k)+'='+bind(k==='output'||k==='input'?JSON.stringify(v):v));
    sql = 'update ops_agent_jobs set '+changes.join(',')+where+' returning *';
  } else {
    const columns = url.searchParams.get('select') || '*';
    sql = 'select '+(columns==='*'?'*':columns.split(',').map(ident).join(','))+' from ops_agent_jobs'+where;
    const order = url.searchParams.get('order');
    if (order) sql += ' order by '+order.split(',').map(term => {
      const [col,dir] = term.split('.'); assert.ok(['asc','desc'].includes(dir)); return ident(col)+' '+dir;
    }).join(',');
    if (url.searchParams.has('limit')) sql += ' limit '+bind(Number(url.searchParams.get('limit')));
  }
  return Response.json((await db.query(sql,args)).rows);
}
async function dispatch(request) {
  const work = [];
  const response = await worker.fetch(request,env,{waitUntil:promise=>work.push(promise)});
  await Promise.all(work);
  return response;
}
function api(session,action,project_id,data={}) {
  return dispatch(new Request(apiOrigin+'/v1/equiquant',{method:'POST',headers:{
    origin:siteOrigin,'content-type':'application/json',
    ...(session ? {authorization:'Bearer '+session.access_token} : {})
  },body:JSON.stringify({org_id:org,action,...(project_id ? {project_id} : {}),data})}));
}

const mime = {'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json',
  '.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'};
const errors = [];
async function openProduct(browser, session) {
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  await context.addInitScript(s=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(s) localStorage.setItem('mccdb_session', JSON.stringify(s));
  },session);
  await context.route('**/*',async route=>{
    const r = route.request(), url = new URL(r.url());
    try {
      if (url.origin===apiOrigin && ['/v1/equiquant','/v1/workspaces/me'].includes(url.pathname)) {
        const response = await dispatch(new Request(url,{method:r.method(),headers:r.headers(),body:r.postData() || undefined}));
        return await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers.entries()),body:Buffer.from(await response.arrayBuffer())});
      }
      if (url.origin===siteOrigin || url.hostname==='matthew.mccluster.org') {
        const file = resolve(root,'.'+decodeURIComponent(url.pathname));
        assert.ok(file.startsWith(resolve(root)+sep));
        try { return await route.fulfill({contentType:mime[extname(file)] || 'application/octet-stream',body:await readFile(file)}); }
        catch (err) { if (err.code!=='ENOENT') throw err; return await route.fulfill({status:404,body:''}); }
      }
      if (url.hostname.endsWith('.supabase.co') || url.origin===apiOrigin) {
        let body = [];
        if (url.pathname==='/auth/v1/user' && session) body = session.user;
        if (url.pathname==='/v1/status' && session===owner) {
          body = {ok:true,operator:{email:owner.user.email},database:{reachable:true}};
        }
        const status = url.pathname==='/v1/status' && session!==owner ? 403 : 200;
        return await route.fulfill({status,contentType:'application/json',headers:{
          'access-control-allow-origin':siteOrigin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'
        },body:JSON.stringify(body)});
      }
      return await route.abort();
    } catch (e) {
      errors.push(e.message); await route.abort();
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  if (session===owner) {
    await page.goto(siteOrigin+'/control.html#home:today',{waitUntil:'domcontentloaded'});
    await page.locator('#mccControlToggle').click();
    await page.locator('#mccDestinationSearch').fill('Equity Quantized');
    await page.locator('#mccDestinations a[href$="equiquant.html"]').click();
  } else {
    await page.goto(siteOrigin+'/account.html?stay=1',{waitUntil:'domcontentloaded'});
    await page.locator('#acDesk').getByRole('link',{name:'Equity Quantized research projects'}).click();
  }
  await page.waitForURL('**/equiquant.html*');
  return page;
}
async function act(page, selector, action) {
  const pending = page.waitForResponse(r=>new URL(r.url()).pathname === '/v1/equiquant' &&
    r.request().method()==='POST' && r.request().postDataJSON().action === action);
  const [response] = await Promise.all([pending, page.locator(selector).click()]);
  const result = await response.json();
  assert.ok(response.ok(), action+' returned '+response.status()+' '+JSON.stringify(result));
  await page.locator('#eq-desk[aria-busy=false]').waitFor();
  return result;
}
async function fits(page, stage) {
  const dims = await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  assert.deepEqual(dims,[390,390],stage);
  console.log('PASS '+stage+' at '+dims.join(' = ')+' px');
}
async function openProject(page, title) {
  await page.locator('#eq-projects').getByRole('button',{name:new RegExp(title)}).click();
}
function verifyRun(run, scenario, capability, outerElapsedNs) {
  assert.equal(run.scenario,scenario);
  assert.equal(run.status,'done');
  assert.equal(run.dataset_doi,doi);
  assert.equal(run.source_commit,commit);
  assert.equal(run.observations_sha256,observations);
  assert.equal(run.result_sha256,pins[scenario][0]);
  assert.ok(Math.abs(run.held_out_mse-pins[scenario][1]) < 1e-9);
  assert.equal(run.folds,13);

  const measured = run.execution;
  const models = {
    pooled:'5374cae4064179f0e65f0c5874220129955c426677bc6084fe0250d61e418ed2',
    group_levels:'6e22a780cfd26067de53d7df5cde9ab74f56db5c93ebf01b66eb6939440eaf1b',
    group_slopes:'f7bcc64b96eb31dcf31ed0e6c0ab73374b5c7c4da69b9d1eefa84808f5b28f9c'
  };
  assert.equal(measured.model_sha256,models[scenario]);
  const code = readFileSync(join(root,'core/src/equiquant-kernel.mjs'));
  assert.equal(measured.code_sha256,createHash('sha256').update(code).digest('hex'));
  assert.equal(measured.spec_sha256,'f12502819b7a9769ea22ae6c0bbfc079b669b3cb4ede2c55513ae7bb3a53be62');
  assert.equal(measured.target,target);
  assert.equal(measured.backend,'node_cpu');
  assert.equal(measured.precision,'binary64');
  assert.equal(measured.node_version.replace(/^v/,''),process.versions.node);
  assert.equal(measured.hardware_sha256,capability.hardware_sha256);
  for (const field of ['code_sha256','spec_sha256','model_sha256','hardware_sha256']) {
    assert.match(measured[field],/^[a-f0-9]{64}$/,field);
  }
  assert.ok(Number.isSafeInteger(measured.elapsed_ns) && measured.elapsed_ns>0 &&
    BigInt(measured.elapsed_ns)<=outerElapsedNs,'Runtime must fit inside the independently timed Core cycle');
  assert.equal(run.execution_verified,true,'Worker must verify the stored execution signature');
  assert.ok(!Object.hasOwn(measured,'signing_public_key'),'Signing keys stay inside the verification boundary');
  console.log('Observed '+measured.target+' '+measured.backend+' '+measured.precision+
    ' on '+measured.node_version+' in '+(measured.elapsed_ns/1e6).toFixed(3)+' ms ('+scenario+')');
}
let browser;
const realFetch = globalThis.fetch;
try {
  await seed();
  globalThis.fetch = isolatedFetch;
  const { runCoreCycle } = await import('../../core/src/runner.mjs');
  const { refreshMosaicCapability, mosaicMachineSha256 } = await import('../../core/src/equiquant-runtime.mjs');
  assert.equal(process.env.MCCLUSTER_EQUIQUANT_MACHINE_SHA256,mosaicMachineSha256(),
    'Supply the machine fingerprint for the Prime computer designated for this rehearsal');
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,
    args:['--disable-background-networking','--disable-component-update','--host-resolver-rules=MAP * ~NOTFOUND']});
  const title = 'Sample project - MOSAiC deformation holdouts';
  const lead = await openProduct(browser,owner);
  await lead.locator('#eq-title').fill(title);
  await fits(lead,'Control entry and project list');
  const created = await act(lead,'#eq-create','create');
  const project = created.project.id;
  assert.equal((await api(null,'state',project)).status,401);
  const retryCreate = await api(owner,'create',project,{title});
  assert.equal((await retryCreate.json()).project.id,project);
  assert.ok([403,404].includes((await api(outsider,'state',project)).status));
  assert.deepEqual((await (await api(outsider,'list')).json()).projects,[]);
  assert.ok([400,403,404].includes((await api(owner,'invite',project,{profile_id:unverified.user.id})).status));
  await lead.locator('#eq-profile').fill(member.user.id);
  await act(lead,'#eq-invite','invite');
  assert.ok([403,404].includes((await api(member,'state',project)).status));
  const collaborator = await openProduct(browser,member);
  await openProject(collaborator,title);
  await act(collaborator,'#eq-accept','accept');
  await collaborator.locator('#eq-role').selectOption({label:'Formal analysis'});
  await collaborator.locator('#eq-name').fill('Sample Contributor');
  await collaborator.locator('#eq-statement').fill('Compared held-out deformation estimates for the MOSAiC pilot.');
  await collaborator.locator('#eq-consent').check();
  const contributed = await act(collaborator,'#eq-evidence','evidence');
  const evidence = contributed.evidence[0];
  assert.ok(evidence.id);
  assert.equal(contributed.release,null);
  const beforeReview = await api(member,'citation',project);
  assert.ok([404,409].includes(beforeReview.status),'Citation requires an explicit review');
  const reference = JSON.parse(await read('core/data/equiquant/observations.json'));
  await collaborator.locator('#eq-dataset > summary').click();
  const lastPair = reference.at(-1);
  assert.equal(await collaborator.locator('#eq-observation option').count(),reference.length);
  await collaborator.locator('#eq-observation').selectOption(lastPair.week);
  const observed = await collaborator.locator('#eq-observed-values').innerText();
  for (const rate of [lastPair.scenarios.primary.proxy_per_day,...lastPair.scenarios.primary.target_per_day]) {
    assert.ok(observed.includes(rate.toFixed(6)), 'Pinned scene measurement missing');
  }
  await collaborator.locator('#eq-dataset-browser details > summary').click();
  assert.ok((await collaborator.locator('#eq-dataset-source').innerText()).includes(observations));
  await fits(collaborator,'Pinned dataset and observations');
  await collaborator.locator('.eq-toy > summary').click();
  const practice = collaborator.locator('#eq-toy-result');
  const firstValue = await practice.innerText();
  await collaborator.locator('#eq-scenario').selectOption('group_slopes');
  await collaborator.locator('#eq-toy-group').selectOption('1');
  assert.notEqual(await practice.innerText(),firstValue);
  await collaborator.locator('#eq-toy-scale').selectOption('11.2');
  await collaborator.locator('#eq-dataset > summary').click();
  await collaborator.locator('.eq-toy > summary').click();
  const beforeCapability = await api(member,'replay',project,{scenario:'pooled',target});
  assert.ok([409,503].includes(beforeCapability.status),'The backend must verify the local target before queuing');
  await refreshMosaicCapability();
  assert.equal(observedCapability.hardware_sha256,mosaicMachineSha256());
  const capabilities = await act(collaborator,'#eq-refresh','state');
  const local = capabilities.targets.find(t=>t.id===target);
  assert.ok(local?.available,'Expected the real local CPU self-check to establish eligibility');
  // Simulate a single damaged transport response. The database and the real
  // runner's attestation remain intact for the rest of this workflow.
  distortNextState = state=>{ state.targets.find(t=>t.id===target).attestation.signature = 'damaged'; };
  const changedTarget = await api(member,'replay',project,{scenario:'pooled',target});
  assert.equal(changedTarget.status,409);
  assert.equal(distortNextState,undefined);
  const localChoice = collaborator.locator('#eq-target');
  await localChoice.selectOption(target);
  for (const remote of ['ovh_core','connected_inference']) {
    const choice = capabilities.targets.find(t=>t.id===remote);
    assert.equal(choice?.available,false);
    assert.ok(choice.reason);
    const option = localChoice.locator('option[value="'+remote+'"]');
    const label = remote === 'ovh_core' ? 'Unavailable' : 'Unsupported';
    assert.ok(await option.isDisabled());
    assert.ok((await option.textContent()).includes(label));
    const description = collaborator.locator('#eq-target-status li').filter({
      hasText: remote === 'ovh_core' ? 'OVH Core' : 'Connected inference'
    });
    assert.ok((await description.textContent()).includes(label));
    const refused = await api(member,'replay',project,{scenario:'pooled',target:remote});
    assert.ok([400,409,503].includes(refused.status),remote+' must not be routable without a compatible capability');
  }
  assert.equal((await one('select count(*)::int as n from ops_agent_jobs')).n,0);
  const jobs = {};
  for (const scenario of Object.keys(pins)) {
    await collaborator.locator('#eq-scenario').selectOption(scenario);
    const queued = await act(collaborator,'#eq-replay','replay');
    const run = queued.runs.find(r=>r.scenario===scenario);
    assert.equal(run.status,'queued');
    jobs[scenario] = run.job_id;
    const started = process.hrtime.bigint();
    assert.equal(await runCoreCycle(),true);
    const outerElapsedNs = process.hrtime.bigint()-started;
    const updated = await act(collaborator,'#eq-refresh','state');
    const receipt = updated.runs.find(r=>r.job_id===run.job_id);
    verifyRun(receipt,scenario,observedCapability,outerElapsedNs);
    const { output } = await one('select output from ops_agent_jobs where id=$1',[run.job_id]);
    assert.equal(receipt.result_sha256,createHash('sha256').update(output.result_json).digest('hex'));
    assert.ok(output.execution.signature && output.execution.signing_public_key,'Persisted output needs signed execution evidence');
    const row = await one('select status,attempts,input from ops_agent_jobs where id=$1',[run.job_id]);
    assert.deepEqual(row,{status:'done',attempts:1,input:{scenario,target,hardware_sha256:observedCapability.hardware_sha256,node_version:process.versions.node}});
    console.log('PASS '+scenario+' held-out MSE '+pins[scenario][1]+', SHA-256 '+pins[scenario][0]);
  }
  const retry = await api(member,'replay',project,{scenario:'group_levels',target});
  const repeats = (await retry.json()).runs.filter(r=>r.scenario==='group_levels');
  assert.deepEqual(repeats.map(r=>r.job_id),[jobs.group_levels]);
  assert.equal(await runCoreCycle(),false);
  assert.deepEqual(telemetry,[], 'Project runs do not enter shared operations telemetry');
  assert.equal((await one('select count(*)::int as n from ops_agent_jobs')).n,3);
  await collaborator.reload();
  if (!await collaborator.locator('#eq-scenario').isVisible()) await openProject(collaborator,title);
  await collaborator.locator('#eq-compare-a').selectOption(jobs.pooled);
  await collaborator.locator('#eq-compare-b').selectOption(jobs.group_levels);
  const comparison = collaborator.locator('#eq-comparison');
  await comparison.waitFor();
  assert.match(await comparison.innerText(),/0\.0?81|0\.33|0\.25/);
  assert.match(await collaborator.locator('#eq-compare-time').innerText(),/Measured replay time.*First.*Second/);
  const latest = await (await api(member,'state',project)).json();
  const groupCount = await collaborator.locator('#eq-compare-context option').count();
  assert.equal(groupCount,1,'All actual runs shared the tested Prime hardware');
  // Presentation-only compatibility fixtures use a detached laboratory panel.
  // No synthetic hardware is enrolled, run or submitted as scientific evidence.
  const guards = await collaborator.evaluate(runs=>{
    const panel = document.createElement('div');
    const other = structuredClone(runs[0]);
    other.job_id = 'different-hardware-fixture';
    other.execution.hardware_sha256 = '0'.repeat(64);
    const unverified = {...runs[1],job_id:'unverified-fixture',execution_verified:false};
    window.EquityQuantizedLab.render(panel,{runs:[...runs,other,unverified]});
    const select = panel.querySelector('#eq-compare-context');
    const first = panel.querySelector('#eq-compare-a');
    const real = [...first.options].map(s=>s.value);
    select.selectedIndex=1;
    select.dispatchEvent(new Event('change'));
    return {groups:select.length,real,hidden:panel.querySelector('#eq-compare-fields').hidden,
      comparisonTime:panel.querySelector('#eq-compare-time').textContent};
  }, latest.runs);
  assert.equal(guards.groups,2);
  assert.deepEqual(guards.real.sort(),Object.values(jobs).sort());
  assert.equal(guards.hidden,true);
  assert.equal(guards.comparisonTime,'');
  await fits(collaborator,'Reloaded model comparison');
  const review = {job_id:jobs.group_levels,evidence_ids:[evidence.id],confirmed:true};
  assert.ok([403,404].includes((await api(member,'review',project,review)).status));
  distortNextState = state=>{ state.runs.find(run=>run.job_id===review.job_id).execution.signature='damaged'; };
  assert.equal((await api(owner,'review',project,review)).status,409);
  assert.equal(distortNextState,undefined);
  await act(lead,'#eq-refresh','state');
  await lead.locator('#eq-review-run').selectOption(jobs.group_levels);
  await lead.locator('#eq-review-options input[type=checkbox]').first().check();
  await lead.locator('#eq-confirm').check();
  const reviewed = await act(lead,'#eq-review','review');
  assert.ok(reviewed.release);
  distortNextState = state=>{ state.release.run.execution.signature='damaged'; };
  assert.equal((await api(owner,'citation',project)).status,409);
  assert.equal(distortNextState,undefined);
  const downloadPending = lead.waitForEvent('download');
  const exported = await act(lead,'#eq-citation','citation');
  const download = await downloadPending;
  assert.equal(download.suggestedFilename(),exported.filename);
  const citation = JSON.parse(await readFile(await download.path(),'utf8'));
  assert.deepEqual(citation,exported.citation);
  const text = JSON.stringify(citation);
  for (const value of [title,'Sample Contributor',doi,commit,pins.group_levels[0]]) assert.ok(text.includes(value),value);
  assert.ok(!text.includes(member.user.id));
  assert.ok(!text.includes('Compared held-out deformation estimates'), 'Evidence stays inside the project');
  assert.deepEqual(citation.author,[{literal:'Sample Contributor'}]);
  const chosenExecution = reviewed.release.run.execution;
  for (const key of ['target','precision','code_sha256','spec_sha256','model_sha256','hardware_sha256','elapsed_ns']) {
    assert.ok(text.includes(String(chosenExecution[key])), 'Reviewed citation lacks '+key);
  }
  await lead.reload();
  if (!await lead.locator('#eq-citation').isVisible()) await openProject(lead,title);
  await lead.locator('#eq-citation').waitFor();
  await fits(lead,'Saved release and private citation');
  if (process.env.EQUIQUANT_QA_OUT) {
    await mkdir(process.env.EQUIQUANT_QA_OUT,{recursive:true});
    for (const [width,height] of [[390,844],[1440,1000]]) {
      await lead.setViewportSize({width,height});
      await lead.locator('#eq-compare-a').selectOption(jobs.pooled);
      await lead.locator('#eq-compare-b').selectOption(jobs.group_levels);
      await lead.locator('#eq-comparison').waitFor();
      const prefix = join(process.env.EQUIQUANT_QA_OUT,'sample-equity-quantized-'+width);
      await lead.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await lead.screenshot({path:prefix+'-project.png'});
      const anchor = locator=>locator.evaluate(el=>{
        const y = el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({top:Math.max(0,y-24),behavior:'instant'});
      });
      const selector = lead.locator('#eq-target');
      await selector.selectOption(target);
      assert.equal(await selector.inputValue(),target);
      assert.match(await selector.locator('option:checked').textContent(),/Prime/);
      const capabilityDetails = lead.locator('#eq-target-status').locator('..');
      if (!await capabilityDetails.evaluate(el=>el.open)) await capabilityDetails.locator('summary').click();
      await anchor(lead.locator('label[for=eq-target]'));
      await lead.screenshot({path:prefix+'-targets.png'});
      await capabilityDetails.locator('summary').click();
      await anchor(lead.getByRole('heading',{name:'Saved project runs'}));
      await lead.screenshot({path:prefix+'-lab.png'});
      await anchor(lead.getByRole('heading',{name:'Release credits'}));
      await lead.screenshot({path:prefix+'-release.png'});
      const bar = lead.locator('.appbar').first();
      console.log('Captured '+width+' px saved project, results comparison and release. Shared bar visible: '+await bar.isVisible());
    }
  }
  await db.exec('reset role');
  const unrelated = await one("insert into ops_agent_jobs(org_id,job_type) values ($1,'lead_rescore') returning id",[org]);
  assert.equal(await runCoreCycle(),false,'Prime research worker must leave ordinary Core jobs queued');
  assert.equal((await one('select status from ops_agent_jobs where id=$1',[unrelated.id])).status,'queued');
  await assertResearchGuards(db,org);
  assert.deepEqual(errors,[]);
  console.log('PASS verified collaborator invite, self-consented evidence, three fenced Core jobs, separate owner review and downloaded citation. Disposable PostgreSQL, no hosted services.');
} finally {
  await browser?.close();
  globalThis.fetch = realFetch;
  await db.close();
}
