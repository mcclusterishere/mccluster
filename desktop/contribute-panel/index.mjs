// Desktop Contribute panel contract. The panel is a client: it never calls
// the Core. Opt-in is written to the node state root. Ledger balances are
// only displayed after a trusted writer (the node doctor or a local test
// helper) records them from compute_ledger_balances. See
// docs/control-plane/COMPUTE-CONTRIBUTE-PANEL.md.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redemptionMint, DEFAULT_REDEMPTION_RATIO } from '../../core/src/compute/contribution-ledger.mjs';

export const CONTRIBUTE_SCHEMA = 'mccluster.contribute-panel/v1';
export const BALANCES_SCHEMA = 'mccluster.contribution-balances/v1';
export const CONTRIBUTE_FILE = 'contribute.json';
export const BALANCES_FILE = 'contribution-balances.json';
export const MICRO_PER_UNIT = 1_000_000n;

export function contributePath(stateRoot) { return join(requiredDir(stateRoot), CONTRIBUTE_FILE); }
export function balancesPath(stateRoot) { return join(requiredDir(stateRoot), BALANCES_FILE); }

function requiredDir(stateRoot) {
  if (typeof stateRoot !== 'string' || !stateRoot.trim()) throw new Error('state root is required');
  return stateRoot;
}

function atomicWrite(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
}

function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
}

export function readOptIn(stateRoot) {
  const raw = readJson(contributePath(stateRoot));
  if (!raw) return { opted_in: false, updated_at: null, present: false };
  if (raw.schema !== CONTRIBUTE_SCHEMA) throw new Error(`unknown contribute schema: ${raw.schema}`);
  return { opted_in: raw.opted_in === true, updated_at: raw.updated_at ?? null, present: true };
}

export function setOptIn(stateRoot, optedIn, { now = new Date().toISOString() } = {}) {
  const record = { schema: CONTRIBUTE_SCHEMA, opted_in: optedIn === true, updated_at: now };
  atomicWrite(contributePath(stateRoot), record);
  return readOptIn(stateRoot);
}

function asMicro(value, name) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${name} must be a non-negative integer`);
    return value;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  throw new Error(`${name} must be a non-negative integer`);
}

export function formatUnits(micro) {
  const value = asMicro(micro, 'units');
  const whole = value / MICRO_PER_UNIT;
  const frac = value % MICRO_PER_UNIT;
  const units = frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
  return { micro: value.toString(), units };
}

export function writeBalances(stateRoot, balances, { now = new Date().toISOString() } = {}) {
  const record = {
    schema: BALANCES_SCHEMA,
    account_id: String(balances.account_id || ''),
    contributed_micro: asMicro(balances.contributed_micro ?? 0, 'contributed_micro').toString(),
    earned_micro: asMicro(balances.earned_micro ?? 0, 'earned_micro').toString(),
    carry_micro: asMicro(balances.carry_micro ?? 0, 'carry_micro').toString(),
    available_micro: asMicro(balances.available_micro ?? 0, 'available_micro').toString(),
    pending_micro: asMicro(balances.pending_micro ?? 0, 'pending_micro').toString(),
    updated_at: now,
    source: balances.source || 'ledger'
  };
  if (!record.account_id) throw new Error('account_id is required');
  atomicWrite(balancesPath(stateRoot), record);
  return readBalances(stateRoot);
}

export function readBalances(stateRoot) {
  const raw = readJson(balancesPath(stateRoot));
  if (!raw) return null;
  if (raw.schema !== BALANCES_SCHEMA) throw new Error(`unknown balances schema: ${raw.schema}`);
  const contributed = asMicro(raw.contributed_micro ?? 0, 'contributed_micro');
  const earned = asMicro(raw.earned_micro ?? 0, 'earned_micro');
  const carry = asMicro(raw.carry_micro ?? 0, 'carry_micro');
  const available = asMicro(raw.available_micro ?? 0, 'available_micro');
  const pending = asMicro(raw.pending_micro ?? 0, 'pending_micro');
  return {
    account_id: String(raw.account_id || ''),
    contributed_micro: contributed.toString(),
    earned_micro: earned.toString(),
    carry_micro: carry.toString(),
    available_micro: available.toString(),
    pending_micro: pending.toString(),
    updated_at: raw.updated_at ?? null,
    source: raw.source || 'ledger',
    contributed: formatUnits(contributed),
    earned: formatUnits(earned),
    carry: formatUnits(carry),
    available: formatUnits(available),
    pending: formatUnits(pending)
  };
}

export function readPanel(stateRoot) {
  const opt = readOptIn(stateRoot);
  const balances = readBalances(stateRoot);
  return {
    opted_in: opt.opted_in,
    updated_at: opt.updated_at,
    consent: CONSENT_TEXT,
    ratio: DEFAULT_REDEMPTION_RATIO,
    ratio_caption: `${DEFAULT_REDEMPTION_RATIO} contributed work units earn 1 spendable unit. Leftover units stay as carry until the next accepted job completes the ratio.`,
    balances
  };
}

export function previewEarn(contributedMicro, { carryMicro = 0, ratio = DEFAULT_REDEMPTION_RATIO } = {}) {
  return redemptionMint(contributedMicro, { carryMicro, ratio });
}

export function clearPanel(stateRoot) {
  for (const file of [contributePath(stateRoot), balancesPath(stateRoot)]) {
    if (existsSync(file)) rmSync(file);
  }
}

export const CONSENT_TEXT =
  'Contributing makes this device a compute node of the McCluster compute network.\n' +
  'What runs here: only the approved model class, through the node adapter on loopback; nothing else is installed by enabling this.\n' +
  'Which work: workload class public only, by default for a community device: open or synthetic inputs, never another owner\'s data.\n' +
  'Your limits: idle only, AC power only, max concurrency (1 in the pilot), CPU busy ceiling, battery floor and a thermal limit.\n' +
  'This panel never calls the Core. Pause and Revoke stay one click away on the full desktop client, which drives the node doctor.';
