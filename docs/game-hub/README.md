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
- **Music bar**: play/pause, next and the track title for the selected course's paired album. Above the course icons.
- **Course icons**: one per learning module, at the bottom of the screen, just above the shared app bar (`js/tabbar.js`,
  which every page keeps). Picking an icon switches the panel and the music.

The address is `game-hub.html#m=<module>[&play=<game>]`, so a course or a game can be linked directly. The last
course you picked is remembered in this browser.

Files: `game-hub.html`, `css/game-hub.css`, `js/game-hub/hub.mjs` (page), `js/game-hub/modules.mjs` (schema and
checks), `js/game-hub/player.mjs` (music), `js/game-hub/chem108/` (Molecule Rush), `data/game-hub/modules.json`
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

The player is a single `<audio>` element (`js/game-hub/player.mjs`). Nothing plays until the visitor presses play.
After that, switching courses keeps the music going. Each course's track and second are remembered in this browser
(`localStorage` key `mcc.gamehub.music.v1`, every access in try/catch). The site's album engine (`js/music-engine.js`)
is one global queue with gated masters and its own transport, so the hub does not reuse it.

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
