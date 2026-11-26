// STAGING SKELETON. Not imported by workers/mccluster, not deployed, no route.
// Pure host -> tenant routing for the Equity Uprise owner model, so the decision table can be
// reviewed and tested before any of it moves into workers/mccluster/src/platform/router.js
// (which already implements stage F when platform.origin flips; this file only shows the shape).

export function indexHosts(registry) {
  const map = new Map();
  const add = (host, entry) => map.set(host.toLowerCase(), entry);
  const owner = registry.owner;
  for (const h of owner.hosts) add(h, { role: 'owner', key: owner.key, canonical: true });
  for (const h of owner.aliases || []) add(h, { role: 'owner', key: owner.key, canonical: false, to: owner.hosts[0] });
  for (const t of registry.tenants) {
    for (const h of t.hosts) add(h, { role: 'tenant', key: t.key, canonical: true, tenant: t });
    for (const h of t.aliases || []) add(h, { role: 'tenant', key: t.key, canonical: false, to: t.hosts[0] });
  }
  for (const d of registry.legacy_doors || []) {
    for (const h of [d.host, ...(d.aliases || [])]) add(h, { role: 'door', key: d.host, canonical: false, to: owner.hosts[0] });
  }
  return map;
}

// Returns { kind: 'serve' | 'redirect' | 'pass', tenant, location?, status? }
export function route(urlString, registry, hostIndex = indexHosts(registry)) {
  const url = new URL(urlString);
  const entry = hostIndex.get(url.hostname.toLowerCase());
  if (!entry) return { kind: 'pass', tenant: null };
  const ownerOrigin = `https://${registry.owner.hosts[0]}`;
  const tail = url.pathname + url.search;
  if (!entry.canonical) return { kind: 'redirect', status: 301, tenant: entry.key, location: `https://${entry.to}${tail}` };
  if (entry.role === 'owner') return { kind: 'serve', tenant: entry.key, path: url.pathname === '/' ? '/' : url.pathname };
  const t = entry.tenant;
  if (t.own_paths) {
    const owns = url.pathname === '/' || t.own_paths.some((p) => (p.endsWith('/') ? url.pathname.startsWith(p) : url.pathname === p));
    if (!owns) return { kind: 'redirect', status: 301, tenant: t.key, location: ownerOrigin + tail };
    return { kind: 'serve', tenant: t.key, path: url.pathname === '/' ? t.root : url.pathname };
  }
  return { kind: 'serve', tenant: t.key, path: url.pathname === '/' ? t.root : url.pathname };
}
