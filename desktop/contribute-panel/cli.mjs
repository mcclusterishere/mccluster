#!/usr/bin/env node
// Local Contribute panel CLI for the node state root. Never talks to the Core
// or to production Supabase. Usage:
//   node desktop/contribute-panel/cli.mjs --state <dir> status
//   node desktop/contribute-panel/cli.mjs --state <dir> opt-in
//   node desktop/contribute-panel/cli.mjs --state <dir> opt-out
import { readPanel, setOptIn } from './index.mjs';

const args = process.argv.slice(2);
const stateIdx = args.indexOf('--state');
if (stateIdx < 0 || !args[stateIdx + 1]) {
  console.error('Usage: node desktop/contribute-panel/cli.mjs --state <dir> <status|opt-in|opt-out>');
  process.exit(2);
}
const stateRoot = args[stateIdx + 1];
const command = args.filter((a, i) => a !== '--state' && i !== stateIdx + 1)[0] || 'status';

if (command === 'opt-in') setOptIn(stateRoot, true);
else if (command === 'opt-out') setOptIn(stateRoot, false);
else if (command !== 'status') {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}

const panel = readPanel(stateRoot);
const lines = [
  `Opted in: ${panel.opted_in ? 'yes' : 'no'}`,
  panel.ratio_caption
];
if (!panel.balances) {
  lines.push('Contributed: (no ledger receipt on this device yet)');
  lines.push('Earned: (no ledger receipt on this device yet)');
} else {
  const b = panel.balances;
  lines.push(`Account: ${b.account_id}`);
  lines.push(`Contributed: ${b.contributed.micro} micro-units (${b.contributed.units} units)`);
  lines.push(`Earned: ${b.earned.micro} micro-units (${b.earned.units} units)`);
  lines.push(`Carry: ${b.carry.micro} micro-units`);
  lines.push(`Available: ${b.available.micro} micro-units`);
}
process.stdout.write(`${lines.join('\n')}\n`);
