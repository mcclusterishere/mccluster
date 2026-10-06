/* Clipping marketplace contracts: the boundaries that keep money honest and
   civic work separate, read from the source that ships. The database's
   behaviour (settlement, caps, holds, payouts) is proven end to end by
   supabase/tests/action_clipping_regression.sql; the Worker's platform reads
   by workers/mccluster/test/clipping.test.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (path) => fs.readFile(new URL('../../' + path, import.meta.url), 'utf8');
const MIGRATION = 'supabase/migrations/20261006170955_action_clipping_marketplace_v1.sql';

function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  const end = sql.indexOf('\n$$;', start);
  return sql.slice(start, end);
}

test('the clipping migration is committed under the version production recorded for it', async () => {
  const ledger = JSON.parse(await read('supabase/production-ledger.json'));
  assert.ok(ledger.migrations.some((m) => m.version === '20261006170955' && m.name === 'action_clipping_marketplace_v1'));
  await fs.access(new URL('../../' + MIGRATION, import.meta.url));
  await assert.rejects(fs.access(new URL('../../supabase/pending/action_clipping_marketplace_v1.sql', import.meta.url)), 'no second copy waits in pending/');
});

test('only Instagram is verifiable; YouTube and TikTok are off in the database and the Worker', async () => {
  const [sql, platforms] = await Promise.all([read(MIGRATION), read('workers/mccluster/src/clipping/platforms.js')]);
  assert.match(fnBody(sql, 'private.clip_platform_enabled'), /select p_platform = 'instagram'/);
  assert.match(platforms, /instagram:\s*\{\s*enabled:\s*true/);
  assert.match(platforms, /youtube:\s*\{\s*enabled:\s*false/);
  assert.match(platforms, /tiktok:\s*\{\s*enabled:\s*false/);
});

test('views are never taken from the member: submission carries a link, metrics come from the service role', async () => {
  const [sql, web, native] = await Promise.all([read(MIGRATION), read('js/mnet-clips.js'), read('native/src/actionNetwork.ts')]);
  assert.match(sql, /create or replace function public\.clip_submit\(p_mission uuid, p_platform text, p_url text, p_moment uuid default null\)/);
  for (const client of [web, native]) {
    const call = client.slice(client.indexOf('clip_submit'), client.indexOf('clip_submit') + 260);
    assert.doesNotMatch(call, /views|likes|screenshot/i, 'the client never reports a number');
  }
  assert.match(fnBody(sql, 'public.clip_record_metrics'), /'platform_api'/, 'snapshots are marked as platform reads');
  const grants = sql.slice(sql.indexOf('-- 9. Who may call what.'));
  for (const fn of ['clip_settle_submission(uuid)', 'clip_work_due(integer)', 'clip_record_verification(uuid, jsonb)',
    'clip_record_metrics(uuid, jsonb)', 'clip_release_due()', 'clip_attribute_conversions(timestamptz)',
    'clip_account_mark_verified(uuid, jsonb)', 'clip_check_fraud(uuid)']) {
    const at = grants.indexOf(`'public.${fn}'`);
    assert.ok(at > grants.indexOf('settlement is the Worker'), `${fn} is service-only`);
  }
});

test('every clipping table is server-only and the payout ledger guards itself', async () => {
  const sql = await read(MIGRATION);
  for (const table of ['action_clip_campaigns', 'action_clip_assets', 'action_clip_claims', 'action_clip_submissions',
    'action_clip_payouts', 'action_clip_earnings', 'action_clip_conversions']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table} \\(`));
    assert.match(sql, new RegExp(`'${table}'`), `${table} is in the RLS/revoke loop`);
  }
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on public\.%I from public, anon, authenticated/);
  assert.match(sql, /idempotency_key\s+text not null unique/);
  assert.match(sql, /create trigger action_clip_earnings_guard before update or delete on public\.action_clip_earnings/);
  const guard = fnBody(sql, 'private.clip_earnings_guard');
  assert.match(guard, /append-only/);
  assert.match(guard, /never edited/);
});

test('funding a creator records is owner-attested; card funding is staged, not typed in', async () => {
  const [sql, control] = await Promise.all([read(MIGRATION), read('js/control-room/clipping.js')]);
  const fund = fnBody(sql, 'public.clip_campaign_fund');
  assert.match(fund, /if p_provider in \('stripe', 'square'\) then\s+raise exception 'card funding is not connected yet/);
  assert.match(control, /<option value="stripe" disabled>Card payment \(not connected yet\)<\/option>/);
});

test('credentials are references, end dates only move later, and every campaign has a song link', async () => {
  const sql = await read(MIGRATION);
  const attach = fnBody(sql, 'public.clip_account_attach_credential');
  assert.match(attach, /\^vault:/);
  assert.match(attach, /SOCIAL_IG_\[A-Z0-9_\]\+_ACCESS_TOKEN/);
  assert.ok(attach.indexOf('never a token') < attach.indexOf('update public.social_accounts'), 'checked before anything is stored');
  assert.match(fnBody(sql, 'public.clip_campaign_update'), /'infinity'::timestamptz/);
  assert.match(fnBody(sql, 'private.clip_song_url'), /album\.html\?track=/);
  assert.match(fnBody(sql, 'public.clip_my_work'), /'link', private\.clip_song_url\(c\.music_object_id, c\.creator_track_id\)/);
});

test('settlement is budget-safe: it locks the campaign and never commits past funded budget', async () => {
  const sql = await read(MIGRATION);
  const settle = fnBody(sql, 'public.clip_settle_submission');
  assert.match(settle, /from public\.action_clip_campaigns where mission_id = v_sub\.mission_id for update/);
  assert.match(settle, /on conflict \(idempotency_key\) do nothing/);
  assert.match(fnBody(sql, 'private.clip_money'), /least\(c\.budget_cents, f\.funded\)/);
  assert.match(fnBody(sql, 'public.clip_work_due'), /for update skip locked/);
});

test('paid clip work is kept out of civic proof, points and the Action Record', async () => {
  const [sql, mnet, native] = await Promise.all([read(MIGRATION), read('js/mnet.js'), read('native/src/actionNetwork.ts')]);
  assert.match(sql, /create trigger action_proofs_civic_only before insert or update of assignment_id on public\.action_proofs/);
  assert.match(sql, /create trigger action_points_civic_only before insert on public\.action_points_ledger/);
  assert.match(fnBody(sql, 'public.action_record'), /kind = 'civic'/);
  assert.match(mnet, /kind!=="clip"/);
  assert.match(native, /row\.kind !== 'clip'/);
});

test('creator dashboards are org-scoped through the existing owner check', async () => {
  const sql = await read(MIGRATION);
  assert.match(fnBody(sql, 'private.clip_require_owner'), /private\.is_org_owner/);
  // by campaign through clip_require_owner, by org directly through is_org_owner
  for (const fn of ['public.clip_campaign_dashboard', 'public.clip_review_submission', 'public.clip_campaign_update',
    'public.clip_campaign_set_status', 'public.clip_campaign_fund']) {
    assert.match(fnBody(sql, fn), /private\.clip_require_owner\(/, `${fn} checks the creator org`);
  }
  for (const fn of ['public.clip_campaign_create', 'public.clip_campaigns_for_org', 'public.clip_record_payout']) {
    assert.match(fnBody(sql, fn), /not private\.is_org_owner\((?:p_org|v_org)\)/, `${fn} checks the creator org`);
  }
});

test('the surfaces are wired: Worker cron and routes, Control, web and native Clips', async () => {
  const [entry, control, controlV2, mnetHtml, screen] = await Promise.all([
    read('workers/mccluster/src/entry.js'), read('control.html'), read('js/control-room-v2.js'),
    read('mnet.html'), read('native/src/ActionNetworkScreen.tsx')]);
  assert.match(entry, /observeScheduled\(env, ctx, 'clipping\.settlement'/);
  assert.match(entry, /handleClippingRequest/);
  assert.match(control, /js\/control-room\/clipping\.js/);
  assert.match(controlV2, /"clipping"/);
  assert.match(mnetHtml, /data-mn-view="clips"/);
  assert.match(mnetHtml, /js\/mnet-clips\.js/);
  assert.match(screen, /\{ key: 'clips', label: 'Clips' \}/);
  assert.match(screen, /view === 'clips' \? <ClipsView \/>/);
  assert.doesNotMatch(screen + (await read('js/mnet-clips.js')), /service_role/i);
});

test('CI rebuilds the database from the migration chain and runs the end-to-end regression', async () => {
  const ci = await read('.github/workflows/api-economic-core-ci.yml');
  const rebuild = ci.indexOf('bash scripts/supabase-local-reset-with-replay.sh');
  const regress = ci.indexOf('-f supabase/tests/action_clipping_regression.sql');
  assert.ok(rebuild > 0 && regress > rebuild, 'the rebuilt chain, clipping included, is what the regression runs against');
  assert.doesNotMatch(ci, /-f supabase\/pending\/action_clipping_marketplace_v1\.sql/, 'no separate pending apply once it is in the chain');
});

// Execute the actual browser module: a parse-only test misses a truncated
// registration or a create form whose buttons have no handlers.
async function clippingUI(action = false, failBrief = false) {
  const { runInNewContext } = await import('node:vm');
  const fields = Object.fromEntries(Object.entries({
    clTitle: 'Campaign', clSong: 'song-1', clSource: 'content-1',
    clDestination: 'https://example.com/action', clBudget: '100', clCpm: '3',
    clAttribution: '@artist', clCollaborators: '@partner', clCollabMode: 'request'
  }).map(([k, value]) => [k, { value }]));
  fields.clIg = { checked: true };
  const calls = [], window = {};
  runInNewContext(await read('js/control-room/clipping.js'), {
    window, document: { getElementById: id => fields[id], querySelectorAll: () => [] },
    confirm: () => true, prompt: () => 'receipt-1'
  });
  const ui = window.CR.clipping;
  assert.ok(ui?.init && ui?.render && ui?.bind, 'module registers every entry point');
  ui.init({ org: () => ({ id: 'org-1' }), render() {}, supa: async (path, opts) => {
    calls.push({ path, body: opts?.body });
    if (path === 'rpc/clip_campaign_create' || path === 'rpc/clip_campaign_create_from_action') return { mission_id: 'campaign-1' };
    if (path === 'rpc/clip_campaign_set_distribution' && failBrief) throw new Error('missing function');
    if (path === 'rpc/clip_campaigns_for_org') return [{ mission_id: 'campaign-1', title: 'Campaign', status: 'draft' }];
    if (path === 'rpc/clip_campaign_dashboard') return { campaign: { status: 'draft' }, money: {}, totals: {} };
    return [];
  }});
  ui.state.sourceType = action ? 'action' : 'music';
  const button = {};
  ui.bind({ querySelectorAll: () => [], querySelector: q => q === '[data-clip-create]' ? button : null });
  button.onclick();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  return { ui, calls };
}

test('new source forms create the right draft and preserve the management dashboard', async () => {
  for (const action of [false, true]) {
    const { ui, calls } = await clippingUI(action);
    const create = calls.find(x => x.path === (action ? 'rpc/clip_campaign_create_from_action' : 'rpc/clip_campaign_create'));
    assert.ok(create, 'the source type selects its canonical RPC');
    assert.equal(create.body.p.org_id, 'org-1');
    assert.equal(create.body.p.source_kind, action ? 'action' : 'music');
    assert.equal(calls.some(x => x.path === 'rpc/clip_campaign_set_distribution'), !action,
      'music saves its brief separately; action creation already saves it');
    assert.equal(ui.state.sel, 'campaign-1');
    assert.equal(ui.state.tab, 'overview');
    const html = ui.render();
    for (const target of ['data-clip-pick', 'data-clip-tab="clips"', 'data-clip-tab="clippers"', 'data-clip-tab="money"', 'data-clip-fund', 'data-clip-status']) {
      assert.ok(html.includes(target), `${target} remains accessible after creating a draft`);
    }
  }
});

test('a failed music distribution save identifies the saved draft rather than inviting duplicate creation', async () => {
  const { ui, calls } = await clippingUI(false, true);
  assert.equal(calls.filter(x => x.path === 'rpc/clip_campaign_create').length, 1);
  assert.equal(ui.state.sel, 'campaign-1');
  assert.equal(ui.state.tab, 'overview');
  assert.equal(ui.state.bad, true);
  assert.match(ui.state.msg, /Draft saved.*brief could not be saved/);
});
