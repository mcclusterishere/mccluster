# Every account's front page

Owner, 2026-10-21:

> "make sure everybody else's page can replicate the same experience. I think we built something like an editor, and
> I've never seen the editor ... I have a whole account on Hitman Benji ... I never seen nothing like that, like at all,
> to be able to edit my profile ... all the accounts need to be able to recreate with their own media this exact same
> experience. The experience being my front page with a VR, with the scroll dependent video, all this."

## What was there before

- **An account's "front page" was a profile card.** `member-front.html` shows a name, a picture, a bio and counts. Its
  only editor is "Customize", which changes those fields.
- **The experience belonged to `index.html` alone.** The scroll films, the 360 cabin and the night descent were the
  house page's, with the house's media.
- **No account could make its own.** There was nowhere to upload a film or a 360, and nothing that would play them.

## What it is now

### The page: `front.html?u=<handle>`

- **The house page used as a template.** It has the same scenes, the same element ids, the same scroll engine
  (`js/main.js`) and the same 360 cabin (`js/vr360.js`). `index.html` is not touched.
- **The loader** is `js/front-member.js`. Before the engine starts, it reads the account's published page from the
  Worker (`GET /v1/fronts/:handle`). It then puts in:
  - the account's words, as text only, never markup;
  - its still, its soundtrack and its links.
  Then it starts the engine with the account's settings.
- **Scenes without media are switched off.**
  - With no scene films and no 360, there is no Vaunt scene.
  - With no closing film, there is no night descent, and the closing links move to the foot of the page.
  - The World at the end is the house's, so it is off.
- **Defaults for an account that has typed nothing:** its name as the title, `@handle` under it, and a "Follow me on the
  World" button to its profile.
- **Its 360 room has its own tags or none.** The house page's tags (the Vaunt cockpit, "Get to the bag", the résumé) never
  appear on an account's page (`frontConfig(raw, member)` in `js/main.js`; Codex #595).
- **Media URLs are checked twice.** The engine accepts a film, a 360 or a track only from an account's own folder of the
  `front-media` bucket (`FRONT_MEDIA_RE` in `js/main.js`). The Worker has already checked that the folder is this
  account's.
- **Other states.**
  - Not indexed (`noindex`): the words are the account's.
  - An account with no page gets "No front page yet", a link to its card and a link to the editor. The engine does not
    start.

### The editor: `front-studio.html`

Every signed-in account with a handle gets it. It is free; there is no tier.

**The preview is the real page.**
- It is `front.html` in a frame, at phone (390) or desktop (1280) width, scaled to fit.
- The editor hands the frame the draft. The frame takes it only from its own parent on this origin, never from a URL.
- Buttons go to the top, the films, the 360 room and the close.
- Words and media reload the frame. The hold, the opening view, tags, the close timing and the scroll feel apply live.

**What an account sets:**

| Group | Settings |
|---|---|
| Words | The line above the name, the two-line title (the second line in red), the line under it, and two buttons (label and link). |
| Films | Opening, scene 1, scene 2 and closing. Each is any short video, cut into frames in the account's own browser (see below). Also a photo for behind the title when there is no opening film. |
| 360 room | A 360 video (MP4 or WebM, up to 300 MB) or photo. Whether it holds the page. Its opening view ("Use the preview's view"). The room card's words. Up to five tags, each placed with "Pin where the preview looks". |
| Soundtrack | MP3, M4A, AAC or WAV, up to 30 MB. |
| The close | Its words and up to four links. |
| Feel | Smooth, Standard or Quick scrolling, and when the closing words arrive. |

**A link** is a page on this site or an `https://` address. A bad one is named in its own row, and Save and Publish wait
until it is fixed.

**Fields are never redrawn under the hand typing in them.** Moving from one field to the next keeps what was typed and
the next tap. Only adding or removing a row redraws the form.

**Saving:**
- **Save draft** keeps the draft.
- **Publish** puts it live at `front.html?u=<handle>`.
- **Take it down** unpublishes it and keeps the draft.
- What the Worker did not keep is listed by name ("Not kept: …").

**Layout.** Phone first: the preview, then the settings under it. From 1100px they sit side by side. Fields are 16px
type and every control is at least 44px.

### Films are frames, cut on the account's device

- **Why frames.** The house's scroll films are frame sequences, not video: the engine draws frame N for scroll position
  N, which is why the scrub feels held.
