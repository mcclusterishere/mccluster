import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTRIBUTE_SCHEMA, BALANCES_SCHEMA, CONTRIBUTE_FILE, BALANCES_FILE,
  readOptIn, setOptIn, readBalances, writeBalances, readPanel, previewEarn, formatUnits, clearPanel
} from './index.mjs';

function state() { return mkdtempSync(join(tmpdir(), 'contribute-panel-')); }

test('a new state root is opted out and has no balances', () => {
  const root = state();
  const panel = readPanel(root);
  assert.equal(panel.opted_in, false);
  assert.equal(panel.balances, null);
  assert.equal(panel.ratio, 3);
  assert.match(panel.ratio_caption, /3 contributed work units earn 1 spendable unit/);
  assert.ok(panel.consent.length > 80);
});

test('the opt-in toggle writes contribute.json and does not invent balances', () => {
  const root = state();
  const on = setOptIn(root, true, { now: '2026-11-25T17:00:00.000Z' });
  assert.equal(on.opted_in, true);
  const saved = JSON.parse(readFileSync(join(root, CONTRIBUTE_FILE), 'utf8'));
  assert.equal(saved.schema, CONTRIBUTE_SCHEMA);
  assert.equal(saved.opted_in, true);
  assert.equal(readBalances(root), null);
  const off = setOptIn(root, false, { now: '2026-11-25T17:01:00.000Z' });
  assert.equal(off.opted_in, false);
  assert.equal(readPanel(root).opted_in, false);
});

test('the panel shows contributed and earned units written by a trusted source', () => {
  const root = state();
  setOptIn(root, true, { now: '2026-11-25T17:00:00.000Z' });
  writeBalances(root, {
    account_id: 'worker-ratio',
    contributed_micro: 9,
    earned_micro: 3,
    carry_micro: 0,
    available_micro: 3,
    pending_micro: 0
  }, { now: '2026-11-25T17:02:00.000Z' });
  const panel = readPanel(root);
  assert.equal(panel.opted_in, true);
  assert.equal(panel.balances.contributed.micro, '9');
  assert.equal(panel.balances.earned.micro, '3');
  assert.equal(panel.balances.available.micro, '3');
  assert.equal(panel.balances.account_id, 'worker-ratio');
  const saved = JSON.parse(readFileSync(join(root, BALANCES_FILE), 'utf8'));
  assert.equal(saved.schema, BALANCES_SCHEMA);
});

test('toggling opt-in leaves existing balances in place', () => {
  const root = state();
  writeBalances(root, { account_id: 'worker-ratio', contributed_micro: 6, earned_micro: 2, carry_micro: 0, available_micro: 2 });
  setOptIn(root, true);
  setOptIn(root, false);
  const balances = readBalances(root);
  assert.equal(balances.contributed_micro, '6');
  assert.equal(balances.earned_micro, '2');
  assert.equal(readOptIn(root).opted_in, false);
});

test('formatUnits splits micro-units into whole units of one million', () => {
  assert.deepEqual(formatUnits(0), { micro: '0', units: '0' });
  assert.deepEqual(formatUnits(3), { micro: '3', units: '0.000003' });
  assert.deepEqual(formatUnits(1_000_000), { micro: '1000000', units: '1' });
  assert.deepEqual(formatUnits('1500000'), { micro: '1500000', units: '1.5' });
});

test('previewEarn matches the 3-to-1 ledger rule including leftover carry', () => {
  assert.deepEqual(previewEarn(3), { mintedMicro: 1n, carryMicro: 0n });
  assert.deepEqual(previewEarn(2), { mintedMicro: 0n, carryMicro: 2n });
  assert.deepEqual(previewEarn(1, { carryMicro: 2 }), { mintedMicro: 1n, carryMicro: 0n });
});

test('corrupt or unknown schema files are refused, and clearPanel removes both files', () => {
  const root = state();
  writeFileSync(join(root, CONTRIBUTE_FILE), '{not json');
  assert.throws(() => readOptIn(root), /not valid JSON/);
  clearPanel(root);
  writeFileSync(join(root, BALANCES_FILE), JSON.stringify({ schema: 'nope', contributed_micro: 1, earned_micro: 0, account_id: 'x' }));
  assert.throws(() => readBalances(root), /unknown balances schema/);
  writeBalances(root, { account_id: 'worker-ratio', contributed_micro: 3, earned_micro: 1 });
  setOptIn(root, true);
  clearPanel(root);
  assert.equal(readOptIn(root).present, false);
  assert.equal(readBalances(root), null);
});
