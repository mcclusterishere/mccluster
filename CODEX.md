# Codex — McCluster

Read `AGENTS.md` first. Completely. Read `docs/control-plane/AI-HARNESS.md` before AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company work.

You are in the McCluster ecosystem. GitHub `mcclusterishere/mccluster` owns the contracts; Cloudflare Worker `mccluster` is the public API/MCP edge; Supabase `zmnhbrjyhxzhkxmhkexs` is the authoritative data plane; OVH **McCluster Core** is the persistent execution plane.

Private cross-model context lives in Supabase schema `ai_context`. Do not commit raw ChatGPT, Claude, Grok, Gemini, Copilot, local-model, or other AI transcripts into public Git. All providers are replaceable adapters to the same McCluster context plane. Do not create a shadow vector store, second conversation database, separate memory service, or competing context source.

Satellites do not grow a second auth, database, social scheduler, billing, Worker, admin, CRM, or AI memory stack. Public edge is `matthew.mccluster.org` (apex `mccluster.org` aliases it). API is Worker `mccluster` on `api.mccluster.org`.

There is no Worker named `mccluster-core`. Do not create one. **McCluster Core is still canonical as the OVH execution plane, not a Worker.** It may run Halo, persistent agents, schedulers, queue consumers, builds, controlled code execution, caches, and machine-level MCP tools. It must use canonical Worker/Supabase contracts and must not create shadow state. Read `docs/control-plane/MCCLUSTER-CORE.md`.

Client social is a McCluster service. If you were about to create a new backend: stop.

## Never draw a logo

The artwork the owner supplies is the only source of truth for any mark,
forever. Do not trace, approximate, reconstruct, recolour, or composite one —
not as a placeholder, not "until the real one arrives", not at a size where
you think it will not matter. Cropping a supplied file is fine; adding a
shape it does not contain is drawing. If the variant you need does not
exist, ask for it.

An agent shipped a hand-drawn `we-icon.svg` into three repositories once and
it had to be torn out of four. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO
DRAW" for the supplied Whip Equipped kit.

## mcclusterishere/Here is dead

It publishes nothing — deploy workflows disabled, no CNAME. Do not write to
it. If a task looks like it belongs there, say so in the chat and work in
`mcclusterishere/mccluster` instead.
