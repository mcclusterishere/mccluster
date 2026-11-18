# The World's sign-in: the door

Owner, 2026-11-18: "Also, the sign-in page just looks like shit. It needs to be fancier, look sexier, and have more shit
to it. Instead, it looks like a commoner built it. This is royalty shit over here, gang."

This records what was built for that request, why, where every word on it comes from, and how it is tested.

## What it is

The World's sign-in (`#mnSignedOut` in `mnet.html`) no longer replaces the World. It rises over it, as a door:

- at 390 px (the design), a bottom sheet; from 700 px a floating card; from 1100 px a card in a right-hand column beside
  the Earth;
- the World stays on screen under it (`#mnApp` displayed, made inert), with the real globe turning under a scrim;
- the stage above the sheet holds the way back (`← Back to the World`), the World's real pulse and the Earth's credit;
- the sheet holds the supplied Equity Uprise artwork (the crown), "The place for doers.", the headline in Playfair Display
  with *into action* in italic and a red full stop, the two doors (Sign in / Create account, with "Welcome back" and "New
  here" over them and one gold rule that slides between them), the form, and the colophon "A McCluster Corp program.".

The three onboarding pages (`#mnProfileGate`) are still pages that replace the World (`html.mn-gate-on`, their padding
clears the bar, their markup unchanged). They take the door's hand: the serif headline, the tokens, and a readable day page
(it was black type on a near-black ground).

Architecture: the "cinematic world" direction, with the "regal editorial" typography and craft grafted on, as judged on
2026-11-18. "Get Your Hu Up!" is gone from the World (owner, 2026-11-17) and nothing replaces it.

## Files

| File | What |
| --- | --- |
| `mnet.html` | the door's markup (ids kept; new parts use the `wg-` prefix); the stylesheet link after `css/daylight.css`; the script before `js/mnet.js` |
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
| News | `GET https://api.mccluster.org/v1/world/news-heat` | "Last 24 hours", "News from N countries" (countries with a story); "The GDELT Project", linked. The capped story total is never shown |
| Record | `GET https://api.mccluster.org/v1/action-archive/docket-516r-2025`, else `data/action/docket-516r-archive.json` | "On the record", "Docket 516R · Write the Change", "10 participants · 9 songs · Bridgeport, CT · Oct 5, 2025": counts only, no name, no photograph, no link |
| Dateline (700 px and up) | the visitor's own clock | "Today in the World · <their date>", shown when a card is |
| Credit | the globe frame's own credit line, copied as text and links (`#mnWorldFrame` `.osm-credit.is-editorial`) | else "NASA imagery · Natural Earth · © OpenStreetMap", the World's words |

Never shown on the door: members by country, live places, public posts, place scope, environment reports, the rally
photographs, the building renders, the M mark, Drawdown imagery or logos. The words "Equity Uprise" never appear in the
door's visible text, and the crown is never captioned.

New lines (the rest are the World's existing words, unchanged): the tab kickers "Welcome back" and "New here"; "Show" /
"Hide" and "Show password" / "Hide password"; "Both passwords match."; "That email and password don’t match an account.
Check them, or use Forgot password." (for `invalid_credentials` only; every other refusal shows the server's message);
"A McCluster Corp program."; "Today in the World", "Open now", "Last 24 hours", "News from N countries", "On the record",
"Your mission", "Open the mission: ".

## How it behaves

- **Opening.** Only when asked, from today's callers: the header Join, the guest card, every members-only tap
  (`askToSignIn`), the globe's `hu:ask-sign-in`, `?signin=1`, `?join=1`, a flow (`?next=`, `?finish=1`, a pending
  sign-up) and "Your sign-in ended. Sign in again.". A World dialog open under it is closed first (`dialog.close()` fires no
  cancel, so `?mission=` stays). Everything outside the door becomes inert except the privacy notice (and its first-visit
  wall); the phone's Back gets one history entry; the sheet rises 28 px over 420 ms only after a gesture. A door opened by
  the address is whole in its first frame.
- **Closing.** The Back pill, Escape (a filled field lets go first; nothing while composing; the privacy notice's own Escape
  is its own), a tap on the scrim, the phone's Back, the mission card (a hand-off), a sign-in that worked. Inert comes off at
  once; the sheet falls for 220 ms; focus goes back to what opened the door; the typed email stays; passwords are hidden
  again. The World is where it was: no scroll to the top.
- **History.** One entry while open (`{mccDoor: 1}`, same URL). A close from the page steps back over it; the phone's Back
  is the close; a hand-off or a success replaces it, so a later Back never reopens the door.
- **The form.** The status line sits directly over the action and every field is described by it; the field it names
  keeps its ring. In Create account, the ring under the password fills at 8 characters and a tick appears in the confirm
  field when both match (announced once). While a sign-in or a sign-up is on its way the action is `aria-busy` with a
  turning ring and a gold thread. The emailed state is a sealed note that leads the panel with Resend under it.
- **The privacy banner** (banner mode on the first visit, owner 2026-11-17): the door reserves its height at the bottom,
  the sheet scrolls inside above it, and the banner is never covered, never inert and reachable by Tab.

## The law it keeps

- The supplied artwork only: `equity-uprise-mark-white.png` by night, `equity-uprise-mark.png` by day, complete and scaled
  in a square box; no filter, mask, plate, shadow or outline (AGENTS.md, "The logos are not yours to draw").
- Two entities: the door names the company once, in its colophon; never Matthew McCluster, I AM HERE, Whip Equipped or
  PRIM3.
- Mobile first: min-width queries only, `minmax(0, 1fr)`, form controls at `max(16px, ...)`, the viewport meta unchanged;
  `scrollWidth === clientWidth` measured at 320, 390, 820 and 1280.
- Fonts are self-hosted: Playfair Display (one new roman file; the italic is the repository's variable italic) and Manrope
  from `css/style.css`. Nothing from a third-party font host.
- No backdrop-filter over the globe frame; the only blur is the veil at 1100 px and up, which starts at the frame's right
  edge, and none under `prefers-reduced-transparency`. Under `prefers-reduced-motion` nothing moves.
- Contrast at 4.5:1 or better for text by night and by day (3:1 for 24 px and up, or 18.66 px bold), measured from
  screenshot pixels with the glyphs masked. The night eyebrow (4.13:1 before) and the day reason line (1.62:1 before) pass.

## Where the spec was silent

- The first-visit privacy wall (`#mccPrivacyGate`) is spared from inert as the banner is: inerting it would leave a
  visitor unable to answer it.
- An Escape pressed inside the privacy notice is the notice's own ("Not now") and does not also close the door.
- At 700 to 1099 px, Create account is compacted (a smaller crown and headline, 58 px fields) so the card stays clear of
  300 px of the globe at 820 x 1180; at 1100 px and up the spec's sizes apply.
- The World's own headline ("The world is your feed.") is hidden while the door is open, so the stage's words never sit on
  it; it comes back when the door closes.
- Each field's input box reaches up over its label (transparent) so the input itself is a 44 px target; the text sits where
  the design puts it.
- While busy, `css/mnet.css` makes every busy primary's label transparent; the door keeps its label with
  `-webkit-text-fill-color` rather than `!important`.
- The dateline sits on the dark shelf in both phases, so it keeps the night gold and grey by day.

## Tests

- `scripts/test/world-gate.test.mjs` (in `npm test`): the files and their order in `mnet.html`, no "Hu Up", the markup, the
  stylesheet's law, the font's sha256 and licences, the notices, the credit, and `MCC_GATE` in a fake DOM (inert, history,
  Escape, Show / Hide, the live rules, busy, the doors by keyboard, the re-open race, the visual viewport, the pulse's
  words and reads).
- `scripts/e2e/sign-in.e2e.mjs`: every flow with the auth client wrapped so each call and its arguments are recorded, and
  each request body recorded too, at 390 x 844, 820 x 1180 and 1280 x 800, by night and by day.
- `scripts/e2e/world-gate.e2e.mjs`: the screenshot set below and the acceptance checks; `results.json` keeps per frame the
  overflow, the rectangles, the loaded fonts, the visible text, the contrast of every text, the inert map and the request
  log.

Screenshots (`node scripts/e2e/world-gate.e2e.mjs <outDir>`, deviceScaleFactor 2): `door-signin-{390,820,1280}-{night,day}`,
`door-create-{390,820,1280}-{night,day}`, `door-create-390-night-end`, `door-why-390-night`, `door-why-390-day`,
`door-why-1280-night`, `door-mission-390-night`, `door-error-390-{night,day}`, `door-create-error-390-{night,day}`,
`door-privacy-error-390-night`, `door-loading-390-night`, `door-verify-390-{night,day}`, `door-verify-1280-night`,
`door-provider-390-night`, `door-empty-{390,1280}-night`, `door-banner-signin-390-night`, `door-banner-create-390-day`,
`door-banner-signin-1280-night`, `door-reduced-motion-390-night`, `door-signin-320-night`, `door-create-320-day`,
`door-closed-after-back-390-night`, `door-open-{0,120,260,420}ms-390-night`, `onboard-{1,2,3}-390-{night,day}`,
`onboard-1-1280-{night,day}`. With `CESIUM_DIR` set the globe renders under the door; without it the layout checks still
hold.

The CI entry belongs to the feed lane's workflow (`.github/workflows/human-uprise-editorial.yml`), named here rather than
edited: add the paths `css/world-gate.css`, `js/world-gate.js`, `scripts/e2e/world-gate.e2e.mjs`,
`scripts/e2e/sign-in.e2e.mjs` and `scripts/e2e/support/world-gate-harness.mjs`; add `world-gate` and `sign-in` to
`matrix.suite`; and add the cases
`world-gate) node scripts/e2e/world-gate.e2e.mjs /tmp/hu-proof/world-gate ;;` and
`sign-in) node scripts/e2e/sign-in.e2e.mjs /tmp/hu-proof/sign-in ;;`.

## Open questions for the owner

1. The door rises over the living World instead of replacing it. If you would rather it replaced the World as before, that
   is one line in `showGate` and the stylesheet.
2. "Get Your Hu Up!" is gone and nothing takes its place. Leave the space empty, or supply a line?
3. The new words above ("Welcome back", "New here", "Open now", "Last 24 hours", "On the record", "Today in the World",
   "Your mission", Show / Hide, "Both passwords match.", the bad-password line): are they right?
4. With one open mission the card says "Open now" with no count; the count shows from two. The door says "News from N
   countries", credited to GDELT, never the capped story total. Agreed?
5. The headlines on the door and the three pages are Playfair Display (OFL, one new file); the interface is Manrope.
6. The crown is the supplied 160 px file shown at 52 to 96 px, a little soft on 3x phones. Larger exports of the two
   variants (480 px or more) would sharpen it.
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
