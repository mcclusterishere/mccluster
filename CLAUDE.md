# Claude / Codex / Cursor — stop

You are in the McCluster ecosystem.

1. Read `AGENTS.md` completely before any edit.
2. Read `docs/control-plane/ECOSYSTEM.md` if this is the control repo (`mcclusterishere/mccluster`).
3. Read `docs/control-plane/AI-HARNESS.md` before AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company work.
4. **McCluster is the backend and the control plane.** GitHub `mcclusterishere/mccluster` + Cloudflare Worker `mccluster` + Supabase `zmnhbrjyhxzhkxmhkexs`.
5. This repo is either the plane or a satellite. Satellites do not grow a second auth, database, social, billing, Worker, admin stack, CRM, vector store, conversation database, or memory service.
6. Private cross-model context lives in Supabase schema `ai_context`. Do not commit raw Claude, ChatGPT, Grok, Gemini, Copilot, local-model, or other AI transcripts into public Git. When an adapter is available, ingest and retrieve through the canonical McCluster context plane.
7. Do not auto-push GitHub Actions onto feature branches.
8. Do not rewrite `index.html` or revive rejected visual systems.
9. If you were about to create a new backend or a Worker named `mccluster-core`: stop. That Worker does not exist. The only Worker is `mccluster`.

Public edge: `https://matthew.mccluster.org` (apex `mccluster.org` is the same property).
API Worker: `mccluster` on `https://api.mccluster.org`.
Source: `workers/mccluster`.

10. **Never draw a logo.** The artwork the owner supplies is the only source of truth for any mark, forever. Do not trace it, approximate it, recolour it, or add a plate or tile it does not already contain. Cropping a supplied file is fine; adding a shape is drawing. If the variant you need does not exist, ask. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO DRAW".
11. **`mcclusterishere/Here` is the old repo and publishes nothing.** Do not write to it. If a task looks like it belongs there, say so in the chat and work in this repo instead.
