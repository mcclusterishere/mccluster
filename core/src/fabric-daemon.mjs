import { drainOutbox, drainSpool, reconcileFabric } from './fabric.mjs';

const pollMs = Math.max(1000, Number(process.env.MCCLUSTER_FABRIC_POLL_MS || 5000));
const reconcileEvery = Math.max(1, Number(process.env.MCCLUSTER_FABRIC_RECONCILE_EVERY || 12));
let cycle = 0;
let stopping = false;

function log(event, detail = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'mccluster-fabric', event, ...detail }));
}

async function runCycle() {
  const spooled = await drainSpool({ limit: 50 });
  const acked = await drainOutbox({ limit: 100 });
  cycle += 1;
  let reconciled = 0;
  if (cycle % reconcileEvery === 0) reconciled = await reconcileFabric({ limit: 500 });
  if (spooled || acked || reconciled) log('cycle', { spooled, acked, reconciled });
}

async function main() {
  log('started', { poll_ms: pollMs });
  while (!stopping) {
    try { await runCycle(); }
    catch (error) { log('cycle_error', { error: error?.stack || String(error) }); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  log('stopped');
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { stopping = true; });
}

await main();
