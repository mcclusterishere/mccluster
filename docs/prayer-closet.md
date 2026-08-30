# PRAYER CLOSET: the operator's manual

Fashion first. The garment is the front door; the Word is what you find
when you step past it. Nobody is ever asked to buy clothing to read the
Bible. The Inner Room is free, always, with no account and no gate.

## The rooms

| Room | File | What it is |
|---|---|---|
| The Closet | `prayer-closet.html` | Season home: hero wears the most-forward drop, the rail, the coming rack, collaborators, the quiet doorway |
| Drop rooms | `closet/<slug>.html` ×3 | Staged: Garment → Message → Chapter → Briefing → Prayer Closet → Acquire. Shells only; `js/closet.js` dresses everything from the ledger |
| The Inner Room | `inner-room.html` | Calm Matthew reader (WEB, public domain, served from this repo). Tap a verse → highlight / save ✦ / note. Everything stays in the visitor's localStorage |
| The ledger | `data/prayer-closet.json` | **This file IS the admin panel**; see below |
| Scripture | `data/scripture/matthew-{5,6,10,28}.json` | World English Bible chapter files (public domain; fetched once from bible-api.com and committed) |

Entrances: the fourth bottom-bar tab (**Prayer Closet**, closet-rack icon,
deliberately not a cross/Bible/church symbol), the closet wing in
`js/tabbar.js` (The Closet + Inner Room), and the Prayer Closet group in
the masthead drawer (`js/masthead.js`).

## Running a drop from the ledger

Everything an operator flips lives in `data/prayer-closet.json`. No
page edits, no redeploy-per-drop; surfaces repaint on next load.

