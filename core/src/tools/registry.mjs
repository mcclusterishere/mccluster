import { callMcpTool, listMcpTools } from './mcp-http.mjs';
import { callHttpTool } from './http.mjs';
import { callComputeTool, discoverComputeTools } from './compute.mjs';

const NAME = /^[a-zA-Z0-9_.:-]{1,160}$/;
const CACHE_TTL_MS = Number(process.env.CORE_TOOL_CACHE_TTL_MS || 60_000);

const BUILTIN_MCP_SERVERS = [
  {
    id: 'mccluster-media',
    namespace: 'mccluster',
    url: 'https://api.mccluster.org/v1/media/mcp',
    protocolVersion: '2026-07-28',
    bearerEnv: 'MCCLUSTER_API_BEARER'
  }
];

const BUILTIN_HTTP_TOOLS = [
  {
    name: 'mccluster.health',
    title: 'McCluster API health',
    description: 'Read the public health state of the canonical McCluster Worker.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    request: {
      method: 'GET',
      url: 'https://api.mccluster.org/health'
    }
  }
];

function parseJsonEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) { throw new Error(`${name} is not valid JSON: ${error.message}`); }
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`);
  return parsed;
}

function normalizeServer(server) {
  if (!server?.id || !NAME.test(server.id)) throw new Error('MCP server id is invalid');
  if (!server?.url) throw new Error(`MCP server ${server.id} has no url`);
  const namespace = server.namespace || server.id;
  if (!NAME.test(namespace)) throw new Error(`MCP server namespace is invalid: ${namespace}`);
  return { ...server, namespace };
}

function normalizeHttpTool(tool) {
  if (!tool?.name || !NAME.test(tool.name)) throw new Error('HTTP tool name is invalid');
  if (!tool?.request?.url) throw new Error(`HTTP tool ${tool.name} has no request.url`);
  return {
    title: tool.title || tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    ...tool,
    transport: 'http'
  };
}

function publicMcpName(server, remoteName) {
  const combined = `${server.namespace}.${remoteName}`;
  if (!NAME.test(combined)) throw new Error(`Remote MCP tool name is unsafe: ${combined}`);
  return combined;
}

function addRecord(records, record) {
  if (!record?.name || !NAME.test(record.name)) throw new Error(`Tool name is invalid: ${record?.name || ''}`);
  if (records.has(record.name)) throw new Error(`Duplicate tool name: ${record.name}`);
  records.set(record.name, record);
}

export class ToolRegistry {
  constructor({ mcpServers, httpTools, computeDiscovery = discoverComputeTools } = {}) {
    this.mcpServers = (mcpServers || [
      ...BUILTIN_MCP_SERVERS,
      ...parseJsonEnv('CORE_MCP_SERVERS_JSON')
    ]).map(normalizeServer);
    this.httpTools = (httpTools || [
      ...BUILTIN_HTTP_TOOLS,
      ...parseJsonEnv('CORE_HTTP_TOOLS_JSON')
    ]).map(normalizeHttpTool);
    this.computeDiscovery = computeDiscovery;
    this.cache = null;
    this.cacheAt = 0;
  }

  async refresh({ force = false } = {}) {
    if (!force && this.cache && Date.now() - this.cacheAt < CACHE_TTL_MS) return this.cache;

    const records = new Map();
    const diagnostics = [];

    for (const tool of this.httpTools) {
      addRecord(records, {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        transport: 'http',
        target: tool
      });
    }

    for (const server of this.mcpServers) {
      try {
        const tools = await listMcpTools(server);
        for (const remote of tools) {
          if (!remote?.name) continue;
          const name = publicMcpName(server, remote.name);
          addRecord(records, {
            name,
            title: remote.title || remote.name,
            description: remote.description || '',
            inputSchema: remote.inputSchema || { type: 'object', properties: {} },
            outputSchema: remote.outputSchema,
            transport: 'mcp-http',
            serverId: server.id,
            remoteName: remote.name,
            target: { server, remote }
          });
        }
        diagnostics.push({ id: server.id, transport: 'mcp-http', ok: true, tools: tools.length });
      } catch (error) {
        diagnostics.push({ id: server.id, transport: 'mcp-http', ok: false, error: error.message });
      }
    }

    if (this.computeDiscovery) {
      try {
        const discovered = await this.computeDiscovery();
        for (const tool of discovered.tools || []) addRecord(records, tool);
        if (discovered.diagnostic) diagnostics.push(discovered.diagnostic);
      } catch (error) {
        diagnostics.push({ id: 'mccluster-compute', transport: 'compute', ok: false, error: error.message });
      }
    }

    this.cache = { records, diagnostics, refreshedAt: new Date().toISOString() };
    this.cacheAt = Date.now();
    return this.cache;
  }

  async list(options) {
    const snapshot = await this.refresh(options);
    return {
      tools: [...snapshot.records.values()].map(({ target, ...tool }) => tool),
      diagnostics: snapshot.diagnostics,
      refreshedAt: snapshot.refreshedAt
    };
  }

  async call(name, args = {}, options = {}) {
    if (!NAME.test(name || '')) throw new Error('Tool name is invalid');
    let snapshot = await this.refresh();
    let record = snapshot.records.get(name);
    if (!record) {
      snapshot = await this.refresh({ force: true });
      record = snapshot.records.get(name);
    }
    if (!record) throw new Error(`Unknown tool: ${name}`);

    const startedAt = Date.now();
    let result;
    if (record.transport === 'http') {
      result = await callHttpTool(record.target, args);
    } else if (record.transport === 'mcp-http') {
      result = await callMcpTool(record.target.server, record.remoteName, args);
    } else if (record.transport === 'compute') {
      result = await callComputeTool(record.target, args, options);
    } else {
      throw new Error(`Unsupported transport: ${record.transport}`);
    }

    return {
      tool: name,
      transport: record.transport,
      durationMs: Date.now() - startedAt,
      result
    };
  }
}

export function createToolRegistry(options) {
  return new ToolRegistry(options);
}
