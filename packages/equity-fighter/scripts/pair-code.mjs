#!/usr/bin/env node
// Print the one-time pairing code for one platform user id. Run on a trusted
// machine with EQUITY_FIGHTER_PAIRING_SECRET in the environment; never paste
// the secret into chat. Usage: npm run pair-code -- slack U0123ABCD
import { pairingCode } from '../dist/pairing.js';

const [platform, userId] = process.argv.slice(2);
if (!platform || !userId) {
  console.error('usage: npm run pair-code -- <platform> <platform user id>');
  process.exit(2);
}
console.log(await pairingCode(process.env.EQUITY_FIGHTER_PAIRING_SECRET || '', platform, userId));
