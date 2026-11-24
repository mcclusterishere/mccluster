# The World's sign-in: the door

Owner, 2026-11-18: "Also, the sign-in page just looks like shit. It needs to be fancier, look sexier, and have more shit
to it. Instead, it looks like a commoner built it. This is royalty shit over here, gang."

This records what was built for that request, why, where every word on it comes from, and how it is tested.

## What it is

The World's sign-in (`#mnSignedOut` in `mnet.html`) no longer replaces the World. It rises over it, as a door:

- at 390 px (the design), a bottom sheet; from 700 px a floating card; from 1100 px a card in a right-hand column beside
  the Earth;
- the World stays on screen under it (`#mnApp` displayed, made inert), with the real globe turning under a scrim;
- the stage above the sheet holds the way back (`← Back` on a phone, `← Back to the World` from 700 px; its name is "Back
  to the World" throughout), the crest (the supplied white Equity Uprise mark, centred over the Earth in the stage's dark
  band), the World's real pulse in every state that has the room (on a phone one card under another, the open mission
  first; from 700 px a dated row of three) and the Earth's credit;
- the sheet is opaque, with an engraved double rule (a gold border and a hairline 6 px inside it), and holds "The place for
  doers.", the headline in Playfair Display with *into action* in italic and a red full stop, the two doors (Sign in /
  Create account, with "Welcome back" and "New here" over them and one gold rule that slides between them), the form, and
  the colophon "A McCluster Corp program.".

The three onboarding pages (`#mnProfileGate`) are still pages that replace the World (`html.mn-gate-on`, their padding
clears the bar, their markup unchanged). They take the door's hand: the serif headline, the tokens, and a readable day page
(it was black type on a near-black ground). From 1100 px they keep one centred measure, and the floating bar steps aside to
the right of it, moved and never hidden: centred over the measure it lay on the page's action at rest, over 87 % of its words
at 1280 x 720 and 88 % at 1366 x 768 (release review RS-4, 2026-11-19). The phone keeps its bar where it was.

Architecture: the "cinematic world" direction, with the "regal editorial" typography and craft grafted on, as judged on
2026-11-18. "Get Your Hu Up!" is gone from the World (owner, 2026-11-17) and nothing replaces it.

## Files

| File | What |
| --- | --- |
| `mnet.html` | the door's markup (ids kept; new parts use the `wg-` prefix); the stylesheet link after `css/daylight.css`; the script before `js/mnet.js`, ahead of `js/video-poster.js`, which keeps its pinned place directly before `js/mnet.js` |
| `css/world-gate.css` | the door and the onboarding skin; every rule scoped by `#mnSignedOut`, `#mnProfileGate` or `html.mn-door-open` |
| `js/world-gate.js` | `window.MCC_GATE`: presentation only, never an auth call |
| `js/mnet.js` | only `showGate`, `openSignIn`, `askToSignIn`, the `#mnSignedOutBack` handler and the sign-in refusal line |
| `assets/fonts/playfair-display-latin-500-normal.woff2` | the roman, unmodified from `@fontsource/playfair-display@5.3.0`, sha256 `1e3429a2122b4171bf393c8de5c501820e17ca2074c498d7080e2326975d825c` |
| `assets/fonts/OFL-playfair-display.txt`, `assets/fonts/OFL-manrope.txt` | the licences that travel with the faces (OFL 1.1) |
| `THIRD-PARTY-NOTICES` | Playfair Display and Manrope |

Untouched: `js/mcc-auth.js` (every auth call sends what it sent), the shared bar (`js/tabbar.js`, `js/site-navigation.js`,
`css/site-navigation.css`), the music (`js/mnet-audio.js`), `js/live-content.js`, `index.html`, `account.html`,
`forgot-password.html`, `reset-password.html`, and every file of the feed and compute lanes.

## Every word, and where it comes from

Reads start on the first open only, never on arrival; each has a 6 s deadline, is kept five minutes and, if it fails or is
empty, hides only its own card. Nothing is invented: no zero, no placeholder, no total.

