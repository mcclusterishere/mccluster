/* How Equity Fighter reaches the McCluster AI Harness: MCP tools/call, over
   one of two transports. Both end in the same Core tool broker, so the
   catalog, the dispatch layer's routing and gates, control_approvals and
   ai_context.decisions are the same whichever is used.

   edge (default)  POST https://api.mccluster.org/v1/core/mcp with the
                   owner's Supabase session bearer. Worker mccluster /
                   mccluster-mcp checks the house-owner membership, stamps
                   the actor and forces the house org. Equity Fighter cannot
                   name an actor on this path at all.
   core            POST <CORE_BROKER_URL>/mcp with CORE_BROKER_TOKEN plus a
                   fresh mccluster-edge/v1 HMAC signature
                   (core/src/broker-edge-auth.mjs), the same machine hop the
                   approved transport edge workers/mccluster-mcp uses. For a
                   gateway co-located with Core on OVH. The owner actor rides
                   in params._meta['mccluster/actor'] exactly as
                   mccluster-mcp sends it, and only after this gateway has
                   matched the sender to a paired/allowlisted owner identity.

   Whatever the transport, this client calls ONLY the tools in
   ALLOWED_TOOLS. Equity Fighter cannot reach code.build, deploy.preview,
   site.edit or anything else directly; those exist only behind
   dispatch.turn's catalog gate. */

import { hmacSha256, randomId, sha256Base64Url, toBase64Url } from '../crypto.js';
import type { OwnerActor } from '../types.js';
import { decide, PolicyDeniedError, type PolicyContext } from '../policy/approval-policy.js';

export const DEFAULT_EDGE_MCP_URL = 'https://api.mccluster.org/v1/core/mcp';
export const EDGE_PROTOCOL = 'mccluster-edge/v1';
const EDGE_LABEL = 'MCCLUSTER-EDGE-V1';

/** The complete list of harness tools this gateway may call. */
export const ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'dispatch.turn',
  'dispatch.get',
  'dispatch.execute',
  'ai.chat',
  'compute.task.get',
]);

export type HarnessTransport =
  | { kind: 'edge'; url: string; ownerAccessToken: string; timeoutMs: number }
  | { kind: 'core'; baseUrl: string; token: string; signingKey: string; timeoutMs: number };

export class HarnessError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'HarnessError';
    this.status = status;
    this.code = code;
  }
}

export function canonicalEdgeRequest(parts: { method: string; path: string; timestamp: string; nonce: string; digest: string }): string {
  return [EDGE_LABEL, parts.method.toUpperCase(), parts.path, parts.timestamp, parts.nonce, parts.digest].join('\n');
}

export async function signEdgeHeaders(
  secret: string,
  method: string,
  path: string,
  bodyBytes: Uint8Array,
  now: () => Date = () => new Date(),
  nonce: () => string = randomId,
): Promise<Record<string, string>> {
  if (!secret) throw new HarnessError('Core edge signing key is not configured', 503);
  const timestamp = now().toISOString();
  const n = nonce();
  const digest = await sha256Base64Url(bodyBytes);
  const signature = toBase64Url(await hmacSha256(secret, canonicalEdgeRequest({ method, path, timestamp, nonce: n, digest })));
  return {
    'x-mccluster-edge-protocol': EDGE_PROTOCOL,
    'x-mccluster-timestamp': timestamp,
    'x-mccluster-nonce': n,
    'x-mccluster-content-sha256': digest,
    'x-mccluster-signature': signature,
  };
}

export function requireHttps(raw: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw || ''));
  } catch {
    throw new HarnessError(`${what} is not configured`, 503);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw new HarnessError(`${what} must be HTTPS`, 503);
  return url;
}

export interface HarnessClient {
  readonly transport: HarnessTransport['kind'];
  /** Every call names its policy context; src/policy/approval-policy.ts decides before any byte leaves. */
  callTool(name: string, args: Record<string, unknown>, actor: OwnerActor, policy: PolicyContext): Promise<unknown>;
}

export function createHarnessClient(transport: HarnessTransport, fetchImpl: typeof fetch = fetch): HarnessClient {
  let endpoint: URL;
  if (transport.kind === 'edge') {
    endpoint = requireHttps(transport.url, 'Harness MCP URL');
    if (!transport.ownerAccessToken) throw new HarnessError('Owner session token is not configured', 503);
  } else {
    endpoint = requireHttps(`${String(transport.baseUrl || '').replace(/\/+$/, '')}/mcp`, 'Core broker URL');
    if (!transport.token) throw new HarnessError('Core broker credential is not configured', 503);
    if (!transport.signingKey) throw new HarnessError('Core edge signing key is not configured', 503);
  }

  return {
    transport: transport.kind,
    async callTool(name, args, actor, policy) {
      if (!ALLOWED_TOOLS.has(name)) throw new HarnessError(`Equity Fighter may not call ${name}`, 403, 'EF_TOOL_NOT_ALLOWED');
      const verdict = decide(name, policy);
      if (!verdict.allow) throw new PolicyDeniedError(name, verdict);
      const params: Record<string, unknown> = { name, arguments: args };
      if (transport.kind === 'core') {
        params._meta = { 'mccluster/actor': { user_id: actor.user_id, kind: 'owner', source: `equity-fighter:${actor.via.platform}` } };
      }
      const bodyBytes = new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: randomId(), method: 'tools/call', params }));
      const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
      if (transport.kind === 'edge') {
        headers.authorization = `Bearer ${transport.ownerAccessToken}`;
      } else {
        headers.authorization = `Bearer ${transport.token}`;
        Object.assign(headers, await signEdgeHeaders(transport.signingKey, 'POST', endpoint.pathname, bodyBytes));
      }
      let res: Response;
      try {
        res = await fetchImpl(endpoint.toString(), { method: 'POST', headers, body: bodyBytes, signal: AbortSignal.timeout(transport.timeoutMs) });
      } catch (error) {
        const n = (error as { name?: string })?.name;
        throw new HarnessError(n === 'TimeoutError' || n === 'AbortError' ? 'The harness did not respond in time' : 'The harness is unreachable', 504);
      }
      const text = await res.text();
      let body: any;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        throw new HarnessError('The harness returned a non-JSON response', 502);
      }
      if (!res.ok) {
        const msg = body?.error?.message || body?.error || `The harness rejected the request (${res.status})`;
        // 401/403 is this gateway's own credential being refused: configuration, not the owner.
        throw new HarnessError(String(msg), res.status === 401 || res.status === 403 ? 502 : res.status, body?.code ?? null);
      }
      if (body?.error) throw new HarnessError(String(body.error?.message || 'Harness MCP error'), 502, String(body.error?.code ?? ''));
      return unwrapMcpResult(body?.result);
    },
  };
}

/** Core answers tools/call as MCP text content holding JSON; isError carries {error, code, status}. */
export function unwrapMcpResult(result: any): unknown {
  if (!result || typeof result !== 'object') throw new HarnessError('The harness returned an empty tool result', 502);
  const text = Array.isArray(result.content) ? result.content.find((c: any) => c?.type === 'text')?.text : undefined;
  let parsed: any = result.structuredContent ?? undefined;
  if (parsed === undefined && typeof text === 'string') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { text };
    }
  }
  if (result.isError) {
    throw new HarnessError(String(parsed?.error || 'Harness tool call failed'), Number(parsed?.status) || 502, parsed?.code ?? null);
  }
  return parsed ?? {};
}
