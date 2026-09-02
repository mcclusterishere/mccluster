# Claude / Codex / Cursor — stop

You are in the McCluster ecosystem.

1. Read `AGENTS.md` completely before any edit.
2. Read `docs/control-plane/ECOSYSTEM.md` if this is the control repo (`mcclusterishere/mccluster`).
3. **McCluster is the backend and the control plane.** GitHub `mcclusterishere/mccluster` + Cloudflare Worker `mccluster` + Supabase `zmnhbrjyhxzhkxmhkexs`.
4. This repo is either the plane or a satellite. Satellites do not grow a second auth, database, social, billing, Worker, or admin stack.
5. Do not auto-push GitHub Actions onto feature branches.
6. Do not rewrite `index.html` or revive rejected visual systems.
7. If you were about to create a new backend or a Worker named `mccluster-core`: stop. That Worker does not exist. The only Worker is `mccluster`.

Public edge: `https://matthew.mccluster.org` (apex `mccluster.org` is the same property).
API Worker: `mccluster` on `https://api.mccluster.org`.
Source: `workers/mccluster`.
