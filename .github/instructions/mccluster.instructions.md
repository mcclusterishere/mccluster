---
applyTo: "**"
---

This repository is part of the McCluster control plane. Canonical backend is GitHub `mcclusterishere/mccluster`, Cloudflare Worker `mccluster`, and Supabase `zmnhbrjyhxzhkxmhkexs`. There is no Worker named `mccluster-core`. Do not create one. McCluster Core is the canonical OVH persistent execution plane, not a Worker; read `docs/control-plane/MCCLUSTER-CORE.md`. Do not scaffold a parallel API, auth provider, database, CRM, memory store, or source of truth. Core workloads must use canonical Worker/Supabase contracts. Public site is `matthew.mccluster.org`. API is `https://api.mccluster.org`. Read `AGENTS.md` before editing. Do not auto-push CI onto feature branches. Do not overwrite shipping UI unless the owner named that file.
