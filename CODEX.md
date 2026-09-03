# Codex — McCluster

Read `AGENTS.md` first. Completely.

You are in the McCluster ecosystem. The GitHub repository `mcclusterishere/mccluster` and the Cloudflare Worker `mccluster` are the backend AND the control plane. Supabase project `zmnhbrjyhxzhkxmhkexs` is the shared data plane.

Satellites do not grow a second auth, database, social scheduler, billing, Worker, or admin. Public edge is `matthew.mccluster.org` (apex `mccluster.org` aliases it). API is Worker `mccluster` on `api.mccluster.org`.

There is no Worker named `mccluster-core`. Do not create one.

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