| Card | Source | Words |
| --- | --- | --- |
| Missions | the World's own open-missions read (`loadOpenMissions` in `js/mnet.js`: `action_missions?status=eq.open`, the anonymous key), cleaned by `js/world-mission-posts.js` | "Open now" while there is one open mission, "Open now · N missions" from two, "Open now · 500+ missions" at the read's limit; the newest title; its field and points ("Mutual aid · 100 points"). The card is a button that closes the door and opens that mission. After a mission's Join it reads "Your mission" and is not a button |
| News | `GET https://api.mccluster.org/v1/world/news-heat` | "Last 24 hours" (the hours are the answer's own `window_hours`, 24 today; an answer that does not say what window it counted gets no card), "News from N countries" (countries with a story), "News from N+ countries" when the answer says its read was capped (the API reads at most 15,000 stories, so a country whose stories all lie past the cap is not counted: the number is a floor); "The GDELT Project", linked. The capped story total is never shown |
| Record | `GET https://api.mccluster.org/v1/action-archive/docket-516r-2025`, else `data/action/docket-516r-archive.json` | "On the record", "Docket 516R · Write the Change", "10 participants · 9 songs · Bridgeport, CT · Oct 5, 2025": counts only, no name, no photograph, no link |
| Dateline (700 px and up) | the visitor's own clock | "Today in the World · <their date>", shown when a card is |
| Credit | the globe frame's own credit line, copied as text and links (`#mnWorldFrame` `.osm-credit.is-editorial`) | else "NASA imagery · Natural Earth · © OpenStreetMap", the World's words |

Never shown on the door: members by country, live places, public posts, place scope, environment reports, the rally
photographs, the building renders, the M mark, Drawdown imagery or logos. The words "Equity Uprise" never appear in the
door's visible text, and the crest is never captioned.

New lines (the rest are the World's existing words, unchanged): the tab kickers "Welcome back" and "New here"; "Show" /
"Hide" and "Show password" / "Hide password"; "Both passwords match."; "That email and password don’t match an account.
Check them, or use “Forgot or don't know your password?” above." (for `invalid_credentials` only, naming the control by its
own words; every other refusal shows the server's message); "A McCluster Corp program."; "Today in the World", "Open
now", "Last 24 hours", "News from N countries" / "News from N+ countries", "On the record", "Your mission", "Open the
mission: ". On a phone the way back reads "← Back" (the World's "← Back to the World", its last words added from 700 px).

## How it behaves

- **Opening.** Only when asked, from today's callers: the header Join, the guest card, every members-only tap
  (`askToSignIn`), the globe's `hu:ask-sign-in`, `?signin=1`, `?join=1`, a flow (`?next=`, `?finish=1`, a pending
  sign-up) and "Your sign-in ended. Sign in again.". A World dialog open under it is closed first (`dialog.close()` fires no
  cancel, so `?mission=` stays). Everything outside the door becomes inert except the privacy notice (and its first-visit
  wall); the phone's Back gets one history entry; the sheet rises whole, 28 px over 420 ms, only after a gesture (nothing
  inside it moves on its own); the band over the World's header is solid from the first frame. A door opened by the
  address is whole in its first frame. The focus goes to the email where a keyboard is at hand; on a touch screen (no
  hover, a coarse pointer) to the door itself, so the phone's keyboard does not rise over the sheet before a field is
  tapped. When the keyboard does rise, the door follows the visual viewport and the field being typed in stays in view.
- **Closing.** The Back pill, Escape (a filled field lets go first; nothing while composing; the privacy notice's own Escape
  is its own), a tap on the scrim, the phone's Back, the mission card (a hand-off), a sign-in that worked. Inert comes off at
  once; the sheet falls for 220 ms; focus goes back to what opened the door; the typed email stays; passwords are emptied
  and hidden again, so the next person at the same screen finds nothing to Show (security review SEC-4, 2026-11-19). The
  World is where it was: no scroll to the top. A door asked for by a mission's Join goes back into that mission
  (its sheet opens again, `?mission=` kept), by the Back pill, Escape, the scrim and the phone's Back alike.
