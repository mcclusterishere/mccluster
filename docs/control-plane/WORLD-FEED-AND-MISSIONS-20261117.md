# The World feed and public missions: owner direction of 2026-11-17

Status: build brief and resume point. Work happens on `claude/new-session-83ken5`; nothing here is merged,
deployed or applied to the production database. Every production step at the end needs the owner's approval of
the exact change.

## The owner's words (2026-11-17)

- "Right now, let's just deal with the globe in the repository. I need it functional as far as like the globe
  itself. I need the missions like from project … drawdown … I need all those missions. Import. … we need them on
  the globe for the signed out users so people can just go look at the missions, sign in, get that user flow. And I
  want you to also like finish productizing the site." The site is the mccluster.org World.
- "I think the missions should low key just be placed in the newsfeed instead of having that Tinder swipe tab. …
  I don't like it. But having the missions as like just another post in the newsfeed, not a big, large post, just
  the same size post as all the other [posts]."
- "whenever you click on a country, when you click on America, you should be able to say, see X amount of news,
  X amount of missions, and [so on]."
- "it should be another tab called the equity uprise tab. That's on the feed, like not in the center on the globe
  section as a tab, but on the feed section under the globe, like there's just that scrolling tab thing you can
  like drag left and right."
- "Should start on everything, but you can individualize it to select mission feed. So it starts on everything
  with all that stuff combined, the missions, the feed, the news, all that in its own like one tab."
- "the equity uprise is definitely that nomenclature … the logo, the PNG logo that is there, put that on that tab,
  but don't make it ugly … Just keep it as is."
- "that whole environmental justice panel behind the E=up button is a [joke]. Needs to be fixed."
- "Project Drawdown gave us specific explicit permission already." "Just credit them."

## What this supersedes

| Earlier rule | Now |
| --- | --- |
| `AGENTS.md`, owner 2026-11-07: the public modes are News feed and Environmental Justice; general Missions stay owner-only | Missions are public, as posts in the World feed. Travel stays owner-only (the owner did not mention it). |
| `MISSION-RESET-DOCKET-516R.md`, owner 2026-10-17: the Missions tab shows one card at a time; left passes, right accepts | The swipe deck is removed. |
| Owner 2026-11-07: the E=UP logo is a mode button in the centre of the globe | The E=UP logo is a tab in the feed's scrolling tab strip; the Environmental Justice panel lives behind that tab. |
| Owner 2026-10-19: the strip reads Local, Global, Live, News, People; "Global is everything" | The default tab is labelled Everything (same `global` key) and the strip gains the Equity Uprise tab. |
| PR #726, owner 2026-11-03: the explorer's mission feed and pin detail are owner-only (`css/globe-games.css`) | Mission pins, their detail and their join are public. The games controls stay owner-only. |

## The target

1. **The feed strip** (`#mnFeedScope`, the drag-scrolling row under the globe): Local · Everything (key `global`,
   pressed on load) · Equity Uprise (key `equity`) · Live · News · People.
2. **The Equity Uprise tab** shows the owner-supplied PNG only: `assets/img/equity-uprise-mark-white.png` on a dark
   ground, `assets/img/equity-uprise-mark.png` on a light (daylight) ground. Choosing a supplied variant is not
   recolouring. Scale proportionally to the strip's icon size; no plate, filter, crop or visible words. Its
   accessible name is "Equity Uprise". (`AGENTS.md`, "THE LOGOS ARE NOT YOURS TO DRAW".)
3. **Everything** combines member posts, news and missions in one stream. Missions are interleaved at a modest
   ratio (no more than one mission per few other items), each mission at most once per page.
4. **The Equity Uprise tab** is the mission feed: every open mission as a post, with the Environmental Justice
   panel above them.
5. **A mission post** is the same size and shape as any post (`mn__post-card`): a header with the mission's kind
   and domain (never the brand written out), the title, the description clamped like a post body, one meta line
   (difficulty and points), a compact source line for sourced missions that opens the full credit, and the
   post's action row. The join is the Equity Uprise emblem alone (accessible name "Join this mission"), as on the
   rest of the World; a Details action opens the mission dialog. No hero, no stack, no swipe.
6. **The mission dialog** works for a signed-out visitor: full description, proof hint and safety line, the
   `about` quotation with `about_credit` beneath it when present, the full `credit_line`, and Join. A guest's Join
   asks them to sign in or create an account and keeps `?mission=<id>`, so they return to that mission.
7. **The swipe deck is gone**: `.hu-mission-preview`, `#huMissionList`, `#mnWorldEup`, `js/mission-swipe-deck.js`,
   its styles and `scripts/e2e/mission-swipe.e2e.mjs`. The "Open missions" block that filled a short feed is
   replaced by the mission posts.