- **How a film is cut.** `js/front-media.js` does it in the browser, from the video the account picks:
  - 12 frames a second, between 48 and 160 frames;
  - each at 1280px and at 640px (the engine's phone set, `sm/`);
  - WebP, or JPEG where the browser cannot make WebP (Safari).
- **Where the frames go.** They are uploaded as they are cut, with the account's own session, to
  `front-media/<auth uid>/films/<id>/`. Nothing is sent to a server to be processed.
- **Other media** (the 360 room, the photo, the track) is uploaded as it is, after a type and size check. A 360 must be
  twice as wide as it is tall. A 360 video also gets a poster from its first frame.
- **What a page no longer uses leaves the folder.** After every save, publish and take-down, the editor removes any file
  in the account's folder that neither its draft nor its published page uses: a replaced film's frames, a swapped 360,
  an upload never saved (`sweep` in `js/front-media.js`). A film cut that fails takes its frames back with it. Saving a
  draft keeps what the published page still plays. Uploads wait for a sweep to finish.

### The doors

- **The card (`member-front.html`):**
  - For its owner it shows "Build my front page" (or "Edit my front page" once one is published) and "My front page".
  - "Customize" is now "Customize my profile card".
  - Anyone else, signed in or not, is taken into the published page, unless they asked for the card (`&card=1`).
  - A signed-in visitor gets "Back to my page".
- **The artist page (`js/music-creator-profile.js`):** its owner gets "Edit my artist page" and "Build my front page".

## The Worker: `/v1/fronts` (`workers/mccluster/src/member-fronts.js`)

| Route | Who | What |
|---|---|---|
| `GET /v1/fronts/:handle` | anyone | The published page: never a draft, never a removed or private one. Checked again on the way out. `public, max-age=60`. |
| `GET /v1/fronts/me` | the account | Its handle, name, media folder, draft and published page. |
| `POST /v1/fronts/me` | the account | `{config, publish}`: checks the page and saves the draft (`publish:true` also publishes it). Refused with 403 `removed` if the house took it down. |
| `DELETE /v1/fronts/me/published` | the account | Takes the page down and keeps the draft. |
| `POST /v1/fronts/:handle/takedown` | the house owner | Removes a page (`{reason}`). The account cannot republish it. |

- **One check** (`packages/front-config`) decides what is stored. It is the same JSON shape and the same bounds as the
  house page's `@front` row, plus the rule only the server can know: media must be in this account's own folder.
- **The engine checks again as it reads.** `scripts/test/member-front-pages.test.mjs` holds the two to the same rules.
- **An account without a handle** gets 409 `handle_required`; the editor sends it to finish its account.

## The database: `supabase/pending/member_fronts_v1.sql` (pending)

- **`public.member_fronts`:** one row per account (`m_uid`), with `handle` unique, `draft`, `published`, `removed_at`
  and size checks.
  - Forced RLS, and revoked from `anon` and `authenticated`.
  - Only the Worker's service role reads or writes it.
- **The `front-media` bucket:**
  - Public: a front page is public, and a film is hundreds of frame requests that a signed URL could not serve.
  - 300 MB per file; images, MP4/WebM and audio only.
  - Every account owns one folder, its auth uid. Its policies let an account list, write, replace and remove only that
    folder. Nobody can list everyone's uploads, drafts included.
  - **Every account has room for one page, not a warehouse** (Codex #595): at most 2,500 files and 1 GiB in its folder
    (`public.front_media_has_room()`, checked on every write). A full page is four films of up to 320 frames, a 360 of
    up to 300 MB, a still and a track, with room to replace one before the sweep runs. Past either line the upload is
    refused and the editor says the storage is full.
- **Status.** Not applied in production. Until it is, `/v1/fronts` answers 503 (before the Worker is deployed with
  these routes, 404). Either way the editor says front pages are not switched on yet, and a visitor's
  `front.html?u=` says the page cannot be read right now.
- **Promotion** follows `supabase/pending/README.md`: apply, `git mv` into `migrations/`, ledger, drift contract, Core
  redeploy.

## Tests

| Suite | What |
|---|---|
| `scripts/e2e/member-front.e2e.mjs` | The whole flow in a real browser, against the real Worker routes and check over an in-memory database and bucket (detail below). |
| `scripts/test/member-front-pages.test.mjs` | Engine and Worker agree on links, media and bounds; the page, editor, doors, Worker wiring and SQL keep their contract. |
| `workers/mccluster/test/member-fronts.test.mjs` | The routes: own media only, drafts never public, takedown, private profiles, handle required. |
| `scripts/test-member-fronts-db.sh` | The SQL on a scratch Postgres, as the real API roles: the table is the Worker's alone; each bucket folder is held to its owner, with no listing, and to 2,500 files and 1 GiB. |

What the browser test covers, all at 390 and 1280 with no sideways scroll and no JavaScript errors:
- **Gates:** signed out, and an account with no handle.
- **Benji builds his page on a phone:**
  - typed words reach the preview as text;
  - a WebM is cut into 48 + 48 WebP frames in his folder;
  - a non-360 photo is refused, and a 360 photo and a WAV track go in;
  - a script link stops Save;
  - the opening view and a tag are taken from the preview's 360;
  - Save, then Publish.
- **A signed-out visitor:**
  - gets his page with his settings: phone frames on the phone, full frames on the desktop;
  - opens his 360 room with his tag;
  - follows his links.
- **The doors:**
  - the card redirects visitors, signed in or not;
  - `&card=1` keeps the card;
  - his own card shows "Edit my front page".
- **Edge cases:** a missing page says so; "Take it down" unpublishes and keeps the draft.
