# Gemini

Read `AGENTS.md`, `CLAUDE.md`, and `docs/control-plane/AI-HARNESS.md` first. Same law.

McCluster (`mcclusterishere/mccluster` + Cloudflare Worker `mccluster` + Supabase `zmnhbrjyhxzhkxmhkexs`) is the backend and control plane for every product and every client backend. Do not invent a parallel stack. Do not create a Worker named `mccluster-core`. Do not race git pushes from CI. Ship public pages to `matthew.mccluster.org`. API is `https://api.mccluster.org`.

Private cross-model context lives in Supabase schema `ai_context`. Do not commit raw ChatGPT, Claude, Grok, Gemini, Copilot, local-model, or other AI transcripts into public Git. Treat every model as a replaceable adapter to the canonical McCluster context plane. Do not create a second conversation database, vector store, memory service, CRM, or competing context source.

## Never draw a logo

The artwork the owner supplies is the only source of truth for any mark,
forever. Do not trace, approximate, reconstruct, recolour, or composite one —
not as a placeholder, not "until the real one arrives", not at a size where
you think it will not matter. Do not crop supplied artwork. Scale the complete supplied artwork proportionally only. adding a
shape it does not contain is drawing. If the variant you need does not
exist, ask for it.

An agent shipped a hand-drawn `we-icon.svg` into three repositories once and
it had to be torn out of four. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO DRAW" for the supplied Whip Equipped kit.

## mcclusterishere/Here is dead

It publishes nothing — deploy workflows disabled, no CNAME. Do not write to
it. If a task looks like it belongs there, say so in the chat and work in
`mcclusterishere/mccluster` instead.


## EQUITY UPRISE BUILDING / 360 / SPATIAL AUTHORITY — MANDATORY

For **any Equity Uprise task involving geometry, architecture, floors, rooms, building imagery, 360 panoramas, environmental rendering, physical navigation, spatial transitions, or spatial lore/worldbuilding**, you MUST read:

`docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md`

before designing, generating, rendering, coding, or describing the environment.

That authority file points to the required repo audit, locked six-floor building inventory, floor-specific builder/360 specs, schematic-plan basis, and canonical PNG/SVG/DXF plan references.

Non-negotiable:
- generated images are never geometry authority;
- floor/core geometry may not drift between renders;
- Floor 1 establishes the fixed 72' × 72' shell/core datum currently used for building coordination;
- elevator, stairs, risers and structural coordination remain vertically aligned;
- Floor 1 is the only public exterior entrance under the current locked scheme;
- do not invent rooms/floors/departments as canonical lore when they are not supported by the audited Equity Uprise program;
- if a floor does not yet have a reviewed floor-specific builder/360 spec, write/review that spec before generating its production imagery.

Do not confuse the six-floor Equity Uprise building with the separate `docs/uprise-world/` Living Sketch / Uprise World project. Each retains its own authority unless the owner explicitly requests a crossover.
