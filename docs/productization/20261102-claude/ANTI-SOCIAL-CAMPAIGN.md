# Anti-Social → free website: creative brief and asset/rights checklist (local draft)

**Status: prepared locally. No ad was generated, bought, scheduled or published. No spend is authorised. The product journey must pass its acceptance (M4) before any campaign is considered.** This brief is for the owner's review; nothing in it is a selected business term.

## What the journey is (implemented in this branch)

| Step | Where | State |
|---|---|---|
| Song-led landing | `free-website.html` (+ `js/free-website.js`, `css/free-website.css`) | implemented locally; sound only on press; captions from the asset's own file; phone-first |
| Real demo | `index.html` (the page the song plays on) and the three-tile demonstration in `website-studio.html` | existing, linked; nothing mocked |
| Template choice kept through sign-in | `account.html?next=front-studio.html[?template=offers]` / `customer-projects.html`; `sessionStorage` fallback honoured once by `js/front-studio.js` | implemented locally |
| Free builder | `front-studio.html` (cinematic / offers), `website-studio.html` (three tiles) | existing engines; revision-aware saving added in this branch |
| Save / preview / publish / take down / recover | v2 editor API and Tile bridge (default-off flags) | implemented locally in the UI; backend default-off |

## The asset, as it actually exists in the repository

| Fact | Evidence | Verified? |
|---|---|---|
| Recording | `assets/audio/antisocial.mp3` (2,834,973 bytes) | present in tree; already served on `index.html` as the page's song |
| Captions | `assets/captions/antisocial.en.vtt` and `.srt` | present; the landing reads the VTT at runtime; no words are typed into code |
| Catalogue | `data/catalogue.json` → `tracks[4]`: "Antisocial", album **I AM HERE**, track 5, 2:57, `isrc: QT6KV2600005`, `credit: ""` | present; **credit is empty** |
| Identifiers | `data/ddex/identifiers.json`: ISRC `QT6KV2600005`, house no. `QT6KV·05`, release `here` (**I AM HERE**, `icpn: ""`) | present; **no ICPN** |
| Lyrics record | `data/lyrics/antisocial.json` (timed + plain) | present; not reproduced anywhere in this branch |
| Ownership | AGENTS.md: *I AM HERE is Matthew's album, published through the ecosystem*; the page is on Matthew's property | stated by the owner; not a licence document |
| Approved version | the file above is the one the live front page plays | the only version in the tree; **no "approved for advertising" marker exists** |

## Rights checklist — each line needs the owner's answer before any creative is cut

1. **Master recording.** Who owns the master of this exact file? If anyone other than Matthew McCluster (producer, mixer, label, distributor) has a share, their written clearance for advertising use is needed.
2. **Composition.** Writers and publishers of the composition (the catalogue `credit` is empty). Co-writers, samples, interpolations: list them or confirm none.
3. **Performers.** Any featured or background performer on the recording beyond Matthew.
4. **Producer / beat.** If the beat was licensed (lease/exclusive), does that licence permit paid advertising and synchronisation? Attach the licence.
5. **Distributor / DSP exclusivity.** Does the distribution agreement restrict use of the recording in ads, or require the ISRC to be used only with the released version?
6. **Visuals.** Any footage, photographs or artwork to be cut with the song: who shot it, who appears in it, model releases, locations.
7. **Captions / transcript.** The caption file is the source for accessible text; confirm it is the approved wording.
8. **Platform terms.** Each ad platform's music-rights terms (owner-supplied vs library). Meta and TikTok restrict commercial use of music for business accounts unless rights are owned; confirm the account type.
9. **Approved cut.** Which segment (timestamps) is approved for a 15/30-second cut; whether the full track may stream on the landing (it does today on `index.html`).
10. **Attribution.** Required credit line (today: *Antisocial · I AM HERE · Matthew McCluster · ISRC QT6KV2600005*).

Until every line is answered, the asset dependency stays explicit: the landing plays the existing file as the site already does; no ad creative is produced.

## Creative brief (draft, for review)

**Objective.** Get a person who hears the song to sign up and publish their own free page. Measure sign-ups and first publishes only through the site's existing consent-gated events (`data-cta` attributes already on the landing; no new tracking).

**Single message.** "This page was built with what you get for free." The song is proof, not the product: the page it plays on is the demonstration.

**Audience.** People who already make things (music, photographs, a small business) and have never published a page of their own because it looked like a job for someone else.

**CTA.** *Build yourself a free website.* Always to `free-website.html`, never straight to a sign-up form: the landing is where the template choice is made and kept.

**Formats (proposed, not produced).** 9:16 vertical, 15 s and 30 s; sound-on with burned-in captions from the caption file; a sound-off variant that leads with the page scrolling. Square 1:1 for feed. Still: the page on a phone with the title line.

**Mandatory on every unit.** Credit line (above). Captions. No "in minutes", no "today", no "unlimited". The word *free* only for what is free (account, page, address, storage within the shown allowance); domains and modules are "optional, paid, with their own terms".

**Do not.** Invent lyrics or paraphrase them as copy. Use the Equity Uprise emblem or any McCluster Corp mark on Matthew's personal creative (two entities). Use footage of anyone without a release. Claim a time to completion. Claim hosting on a domain of your own is included.

**Decisions the owner still holds.** Budget and platforms; the 15/30-second cut; whether the campaign runs on Matthew's property only or also on the company's hosts; whether paid assistance (a built page as a service) is offered — pricing is an owner decision, not a page constant.

## Product acceptance that precedes any launch (M4 of the assignment)

Visitor plays/opts into sound → understands the real demo → selects a template → signs up without losing the selection → saves an owned draft → previews actual rendering → publishes to the supported free address → opens the public URL signed out → edits/reloads → unpublishes/recovers. Plus private profile, duplicate address, quota exhaustion, expired login, failed upload and two-editor conflicts. Local fixture coverage exists for the backend journey (144 assertions) and for the editor UI contract (this branch's harnesses); real Auth/Storage/browser acceptance remains a recorded gate.
