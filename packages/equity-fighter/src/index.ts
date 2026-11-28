/* Equity Fighter public entry. createFromEnv wires the real harness clients;
   tests wire mocks through createGateway directly. */

import { buildAdapters } from './adapters/index.js';
import { loadConfig, type Env } from './config.js';
import { createGateway, type Gateway, type GatewayDeps } from './gateway.js';
import { createHarnessClient } from './harness/mcp-client.js';
import { createDispatchClient } from './harness/dispatch.js';
import { createEquityNetClient } from './harness/equitynet.js';
import { createSupabaseStore } from './harness/store.js';

export * from './types.js';
export { loadConfig, publicStatus, type GatewayConfig, type Env } from './config.js';
export { createGateway, summarize, type Gateway, type GatewayDeps } from './gateway.js';
export { createHarnessClient, signEdgeHeaders, canonicalEdgeRequest, unwrapMcpResult, HarnessError, ALLOWED_TOOLS, DEFAULT_EDGE_MCP_URL, type HarnessTransport } from './harness/mcp-client.js';
export { createDispatchClient, normalizeTurn, messageIdFor, DISPATCH_TOOLS, type DispatchClient } from './harness/dispatch.js';
export { pairingCode, verifyPairingCode } from './pairing.js';
export { createEquityNetClient, chatText, type EquityNetClient } from './harness/equitynet.js';
export { createSupabaseStore, type GatewayStore } from './harness/store.js';
export * from './adapters/index.js';

export interface FromEnvResult {
  gateway: Gateway | null;
  config: ReturnType<typeof loadConfig>;
}

/** Returns gateway null (and the reasons) when the gateway is off or incomplete. */
export function createFromEnv(env: Env, extra: Pick<GatewayDeps, 'waitUntil' | 'log'> = {}): FromEnvResult {
  const config = loadConfig(env);
  if (!config.enabled) return { gateway: null, config };
  const harness = createHarnessClient(config.harness);
  const gateway = createGateway({
    config,
    adapters: buildAdapters(config),
    store: createSupabaseStore(config.supabase),
    dispatch: createDispatchClient(harness, { orgId: config.orgId, threadId: config.threadId }),
    equitynet: createEquityNetClient(harness, { orgId: config.orgId }),
    ...extra,
  });
  return { gateway, config };
}
