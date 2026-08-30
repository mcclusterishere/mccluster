# LOADING A WALL: Drive links in, gallery out

For putting a shoot on the site: the groundbreaking, a rally, a runway, a
recap. You paste Drive links, push, and the wall builds itself.

## Why it works this way

The build sandbox can't reach Google Drive: the network policy answers
**403** to the connection, so nothing running in a session can download from
a Drive link no matter how it's shared. A **GitHub runner** has open
internet. So the links go into a file in the repo, and a workflow does the
pulling.

That's not a workaround, it's the better shape anyway: the intake file is a
record of where every wall's originals came from.

## Do this

### 1. Share the folder

In Drive: the folder → **Share** → **General access** → **Anyone with the
link** → **Viewer**.

This is the step that fails. If it's left on "Restricted", the runner gets a
Google login page instead of a photo and the workflow stops with a clear
error saying exactly that.

### 2. Paste the link

`data/walls-intake.json`:

```json
{
  "event": "candler-crossing",
  "prefix": "candler",
  "folder": "https://drive.google.com/drive/folders/1AbC...",
  "files": [],
  "cover": 1,
  "sell": true
}
```

| field | what it does |
|---|---|
| `event` | must match an `id` in `data/gallery.json`; that's the wall it lands on |
| `prefix` | the filenames it writes: `candler-01.jpg`, `candler-02.jpg`… |
| `folder` | one Drive **folder** link, the usual case |
| `files` | individual Drive **file** links, if you'd rather hand-pick |
| `cover` | which photo (1-based, in folder order) becomes the event cover |
| `sell` | `true` puts the stills in the print shop |

Use `folder` **or** `files` **or** both. Add a second object to `walls` to
load two shoots in one push.

### 3. Push

Committing `data/walls-intake.json` to `main` fires the workflow. Or run it
by hand: **Actions → Load a wall from Drive → Run workflow**, with an event
id to do just one.

## What it does to the files

- **HEIC → JPEG.** iPhones shoot HEIC and browsers don't display it.
- **Capped at 1800px wide, q3 JPEG.** Sharp on any screen, small enough that
  a wall of forty frames still opens fast on a phone. Clips get 1920p H.264
  with `faststart` so they play before they finish loading.
- **EXIF stripped.** Camera metadata carries the **GPS coordinates of where
  you were standing**. Those don't belong on a public site.
- **Renamed in folder order**, so the order you arranged in Drive is the
  order on the wall.
- **Originals aren't kept in the repo.** The web copies live in
  `assets/img/<event>/`; Drive stays the master. Don't delete the Drive
  folder; it's your negative.

Then `tools/wall-index.mjs` reads what actually landed on disk and writes
the `media[]` array and `cover` into `data/gallery.json`. It never invents
an entry for a photo that isn't there. Add ten more frames later, re-run,
and it picks them up.

## After it runs

The workflow commits to `main`, and `deploy-pages.yml` publishes. Then, by
hand:

1. **Write the `about`** for the event in `data/gallery.json`. That's the
   paragraph on the wall and it's the only part a script can't do.
2. **Check the cover.** It's the frame the whole gallery is judged on.
3. **Cull.** The workflow loads everything in the folder. A wall is stronger
   at twelve frames than at forty. Pull the ones that don't earn their
   place out of the Drive folder and re-run.

## When it fails

| Symptom | Cause |
|---|---|
| `Could not read the Drive folder` | Sharing is still Restricted |
| Downloads an HTML file instead of a photo | Same thing; that's the login page |
| `<id> is not an event in data/gallery.json` | Add the event there first |
| Some files missing from a big folder | gdown pages large folders; split it or use `files` |
| `nothing to commit` | Nothing downloaded; check the log's file list |

## Getting the wall found in search

Every wall gets its **own real page** at `walls/<event>.html`, generated
from `data/gallery.json` by:

    node tools/build-walls.mjs

It runs automatically at the end of every Drive load, so a new wall gets a
page without anyone remembering to make one.

### Why this had to exist

The gallery routes events on a hash: `gallery.html#/candler-crossing`.
Everything after a `#` is **the same URL** to a search engine. So every wall
shared one title, one description and one entry in the index, and none of
them could rank for anything. That is not a keyword problem and no amount
of copy fixes it. It needs real URLs, which is what these are.

### What each page carries

- **The client's name first in the `<title>`**, like "DeKalb County · Candler
  Crossing · Groundbreaking (June 11, 2026) | Photographed by Matthew
  McCluster". Somebody searching the client is searching those words.
- **The story in real HTML**, not injected by script. Crawlers do run
  JavaScript, but text that is in the source is text that is never missed.
- **Structured data joining three entities**: the `Event`, the
  `Organization` that commissioned it, and the `Person` who shot it. Every
  frame is an `ImageObject` whose `creator` and `copyrightHolder` point at
  the same Person node, `about` points at the client, and `isPartOf` points
  at the event. That triangle is the whole mechanism: it is what tells a
  search engine that this photographer and this client belong in the same
  answer.
- **Press citations** as real outbound links, when the event has `sources`.
  Being cited alongside the coverage is worth more than any keyword.
- **Descriptive alt text** on every frame, carrying event, client and place.
- Canonical URL, OG and Twitter cards off the wall's own cover.

### The two things that decide whether it works

1. **Fill in `about`, `client`, `venue`, `city` and `date` on every event.**
   The generator can only publish what the record holds. An event with no
   `about` gets a thin page, and thin pages do not rank.
2. **Get linked from somewhere else.** Ask the client to credit the
   photographs with a link: a county press release, a chapter's recap post,
   an event page. One link from a `.gov` or a news site is worth more than
   everything on this list combined, and it is the only part of this that
   can't be built in a repo.

### What this cannot do

It cannot make you outrank a client for their own name. Nothing can, and
anyone selling that is lying. What it does is make this the best-matching
page in the world for **"<client> + <event>"**, **"<event> photos"** and
**"<event> photographer"**, which is how people actually look for the person
who shot a thing they attended.
