import { Agent, getAgentByName, routeAgentRequest } from "agents";
import {
  MAX_KNOWLEDGE_BYTES,
  isKnowledgeContentType,
  knowledgeKey,
  normalizeTenantId,
  tenantSearchInstanceId,
} from "./policy";

type AgentMode = "search" | "answer";

type SearchInput = {
  tenantId: string;
  query: string;
  mode: AgentMode;
};

type SearchChunk = {
  id?: string;
  score?: number;
  text?: string;
  item?: { key?: string; metadata?: Record<string, unknown> };
};

type SearchResult = {
  chunks?: SearchChunk[];
  [key: string]: unknown;
};

interface AiSearchInstance {
  search(input: Record<string, unknown>): Promise<SearchResult>;
  chatCompletions(input: Record<string, unknown>): Promise<unknown>;
}

interface AiSearchNamespace {
  get(id: string): AiSearchInstance;
  create(input: Record<string, unknown>): Promise<AiSearchInstance>;
}

interface Env {
  HereTenantAgent: DurableObjectNamespace<HereTenantAgent>;
  TENANT_CONTENT: R2Bucket;
  AI_SEARCH: AiSearchNamespace;
  EDGE_ADMIN_TOKEN?: string;
  AI_SEARCH_SERVICE_TOKEN_ID?: string;
  R2_BUCKET_NAME: string;
  AI_SEARCH_NAMESPACE: string;
  ALLOWED_ORIGINS?: string;
}

type HereTenantAgentState = {
  tenantId: string | null;
  indexedObjects: number;
  queryCount: number;
  lastIndexedKey: string | null;
  lastQueryAt: string | null;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...headers },
  });
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = new Set(
    String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowed.has(origin) ? origin : null;
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = allowedOrigin(request, env);
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type, x-content-visibility, x-source",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    vary: "Origin",
  };
}

async function tokenDigest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (!env.EDGE_ADMIN_TOKEN) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const [actual, expected] = await Promise.all([
    tokenDigest(supplied),
    tokenDigest(env.EDGE_ADMIN_TOKEN),
  ]);
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.min(actual.length, expected.length); index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

function parseTenantRoute(pathname: string, suffix: string): { tenantId: string; rest: string } | null {
  const match = pathname.match(new RegExp(`^/v1/tenants/([^/]+)/${suffix}(?:/(.*))?$`));
  if (!match) return null;
  return { tenantId: normalizeTenantId(decodeURIComponent(match[1])), rest: decodeURIComponent(match[2] || "") };
}

function publicCatalog(): Record<string, unknown> {
  return {
    service: "HERE tenant knowledge agent",
    purpose: "Store tenant-owned knowledge in R2 and expose isolated retrieval through Cloudflare AI Search.",
    capabilities: [
      "tenant-prefixed R2 knowledge storage",
      "per-tenant AI Search provisioning",
      "hybrid semantic and keyword retrieval",
      "durable per-tenant query and ingestion state",
      "Cloudflare Agent HTTP and WebSocket routing",
    ],
    prohibitedCapabilities: [
      "physical building actuation",
      "door or emergency controls",
      "network device configuration",
      "domain purchases",
      "payment or payout changes",
    ],
    discovery: {
      llms: ["/llms.txt", "/.well-known/llms.txt"],
      agentRoute: "/api/agents/here-tenant-agent/{tenantId}",
      searchRoute: "/v1/tenants/{tenantId}/search",
    },
  };
}

function llmsText(url: URL): string {
  return `# HERE Agent Platform\n\n> Tenant-owned knowledge storage and retrieval for HERE and McCluster client sites.\n\n- Origin: ${url.origin}\n- Capability catalog: ${url.origin}/v1/agent/catalog\n- Knowledge search: POST ${url.origin}/v1/tenants/{tenantId}/search\n- Agent runtime: ${url.origin}/api/agents/here-tenant-agent/{tenantId}\n\nAuthentication is required for tenant data. The agent is intentionally unable to actuate buildings, configure network devices, purchase domains, or move money.\n`;
}

export class HereTenantAgent extends Agent<Env, HereTenantAgentState> {
  initialState: HereTenantAgentState = {
    tenantId: null,
    indexedObjects: 0,
    queryCount: 0,
    lastIndexedKey: null,
    lastQueryAt: null,
  };

  async recordIngest(tenantId: string, key: string): Promise<HereTenantAgentState> {
    const normalized = normalizeTenantId(tenantId);
    const next = {
      ...this.state,
      tenantId: normalized,
      indexedObjects: this.state.indexedObjects + 1,
      lastIndexedKey: key,
    };
    this.setState(next);
    return next;
  }

  async query(input: SearchInput): Promise<unknown> {
    const tenantId = normalizeTenantId(input.tenantId);
    const query = input.query.trim();
    if (!query || query.length > 2_000) throw new Error("query must be 1-2000 characters");

    const instance = this.env.AI_SEARCH.get(tenantSearchInstanceId(tenantId));
    const request = {
      messages: [
        {
          role: "developer",
          content: "Use only this tenant's indexed sources. If the sources do not support an answer, say so clearly.",
        },
        { role: "user", content: query },
      ],
      ai_search_options: {
        retrieval: {
          retrieval_type: "hybrid",
          max_num_results: 8,
          match_threshold: 0.35,
        },
      },
    };

    const result = input.mode === "answer"
      ? await instance.chatCompletions(request)
      : await instance.search(request);

    this.setState({
      ...this.state,
      tenantId,
      queryCount: this.state.queryCount + 1,
      lastQueryAt: new Date().toISOString(),
    });
    return result;
  }

