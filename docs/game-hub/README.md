# Game Hub

Owner, 2026-11-03: "The learning hub is now the game hub. We're gonna make a bunch of mini games from all the
courses I'm taking right now. … We now need to pair the music with the learning modules, each learning module as an
icon at the bottom of the screen."

`game-hub.html` is on Matthew McCluster's property (`https://matthew.mccluster.org`, GitHub Pages). It is a page of
Matthew's courses, not a McCluster Corp product page, so it carries no company metadata. It ships `noindex, nofollow`
like the game pages it opens (`prim3-transit.html`, `prim3-world.html`). Whether it becomes an indexed page (sitemap,
canonical, structured data) is the owner's call.

## What is on the screen

- **Main panel**: the selected course's game cards. A `link` game opens its own page. An `embedded` game runs inside
  the hub page, so the music keeps playing while you play.
- **Floating capsule**: current song, play/pause and next, with Games opening the course selector and position controls. It starts collapsed and collapses on game start. Move its dedicated handle by touch/mouse or arrow keys; Home or Reset restores the initial position.
- **Course icons**: selecting a course changes the main panel. The current song continues; Play course soundtrack explicitly selects the course album. The shared app bar remains unchanged.

The address is `game-hub.html#m=<module>[&play=<game>]`, so a course or a game can be linked directly. The last
course you picked is remembered in this browser.

Files: `game-hub.html`, `css/game-hub.css`, `js/game-hub/hub.mjs` (page), `js/game-hub/modules.mjs` (schema and
checks), `js/game-hub/shared-music.mjs` (existing music transport adapter), `js/game-hub/floating-capsule.mjs` (layout), `js/game-hub/chem108/` (Molecule Rush), `data/game-hub/modules.json`
(the module list). The Control destinations panel (`js/site-navigation.js`) lists the hub under Products.

## Module schema (`data/game-hub/modules.json`)

```json
{
  "version": 1,
  "default": "prim3-security",
  "modules": [{
    "id": "chem108",                         // lowercase, digits, dashes; unique
    "label": "Chem 108 · Organic chemistry", // the icon's accessible name and the panel heading
    "short": "Chem 108",                     // the label under the icon
    "course": "Chem 108 organic chemistry",
    "blurb": "…",
    "accent": "#3ddc97",                     // #rrggbb, never purple (the test refuses violet to magenta hues)
    "icon": { "kind": "glyph", "glyph": "ring" },
    "music": { "album": "here", "role": "soundtrack", "label": "Study soundtrack — no chemistry lyrics" },
    "games": [
      { "id": "molecule-rush", "kind": "embedded", "view": "chem108/molecule-rush", "title": "…", "tag": "…", "blurb": "…" },
      { "id": "…", "kind": "link", "href": "some-page.html", "title": "…", "tag": "…", "blurb": "…", "gate": "owner" }
    ]
  }]
}
```

