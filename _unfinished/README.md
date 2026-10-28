# Not finished, not deployed

Work that is kept but deliberately kept OFF the live site. The deploy
workflow strips this whole directory out of the published tree
(`.github/workflows/deploy-pages.yml`, "Strip the internals" step), the
same way it strips `docs/`, `supabase/` and `scripts/`.

Nothing here is deleted. It is all in git history and on this branch —
it just never reaches a visitor.

## site0-game/

**The PRIM3 Site 0 build.** Recovered from the Kimi share link on
2026-08-19, mirrored whole, and made to run offline with no CDN and no
dependence on that link staying alive.

Three pieces: the Interactive Design Bible, a **playable FPS build**
(*"L1 Center Drive-Through · Three-Agent Test"* — walk, drive, taxi a
plane), and a navigable Gaussian-splat world viewer for L3 and B3. The
model behind the game is 183 named meshes across all nine levels.

Verified running: zero failed requests, zero page errors.

`site0-game/README.md` has the section test on the floor plates — the
L1/L2 void is already correct; what is wrong is that B3 and B5 cover only
a third of the building while B2 and B4 hang outside the hull — and the
programme mismatch between this build's B-levels and the repo's own
master.

## shake-shop/

The campus shake delivery run — storefront, runner's desk, menu data and
the spatial-stage scaffold. Shelved on 2026-08-19 at the owner's request:
"tuck away the shake shop for a rainy day." It was not broken, it was
never opened — 0 delivery stops configured and `STRIPE_SK` unset, so the
sign always said CLOSED and no order could ever be taken.

The fifth tab it used to hold now opens McCluster Sites.

**The money is not here, and was not deleted.** The pricing law, the RLS
and the ordering endpoint stay where they were:

- `supabase/migrations/` — the schema, its policies, and the function
  surface hardening
- `supabase/functions/shake-order/` — the edge function that recomputes
  every cent server-side, and `price.ts` under its 19 tests

None of that is served to a browser, so leaving it in place costs the
live site nothing and means the shop can be un-shelved without rebuilding
the part that took the most care to get right.

To bring it back: move the files out (pages to the repo root, `shakes.css`
to `css/`, the two scripts to `js/`, the two JSON files to `data/`),
repoint the fifth tab in `js/tabbar.js`, restore the sitemap entry and the
`Disallow: /shake-desk.html` line in `robots.txt`, and restore the shop
block in `scripts/smoke.mjs` — it is marked in place where it was cut.
Configure a delivery stop and set `STRIPE_SK` before announcing it.

## uprise-world/

**Legacy R&D artifact — intentionally frozen, not an active product backlog.**

Uprise World was an interactive Equity Uprise world experiment. The owner
pulled it off the site on 2026-08-18 rather than leave a broken room where
a visitor could walk into it, and on 2026-10-05 reclassified it as a legacy
experiment worth preserving for the cost and product lessons.

The source stays intact because the experiment contains reusable evidence:
the spherical locomotion prototype, landmark/check-in model, mobile/WebGL
constraints, visual-reference work, and the documented path that led the
team toward a world before the core user loop had been validated.

**Do not resume implementation from the historical roadmap.** Before any
revival, read `docs/uprise-world/LEGACY-EXPERIMENT-RETROSPECTIVE.md` and
produce a new product brief that proves the user job, the smallest repeatable
loop, retention/progression need, and why richer spatial representation is
actually required. A revival must start from current product needs, not from
the sunk cost or old phase numbering.

Moved intact: the two pages, the seven scripts and the data file. They are
preservation material, not a release candidate. Do NOT simply un-strip the
directory — pages here have no cache-busting stamp applied and no smoke
coverage, because the release gate does not walk them either.

## travel-desk.html, asset-lab.html (and the lab-landmark / lab-props aliases)

Shelved 2026-10-27 by the ghost-backend audit. Both pages were on the
live site and both spoke to backends that do not exist:

- `travel-desk.html` is the owner console for `/api/travel/*`, the
  Roadshow Worker that was sketched as a loose `workers/travel-quote.js`
  and never deployed (no wrangler config, no route; relative `/api/...`
  cannot exist on GitHub Pages). The sketch is deleted from the tree (it
  is in git history), and `js/roadshow.js` on hire.html is the door only:
  it no longer fetches a quote that always 404'd.
- `asset-lab.html` is the HERE 3D Asset Lab client for the archived
  `apps/api` origin (`/api/v1/status`, `/api/v1/3d/*`). `lab-landmark.html`
  and `lab-props.html` were legacy aliases whose only destination was that
  page, so they came along and their rows left `data/legacy-page-routes.json`.

To bring either back: move the page to the repo root, deploy the backend it
talks to (or point it at a route the `mccluster` Worker actually serves),
restore the Studio entry in `js/site-navigation.js` and the `assetLab`
bridge in `js/control-room-v2.js`, and regenerate `redirects/` with
`node tools/build-redirects.mjs`.
