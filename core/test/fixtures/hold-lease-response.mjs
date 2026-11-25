// A test-only delivery gate. The real gateway already assigned the lease; release its
// response to the real agent only after the parent observes graceful shutdown.
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const response = await originalFetch(url, options);
  if (!String(url).endsWith('/v1/compute/lease') || !response.ok) return response;
  const { lease } = await response.clone().json();
  if (lease) {
    const marker = process.env.FIXTURE_HELD_RESPONSE;
    fs.writeFileSync(marker, '');
    const deadline = Date.now() + 15_000;
    while (fs.existsSync(marker) && Date.now() < deadline) await sleep(25);
  }
  return response;
};