  async onRequest(request: Request): Promise<Response> {
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
    return json({ ok: true, service: "here-tenant-agent", state: this.state });
  }
}

async function handleKnowledgePut(request: Request, env: Env, tenantId: string, path: string): Promise<Response> {
  if (!path) return json({ error: "knowledge object path is required" }, 400);
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  if (!isKnowledgeContentType(contentType)) {
    return json({ error: "unsupported knowledge content type" }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_KNOWLEDGE_BYTES) {
    return json({ error: "knowledge object exceeds 25 MiB" }, 413);
  }
  if (!request.body) return json({ error: "request body is required" }, 400);

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_KNOWLEDGE_BYTES) {
    return json({ error: "knowledge object exceeds 25 MiB" }, 413);
  }

  const key = knowledgeKey(tenantId, path);
  const visibility = request.headers.get("x-content-visibility") === "public" ? "public" : "private";
  const source = (request.headers.get("x-source") || "manual").slice(0, 120);
  const object = await env.TENANT_CONTENT.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: {
      tenant_id: tenantId,
      visibility,
      source,
      indexed: "true",
    },
  });

  const agent = await getAgentByName(env.HereTenantAgent, tenantId);
  await agent.recordIngest(tenantId, key);
  return json({ ok: true, key, etag: object.etag, visibility }, 201);
}

async function provisionSearch(env: Env, tenantId: string): Promise<Response> {
  const input: Record<string, unknown> = {
    id: tenantSearchInstanceId(tenantId),
    type: "r2",
    source: env.R2_BUCKET_NAME,
    source_params: {
      include_items: [`/tenants/${tenantId}/knowledge/**`],
      exclude_items: [`/tenants/${tenantId}/knowledge/drafts/**`],
    },
    index_method: { vector: true, keyword: true },
    fusion_method: "rrf",
    sync_interval: 3600,
    custom_metadata: [
      { field_name: "tenant_id", data_type: "text" },
      { field_name: "visibility", data_type: "text" },
      { field_name: "source", data_type: "text" },
    ],
  };
  if (env.AI_SEARCH_SERVICE_TOKEN_ID) input.token_id = env.AI_SEARCH_SERVICE_TOKEN_ID;

  try {
    await env.AI_SEARCH.create(input);
    return json({ ok: true, instance: input.id, bucket: env.R2_BUCKET_NAME }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({
      error: "AI Search provisioning failed",
      detail: message,
      next: "Create the first R2-backed AI Search instance in the Cloudflare dashboard or provide AI_SEARCH_SERVICE_TOKEN_ID.",
    }, 409);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "here-agent-platform",
        storage: { provider: "cloudflare-r2", bucket: env.R2_BUCKET_NAME },
        search: { provider: "cloudflare-ai-search", namespace: env.AI_SEARCH_NAMESPACE },
        agent: { provider: "cloudflare-agents", durable: true },
      }, 200, cors);
    }
    if (url.pathname === "/v1/agent/catalog") return json(publicCatalog(), 200, cors);
    if (url.pathname === "/llms.txt" || url.pathname === "/.well-known/llms.txt") {
      return new Response(llmsText(url), { headers: { "content-type": "text/plain; charset=utf-8", ...cors } });
    }

    if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401, cors);

    if (url.pathname.startsWith("/api/agents/")) {
      const response = await routeAgentRequest(request, env, { prefix: "/api/agents" });
      return response || json({ error: "agent route not found" }, 404, cors);
    }

    const knowledge = parseTenantRoute(url.pathname, "knowledge");
    if (knowledge && request.method === "PUT") {
      const response = await handleKnowledgePut(request, env, knowledge.tenantId, knowledge.rest);
      for (const [name, value] of Object.entries(cors)) response.headers.set(name, String(value));
      return response;
    }

    const provision = parseTenantRoute(url.pathname, "search/provision");
    if (provision && request.method === "POST") {
      const response = await provisionSearch(env, provision.tenantId);
      for (const [name, value] of Object.entries(cors)) response.headers.set(name, String(value));
      return response;
    }

    const search = parseTenantRoute(url.pathname, "search");
    if (search && request.method === "POST") {
      const body = await request.json<{ query?: string; mode?: AgentMode }>();
      const mode: AgentMode = body.mode === "answer" ? "answer" : "search";
      const agent = await getAgentByName(env.HereTenantAgent, search.tenantId);
      try {
        const result = await agent.query({ tenantId: search.tenantId, query: String(body.query || ""), mode });
        return json({ ok: true, mode, result }, 200, cors);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return json({ error: "tenant search failed", detail }, 502, cors);
      }
    }

    return json({ error: "not found" }, 404, cors);
  },
} satisfies ExportedHandler<Env>;