- **History.** One entry while open (`{mccDoor: 1}`, same URL). A close from the page steps back over it; the phone's Back
  is the close; a hand-off or a success replaces it, so a later Back never reopens the door.
- **The form.** The status line sits directly over the action and every field is described by it; the field it names
  keeps its ring. In Create account, the ring under the password fills at 8 characters (and then describes the password) and
  a tick appears in the confirm field when both match (announced once); the note about the three pages to come sits under
  the action. While a sign-in or a sign-up is on its way the action is `aria-busy` with a turning ring and a gold thread.
  The emailed state is a sealed note that leads the panel with Resend under it. Field names are drawn in small capitals by
  the font (`font-variant-caps`), never by `text-transform`, so a screen reader hears "Email", not "EMAIL".
- **The action is in view at rest.** On a phone the sheet is as tall as what it holds, but never so tall that the stage
  loses the open mission (160 px) while the action could stay in view without it; the action's own need (measured by
  `js/world-gate.js`: its foot plus the 34 px fade under it, as `--wg-need`) wins over the stage, and nothing ever covers
  the way back (68 px). The action is drawn above the fade. From 1100 px the card is beside the Earth (24 px above and
  below it), and the larger type (38 px headline, 64 px fields) is kept for screens 900 px and taller.
- **The privacy banner** (banner mode on the first visit, owner 2026-11-17): the door reserves its height at the bottom
  and, while it waits, the sheet keeps a tighter hand (`data-banner`), so Create account's box and action are in view at
  rest above the banner at 390 x 844 and 1280 x 800; the banner is never covered, never inert and reachable by Tab. The
  room kept is what of the banner lies inside the door's own box: with a phone's keyboard up the door follows the visual
  viewport and the banner, fixed to the foot of the layout viewport, is under the keyboard, so the door keeps nothing for
  it and the form has the whole of what is left of the screen; the room comes back when the keyboard goes down.

## The law it keeps

- The supplied artwork only: `equity-uprise-mark-white.png`, the owner's white mark for the World's dark grounds, on the
  stage's dark band by night and by day, complete and scaled in a 52 px square box (at or under the file's own pixels on a
  3x phone); no filter, mask, plate, shadow or outline (AGENTS.md, "The logos are not yours to draw").
- Two entities: the door names the company once, in its colophon; never Matthew McCluster, I AM HERE, Whip Equipped or
  PRIM3.
- Mobile first: min-width queries only, `minmax(0, 1fr)`, form controls at `max(16px, ...)`, the viewport meta unchanged;
  `scrollWidth === clientWidth` measured at 320, 390, 820 and 1280.
