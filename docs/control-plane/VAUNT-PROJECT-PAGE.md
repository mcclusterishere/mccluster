# Vaunt creator project and public profile shell

This is a local implementation proposed for review, not a deployed profile or a
company account. The route is `front.html?project=vaunt` on Matthew's property.
Matthew McCluster manages its repository content. No auth identity, company
ownership, membership, grant, endorsement, database profile or access is created.

## Identified content and spelling

The requested second, third and fourth experiences are not array indices. On base
`16bf23358b742b47f6c77138701f59465dfed34f`, `index.html#work` contains:

| Order | Stable element | Content source |
| --- | --- | --- |
| 1 | `cmdCanvas5` | `assets/frames/vauntlive_0001.webp` through `0161.webp`, also `sm/`; runway performance and takeoff |
| 2 | `workVR` / `workVRCanvas` | `assets/video/vaunt-360.mp4`, `assets/img/vaunt-360-poster.jpg`; explicit Allow/Cancel, hold, drag, Land, Back and Escape |
| 3 | `cmdCanvas4` | `assets/frames/vaunt_0001.webp` through `0161.webp`, also `sm/`; sky-to-cockpit fly-through |

`js/main.js` supplies sequence order, scroll speeds and the cabin's 0.40–0.50
band. `assets/frames/manifest.json` supplies frame counts. The existing page uses
Who Did The Shoot as its continuous soundtrack; the project preserves that
choice rather than silently replacing it with a Vaunt track. The Vaunt EP remains
in `data/albums.json` (`vaunt-ep`, Vaunt (Acoustic), `assets/audio/vaunt.mp3`),
reachable through the existing `album.html?album=vaunt-ep` player. No new Lowkey
album or attribution has been invented.

Vaunt spelling is consistent in the existing supplied logo, asset names,
referral URL and catalog. The brand's own https://www.flyvaunt.com/ and
https://www.flyvaunt.com/about-us/ also use Vaunt (checked 2026-10-26). No asset
was renamed or redrawn. This supports the spelling, not a partnership claim.

## Implementation and compatibility

- `js/front-projects.js` is an immutable registry of repository-managed project
  content. It feeds the existing `front.html`, `js/front-member.js`, `js/main.js`
  and `js/vr360.js`. It is not a second site, account service or user-media path.
- Ordinary account pages still use `front.html?u=handle` and the published-only
  Worker API. Their validation and private/removed-profile behavior are unchanged.
  Project assets are selected separately from the frozen registry; member-media
  validation is not broadened to allow arbitrary local paths.
- Matthew's `index.html#work` now contains one project tile. Existing links from
  hire/portfolio to `index.html#work` still land on the matching project entry.
  Existing `vr-vaunt.html`, `song-vaunt.html`, `walls/vaunt-runway.html`, album and
  referral URLs remain intact; no redirect is needed for those routes.
- The original complete work section is preserved inert in
  `data/front-projects/vaunt-original.html` as well as Git history. Media and
  catalog entries remain untouched. The old `site_content` settings are neither
  deleted nor migrated. Control retains those settings in saved payloads, but
  replaces obsolete cabin controls with a project link. The project currently
  uses the reviewed repository configuration, not live `index.html` overrides.
- `css/profile-shell.css` and `js/guest-world.js` serve index, rich member fronts
  and profile cards. The globe lives outside identity/metric containers. The CTA
  uses the existing auth state: guests sign in/join; members enter World. Shared
  footers stay visible even if legacy scene settings disabled the guest globe.
  The iframe hides its duplicate sign-in door only when the parent supplies one.
- No public portfolio login requirement, signup gate, World access policy,
  cross-host handoff, analytics implementation or Worker route changed. PR #620
  and the separate audit's unshipped work are not included.

## Provisioning and release boundaries

The separate read-only audit reports production lacks `public.member_fronts`
and the `front-media` bucket. Fixture tests do not prove live member publishing.
This repository-managed project requires neither dependency and creates no live
member account. It becomes reachable only after a separately approved site
release; this task does not merge or deploy it.

If database-managed publishing is wanted later:

1. Review the existing `supabase/pending/member_fronts_v1.sql`, its RLS/storage
   limits and `scripts/test-member-fronts-db.sh` in an isolated database. Applying
   it to production requires separate explicit approval. It is not applied here.
2. The current schema/API allow one page per M Account. Do **not** seed a second
   identity or reuse/overwrite Matthew's single row to claim a Vaunt company
   account. Multiple Matthew-owned projects need a separately reviewed ownership
   model and API/editor work before any project seed can be safe.
3. Confirm the immutable project configuration against any current production
   `index.html/@front` overrides before release. This change preserves the
   repository's shipped configuration and keeps existing saved rows recoverable;
   it does not claim to have snapshotted production rows.
4. Review the exact draft PR, preview artifacts and CI. Release only under a
   separate approval. No company contact or external sharing was performed.

## Local verification

- Source suite: 1,152/1,152 passed.
- Full Worker suite: 1,231/1,231 passed after installing locked dependencies.
- `scripts/e2e/vaunt-project.e2e.mjs`: passed at 390×844, 820×1180,
  1180×820 and 1440×1000. Checks the real tile click, engine, asset ordering,
  album links, keyboard entry, cabin Allow/Cancel/Escape, signed-in/out footer transitions, overflow
  equality and JavaScript errors. Screenshots inspected at all four sizes.
- Updated `scripts/e2e/control-front-page.e2e.mjs`: 46/46 passed, including
  preview/save/reset fixtures, retained settings and no preview analytics.
- Existing member browser suite: 66/67, with the single failure being two
  Chromium `Transition was skipped. Navigation aborted` errors during editor
  navigation. Running the unchanged HEAD files through the same harness also
  gives 66/67 with the identical failure. Publishing, media isolation, visitors,
  private editor behavior and takedown assertions pass. No unrelated transition
  repair is included.
- Default browser tests intercept every network request. Globe screenshots in
  that suite exercise the existing CDN-unavailable fallback, not live map data.
  An additional read-only CDN attempt returned HTTP 403 for Cesium.js in this
  environment, so actual globe rendering remains unverified here. The existing
  fallback and sign-in/World links work. Browser emulation is not physical
  iOS/iPad Safari certification.

Reproduce the project browser checks with `PLAYWRIGHT_DIR=<node_modules>` and
optional `CHROMIUM_EXECUTABLE=<chromium>` using the command above and an output
directory argument. `.github/workflows/profile-project-preview.yml` produces
reviewable screenshot artifacts on the draft PR. Local proof directories are
`/tmp/vaunt-proof`, `/tmp/control-front-proof`, `/tmp/member-front-proof` and
`/tmp/member-baseline-proof`.

## Coordination with the separate self-service task

Potential overlap: `front.html`, `member-front.html`, `js/front-member.js`,
`js/main.js` and the presentation of `js/control-room/front-page.js`. Preserve
`?project=vaunt` as repository-managed creator content distinct from `?u=handle`.
The `data-profile-world` footer and `data-world-entry` CTA are shared-shell hooks;
`guest-globe.html?entry=parent` delegates its entry link to that parent shell.
This branch does not change `front-studio.html`, `js/front-studio.js`,
`packages/front-config/index.mjs`, `workers/mccluster/src/member-fronts.js`, any SQL,
member editor persistence, onboarding, billing, domains or social infrastructure.
The broader task owns those contracts and their production review.
