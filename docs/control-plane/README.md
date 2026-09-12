# Control plane

One governed McCluster system with separate edge, data, and execution responsibilities.

- Repo/contracts: `mcclusterishere/mccluster`
- Public Worker: `mccluster`
- Worker source: `workers/mccluster`
- API and remote MCP edge: `https://api.mccluster.org`
- Site: `https://matthew.mccluster.org`
- Authoritative data: Supabase `zmnhbrjyhxzhkxmhkexs`
- Persistent execution plane: OVH **McCluster Core**
- Core contract: [MCCLUSTER-CORE.md](MCCLUSTER-CORE.md)

**There is no Cloudflare Worker named `mccluster-core`.** McCluster Core is the OVH execution plane, not another Worker or source of truth.