- Fonts are self-hosted: Playfair Display (one new roman file; the italic is the repository's variable italic) and Manrope
  from `css/style.css`. Nothing from a third-party font host. The two Playfair files (about 62 KB) are fetched on intent (a
  pointer or a key on the header's Join and Sign in or the guest card) or by the first open, never on a guest's arrival.
- No backdrop-filter over the globe frame; the only blur is the veil at 1100 px and up, which starts at the frame's last
  whole pixel, and none under `prefers-reduced-transparency`. Under `prefers-reduced-motion` nothing moves.
- Contrast at 4.5:1 or better for text by night and by day (3:1 for 24 px and up, or 18.66 px bold), measured from
  screenshot pixels with the glyphs masked. The night eyebrow (4.13:1 before) and the day reason line (1.62:1 before) pass.

## Where the spec was silent

- The first-visit privacy wall (`#mccPrivacyGate`) is spared from inert as the banner is: inerting it would leave a
  visitor unable to answer it.
- An Escape pressed inside the privacy notice is the notice's own ("Not now") and does not also close the door.
- While it waits for its answer the privacy notice rides above the World's bottom bar; with the door open that bar is under
  the door, so the notice returns to the bottom edge it keeps on pages without the bar, and the card has the room above it.
- The room the door keeps for the privacy notice runs under the whole width; at 1100 px and up the stage's dark shelf runs on
  through it, so the World beneath the notice (the bottom bar, the globe's legend) stays dimmed rather than bright.
- One set of sizes for both doors (a 30 px headline on a phone, 32 px from 700 px, 58 px fields, 56 px tabs), so switching
  between Sign in and Create account moves nothing but what it adds; the card stays clear of 300 px of the globe at 820 x
  1180, and the larger type waits for a desktop 900 px tall (review DR-M2: at 1280 x 800 Create account's action sat under
  the fade).
- The World's own words and controls over the Earth (its headline "The world is your feed.", the corner stack with the
  music's play/pause and the expand control, the tags, the filters, the place card) are hidden while the door is open, so
  the stage holds only the Earth and the door's own parts; they come back when the door closes, and the music plays on
  with its setting untouched. The globe frame's own legend, credit and controls live inside the frame: the veil (solid
  from 86 px above the frame's bottom edge) and, from 1100 px, the lower third's shelf (solid at its foot) lie over them, so
  the stage's copy of the credit is the one credit on screen; the feed's row, the guest card and the posts sleep under the
  same veil (review DR-m3: they peeked out beside the card at 820, with half of the Equity Uprise tab's mark).
- Each field's input box reaches up over its label (transparent) so the input itself is a 44 px target; the text sits where
  the design puts it.
- While busy, `css/mnet.css` makes every busy primary's label transparent; the door keeps its label with
  `-webkit-text-fill-color` rather than `!important`.
- The dateline rides on its own plate, as the cards do, in the phase's colours: over the real globe at 820 and 1280 the
  bare line measured 2.3:1 to 4.2:1 against the Earth's colours, so it is never left on the imagery.
- The crest sits on the stage, not in the sheet (review DR-M3: "let the crown sit on the Earth above the sheet"): centred
  over the Earth in the dark band at the top of the stage, where it is legible in both phases (the band is dark by day too,
  so the white mark is the right variant at every width) and costs the form no height. The dark variant is not used by
  the door. On a phone the way back reads "← Back", so the crest has the middle of the band.
- On a phone the pulse is one card under another, full width (the row of three cut its second card at the screen's
  edge): the first card from a 130 px stage (its content box), the second from 190, the third from 267. The record's line
  takes a second line rather than being cut ("Bridg…" at 390; release review RS-9, 2026-11-19), so the third card waits for
  the 17 px it needs.
- Behind the door the globe's news shading steps aside (the page says the door opened and closed, `mcc:door`, and
  `js/world-news-globe.js` sends `tint:false` while it is open): its orange, gold and red competed with the card's gold and
  read as a news map. From 1100 px the veil over the feed is whole (`rgb(4, 6, 9)`): at 0.94 the day feed's white came
  through as a grey column with a hard edge against the Earth's black (release review RS-9).
- The sheet's top edge goes soft when its words are scrolled under it (a fade, as at the foot), so nothing is sliced.

## Tests

- `scripts/test/world-gate.test.mjs` (in `npm test`): the files and their order in `mnet.html`, no "Hu Up", the markup, the
  stylesheet's law, the font's sha256 and licences, the notices, the credit, and `MCC_GATE` in a fake DOM (inert, history,
  Escape, Show / Hide, the live rules, busy, the doors by keyboard and what describes the password, the re-open race, the
  visual viewport and the banner flag, the pulse's words and reads with a capped read, the faces on intent, the focus on a
  touch screen, the action's need and the scrolled flag).
- `scripts/test/retired-tagline.test.mjs` (in `npm test`): reads `mnet.html` whole, the door included (the exception it
  kept for the old sign-in panel ended when the door replaced it, and is removed), and refuses the tagline anywhere on the
  World.
- `scripts/e2e/sign-in.e2e.mjs`: every flow with the auth client wrapped so each call and its arguments are recorded, and
  each request body recorded too, at 390 x 844, 820 x 1180 and 1280 x 800, by night and by day.
- `scripts/e2e/world-gate.e2e.mjs`: the screenshot set below and the acceptance checks; `results.json` keeps per frame the
  overflow, the rectangles, the loaded fonts, the visible text, the contrast of every text, the inert map and the request
  log. Every frame of the door also checks that no control lies under the fade at rest; every grid frame that the action
  is wholly in view at rest (inside the sheet, clear of the fade, the topmost thing at its centre and corners, with nothing
  scrolled first), the phone's stage carries the open mission, and at 820 and 1280 that the frame's own credit and legend
  and the feed's row and guest card lie under the solid veil or shelf; at 1280 by day the strip between the Earth and the
  card stays dark. The banner checks run at 390 and at 1280 in both doors, at rest. Further scenarios: what Chrome's
  accessibility tree says (names as written, the password's description by door, Show without a pressed state), the faces
  fetched only on intent, a touch screen's focus and a keyboard-sized visual viewport, the way back from a mission's Join,
  only the scrim and the sheet moving on the way in, no slash and one centred measure for the onboarding pages at 1280,
  and 320's doors and Forgot line on one line. From the verification: every control's real target (the run of points a
  tap lands on, not its box) in each grid frame, the stage's focus marks from pixels, the keyboard with the privacy notice
  waiting, and the news card's hours from the answer.
- Both browser suites stand on `scripts/e2e/support/world-gate-harness.mjs`: the checkout served as it ships, a fake
  `api.mccluster.org` and Supabase in memory, the globe's Cesium from `CESIUM_DIR` when it is set (aborted otherwise), and
  the privacy notice acknowledged except where a scenario is about the banner.

Screenshots (`node scripts/e2e/world-gate.e2e.mjs <outDir>`, deviceScaleFactor 2): `door-signin-{390,820,1280}-{night,day}`,
`door-create-{390,820,1280}-{night,day}`, `door-create-390-night-end`, `door-why-390-night`, `door-why-390-day`,
`door-why-1280-night`, `door-mission-390-night`, `door-error-390-{night,day}`, `door-create-error-390-{night,day}`,
`door-privacy-error-390-night`, `door-loading-390-night`, `door-verify-390-{night,day}`, `door-verify-1280-night`,
`door-provider-390-night`, `door-empty-{390,1280}-night`, `door-banner-signin-390-night`, `door-banner-create-390-day`,
`door-banner-signin-1280-night`, `door-reduced-motion-390-night`, `door-banner-create-1280-night`, `door-signin-320-night`, `door-create-320-day`,
`door-closed-after-back-390-night`, `door-open-{0,120,260,420}ms-390-night`, `onboard-{1,2,3}-390-{night,day}`,
`onboard-1-1280-{night,day}`. With `CESIUM_DIR` set the globe renders under the door (the motion frames keep its renderer
off, so their timing is the door's own); without it the layout checks still hold, but only the real globe tests the words
that sit over the Earth.

Both browser suites run on a pull request in the feed lane's workflow (`.github/workflows/human-uprise-editorial.yml`)
since the release preparation of 2026-11-18 (`docs/control-plane/WORLD-RELEASE-20261118.md`): its paths name
`css/world-gate.css`, `js/world-gate.js`, `scripts/e2e/world-gate.e2e.mjs`, `scripts/e2e/sign-in.e2e.mjs` and
`scripts/e2e/support/world-gate-harness.mjs`; `world-gate` and `sign-in` are in `matrix.suite`; and the cases are
`world-gate) node scripts/e2e/world-gate.e2e.mjs /tmp/hu-proof/world-gate ;;` and
`sign-in) node scripts/e2e/sign-in.e2e.mjs /tmp/hu-proof/sign-in ;;`. Until then they ran only by hand.

## Open questions for the owner

1. The door rises over the living World instead of replacing it. If you would rather it replaced the World as before, that
   is one line in `showGate` and the stylesheet.
2. "Get Your Hu Up!" is gone and nothing takes its place. Leave the space empty, or supply a line?
3. The new words above ("Welcome back", "New here", "Open now", "Last 24 hours", "On the record", "Today in the World",
   "Your mission", Show / Hide, "Both passwords match.", the bad-password line): are they right?
4. With one open mission the card says "Open now" with no count; the count shows from two. The door says "News from N
   countries", credited to GDELT, never the capped story total. Agreed?
5. The headlines on the door and the three pages are Playfair Display (OFL, one new file); the interface is Manrope.
6. The crest is the supplied 160 px white mark, now shown at 52 px so it stays sharp on 3x phones (its visible mark is
   about 35 x 19 px there). Larger exports of the two variants (480 px or more) would let it be shown larger. It sits on
   the stage above the door rather than in the sheet: say if you would rather have it back in the sheet.
13. On a phone the way back reads "← Back" so the crest has the middle of the band (from 700 px it reads "← Back to the
    World"). Agreed?
7. With the door closed, the bar's top-right "Sign in" still goes to `account.html`, which has no way back to a mission.
   Should the World open its own door instead? That changes the shared bar, outside this lane.
8. While the door is open, the bar's play/pause and the header's song title are covered; the music keeps playing and its
   setting is untouched. Agreed, or should the bar stay reachable above the door?
9. The October 5 rally photographs are not used. May they appear as a captioned, credited record of the event, with the
   agreement of the people pictured?
10. Members by country and live places are not shown even when available. Later?
11. Only email sign-in is switched on in Supabase; the door shows Google or Apple by itself once they are on.
12. Please confirm the Supabase Site URL, and that `https://mccluster.org/**` is in Redirect URLs, so a confirmation email
    sent from `mccluster.org` lands back there.
    Answered in the one-platform plan (2026-11-23): `https://mccluster.org/**` is in Redirect URLs (owner, 2026-11-18;
    `data/seo/domain-architecture.json` → `url_ownership.how_a_page_moves`), and setting the Site URL to
    `https://mccluster.org` is Matthew's step after P2 (`docs/control-plane/DOMAINS-AND-ENTITIES.md` → "The owner's
    steps"). Until then an email that uses the Site URL lands on the Site URL as it is set today.

## Verification fixes (2026-11-18)

Found by the verification of the door at `9e83fa17` (after the review fixes below), each with a test that fails without it:

| Finding | What changed | Proof |
| --- | --- | --- |
| A first visit on a phone, the keyboard up: the door kept the privacy banner's 219 px as empty space above the keyboard (the banner itself is under the keyboard) and left the form a 183 px window | `js/world-gate.js` keeps only what of the banner lies inside the door's own box, and measures again when the visual viewport changes | unit (the visual viewport and the banner) and e2e touch scenario, with a stand-in visual viewport |
| "Last 24 hours" was a constant, not a read | the hours come from the answer's own `window_hours`; no stated window, no card | unit (the pulse's words) and e2e pulse scenario |
| The news card's link could be tapped across 18 px only (the card's source line cut it), the credit's links across 37 px (the sheet, or the screen's edge, lay over the rest); the suite measured boxes, not targets | the source line is cut along its length only; the credit's links have their 44 px inside the stage | e2e: every control's real target in each grid frame; unit (stylesheet) |
| The stage's focus marks: the mission card's line was half cut from 700 px and read under 3:1 against the Earth on a phone; the news link's line was all but cut at every width | each mark is drawn inside its own plate: a line inside the mission card's edge, a link's words on a solid ground | e2e focus scenario: the stage's focus marks from pixels at 390, 820 and 1280, by night and by day; unit (stylesheet) |
| The floating card (700 to 1099 px) on a short screen: on a tablet on its side (1024 x 768) the card lay over half of the cards and all of the credit in Sign in, and over the crest in Create account; upright (768 x 1024) over the credit in Create account; in a 900 x 700 window over the Back pill too. Only 820 x 1180 was measured | the card stops under the way back and the crest (68 px); the stage's lower third shows what has room above the card (the credit from 104 px of stage, the row of cards from 246, the dateline from 290) and nothing runs under the card | e2e short scenario at 1024 x 768, 768 x 1024 and 1000 x 650, both doors; unit (stylesheet) |
| The tagline guard still carried the exception for the old sign-in panel: the old panel put back byte for byte passed it | the exception and its pinned hash are removed; `mnet.html` is read whole | `scripts/test/retired-tagline.test.mjs` |

Recorded, not changed: at 390 x 844 the Sign in sheet starts at 308 px (the judge's target was 150 to 260, set before the
review moved the pulse onto the phone's stage and made the sheet as tall as what it holds); in the emailed state Resend is
drawn above the fields but follows the action in the Tab order (the spec's CSS order); a mission whose points are not set
reads "0 points", as it does in the World's feed (`js/world-mission-posts.js`); on a tablet on its side the stage is too
short for the row of cards, so Sign in shows the way back, the crest and the credit there, and no pulse; with the privacy
banner still waiting, the action needs a scroll inside the sheet at 320 x 640 (both doors) and in Create account at
1024 x 768 (the fade says there is more): only 390 x 844 and 1280 x 800 were asked to hold it at rest.

## Review fixes (2026-11-18)

The review of the door at `31e55c9b` (findings DR-M1 to DR-m11) and what changed:

| Finding | What changed | Proof |
| --- | --- | --- |
| DR-M1 first visit with the banner: Create account's box and action out of view at 390 x 844 and 1280 x 800 | the sheet's height takes the action's measured need over the stage; a tighter hand while the banner waits; the note about the three pages moved under the action | e2e banner checks at rest (no `scrollIntoView`) at 390 and 1280 in both doors, the box too |
| DR-M2 1280 x 800: the action under the fade, the emailed state's Sign in clipped | one set of sizes, the larger type only on screens 900 px tall; the card 24 px from the top and bottom beside the Earth; the action drawn above the fade | e2e: every grid frame's action at rest and clear of the fade, 1280 without a scroll |
| DR-M3 the phone read as an ordinary login | the pulse on the stage in every state that has the room (one card under another, the open mission first), the crest over the Earth in the stage's band, an opaque sheet with an engraved double rule, a soft top edge | e2e: the stage's cards per phone frame, the crest's file, box and band; screenshots in `final/` |
| DR-m1 stagger and sweep | removed; only the scrim and the sheet move | unit (stylesheet) and e2e motion |
| DR-m2 Back from a mission's Join lost the mission | the Back pill (and so Escape, the scrim and the phone's Back) reopens the mission named in `?mission=` | e2e mission scenario, by the pill and the phone's Back |
| DR-m3 the World peeked out at 820 and 1280 | the veil starts 108 px above the frame's foot and is solid 22 px down; the shelf is solid at its foot; from 1100 px the veil is flat and starts at the frame's last whole pixel | e2e peek and seam checks |
| DR-m4 the sheet was 97-98 % opaque | opaque | unit (stylesheet) |
| DR-m5 the hint described the password in Sign in; Show changed name and pressed state; names read upper case | the hint joins the description in Create account only; no `aria-pressed`; small capitals by `font-variant-caps` | unit and e2e (Chrome's accessibility tree) |
| DR-m6 a capped count shown as exact | "N+ countries" when the read was capped | unit (words) and e2e grid |
| DR-m7 the refusal named a control that is not there | it quotes "Forgot or don't know your password?" | unit and the sign-in e2e |
| DR-m8 fonts fetched on every guest visit | fetched on intent or on the first open | unit and e2e fonts scenario |
| DR-m9 details | balanced card titles, one-line doors and Forgot at 320, a soft top edge, a solid band over the header from the first frame, the onboarding pages without the slanted line and in one centred measure at 1280 | e2e |
| DR-m10 CI and evidence | the checks above; `final/` regenerated from this head. The CI entry still belongs to the feed lane's workflow (named under Tests) | |
| DR-m11 the keyboard rose over the sheet on open | the door, not the email, takes the focus on a touch screen; the focused field is kept in view when the visual viewport shrinks | unit and e2e touch scenario |

The render-blocking stylesheet stays: the World already blocks on its own styles (`css/style.css` 412 KB and
`css/mnet.css` 140 KB before compression), the door's 53 KB (13 KB compressed) is what lets `?signin=1` paint the door whole in its
first frame and keeps the members' onboarding pages in their skin, and loading it late would bring back the old gate's look
for a frame.
