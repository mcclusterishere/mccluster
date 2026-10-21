# The owner's front page, controlled from Control

Owner, 2026-10-21:

> "My front page as the admin is not my actual site's front page, which is weird. I should be able to control my site's
> front page, like the actual front page of the website, with, you know, the scroll dependent and the VR and all that
> stuff from my admin panel, which I can't, and it should represent as my actual front page, which it doesn't."

## What was wrong

- **The owner's M opened a member card.** In the shared bar (`js/tabbar.js` `paintPerspective`), the middle M opened
  `member-front.html?handle=…` for every signed-in account, the owner's included. That was a profile card, not
  `index.html`. The 2026-10-14 rule had been lost: "M is the McCluster platform home for everyone".
- **The founder's door never switched the M back.** The check meant to do this (`HOUSE_VISIT`) used a double-escaped
  pattern, `/matthew-mccluster\\.html$/`, which never matched.
- **Control had no view of the site.** Control → Home is operations.
- **The real page could only be edited for text.** Its pencil (`js/site-editor.js`) reaches words only. The scroll
  scenes, the 360 cabin and the films were constants in `js/main.js`.

## What it is now

### The M

- With the owner's bar on (the server's `/v1/status` answer), the M is `index.html`, his actual front page.
- The `HOUSE_VISIT` pattern is fixed, so visiting `matthew-mccluster.html` sets the M back to the house's front page.
- Members are unchanged.

### Control → Create → Front page

The view lives at `control.html#create:front-page`, in `js/control-room/front-page.js`. Its other route names are
`front`, `site`, `homepage`, `home-page` and `index`.

**The preview is the page itself.**
- It is a frame holding `index.html` on this origin, laid out at a phone's width (390) or a desktop's (1280) and scaled
  to fit.
- Its buttons go to the top, the Vaunt scene, the middle of the 360 cabin, the night descent and the World.
- The frame shares the owner's session. The World at the end is a guests' scene, so `js/guest-world.js` shows it inside
  the preview as a guest would see it.
- On a phone the settings sit under the preview. From 1100px they are beside it, the whole stage fits the window, and
  the settings scroll in a column of the same height.

**What it controls.** One row in `site_content` (`page = 'index.html'`, `slot = '@front'`, a JSON value):

| Setting | Values | As shipped |
|---|---|---|
| Scenes on the page | the hero's two doors, the Vaunt scene (with its cabin), the night descent, the World at the end | all on |
| Scroll feel | Smooth / Standard / Quick, or a glide of 0.3–1.8 s and a finger follow of 0.05–0.4 | 0.85 s, 0.14 |
| The 360 cabin | on/off; whether it holds the page; where in the Vaunt scene it opens and ends (15–85%) | on, holds, 40–50% |
| The cabin's opening view | turn −180–180°, tilt −85–85°; "Use the preview's view" takes it from the cabin in the preview | −140°, −32° |
| The cabin's tags | up to five, each a label (60 characters) and a link (a page on this site or an `https://` address); "Pin where the preview looks" places one | the three shipped tags |
| The night room | where LOCK IN arrives in the descent, 50–86% | 74% |

**How a change reaches visitors.**
1. While editing, each change is posted to the frame only: `mcc:front-preview`, which only a Control Room parent on
   this origin can send.
2. The page answers with what it applied (`mcc:front-applied`).
3. **Save** writes what the page applied through `site_content_set`. That is the house admin's RPC, under the owner's
   session.
4. **Reset** deletes the row (`site_content_revert`), and the page is exactly as shipped again.
5. Every write is kept in `site_content_history` by the table's own trigger.
6. Words stay with the pencil, which works in the preview too.

### The page (`js/main.js`)

**Reading the settings.**
- `js/live-content.js` already fetches `site_content` for every visitor. It now also exposes the rows
  (`window.MCC_CONTENT_ROWS`).
- `main.js` reads `@front`. `frontConfig` checks and bounds every value. Anything missing or wrong keeps the shipped
  value, so no row, or a bad one, gives the page exactly as it shipped.
- `window.MCC_FRONT_DEFAULT` is what the page does with no row. Control starts from it, so the two cannot drift.

**Applying them.**
- **Scroll feel** applies at once: Lenis reads its options live.
- **The night room** applies at once.
- **The cabin's band** applies at once. Turning the hold off while someone is inside hands the page back at once.
- **The cabin's tags** apply at once, even in a cabin that is already open. The opening view applies the next time the
  cabin opens.
- **A scene turned off** is taken out with `data-front-off`, an attribute only this code sets. The World's own `hidden`
  rule for signed-in visitors is never undone. The scroll pins are then measured again.
- Turning off the Vaunt scene turns off its cabin too, so nothing can hold the page from a band that is not there.

**Safety.**
- A tag link that is not a page on this site or an `https://` address is dropped by the page. Control shows the
  reason, keeps the tag in the form, and holds Save until it is fixed.
- Tag labels are escaped before the 360 viewer, which writes them as HTML.

### Analytics

`js/analytics.js` records nothing inside the Control preview (`mccControlPreview()`): the owner looking at his page is
not a visit.

## Rules kept

- `index.html` is not edited (AGENTS.md hard rule 3; CLAUDE.md).
- No new backend, table or route. `site_content` and its RPCs exist since 2026-09-22, and the owner's account is the one
  `mnet_is_admin()` names.
- Phone first: min-width queries only, `minmax(0,1fr)`, 44px targets, 16px inputs, no sideways scroll at 390.

## Tests

- **Unit:** `scripts/test/control-surface.test.mjs` (the Create list) and `scripts/test/account-identity-gate.test.mjs`
  (the preview records nothing).
- **Browser:** `scripts/e2e/control-front-page.e2e.mjs`, run locally. CI does not run it yet; adding it to a workflow is
  the owner's call. It checks:
  - a visitor with no row gets the shipped page, with the cabin holding;
  - a visitor with a row gets scenes off, the saved scroll feel and night room, a cabin that lets go, a script link
    dropped, and labels kept as text;
  - the owner's M is `index.html`;
  - Control → Front page at 390 and 1280: the preview is the real page, previews come before saving, the view is taken
    from the cabin, a bad tag is refused and then fixed, Save writes what the page applied, Reset deletes the row, and
    the preview records no visit.