- **Preorders & giving run through Square** (the house processor).
  Two ledger slots control everything, no deploy needed:
  - Per drop: `preorder.square` (a Square payment link) + `preorder.deposit`
    (display dollars; Square owns the real price). Paste the link and the
    drop's Acquire room flips from first-claim capture to a live
    **"Preorder through Square"** button on next load; the claim list
    stays available behind "put your name on the list instead."
    Create links at Square Dashboard → Payments → **Payment Links** →
    item with size variants (S to 2XL).
  - Season: `season.give.square`, the giving door ("Sow into the
    season") on the closet home and under every Acquire room. Use a
    Square **donation-type** payment link so Square words it honestly.
    A gift is never described as a purchase, and no scripture ever sits
    behind either door.
- **Photography & artwork** (`assets/img/closet/<slug>/`, stem == ledger id,
  jpg ~1600px longest edge for photos, png for marks):
  - `drops[].cover`: the portrait card crop (4:5.4) used by the closet-home
    rail card and the drop-room hero. **Its presence is what turns a drop
    from an editorial color field into a photographed one**: the `has-photo`
    class lands, the hanger placeholder disappears, the watermark and sheen
    dial back, and a bottom scrim gives the copy a bed.
  - `drops[].media[]`: `{id, type, role: front|back|detail, src, w, h, note}`,
    mirroring the `data/gallery.json` contract. Renders as the Look gallery
    under the Garment stage; `note` becomes the caption.
  - `placements[].art`: the **artwork mark itself** (transparent PNG from
    `art/`), nested inside the tech-pack phrase cell. The row stays
    two-track by design; a third column breaks alignment at 390px. The
    thumbnail uses `object-fit: contain` because these are line-art marks,
    not photographs.
  - **Artwork does marks, photography does cloth.** `art/*.png` are the
    print-ready cutouts and feed the tech-pack thumbnails; the `media[]`
    crops are the garment itself and feed the Look gallery. Where a mark
    was delivered as *black* ink for printing on light cloth, the `art/`
    copy is the light-ink version the dark UI needs and the delivered
    master is kept beside it as `*-print.png` (see
    `seek-first.png` / `seek-first-print.png`).
  - The color field never goes away. It stays underneath as the automatic
    fallback if an image is missing, so a bad path degrades quietly.
- **The emblem** is `assets/img/hm-mark.png` (the official Hitman mark:
  HM, the round, the halo; landed 2026-07-30, referenced by
  `season.emblem` and `collaborators[hitman].logo`). It is the fourth
  tab's icon (`hm-mark-96.png`), the closet favicon, and the brand mark
  on every closet surface. Never regenerate, redraw, or substitute it.
- **Status walk:** `concept → preview → coming-soon → live → sold-out → archived`.
  - `concept` hangs in the "Coming into the Closet" rack (title + color,
    no phrases; the mystery is the marketing).
  - `preview` / `coming-soon` show the full room and run **first-claim**
    capture: name + email filed to the leads desk under campaign
    `prayer-closet` (via `js/crm.js`). No charge, ever, before `live`.
  - `live` requires `offering` (and `price` for display): the Acquire
    section links `pay.html?offer=<slug>`. The checkout function reads
    the authoritative price/seller from the offerings ledger, never from
    the client. Create the offering row first, then flip the status.
  - `sold-out` keeps the room open (the chapter never sells out) and
    points at the rail.
- **Colors** are editorial color fields until real photography lands.
  Never a fake garment photo. Add `cover` + `media` and the field becomes
  the fallback layer instead of the whole picture (Drop 001 is the worked
  example).
- **Placements** are the tech pack: area → phrase → method. The inside
  label carries the QR that lands on the drop room.
- **Tiers:** `direct` (POD ships direct), `finished` (+$25, hand-finished
  at the desk, numbered), `collab-set` (ships from McCluster Corp when
  physical inserts ride along).

## The law of the house (do not bend)

1. **Scripture is free.** No paywall, no account wall, no email wall in
   front of the Inner Room or any chapter text.
2. **Public domain only.** The WEB is committed in-repo. Do not scrape
   or embed copyrighted translations (NIV/ESV/NLT etc.).
3. **No invented marks.** The official Hitman mark lives at
   `assets/img/hm-mark.png` (landed 2026-07-30). It is the only HM mark
   any surface may use. Never regenerate or substitute it; a future
   collaborator without an official file is set in type until one lands.
4. **The Hitman identity reads as purpose**: commission, discipline,
   precision, mission, service. Never literal violence.
   **The crest, and what it carries.** The shipping crest is
   `assets/img/closet/art/kingdom-steppa-crest.png`: **body armor over an
   open Bible at Matthew 6, a magazine resting on the page**, halo above,
   KINGDOM STEPPA below. The armor is the breastplate of Ephesians 6 and
   the sleeve's WAR ROOM sword is 6:17. The imagery is spiritual warfare,
   not street violence, and copy should keep it there.
   *One practical note, recorded once:* a magazine is far milder than the
   handgun it replaced, but it sits in the same content category for
   print-on-demand vendors and ad platforms. Not a reason to change it,
   just worth knowing if a print job or ad set ever gets flagged on a drop
   already taking $333.
   **The held crest:** the earlier variant carrying a *handgun* over the
   Bible remains at `art/_held/kingdom-steppa-crest-pistol.png`,
   committed for the record and **referenced by no surface**. It was
   superseded by the armor crest, 2026-07-30.
5. **One seller: McCluster Corp.** Drops are curated and fulfilled by the
   house. No provider onboarding, no marketplace rails.
6. **Prices are server-side.** A drop sells only through a configured
   offering; the client never names its own number.

## Phases

- **Phase 1 and 2 (built):** the Closet, three drop rooms, the Inner Room
  (reader + highlights/saves/notes in localStorage), fourth tab, wing,
  drawer group, first-claim capture, season ledger.
- **Phase 3 (next):** the **edition registry**, `HM-MT{chapter}-{drop}-{serial}`
  (e.g. `HM-MT6-001-0084`). Supabase table keyed by edition id: drop,
  serial, tier, produced/authenticated dates. Public verify route shows
  edition number, drop, and authenticity **only, never buyer name,
  email, or any private customer information.** QR on the inside label →
  drop room now, edition page once the registry exists. Account sync for
  Inner Room notes (local-first, merge on sign-in).
- **Phase 4 (later):** collaborator profile rooms, additional seasons
  (new book, new `season` block + scripture files), campaign photography
  replacing color fields, printed-study PDFs for finished editions.
- **Phase 5 (the spin-out):** Prayer Closet moves to its own property,
  **prayercloset.mccluster.org** (registered as `prayer-closet` in
  data/domains.json). The wing was built for this: the ledger, the drop
  engine (`js/closet.js`), the Inner Room, and the scripture files are
  self-contained and lift out together. When the subdomain goes live,
  the Here routes (`/prayer-closet.html`, `/closet/*`, `/inner-room.html`)
  301 across, the fourth tab points at the new host, and QR labels keep
  working because they encode the drop slug, not the host. Until then,
  everything serves from matthew.mccluster.org.

## Season 001, Matthew · one drop, three colorways

The season was three drops. The owner cut it to one on 2026-08-30:
**SENT / Heav'Yeah**, in three colorways. SEEK FIRST and SALT & LIGHT are
retired — their ledger entries, their rooms (`closet/seek-first.html`,
`closet/salt-and-light.html`) and their redirects are removed. Seek
First's photography is still in `assets/img/closet/seek-first/`, kept
because it is real work and costs nothing to leave; delete it whenever.

| Drop | Phrase | Chapter | Colorways | Status |
|---|---|---|---|---|
| The Halo Drop · SENT | Heav Yeah | Mt 10 | **Washed Black** (photographed) · Washed Blue · Black | **Preorder live**, two prices |

**The prices**, and the two Square links carrying them (created
2026-08-30, location `LYTBAM2H7536B`):

| What | Price | Link |
|---|---|---|
| The hoodie | **$66** | `https://square.link/u/DhtsVxFW` |
| The full set, hoodie + joggers | **$120** | `https://square.link/u/qqDcUQS7` |

Both ask for the shipping address and carry two custom fields — size and
colorway — so the buyer names both at checkout. That is why the drop
room's standard terms no longer promise an email for sizing: the step
does not happen any more. See `sizeAtCheckout` in the ledger if a future
link ever goes back to a bare payment link.

The ledger models this as `preorder.options`: a list, each entry with its
own price and its own `square` / `shopify` pair, so one option can move to
a Shopify store while the other stays on Square. A drop with no `options`
falls back to the single `preorder.square` every earlier drop used.

**The bench:** COMMISSION (Mt 28, Stone) sits whole in the ledger's
`benched` array, off every surface, one move away from re-hanging
(or opening Season 002). Its old room, `closet/commission.html`, is a
soft redirect into the Closet; `data/scripture/matthew-28.json` stays
committed for its return.

**Drop 001, as built (reconciled to the production mockup 2026-07-30).**
The colorway changed from Cream to **Washed Blue** (`#688398`, sampled off
the fabric) and the placements were corrected to what the garment actually
carries:

| Area | Print | Change |
|---|---|---|
| Front chest | Kingdom Steppa crest | was a text lockup |
| Full back | HM · AMMO, the halo mark | was "Seek First the Kingdom, Matthew 6:33" |
| Left sleeve | SEEK FIRST, under the jet glyph | was "SEASON 001" |
| Right sleeve | WAR ROOM, the halo sword | **new** |
| Front hip · pocket | the 33 reticle | **new** |
| Jogger right leg | Kingdom Steppa | kept; the set's other half, unphotographed |
| Inside label | PRAYER CLOSET · HM-MT6 + QR | kept |
| ~~Hood~~ | ~~MT 6~~ | **dropped**; the mockup's hood is plain |

Spec: premium heavyweight hoodie, 100% cotton, oversized fit, DTG print.

**Square link hygiene:** Drop 001's link is a customer-enters-amount
(donation-type) link whose description names $333. It works today, but
an **item-type** Payment Link with a fixed $333 price and S to 2XL
variants is cleaner for a product sale: receipts, disputes, and
bookkeeping all read as a purchase. Swap the URL in the ledger
whenever; the site doesn't change.

The name of the house is Matthew 6:6: the inner room, the shut door,
the Father who sees in secret. That verse is quoted (WEB) in every drop
room's Prayer Closet section, and the reflection written there stays on
the visitor's device: "Saved on this device only, never sent anywhere."
