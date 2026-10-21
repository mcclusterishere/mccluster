---
applyTo: "**"
---

This repository is part of the McCluster control plane. Canonical backend is GitHub `mcclusterishere/mccluster`, Cloudflare Worker `mccluster`, and Supabase `zmnhbrjyhxzhkxmhkexs`. There is no Worker named `mccluster-core`. Do not create one. Do not scaffold a parallel API, auth provider, or database. Public properties are distinct: `matthew.mccluster.org` is Matthew McCluster's personal property; `mccluster.org` is McCluster Corp's company property served by Worker `mccluster` by host once routed. Never collapse them. API is `https://api.mccluster.org`. Read `AGENTS.md` before editing. Do not auto-push CI onto feature branches. Do not overwrite shipping UI unless the owner named that file.