- `icon.kind: "image"` is owner-supplied artwork under `assets/img/`, shown whole and scaled only (AGENTS.md → "THE
  LOGOS ARE NOT YOURS TO DRAW"). PRIM3 uses `assets/img/prim3-mark-180.png`. A course with no supplied mark uses
  `icon.kind: "glyph"`, a plain interface icon (`ring`, `flask`, `atom`, `book`, drawn in `hub.mjs`). A glyph is a
  generic UI icon, never a stand-in for a brand mark. If a course has a mark, ask the owner for it.
- `gate: "owner"` shows the card only when the server says the session is the house owner
  (`js/prim3-world/owner-gate.mjs`, the same `/v1/status` check `prim3-world.html` makes). PRIM3 World uses it, and
  that page checks again itself.
- `kind: "embedded"` names a view registered in `EMBEDDED_VIEWS` (`modules.mjs`) and `VIEWS` (`hub.mjs`).

### Adding a course

1. Add a module to `data/game-hub/modules.json`. Pick an existing album from `data/albums.json` and a role (below).
2. For a new embedded game, add `js/game-hub/<course>/` with a `mount(host, { onExit })` that returns `{ destroy }`,
   and register its view name in `modules.mjs` and `hub.mjs`. Pure rules go in their own module, tested.
3. If the game uses another repository's content, vendor exact copies with a `SOURCE.json` pin (as below).
4. Run `node --test scripts/test/game-hub.test.mjs` and render the page at 390px (`scrollWidth === clientWidth`).

## Music pairing rule

The PRIM3 learning-modality contract (`docs/prim3/LEARNING-MODALITY-CONTRACT.md`) says a Rhythm song reinforces only
concepts it actually contains, and a song never creates Principles credit. So the hub has two roles:

- **`rhythm`**: the course's own songs. PRIM3 · Security plays the `prim3` album (the study tapes), whose lyrics are
  the security concepts the course teaches.
- **`soundtrack`**: study music with none of the course in its lyrics. Its label must say so (`no … lyrics`) and may
  not say Rhythm. The test enforces both. It is background music, and it claims no learning credit.

**Chem 108 plays `here`, the I AM HERE album (6 tracks), as its study soundtrack.** There is no chemistry album, so no
album can be Rhythm for Chem 108. The PRIM3 tapes would put security lyrics over a chemistry drill. `heal-the-3` has
only two tracks, and the rest of the catalogue is themed releases (a campaign jingle, a dealership saga, the 516R
release). I AM HERE is Matthew's own flagship record: six tracks is enough rotation for a study session, it is all
public (no gated masters), and its "have no fear" register suits exam prep. When a chemistry song exists, add it as an
album and switch Chem 108 to `role: "rhythm"`.

The capsule uses `window.MCC_MUSIC`, the existing `js/music-engine.js` transport, with its listen ledger and gated-audio rules. It never constructs a second audio element. The engine's original floating mini-player is hidden only on this page; the capsule is its visible transport. Nothing autoplays. Next follows the site's global queue. A course selection preserves current playback; the explicit soundtrack action selects that course's first song.

The old `player.mjs` and `mcc.gamehub.music.v1` preferences remain intact for compatibility but are no longer active here. Their per-course seek positions are not imported into the shared engine (especially not into gated tracks). In-document course/game navigation preserves playback. Full document navigation still stops audio under the existing architecture; uninterrupted cross-page playback and shared-shell state restoration require a separate change.

## Reusable capsule seam and review

`mountCapsule({root, workspace, storageKey})` owns movement/disclosure and reserves a separate scrolling workspace below the capsule. The caller supplies controls and permissions; it owns no music, assessment state, entitlement or billing logic. Dragging only starts on the dedicated handle after six pixels. Arrow keys and visible direction buttons are alternatives, with Escape returning focus to Games. Position is local UI preference only, clamped on resize and visual viewport changes. A short landscape viewport may require scrolling the expanded control panel, while the game retains a clear region below it. The owner gate remains the authority; hiding/showing a control never grants access.

This bounded implementation changes Game Hub only. It does not touch admin navigation #745, shared `tabbar.js`, the site music runtime, or proposed product-widget entitlement #750. Future subsystem adapters can supply their own selector/actions to this seam; a platform-wide island and continuous cross-page audio are not implemented here.

Validation commands:

```sh
node --test scripts/test/game-hub*.test.mjs scripts/test/chem108-worked-example.test.mjs
node scripts/e2e/game-hub-capsule.e2e.mjs
node scripts/e2e/chem108-worked-example.e2e.mjs
```

Browser tests use the real shared navigation and audio runtime with synthetic owner API responses and a valid silent WAV. They are not authenticated production or physical-device evidence. Baseline main source at 390×568 reproduced two answer centers obscured by the old dock. The focused test verifies every answer center after scrolling in collapsed and expanded modes at 320×568, 390×568, 390×844, 844×390 and 1024×768, plus 200% text. Live site fetch was blocked by this execution environment (proxy 403); no deployed reproduction claim. Screenshots are saved under `/tmp/game-hub-selector-evidence/` by the focused browser test. This PR is source review, not a hosted preview or deployment.

## Molecule Rush (Chem 108)

Sixty-second rounds, three lives, and a streak multiplier (×2 from three in a row, up to ×5, 100 points base). There
are four modes:

- **Name It**: an RDKit structure; pick the IUPAC name from four. Sometimes the right option is shown as one of its
  Chem-108 accepted aliases (e.g. `1-hexene` for `hex-1-ene`), and it scores.
- **Spot the Group**: the functional-group family of a drawn structure (alcohol, aldehyde, ketone, carboxylic acid,
  ester, ether, amine, amide, haloalkane), plus Chem-108's own functional-group cards. The family map is in
  `engine.mjs` (`MOLECULE_FAMILY`), read off each name's ending as Chem-108's groups cards teach it.
- **Element Sprint**: symbol to name and name to symbol, across all 118 elements (Elements 1–20 or 21–118).
- **Topic Blitz**: any of the 14 Chem-108 topics, built the way Chem-108's own quiz builds its questions.

Distractors always come from the same topic and the same kind (structure names with structure names). Answers that
read the same under Chem-108's `norm()` are never shown twice, and a distractor is never one the right answer would
itself accept. The end screen lists every miss with the structure (or symbol), the correct name, its accepted aliases,
your pick and Chem-108's explanation. That list is the learning feedback. Questions are chosen by Chem-108's own
`choose()` over its `update()` review records, so misses come back sooner. Best score per mode, accuracy per topic
and the review records are kept in this browser (`mcc.gamehub.chem108.v1`). Keys 1–4 answer, every button is at least
44px, and `prefers-reduced-motion` turns off the pops.

## Chem-108 source pin and what vendoring publishes

`js/game-hub/chem108/data/` holds exact copies of `dist/data.js`, `dist/extra-data.js` and `dist/core.js` from
`mcclusterishere/Chem-108` ("Molecule Fluent") at commit `fb1b038dee3ed86c41a9931bf9c9874a76033412`, with SHA-256s
in `SOURCE.json`. `scripts/test/game-hub.test.mjs` fails if a byte drifts. Do not edit them here. Change Chem-108,
re-copy, and update the hashes. `engine.mjs` ports `norm`, `accepted`, `update`, `shuffle` and `choose` as ES
modules, and the test holds the port to the vendored `core.js` on every structure name and alias.

**Chem-108 is the owner's private repository. Vendoring it into this repository publishes its card data (all 306
cards, the 49 RDKit structure drawings, the aliases and explanations) on the public site, `matthew.mccluster.org`.**
The repository has no license file. The owner wrote and owns the deck, and publishing it here is his decision. RDKit
(BSD) generated the drawings, and Chem-108's README credits it and the IUPAC brief guides. If the deck should stay
private, remove the vendored data and serve it from behind the account instead.