8. **The centre mode bar** loses the Missions and E=UP buttons. A signed-out visitor or member sees no centre
   mode bar. The house owner keeps Travel beside the feed.
9. **The country card** (`#mnPlaceCard`) shows real counts: news in the last 24 hours, missions, posts and
   members. A country's missions are the open missions pinned there plus the open missions that can be done
   anywhere. Picking a country turns the feed to Local, which lists that country's posts, news and missions.
10. **The globe** shows mission pins to everyone (no `missions=0`). A pin exists only where the owner placed a
    mission; a mission that can be done anywhere has no pin. Production has no pins today.
11. **The Environmental Justice panel** reads clearly by day and by night, says plainly when its sources are
    unavailable instead of showing a broken state (production answers 503 until its SQL is applied), and lists
    official reports (NWS, NASA EONET, USGS, NOAA NHC) with their source links. A report is not evidence of
    exposure or injustice and is never labelled so. The abandoned branch
    `codex/equity-environment-always-visible-20261109` (`a47f9a31`) is salvaged where it helps.
12. **Sign in and return**: from a mission post, the dialog, a pin, a shared link or the bar's Sign in chip, a
    guest who signs in (or creates an account and confirms it) comes back to that mission, and Join sends exactly
    one `join_action_mission`.

Mobile first (`AGENTS.md`, hard rule 14): designed at 390 px, verified at 390, 820 and 1280 with
`scrollWidth === clientWidth`.

## Mission data

- `data/missions/drawdown/missions.json`: 125 missions written for this site from Project Drawdown's Explorer and
  its CC BY 4.0 assessment records. `README.md` there holds the credit and display rules.
- Production `public.action_missions` has no column for a proof hint, a safety line or a credit
  (`proof_required` is a boolean). These live in a new table, `public.action_mission_details`
  (one row per mission: catalog, slug, proof hint, safety note, credit line, about, about credit, source URL,
  licence name and URL, DOI), readable by anyone exactly when its mission is (open, paused or closed), written
  only by the service role. The page tolerates its absence.
- Anonymous visitors read open missions through the existing policy "public reads open missions" (open, paused
  and closed rows).

## Production steps (owner approval of the exact SQL, each on its own)

1. Decouple joining from pins (`join_scope`, default `anywhere`), extracted from
   `supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql`. No pin may be written before it:
   today any pin row makes its mission unjoinable for everyone.
2. Create `public.action_mission_details` and import the chosen missions (generated SQL, idempotent).
3. Publish them (status `open`).
4. Place pins the owner chooses.
5. The Environmental Justice module: `eup_module_policy_v1.sql`, then `20261107120000_world_environment_v1.sql`
   (`PROMOTION-ORDER.md`), then the environment module's policy row.
6. Supabase Auth: confirm `https://mccluster.org/**` is in the Redirect URLs (dashboard).

## Owner decisions (2026-11-17, answered in session)

- **Joining a mission** keeps today's rule: a new member completes the three profile pages (legal name, mailing
  address, phone), then joins instantly through `join_action_mission`. No application step for now.
- **First visit**: the full-screen "Privacy before entry" wall on the World becomes the existing banner mode
  (`<meta name="mcc-privacy-notice" content="banner">`), so the globe and the missions show at once. Analytics stay
  off until the visitor agrees, as before.
- **"Get Your Hu Up!"** is removed from the World's sign-in panel and the `/company` footer, and from anywhere else
  it is public.

## Build queue

| Slice | What | State |
| --- | --- | --- |
| W1 | Law, missions public, Travel owner-only, swipe deck and centre buttons removed, Equity Uprise tab, Everything label, guest deep links | not started |
| W2 | Mission posts in Everything and the Equity Uprise tab, the dialog's credits, country card counts, Local missions | not started |
| D1 | Pending SQL: join scope, mission details table, catalog import generator and its tests | done: four pending files with rollbacks (`PROMOTION-ORDER.md` section 10), `tools/build-mission-import.mjs`, `scripts/test/mission-import.test.mjs`, native proof (84 checks) and `scripts/test-mission-pins-db.sh` passed on PostgreSQL 16.15 and 17.7 (production runs 17.6). Nothing applied. Whoever first names `action_mission_details` in shipped code adds it to `live-callers.json` `pending_only` |
| W3 | Environmental Justice panel (salvage, daylight, honest unavailable state, browser acceptance) and its production SQL bundle | not started |
| W4 | Sign in and return from every mission entry, with an end-to-end suite | not started |
| W5 | The globe itself: absent-RPC 404s, render resilience and idle cost, keyboard zoom, other globe entries | not started |
| W6 | Productize: public brand sweep, site defects (CMS key, editor gate, null prices, capsule overlap) | not started |
