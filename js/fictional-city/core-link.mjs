// Optional owner-authenticated read-through to the existing McCluster Core MCP bridge.
// Static fiction remains playable while Core is unavailable or on a different release.
// Neither this adapter nor the static file grants access to private memory or the city page.
export function unwrapLore(rpc) {
  if (rpc?.error || rpc?.result?.isError) throw new Error('Core lore read unavailable');
  let value = rpc?.result;
  const text = value?.content?.find(c => c.type === 'text')?.text;
  if (text) value = JSON.parse(text);
  for (let depth = 0; depth < 4 && value?.result && typeof value.result === 'object'; depth++) value = value.result;
  if (!value?.manifest?.sha256 || value.read_only !== true) throw new Error('Core lore response invalid');
  return value;
}
export async function manifestDigest(text, subtle = globalThis.crypto?.subtle) {
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createCoreLoreLink({ api, expected, session, timeoutMs = 4500 }) {
  let status = 'unchecked', count = 0, disabled = false;
  const initialSession = session();
  const sameOwnerSession = () => !disabled && session() === initialSession && Boolean(initialSession);
  async function read(args) {
    if (!sameOwnerSession()) throw new Error('Owner session changed');
    let timer;
    const budget = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Core lore deadline')), timeoutMs); });
    try {
      const operation = Promise.resolve(api('/v1/core/mcp', {
        method: 'POST', body: { jsonrpc: '2.0', id: 'city-lore-' + (++count), method: 'tools/call',
          params: { name: 'game.lore.read', arguments: { universe_id: expected.id, ...args } } }
      })).then(async response => {
        if (typeof response?.json !== 'function') return response;
        if (!response.ok) throw new Error('Core lore request denied');
        return response.json();
      });
      const rpc = await Promise.race([operation, budget]);
      if (!sameOwnerSession()) throw new Error('Owner session changed');
      const result = unwrapLore(rpc);
      if (result.manifest.id !== expected.id || result.manifest.revision !== expected.revision || result.manifest.sha256 !== expected.sha256) {
        status = 'different-release'; throw new Error('Core lore release differs');
      }
      status = 'connected'; return result;
    } finally { clearTimeout(timer); }
  }
  return {
    status: () => status,
    async connect() {
      if (!expected.sha256 || typeof api !== 'function') { status = 'unavailable'; return false; }
      try { await read({ section: 'manifest' }); return true; }
      catch { if (!disabled && status !== 'different-release') status = 'unavailable'; return false; }
    },
    async resident(id) {
      if (status !== 'connected') return null;
      try { const result = await read({ section: 'npcs', id }); return result.records?.[0] || null; }
      catch { if (!disabled && status !== 'different-release') status = 'unavailable'; return null; }
    },
    dispose() { disabled = true; status = 'closed'; }
  };
}
