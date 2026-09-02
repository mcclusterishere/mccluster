# Gemini

Read `AGENTS.md` and `CLAUDE.md` first. Same law.

McCluster (`mcclusterishere/mccluster` + Cloudflare Worker `mccluster` + Supabase `zmnhbrjyhxzhkxmhkexs`) is the backend and control plane for every product and every client backend. Do not invent a parallel stack. Do not create a Worker named `mccluster-core`. Do not race git pushes from CI. Ship public pages to `matthew.mccluster.org`. API is `https://api.mccluster.org`.
