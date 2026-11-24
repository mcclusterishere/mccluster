// Mandatory egress boundary for the disposable runtime. This file is preloaded
// by every Node subprocess before any product module or environment is read.
// No request to an API, database, model host or webhook can leave loopback.
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const allowed = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export function assertFixtureLoopback(input) {
  const candidate = input instanceof URL ? input : typeof input === 'string' ? new URL(input) : input?.url ? new URL(input.url) : input;
  const host = String(candidate?.hostname || candidate?.host || 'localhost').replace(/:\d+$/, '');
  if (!allowed.has(host)) throw Object.assign(new Error('Disposable owner-workspace runtime blocked non-loopback network access.'), { code: 'FIXTURE_EXTERNAL_NETWORK_DENIED' });
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { assertFixtureLoopback(input); return originalFetch(input, { ...init, redirect: 'error' }); };
for (const transport of [http, https]) {
  for (const name of ['request', 'get']) {
    const original = transport[name];
    transport[name] = function (input, ...args) { assertFixtureLoopback(input); if (args[0] && typeof args[0] === 'object' && (args[0].host || args[0].hostname)) assertFixtureLoopback(args[0]); return original.call(this, input, ...args); };
  }
}
syncBuiltinESMExports();
