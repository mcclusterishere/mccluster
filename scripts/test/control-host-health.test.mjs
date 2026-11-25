/* Review finding R3 (2026-11-10). Control's OVH host tile and Needs you
   followed only the age of the host health snapshot. A fresh snapshot whose
   overall was "degraded" or "fail" (a reconcile cycle failing every run, as
   in incident #510, or any other warning Core raised) still showed an "ok"
   tile and added nothing to Needs you: the warning reached only the tile's
   text and the raw inspector.

   These run Control's own serviceRows() and attentionItems(), sliced from
   js/control-room-v2.js, with the real formatting helpers of
   js/control-room/format.js and only the state the two functions read. The
   state is what GET /v1/ai/system-health returns
   (workers/mccluster/src/ai/router.js): overall, stale, checked_at, and the
   host_health output under `health`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const control = read('js/control-room-v2.js');
/* One top-level function of the page, or nothing when this copy lacks it. */
const fn = (name) => {
  const at = control.indexOf(`\n  function ${name}(`);
  if (at < 0) return '';
  const end = control.indexOf('\n  }\n', at);
  assert.ok(end > at, name);
  return control.slice(at, end + 4);
};
for (const name of ['serviceRows', 'attentionItems']) assert.ok(fn(name), `${name} is in js/control-room-v2.js`);

const reconcileFailed = { component: 'deployment', code: 'reconcile_cycle_failed', severity: 'warning', message: 'The last OVH reconcile cycle failed at stage fetch.',
  detail: { stage: 'fetch', exit_code: 128, interrupted: false, consecutive_failed_cycles: 7 } };
const ledgerDrift = { component: 'supabase', code: 'supabase_migration_ledger_drift', severity: 'critical', message: 'Live migration ledger differs from the contract.' };

function page(aiHealth) {
  const context = { window: {}, Date, String, Array, Number, Object, Math, Intl };
  vm.createContext(context);
  vm.runInContext(read('js/control-room/format.js'), context);
  Object.assign(context, {
    state: {
      status: { database: { reachable: true } }, sources: { health: { ok: true }, workspace: { ok: true }, aiHealth: { ok: true } }, health: { ok: true },
      coreBridge: { ok: true, signed_dispatch: true }, coreTools: [], threads: [], mediaJobs: [], jobs: [], decisions: [], leads: [], recentErrors: null,
      workspace: { name: 'Fixture', slug: 'fixture', role: 'owner' }, aiHealth,
    },
    threadInQueue: () => false, threadOwned: () => false,
  });
  vm.runInContext(`var fmt = window.CR.fmt, text = fmt.text, titleCase = fmt.titleCase, ago = fmt.ago;
${fn('hostHealthProblem')}${fn('serviceRows')}${fn('attentionItems')}
this.rows = serviceRows(); this.items = attentionItems();`, context);
  const tile = context.rows.find((row) => row.key === 'host');
  // Copied out of the vm's realm so that strict deep equality compares values only.
  return { tile: { value: tile.value, kind: tile.kind }, host: Array.from(context.items, (item) => ({ ...item })).filter((item) => /host/i.test(item.title)) };
}
const snapshot = (overall, degradation = [], extra = {}) => ({ ok: true, overall, stale: false, checked_at: new Date(Date.now() - 60_000).toISOString(), health: { overall, degradation }, ...extra });

test('a fresh degraded host health result is a warning tile and a Needs-you item that names what Core found', () => {
  const { tile, host } = page(snapshot('degraded', [reconcileFailed]));
  assert.deepEqual(tile, { value: 'Degraded', kind: 'warn' });
  assert.equal(host.length, 1, JSON.stringify(host));
  assert.equal(host[0].kind, 'warn');
  assert.equal(host[0].title, 'OVH host health is degraded');
  assert.equal(host[0].sub, 'reconcile_cycle_failed (stage fetch)');
  assert.equal(host[0].action, 'system-overview');
});

test('a fresh failing host health result is a bad tile, and a critical finding is named first', () => {
  const { tile, host } = page(snapshot('fail', [reconcileFailed, ledgerDrift]));
  assert.deepEqual(tile, { value: 'Fail', kind: 'bad' });
  assert.equal(host.length, 1);
  assert.equal(host[0].kind, 'bad');
  assert.equal(host[0].title, 'OVH host health is failing');
  assert.equal(host[0].sub, 'supabase_migration_ledger_drift · reconcile_cycle_failed (stage fetch)');
  // A stale cycle names the stage its last cycle ended at; many findings are counted, not listed.
  const many = [1, 2, 3, 4].map((n) => ({ component: 'jobs', code: `finding_${n}`, severity: 'warning' }));
  const stale = { component: 'deployment', code: 'reconcile_cycle_stale', severity: 'warning', detail: { last_cycle_stage: 'deploy' } };
  assert.equal(page(snapshot('degraded', [stale, ...many])).host[0].sub, 'reconcile_cycle_stale (stage deploy) · finding_1 · finding_2 · +2 more');
  assert.equal(page(snapshot('degraded')).host[0].sub, 'Core reports the host degraded without naming a finding.');
});

test('a healthy, stale or missing result is shown as before', () => {
  assert.deepEqual(page(snapshot('ok')), { tile: { value: 'Ok', kind: 'ok' }, host: [] });
  // A stale snapshot keeps its own notice; its old overall is not repeated as a current finding.
  const stale = page(snapshot('degraded', [reconcileFailed], { stale: true }));
  assert.deepEqual(stale.tile, { value: 'Refresh', kind: 'warn' });
  assert.deepEqual(stale.host.map((item) => [item.title, item.kind, item.action]), [['Host health is stale', 'warn', 'system-workload']]);
  assert.deepEqual(page(null), { tile: { value: 'Refresh', kind: 'warn' }, host: [] });
});
