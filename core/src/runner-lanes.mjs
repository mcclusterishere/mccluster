// Separate bounded lanes keep long model turns from blocking unrelated Core
// work. Compute leases still enforce the one-job limit on each Mac.
export async function runJobLanes({ lanes, cycle, shouldStop, pause, pollMs, onError = () => {} }) {
  const workers = [];
  for (const lane of lanes) {
    if (!lane.types.length) continue;
    for (let index = 0; index < lane.concurrency; index += 1) {
      workers.push((async () => {
        while (!shouldStop()) {
          try {
            const worked = await cycle(lane.types);
            if (!worked && !shouldStop()) await pause(pollMs);
          } catch (error) {
            onError(error, lane.name);
            if (!shouldStop()) await pause(Math.min(60_000, pollMs * 2));
          }
        }
      })());
    }
  }
  // Shutdown waits for the current jobs, whose original heartbeat/lease fences
  // remain active. It does not abandon background promises.
  await Promise.all(workers);
}

export function ownerWorkspaceLanes(types, concurrency = 4) {
  const modelTypes = ['resident_ai_turn'];
  const pairTypes = ['compute_pair_benchmark'];
  const parallel = new Set([...modelTypes, ...pairTypes]);
  const limit = Math.max(1, Math.min(8, Number.isFinite(Number(concurrency)) ? Math.floor(Number(concurrency)) : 4));
  return [
    { name: 'ordinary', types: types.filter(type => !parallel.has(type)), concurrency: 1 },
    { name: 'owner-chat', types: modelTypes.filter(type => types.includes(type)), concurrency: limit },
    { name: 'pair-benchmark', types: pairTypes.filter(type => types.includes(type)), concurrency: 1 },
  ];
}