## Layered structure explanations (local implementation, 2026-11-04)

All **49 existing structure cards** now have paired question/answer presentations after both correct and incorrect
responses. The answer reuses the exact original RDKit paths. Reading pauses the round until Continue; it does not
create a new question or another scoring event. IDs, aliases, pinned vendor bytes, save keys and learner records are
preserved. Non-structure questions retain their existing timing behavior.

`lesson-authoring.mjs` defines the family, original atom indices in parent-numbering order, the naming feature,
molecule-specific naming steps and a specific mistake for each card. `compileLesson` produces both the base local
lessons and the schema used in owner draft previews. It never infers a new name from a string. Family templates add
foundations and deeper bonding explanations to the authored molecule-specific material.

Every lesson has:

- A parent/group highlight tied to the original SVG bond classes, plus an atom selector tied to original atom classes.
  One labeled arrow at a time avoids overlapping labels on phones. Labels and explanatory text supplement color and
  thicker bond paths. C labels number the parent; X labels identify carbon atoms outside it; O/N/halogen labels
  identify the remaining atoms. A reserved strip above the drawing holds the selected atom label. Original SVG path
  coordinates remain unchanged; the viewBox expands to include the callout strip.
- Depth controls for test essentials, naming reasoning, atom/H/valence detail and advanced context. Depth does not
  change assessment difficulty. Native disclosure, buttons and live feedback remain keyboard/screen-reader friendly.
- Atom-specific H counts and Lewis bond-order sums, a molecular formula check, functional-group reasoning,
  numbering/name assembly, and quick-check feedback that creates no learner records or score.
- Relevant source links. General naming context explains retained versus systematic names. **Molecule-specific
  discovery history and instructor review remain pending**; no invented discoverers or dates appear.

`validated-graphs.mjs` is generated from the pinned SMILES, not from a new drawing. RDKit 2025.09.6 validates all 49
formulas and all 243 heavy atoms' H/valence counts. Aromatic graphs use a Kekulized copy only for integer Lewis
bookkeeping; the original SMILES/SVG remain intact. Functional-group SMARTS independently check the authored family
labels. `formalCharge` stays null because the course metadata is silent; the uncharged SMILES model charge is stored
separately. This is not a claim about every ionic form or solution condition.

Examples: m27 explicitly distinguishes OH on C2 from m26's end OH; m34 separates the ethyl and ethanoate sides of the
ester; m37 explains why N attached to a carbonyl gives an amide; m45 separates the six ring carbons from the external
carboxyl carbon; m47–m49 anchor the methyl groups at 1,2 / 1,3 / 1,4 respectively. The quick checks use those distinctions
or the actual parent/H counts. The original course deck remains authority for accepted answers, including aliases.

### Owner authoring and permissions

Name It setup → **Study worked examples · all 49 structures** → choose the molecule → **Owner · draft and review this
explanation**. The existing server-backed owner gate (`js/owner-only.mjs`) controls entry; no new role or auth stack
was introduced. Draft text is escaped and length bounded. Previews show the selected molecule's exact geometry and
anchors. In-memory versions and review notes are per selected card. `needs-review` is not approval: drafts cannot
replace learner lessons. Download JSON to keep a version; leaving or switching cards loses unsaved drafts.

Atom/bond anchors are displayed/exported and require source review to change. The editor cannot change assessment
IDs, aliases, scoring or graph facts. No persistent API/table/migration is needed for this local workflow. Any future
persistent authoring must use the canonical backend's `requireHouseOwner`, immutable revisions, validated anchor
references and explicit review/promotion; browser flags are not authorization for a write API.

### Sources and validation

The lessons use original wording, grounded in the pinned deck and these primary teaching/nomenclature sources:

- IUPAC Brief Guide: https://iupac.qmul.ac.uk/BriefGuide/organic.html
- IUPAC Blue Book, general/retained naming: https://iupac.qmul.ac.uk/BlueBook/P1.html
- OpenStax, Organic Chemistry: sections 1.4 (Lewis/valence), 1.6/1.8/1.9 (bonding models), 1.12 (skeletal drawings),
  14.1 (conjugation), 15.2 (benzene), 17.1 (alcohol naming), 21.7 (amides), 24.3 (amines). Each applicable lesson links
  its exact source pages. RDKit API: https://www.rdkit.org/docs/source/rdkit.Chem.rdchem.html

Run:

```sh
node --test scripts/test/game-hub.test.mjs scripts/test/chem108-worked-example.test.mjs scripts/test/owner-only.test.mjs
python3 scripts/chem108/validate-graphs.py
AXE_PATH=/path/to/axe-core/axe.min.js node scripts/e2e/chem108-worked-example.e2e.mjs
node scripts/chem108/export-review.mjs
node scripts/chem108/test-review-file.mjs
```

The Python check requires RDKit 2025.09.6 (`--write` is explicit regeneration, after review). Browser tests use installed
Playwright from `CODEX_PRIMARY_RUNTIME_NODE_MODULES` and Chromium (`CHROMIUM_PATH`, default `/usr/bin/chromium`).
The e2e suite starts an ephemeral local server, fixtures owner access, and excludes the shared tabbar's independently
tested auth/service flows. It does not use a production session. Without AXE_PATH, axe scans are skipped.

Evidence: 97 unit tests; all 49 browser author previews and all 243 atom anchors; all 98 correct/wrong game flows;
all 49 diagrams' original path equality; all 49 depth/quick-check controls; owner draft/version/review; guest gating;
zero horizontal overflow at 320/390/1024px; no detected WCAG A/AA violations in the game panel for each structure.
The self-contained review file also tests all 49 cards, both comparison states and every quick-check response with
network disabled and zero outgoing requests. Managed Chromium blocks file-protocol navigation, so the standalone
HTML bytes are exercised directly in a browser document; opening downloaded HTML depends on the user's browser.

### Review delivery and remaining limits

`data/game-hub/chem108-explanation-coverage.json` inventories all 49 IDs, source hashes, parent atoms, 243 annotation
anchors, local validation status, charge provenance and explicit history gaps. These are local reviewed-by-agent
lessons with automated chemistry checks, **not instructor approval**.

`export-review.mjs` creates `/tmp/chem108-evidence/molecule-rush-49-structure-review.html`: a self-contained, read-only
review copy using the actual lesson/annotation renderers, original diagrams and a sample-response selector. It has no
account access, owner write controls, learner storage or network dependency. A private Library copy is delivered as
`/molecule-rush-49-structure-review.html`; it can be downloaded for inspection. It is not a hosted Game Hub release.
Repository review publication is authorized separately from release. No merge or deployment occurred, and no production database was changed. PRIM3 mission/LMS
files and the shared owner gate were left untouched. Hosted device access still needs a separately authorized release.

### Capsule review evidence (local fixtures)

- [Old dock, 390×568](review/before-390x568.png): two answer centers are covered.
- [Capsule, 390×568](review/capsule-390x568.png), [390×844](review/capsule-390x844.png), [landscape 844×390](review/capsule-844x390.png): answers scroll through their own clear area.
- Root suite: 1,677 Node passes, three existing skips, seven Python passes. Focused capsule/chemistry source suite: 69 passes. Existing chemistry browser suite: all 49 previews/243 atom anchors and 98 correct/wrong scoring flows passed. Capsule browser suite also passes real touch/mouse/keyboard movement, reset/reload, music controls, course-switch continuity, music-load failure and axe checks of the capsule.
- The screenshots show a synthetic owner response with the real shared bar's signed-out profile presentation; they do not establish production owner-session behavior. No merge, deployment, production database write or billing change.
